// Drum hits from the band onset functions (adaptive peak picking). Kicks and snares are kept by small logistic
// models over each peak's features (how strong the onset is, how it stands out of the mix, how sharply the band
// rises over the moment before, how fast it decays, where it sits on the beat grid, whether a kick sweeps down),
// fitted against onsets from separated drum stems (docs/ANALYSIS.md); kicks are picked against the local level so
// the soft ones of a quiet chorus are candidates too, and among sure kicks the 100–600 Hz flux adds the ones on the
// previous kick's tail. Hats must decay fast. Accents: broadband onsets with a clear loudness jump (drops, stabs,
// crashes, the first hit after a gap or a short dropout).
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

/**
 * The local level of an onset function per 1 s block: the median of the block maxima within ±`half` blocks. `fps`
 * sizes the blocks.
 */
export function blockLevels(odf: Float32Array, half: number, fps = 100): Float64Array {
  const n = odf.length, bs = Math.max(1, Math.round(fps)), nBlocks = Math.ceil(n / bs);
  const bmax = new Float64Array(nBlocks), level = new Float64Array(nBlocks), win: number[] = [];
  for (let i = 0; i < n; i++) bmax[(i / bs) | 0] = Math.max(bmax[(i / bs) | 0], odf[i]);
  for (let b = 0; b < nBlocks; b++) {
    win.length = 0;
    for (let q = Math.max(0, b - half); q <= Math.min(nBlocks - 1, b + half); q++) win.push(bmax[q]);
    win.sort((x, y) => x - y);
    level[b] = win[win.length >> 1];
  }
  return level;
}

