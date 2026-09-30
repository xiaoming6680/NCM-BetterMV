// Drum hits from the band onset functions (adaptive peak picking) that are percussive transients: kicks and snares
// must dominate the mix for a moment and decay fast, hats must decay fast, so bass/guitar notes, strums and sustained
// vocals are not counted as drums; a snare must crack below 5 kHz more than above (else it is a hat), and kicks are
// picked against the local level so the soft ones of a quiet chorus count too. Accents: broadband onsets with a clear loudness jump (drops, stabs, crashes, the
// first hit after a gap).
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

/**
 * Percussiveness of a peak at frame f: how strongly the band's rise dominates the whole mix right after it, and how
 * fast the band decays (level 150 ms later relative to the peak). Drums score > 0; bass or guitar notes, which rise
 * inside a full mix and ring on, score < 0. `rc`/`rs` centre and scale the dominance for the band.
 */
function percussive(odf: Float32Array, level: Float32Array, full: Float32Array, f: number, rc: number, rs: number): number {
  const T = odf.length;
  let pk = 0;
  for (let k = f; k < Math.min(T, f + 5); k++) if (level[k] > pk) pk = level[k];
  const decay = level[Math.min(T - 1, f + 15)] / (pk || 1e-12);
  const dominance = odf[f] / (full[Math.min(T - 1, f + 2)] || 1e-12);
  return (dominance - rc) / rs - (decay - 0.5) / 0.15;
}

/** Hits whose percussiveness is below this are dropped (tuned so drum hits pass and bass/guitar notes mostly do not). */
const PERCUSSIVE_MIN = -0.5;
/** Kicks are picked against the local level (±4 s), but not below this share of the song's (see pickPeaks). */
const KICK_LOCAL = 4, KICK_LOCAL_MIN = 0.5;
/** A snare's amplitude rise over 1–5 kHz must be at least this many times its rise above 5 kHz. */
const SNARE_MID = 2;

/**
 * @param levelDb frame level in dB (for accents)
 * @param fullAmp frame RMS amplitude (linear)
 */
export function* detectHits(
  ons: Onsets,
  fps: number,
  levelDb: Float32Array,
  fullAmp: Float32Array,
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
  /** Peaks → hits; drum bands are gated by percussiveness, which also scales the strength (0.35..1). */
  const toHits = (odf: Float32Array, frames: number[], latency: number, level?: Float32Array, rc = 0, rs = 1): Hit[] => {
    const p99 = quantile(odf, 0.99) || 1;
    const out: Hit[] = [];
    for (const f of frames) {
      let w = 1;
      if (level) {
        const sc = percussive(odf, level, fullAmp, f, rc, rs);
        if (sc < PERCUSSIVE_MIN) continue;
        w = Math.min(1, Math.max(0.35, 0.7 + 0.15 * sc));
      }
      out.push([round3(Math.max(0, f / fps - latency)), round3(Math.min(1, odf[f] / p99) * w)]);
    }
    return out;
  };
  const kick = toHits(ons.kick, pickPeaks(ons.kick, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.35, minGap: ms(90), local: KICK_LOCAL, localMin: KICK_LOCAL_MIN }, fps), LATENCY.kick, ons.lowLevel, 1.0, 0.2);
  yield* pause(0.25);
  // A snare or clap cracks in the 1–5 kHz bands; a hat, even an open one, rises mostly above 5 kHz. (Against Clarity's
  // drum stem most false snares were hats: 1–5 kHz / above-5 kHz rise ratio p50 1.7 for hats, 2.5 for snares, 9 for
  // claps; the gate took snare precision from 0.32 to 0.64 at a small loss of recall.)
  const snareFrames = pickPeaks(ons.snare, { maxHalf: ms(30), avgHalf: ms(100), delta: 0.45, minGap: ms(80) }).filter(f => {
    let mid = 0, high = 0;
    for (let k = Math.max(0, f - 1); k <= Math.min(ons.snare.length - 1, f + 1); k++) {
      mid = Math.max(mid, ons.snareMid[k]);
      high = Math.max(high, ons.snareHigh[k]);
    }
    return mid >= SNARE_MID * high;
  });
  const snare = toHits(ons.snare, snareFrames, LATENCY.snare, ons.highLevel, 0.13, 0.06);
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
