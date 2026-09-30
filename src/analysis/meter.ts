// Bar phase and meter. Each beat gets downbeat evidence (bass and harmony change, timbre and loudness change,
// kick, lyric line starts, section changes) and backbeat evidence (snare); a Viterbi over the position in the
// bar picks the phase, allowing rare phase jumps. 3/4 is chosen only when the downbeat evidence repeats clearly
// better every 3 and 6 beats than every 4 and 8.
import type { LyricLine } from '../types.ts';
import { blockDistance, N_MFCC, type BeatFeatures } from './features.ts';
import { quantile, robustZ } from './util.ts';

export interface MeterResult {
  meter: number;
  /** Position in the bar per beat, 0 = downbeat. */
  beatInBar: number[];
  /** Downbeat evidence per beat (z-score scale), reused by the section finder. */
  evidence: Float32Array;
}

const PHASE_JUMP = 16;

export function detectMeter(f: BeatFeatures, beats: number[], lyrics?: LyricLine[]): MeterResult {
  const n = f.n;
  if (n < 8) return { meter: 4, beatInBar: beats.map((_, i) => i % 4), evidence: new Float32Array(n) };
  const hc = new Float32Array(n), bc = new Float32Array(n), tc = new Float32Array(n), dd = new Float32Array(n), ly = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hc[i] = blockDistance(f.chroma, 12, n, i, i + 2, i - 2, i);
    bc[i] = blockDistance(f.bass, 12, n, i, i + 2, i - 2, i);
    let d = 0;
    for (let k = 1; k < N_MFCC; k++) {
      let sa = 0, sb = 0, na = 0, nb = 0;
      for (let q = i; q < Math.min(n, i + 4); q++) { sa += f.mfcc[q * N_MFCC + k]; na++; }
      for (let q = Math.max(0, i - 4); q < i; q++) { sb += f.mfcc[q * N_MFCC + k]; nb++; }
      if (na && nb) d += (sa / na - sb / nb) ** 2;
    }
    tc[i] = Math.sqrt(d);
    let ua = 0, ub = 0, na = 0, nb = 0;
    for (let q = i; q < Math.min(n, i + 4); q++) { ua += f.db[q]; na++; }
    for (let q = Math.max(0, i - 4); q < i; q++) { ub += f.db[q]; nb++; }
    dd[i] = na && nb ? Math.abs(ua / na - ub / nb) : 0;
  }
  if (lyrics && lyrics.length) {
    // A line that starts within half a beat of a beat (singers often start just before the bar).
    for (const l of lyrics) {
      let j = 0;
      while (j + 1 < n && beats[j + 1] <= l.start) j++;
      const k = j + 1 < n && beats[j + 1] - l.start < l.start - beats[j] ? j + 1 : j;
      const iv = k + 1 < n ? beats[k + 1] - beats[k] : k > 0 ? beats[k] - beats[k - 1] : 0.5;
      if (Math.abs(l.start - beats[k]) <= 0.5 * iv) ly[k] += 1;
    }
  }
  const zc = (a: Float32Array) => {
    const z = robustZ(a);
    for (let i = 0; i < n; i++) z[i] = Math.max(-3, Math.min(6, z[i]));
    return z;
  };
  const zh = zc(hc), zb = zc(bc), zt = zc(tc), zd = zc(dd), zk = zc(f.kick), zs = zc(f.snare);
  // Quiet beats (fades, near-silent intros and tails) carry little weight: 1 within 12 dB of the loud level.
  const ref = quantile(f.db, 0.9);
  const down = new Float32Array(n), back = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = Math.min(1, Math.max(0, (f.db[i] - (ref - 24)) / 12));
    down[i] = w * (1.0 * zb[i] + 0.5 * zh[i] + 0.5 * zt[i] + 0.3 * zd[i] + 0.3 * zk[i] + 0.5 * Math.min(1, ly[i]));
    back[i] = w * (zs[i] - 0.5 * zk[i]);
  }
  const best4 = viterbiBars(down, back, 4);
  let meter = 4, path = best4.path;
  if (n >= 24) {
    const ac = (lag: number) => {
      let s = 0, c = 0;
      for (let i = 0; i + lag < n; i++) { s += down[i] * down[i + lag]; c++; }
      return c ? s / c : 0;
    };
    const a3 = ac(3) + ac(6), a4 = ac(4) + ac(8);
    if (a3 > 0 && a3 > 1.5 * Math.max(a4, 0) + 0.2) {
      meter = 3;
      path = viterbiBars(down, back, 3).path;
    }
  }
  return { meter, beatInBar: path, evidence: down };
}

/** Best position-in-bar sequence: q → q+1 (mod M) is free, any other move costs PHASE_JUMP. */
function viterbiBars(down: Float32Array, back: Float32Array, M: number): { path: number[]; score: number } {
  const n = down.length;
  const emit = (i: number, q: number) => {
    if (q === 0) return down[i] - 0.3 * back[i];
    // Backbeats: 2 and 4 in 4/4, 2 and 3 in 3/4.
    const isBack = M === 4 ? q === 1 || q === 3 : true;
    return isBack ? 0.3 * back[i] : 0.15 * -back[i];
  };
  let score = new Float64Array(M), next = new Float64Array(M);
  const bp = new Int8Array(n * M);
  for (let q = 0; q < M; q++) score[q] = emit(0, q);
  for (let i = 1; i < n; i++) {
    let gBest = -Infinity, gArg = 0;
    for (let q = 0; q < M; q++) if (score[q] > gBest) { gBest = score[q]; gArg = q; }
    for (let q = 0; q < M; q++) {
      const prev = (q + M - 1) % M;
      let b = score[prev], arg = prev;
      if (gBest - PHASE_JUMP > b) { b = gBest - PHASE_JUMP; arg = gArg; }
      next[q] = b + emit(i, q);
      bp[i * M + q] = arg;
    }
    const t = score; score = next; next = t;
  }
  let q = 0;
  for (let k = 1; k < M; k++) if (score[k] > score[q]) q = k;
  const total = score[q];
  const path = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    path[i] = q;
    q = bp[i * M + q];
  }
  return { path, score: total };
}