/** Böck-style peak picking: local maximum, above local mean + delta, at least minGap apart. `fps` sizes the blocks. */
export function pickPeaks(odf: Float32Array, o: PeakOptions, fps = 100): number[] {
  const n = odf.length, p99 = quantile(odf, 0.99);
  if (!(p99 > 0)) return [];
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + odf[i];
  // Level per 1 s block: the song's 99th percentile, or the local one.
  const bs = Math.max(1, Math.round(fps)), nBlocks = Math.ceil(n / bs);
  const level = o.local ? blockLevels(odf, o.local, fps).map(v => Math.min(p99, Math.max((o.localMin ?? 0) * p99, v))) : new Float64Array(nBlocks).fill(p99);
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

interface Gate {
  odf: number;
  dominance: number;
  rise: number;
  decay: number;
  grid4?: number;
  grid8?: number;
  grid16?: number;
  sweep?: number;
  bias: number;
  threshold: number;
}

/**
 * The kick and snare gates: logit = bias + Σ weight × feature, kept when the probability reaches `threshold`.
 * Features of a peak at frame f (band level = the kick bins, or the mel bands above 1 kHz):
 * - odf: ln of the onset value over its 99th percentile;
 * - dominance: ln of the onset value over the whole mix's amplitude 20 ms later;
 * - rise: ln of the band's peak level (f … f+40 ms) over its mean level 30–80 ms before;
 * - decay: the band's level 150 ms later over the peak;
 * - grid4 / grid8 / grid16: distance in beats to the nearest beat / eighth / sixteenth note;
 * - sweep: how far the kick bins' centroid moves from 10 to 60 ms after the peak, in bins (a kick sweeps down).
 * The old gates (dominance and a fast decay; a snare's 1–5 kHz rise ≥ 2 × its rise above 5 kHz) threw away most
 * kicks with a bass or a long tail under them and the bright snares of pop, and kept off-beat hats: against six
 * songs' drum stems the kick F went 0.72 → 0.79 and the snare F 0.49 → 0.79 (each song held out of its own fit).
 * That kick gate cost a logit of 4.2 a sixteenth off the eighth-note grid, which threw away the syncopated kicks of
 * drum & bass and rhythm-game music, most of all on a grid at half their tempo (where those kicks fall on the grid's
 * sixteenths), and it let through hundreds of guitar and bass thumps in songs with no drums. Refitted on 16 songs
 * (six of them drum & bass, J-core, hardcore or phonk, three ballads) with the sixteenth-note grid and the sweep
 * (docs/ANALYSIS.md). The snare gate leans on the beat: a grid half a beat off would cost the snares.
 */
const KICK_GATE: Gate = { odf: -0.343, dominance: 3.0915, rise: 0.0594, decay: -1.077, grid8: -6.3, grid16: -4.9591, sweep: -1.7644, bias: 2.1636, threshold: 0.46 };
const SNARE_GATE: Gate = { odf: 3.188, dominance: -0.2099, rise: -0.8695, decay: -2.6032, grid4: -8.6747, grid8: -11.9825, bias: 3.7696, threshold: 0.55 };

/**
 * Kicks on the previous kick's tail. Where the kick bins are still full of the last kick (drum & bass, J-core and
 * hardcore patterns, a busy chorus), the next one barely raises their amplitude and only 40–70 % of the stems' kicks
 * become candidates; the 100–600 Hz log flux (`ons.kickFlux`) still shows its sweep. Its peaks more than
 * 50 ms from every kick candidate are kept by this gate, but only with at least TAIL_SURE_MIN sure kicks (probability
 * ≥ TAIL_SURE in KICK_GATE) within ±TAIL_SPAN s: elsewhere, and all through a ballad, they are guitar, piano and voice
 * onsets that no feature told apart. Features: grid8 / grid16 as above, the sweep, and context = ln(1 + those sure
 * kicks); context weighs against (where the sure kicks are densest, the pattern is already found and the extra peaks
 * are hats and bass notes). Each song held out of its own fit, the mean kick F went 0.639 → 0.662 with the ballads'
 * false kicks unchanged (docs/ANALYSIS.md).
 */
const KICK_TAIL_GATE = { grid8: -3.3858, grid16: -8.1961, sweep: -0.7149, context: -1.2894, bias: 3.4282, threshold: 0.5 };
const TAIL_SURE = 0.9, TAIL_SURE_MIN = 5, TAIL_SPAN = 2;
/** Seconds from a `kickFlux` peak to the matching `kick` peak (latency 9 ms against 29 ms). */
const TAIL_SHIFT = 0.02;

/**
 * The tail-kick candidates: `kickFlux` peaks (picked like the kicks) moved onto the `kick` frame convention, without
 * those within 50 ms of a kick candidate.
 */
export function kickTailFrames(ons: Onsets, kickFrames: number[], fps = 100): number[] {
  const ms = (x: number) => Math.round((x * fps) / 1000);
  const peaks = pickPeaks(ons.kickFlux, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.35, minGap: ms(60), local: KICK_LOCAL, localMin: KICK_LOCAL_MIN }, fps);
  const out: number[] = [];
  let j = 0;
  for (const g of peaks) {
    const f = g + Math.round(TAIL_SHIFT * fps);
    while (j < kickFrames.length && kickFrames[j] < f - ms(50)) j++;
    if (j < kickFrames.length && kickFrames[j] <= f + ms(50)) continue;
    out.push(f);
  }
  return out;
}

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
  /** The strength of a kept hit: its onset value (over the 99th percentile) scaled by the probability, 0.35 at the threshold … 1. */
  const strength = (v: number, p: number, threshold: number) => Math.min(1, v) * Math.min(1, 0.35 + (0.65 * (p - threshold)) / (1 - threshold));
  /**
   * Peaks → hits through a gate (see KICK_GATE). `centroid` (ons.kickCentroid) feeds the sweep term; `sure` collects
   * the times of the peaks with probability ≥ TAIL_SURE.
   */
  const gated = (odf: Float32Array, frames: number[], latency: number, level: Float32Array, g: Gate, centroid?: Float32Array, sure?: number[]): Hit[] => {
    const p99 = quantile(odf, 0.99) || 1, T = odf.length, ln = (x: number) => Math.log(x + 1e-4);
    const out: Hit[] = [];
    for (const f of frames) {
      const t = f / fps - latency;
      let pk = 0, pre = 0, n = 0;
      for (let k = f; k < Math.min(T, f + 5); k++) if (level[k] > pk) pk = level[k];
      for (let k = Math.max(0, f - 8); k <= Math.max(0, f - 3); k++) { pre += level[k]; n++; }
      let logit = g.bias + g.odf * ln(odf[f] / p99) + g.dominance * ln(odf[f] / (fullAmp[Math.min(T - 1, f + 2)] || 1e-12))
        + g.rise * ln(pk / (pre / Math.max(1, n) || 1e-12)) + g.decay * (level[Math.min(T - 1, f + 15)] / (pk || 1e-12));
      if (g.grid4) logit += g.grid4 * gridDistance(beats, t, 1);
      if (g.grid8) logit += g.grid8 * gridDistance(beats, t, 2);
      if (g.grid16) logit += g.grid16 * gridDistance(beats, t, 4);
      if (g.sweep && centroid) logit += g.sweep * (centroid[Math.min(T - 1, f + 6)] - centroid[Math.min(T - 1, f + 1)]);
      const p = 1 / (1 + Math.exp(-logit));
      if (sure && p >= TAIL_SURE) sure.push(t);
      if (p < g.threshold) continue;
      out.push([round3(Math.max(0, t)), round3(strength(odf[f] / p99, p, g.threshold))]);
    }
    return out;
  };
  const kickFrames = pickPeaks(ons.kick, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.35, minGap: ms(90), local: KICK_LOCAL, localMin: KICK_LOCAL_MIN }, fps);
  const sure: number[] = [];
  const kick = gated(ons.kick, kickFrames, LATENCY.kick, ons.lowLevel, KICK_GATE, ons.kickCentroid, sure);
  // Kicks on the previous kick's tail (KICK_TAIL_GATE), as strong as their flux peak.
  const nf = ons.kick.length, fx99 = quantile(ons.kickFlux, 0.99) || 1, back = Math.round(TAIL_SHIFT * fps);
  const sureFrom = (t: number) => { let lo = 0, hi = sure.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sure[m] < t) lo = m + 1; else hi = m; } return lo; };
  for (const f of kickTailFrames(ons, kickFrames, fps)) {
    const t = f / fps - LATENCY.kick, n = sureFrom(t + TAIL_SPAN) - sureFrom(t - TAIL_SPAN);
    if (n < TAIL_SURE_MIN) continue;
    const g = KICK_TAIL_GATE, c = ons.kickCentroid;
    const logit = g.bias + g.grid8 * gridDistance(beats, t, 2) + g.grid16 * gridDistance(beats, t, 4)
      + g.sweep * (c[Math.min(nf - 1, f + 6)] - c[Math.min(nf - 1, f + 1)]) + g.context * Math.log1p(n);
    const p = 1 / (1 + Math.exp(-logit));
    if (p < g.threshold) continue;
    let v = 0;
    for (let k = Math.max(0, f - back - 1); k <= Math.min(nf - 1, f - back + 1); k++) v = Math.max(v, ons.kickFlux[k]);
    kick.push([round3(Math.max(0, t)), round3(strength(v / fx99, p, g.threshold))]);
  }
  kick.sort((a, b) => a[0] - b[0]);
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

  // Accents: flux peaks whose level jumps by ≥ 6 dB against the preceding 400 ms and that are clearly audible. A hit
  // right after a short dropout in a loud passage (a stutter cut, a gated break) barely moves that mean, so a strong,
  // loud flux peak also counts when it rises ≥ 12 dB over the lowest level of the 30–300 ms before it, and that dip
  // is 6 dB deeper than the usual one of the flux peaks within ±4 s (where every beat pumps, every beat dips).
  const ref = quantile(levelDb, 0.95), T = levelDb.length;
  const cand = pickPeaks(ons.flux, { maxHalf: ms(50), avgHalf: ms(300), delta: 0.15, minGap: ms(150) });
  const fp99 = quantile(ons.flux, 0.99) || 1;
  const peak = cand.map(f => {
    let after = -Infinity;
    for (let k = f; k <= Math.min(T - 1, f + ms(150)); k++) after = Math.max(after, levelDb[k]);
    return after;
  });
  const dip = cand.map((f, i) => {
    let low = Infinity;
    for (let k = Math.max(0, f - ms(300)); k <= f - ms(30); k++) low = Math.min(low, levelDb[k]);
    return peak[i] - low;
  });
  const acc: Array<[number, number]> = [];
  cand.forEach((f, i) => {
    const after = peak[i];
    let before = 0, cnt = 0;
    for (let k = Math.max(0, f - ms(400)); k < Math.max(0, f - ms(50)); k++) { before += levelDb[k]; cnt++; }
    if (!cnt) return;
    let jump = after - before / cnt;
    if (jump < 6 || after < ref - 20) {
      if (!(dip[i] >= 12 && ons.flux[f] >= 1.5 * fp99 && after >= ref - 6)) return;
      const near: number[] = [];
      cand.forEach((g, j) => { if (j !== i && Math.abs(g - f) <= ms(4000)) near.push(dip[j]); });
      near.sort((a, b) => a - b);
      if (near.length && dip[i] < near[near.length >> 1] + 6) return;
      jump = Math.max(jump, 6 + (dip[i] - 12) / 2);
    }
    const strength = Math.min(1, Math.max(0, (jump - 6) / 18 + 0.25 + 0.35 * Math.min(1, ons.flux[f] / fp99)));
    acc.push([f, strength]);
  });
  // Keep accents at least 400 ms apart, strongest first.
  acc.sort((a, b) => b[1] - a[1]);
  const kept: Array<[number, number]> = [];
  for (const a of acc) if (kept.every(k => Math.abs(k[0] - a[0]) >= ms(400))) kept.push(a);
  kept.sort((a, b) => a[0] - b[0]);
  const accent = kept.map(([f, s]) => [round3(Math.max(0, f / fps - LATENCY.accent)), round3(s)] as Hit);
  return { kick, snare, hat, accent };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
