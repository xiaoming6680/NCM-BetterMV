// Drum hits from the band onset functions (adaptive peak picking). Kicks and snares are kept by small logistic
// models over each peak's features (how strong the onset is, how it stands out of the mix, how sharply the band
// rises over the moment before, how fast it decays, where it sits on the beat grid), fitted on six songs against
// onsets from separated drum stems (docs/ANALYSIS.md); kicks are picked against the local level so the soft ones of
// a quiet chorus are candidates too. Hats must decay fast. Accents: broadband onsets with a clear loudness jump
// (drops, stabs, crashes, the first hit after a gap).
import type { Hit } from '../types.ts';
import type { Onsets } from './onset.ts';
import { quantile, type Slicer } from './util.ts';

interface PeakOptions {
  /** Local-maximum half window (frames). */
  maxHalf: number;
  /** Moving-average half window (frames) for the adaptive threshold. */
  avgHalf: number;
  /** Threshold above the local average, as a fraction of the 99th percentile (or of the local level, see `local`). */
  delta: number;
  /** Minimum distance between hits (frames). */
  minGap: number;
  /**
   * Scale delta and the floor by the local level instead of the song's: the median of the 1 s block maxima within
   * ±`local` blocks, but at least `localMin` × the 99th percentile. (Soft kicks under a quiet chorus are still hits.)
   */
  local?: number;
  localMin?: number;
}

/** Böck-style peak picking: local maximum, above local mean + delta, at least minGap apart. `fps` sizes the blocks. */
export function pickPeaks(odf: Float32Array, o: PeakOptions, fps = 100): number[] {
  const n = odf.length, p99 = quantile(odf, 0.99);
  if (!(p99 > 0)) return [];
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + odf[i];
  // Level per 1 s block: the song's 99th percentile, or the local one.
  const bs = Math.max(1, Math.round(fps)), nBlocks = Math.ceil(n / bs);
  const level = new Float64Array(nBlocks).fill(p99);
  if (o.local) {
    const bmax = new Float64Array(nBlocks);
    for (let i = 0; i < n; i++) bmax[(i / bs) | 0] = Math.max(bmax[(i / bs) | 0], odf[i]);
    const win: number[] = [];
    for (let b = 0; b < nBlocks; b++) {
      win.length = 0;
      for (let q = Math.max(0, b - o.local); q <= Math.min(nBlocks - 1, b + o.local); q++) win.push(bmax[q]);
      win.sort((x, y) => x - y);
      level[b] = Math.min(p99, Math.max((o.localMin ?? 0) * p99, win[win.length >> 1]));
    }
  }
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = odf[i], lv = level[(i / bs) | 0];
    if (v < 0.05 * lv) continue;
    const delta = o.delta * lv;
    let isMax = true;
    for (let j = Math.max(0, i - o.maxHalf); j <= Math.min(n - 1, i + o.maxHalf); j++) {
      if (odf[j] > v || (odf[j] === v && j < i)) { isMax = false; break; }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - o.avgHalf), b = Math.min(n, i + o.avgHalf + 1);
    if (v < (cs[b] - cs[a]) / (b - a) + delta) continue;
    if (i - last < o.minGap) continue;
    out.push(i);
    last = i;
  }
  return out;
}

/**
 * Detector latency (s) of each onset function against the actual transient (46 ms window, 20 ms flux lag), measured
 * on hand-annotated drum onsets. Subtracted from the peak frame times.
 */
export const LATENCY = { kick: 0.029, snare: 0.005, hat: 0.007, accent: 0.004 };

/** Kicks are picked against the local level (±4 s), but not below this share of the song's (see pickPeaks). */
const KICK_LOCAL = 4, KICK_LOCAL_MIN = 0.5;

/**
 * The kick and snare gates: logit = bias + Σ weight × feature, kept when the probability reaches `threshold`.
 * Features of a peak at frame f (band level = the kick bins, or the mel bands above 1 kHz):
 * - odf: ln of the onset value over its 99th percentile;
 * - dominance: ln of the onset value over the whole mix's amplitude 20 ms later;
 * - rise: ln of the band's peak level (f … f+40 ms) over its mean level 30–80 ms before;
 * - decay: the band's level 150 ms later over the peak;
 * - grid4 / grid8: distance in beats to the nearest beat / eighth note.
 * The old gates (dominance and a fast decay; a snare's 1–5 kHz rise ≥ 2 × its rise above 5 kHz) threw away most
 * kicks with a bass or a long tail under them and the bright snares of pop, and kept off-beat hats: against six
 * songs' drum stems the kick F went 0.72 → 0.79 and the snare F 0.49 → 0.79 (each song held out of its own fit).
 * The snare gate leans on the beat: a grid half a beat off would cost the snares.
 */
const KICK_GATE = { odf: 2.0946, dominance: -0.2519, rise: 0.5866, decay: 0, grid4: 0, grid8: -16.6363, bias: 1.6905, threshold: 0.34 };
const SNARE_GATE = { odf: 3.188, dominance: -0.2099, rise: -0.8695, decay: -2.6032, grid4: -8.6747, grid8: -11.9825, bias: 3.7696, threshold: 0.55 };

/** Distance in beats from t to the nearest point of the beat grid divided into `div` per beat. */
function gridDistance(beats: ArrayLike<number>, t: number, div: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  const ph = ((t - beats[lo]) / (beats[hi] - beats[lo] || 0.5)) * div;
  return Math.abs(ph - Math.round(ph)) / div;
}

/**
 * @param levelDb frame level in dB (for accents)
 * @param fullAmp frame RMS amplitude (linear)
 */
export function* detectHits(
  ons: Onsets,
  fps: number,
  levelDb: Float32Array,
  fullAmp: Float32Array,
  beats: ArrayLike<number>,
  slicer: Slicer,
  p0: number,
  p1: number,
): Generator<number, { kick: Hit[]; snare: Hit[]; hat: Hit[]; accent: Hit[] }, void> {
  const ms = (x: number) => Math.round((x * fps) / 1000);
  function* pause(p: number): Generator<number, void, void> {
    if (slicer.due()) {
      yield p0 + (p1 - p0) * p;
      slicer.resume();
    }
  }
  /** Peaks → hits, without a gate (hats). */
  const toHits = (odf: Float32Array, frames: number[], latency: number): Hit[] => {
    const p99 = quantile(odf, 0.99) || 1;
    return frames.map(f => [round3(Math.max(0, f / fps - latency)), round3(Math.min(1, odf[f] / p99))] as Hit);
  };
  /** Peaks → hits through a gate (see KICK_GATE); the probability also scales the strength (0.35 at the threshold … 1). */
  const gated = (odf: Float32Array, frames: number[], latency: number, level: Float32Array, g: typeof KICK_GATE): Hit[] => {
    const p99 = quantile(odf, 0.99) || 1, T = odf.length, ln = (x: number) => Math.log(x + 1e-4);
    const out: Hit[] = [];
    for (const f of frames) {
      const t = f / fps - latency;
      let pk = 0, pre = 0, n = 0;
      for (let k = f; k < Math.min(T, f + 5); k++) if (level[k] > pk) pk = level[k];
      for (let k = Math.max(0, f - 8); k <= Math.max(0, f - 3); k++) { pre += level[k]; n++; }
      const logit = g.bias + g.odf * ln(odf[f] / p99) + g.dominance * ln(odf[f] / (fullAmp[Math.min(T - 1, f + 2)] || 1e-12))
        + g.rise * ln(pk / (pre / Math.max(1, n) || 1e-12)) + g.decay * (level[Math.min(T - 1, f + 15)] / (pk || 1e-12))
        + g.grid4 * gridDistance(beats, t, 1) + g.grid8 * gridDistance(beats, t, 2);
      const p = 1 / (1 + Math.exp(-logit));
      if (p < g.threshold) continue;
      const w = Math.min(1, 0.35 + (0.65 * (p - g.threshold)) / (1 - g.threshold));
      out.push([round3(Math.max(0, t)), round3(Math.min(1, odf[f] / p99) * w)]);
    }
    return out;
  };
  const kick = gated(ons.kick, pickPeaks(ons.kick, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.35, minGap: ms(90), local: KICK_LOCAL, localMin: KICK_LOCAL_MIN }, fps), LATENCY.kick, ons.lowLevel, KICK_GATE);
  yield* pause(0.25);
  const snare = gated(ons.snare, pickPeaks(ons.snare, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.45, minGap: ms(80) }), LATENCY.snare, ons.highLevel, SNARE_GATE);
  yield* pause(0.5);
  // Hats are quiet, so only their decay is checked: the > 6 kHz level must fall to ≤ 65 % within 80 ms (a strummed
  // guitar or a sung sibilant rings on).
  const hatFrames = pickPeaks(ons.hat, { maxHalf: ms(20), avgHalf: ms(80), delta: 0.45, minGap: ms(50) }).filter(f => {
    const T = ons.hatLevel.length;
    let pk = 0;
    for (let k = f; k < Math.min(T, f + 4); k++) if (ons.hatLevel[k] > pk) pk = ons.hatLevel[k];
    return ons.hatLevel[Math.min(T - 1, f + ms(80))] <= 0.65 * pk;
  });
  const hat = toHits(ons.hat, hatFrames, LATENCY.hat);
  yield* pause(0.75);

  // Accents: flux peaks whose level jumps by ≥ 6 dB against the preceding 400 ms and that are clearly audible.
  const ref = quantile(levelDb, 0.95);
  const cand = pickPeaks(ons.flux, { maxHalf: ms(50), avgHalf: ms(300), delta: 0.15, minGap: ms(150) });
  const fp99 = quantile(ons.flux, 0.99) || 1;
  const acc: Array<[number, number]> = [];
  for (const f of cand) {
    let after = -Infinity;
    for (let k = f; k <= Math.min(levelDb.length - 1, f + ms(150)); k++) after = Math.max(after, levelDb[k]);
    let before = 0, cnt = 0;
    for (let k = Math.max(0, f - ms(400)); k < Math.max(0, f - ms(50)); k++) { before += levelDb[k]; cnt++; }
    if (!cnt) continue;
    const jump = after - before / cnt;
    if (jump < 6 || after < ref - 20) continue;
    const strength = Math.min(1, Math.max(0, (jump - 6) / 18 + 0.25 + 0.35 * Math.min(1, ons.flux[f] / fp99)));
    acc.push([f, strength]);
  }
  // Keep accents at least 400 ms apart, strongest first.
  acc.sort((a, b) => b[1] - a[1]);
  const kept: Array<[number, number]> = [];
  for (const a of acc) if (kept.every(k => Math.abs(k[0] - a[0]) >= ms(400))) kept.push(a);
  kept.sort((a, b) => a[0] - b[0]);
  const accent = kept.map(([f, s]) => [round3(Math.max(0, f / fps - LATENCY.accent)), round3(s)] as Hit);
  return { kick, snare, hat, accent };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
