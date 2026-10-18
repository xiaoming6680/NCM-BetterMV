// Local tempo: an autocorrelation tempogram of the beat novelty (8 s windows every 0.5 s) and a Viterbi path through
// it, weighted by a log-normal tempo prior, so gradual tempo changes are followed while octave jumps need long,
// consistent evidence. Windows with little rhythmic evidence (quiet, arrhythmic) get a small weight, so the path
// keeps the tempo of its neighbours there instead of drifting to the prior. The tempogram is computed once; the
// path is cheap and can be re-run with another prior (e.g. to follow a BPM hint to another octave).
import { chunked, quantile, type Slicer } from './util.ts';

export interface Tempogram {
  /** Number of windows, tempo states and frames. */
  M: number;
  S: number;
  T: number;
  fps: number;
  hop: number;
  /** Beat period (frames) of each tempo state, 1 % apart. */
  periods: Float64Array;
  /** M × S log salience, log(0.05 + normalised autocorrelation), before the prior. */
  salience: Float32Array;
  /** Confidence 0..1 of each window (novelty energy × periodicity × loudness). */
  confidence: Float32Array;
}

export interface TempoCurve {
  /** Beat period in frames for every frame. */
  period: Float32Array;
  /** Viterbi path (BPM) at the tempogram hop. */
  pathBpm: Float32Array;
  hop: number;
}

export const MIN_BPM = 48;
export const MAX_BPM = 230;
const STEP = 1.01; // tempo states are 1 % apart
const MAX_STEP = 4; // states per hop without a jump (≈ 8 %/s)
const STEP_COST = 0.3;
const JUMP_COST = 30;

/** Catmull-Rom interpolation of `a` at fractional index x (1 ≤ x ≤ length − 3). */
function cubicAt(a: Float64Array, x: number): number {
  const i = Math.floor(x), f = x - i;
  const p0 = a[i - 1], p1 = a[i], p2 = a[i + 1], p3 = a[i + 2];
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * @param nov beat novelty at `fps`
 * @param weight optional per-frame reliability 0..1 (loudness relative to the song's loud parts)
 */
export function* tempogram(
  nov: Float32Array,
  fps: number,
  slicer: Slicer,
  p0: number,
  p1: number,
  weight?: Float32Array,
): Generator<number, Tempogram, void> {
  const T = nov.length;
  const hop = Math.round(fps * 0.5);
  const W = Math.round(fps * 8);
  const pMin = (60 * fps) / MAX_BPM, pMax = (60 * fps) / MIN_BPM;
  const S = Math.floor(Math.log(pMax / pMin) / Math.log(STEP)) + 1;
  const periods = new Float64Array(S);
  for (let s = 0; s < S; s++) periods[s] = pMin * Math.pow(STEP, s);
  const lagMax = Math.ceil(pMax) + 3;
  const M = Math.max(1, Math.ceil(T / hop));
  const win = new Float64Array(W);
  for (let u = 0; u < W; u++) win[u] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (u + 0.5)) / W);
  const seg = new Float64Array(W), ac = new Float64Array(lagMax + 1), vals = new Float64Array(S);
  const salience = new Float32Array(M * S);
  const energy = new Float64Array(M), peak = new Float64Array(M), loud = new Float64Array(M);

  const windows = (m0: number, m1: number) => {
    for (let m = m0; m < m1; m++) {
      const a = m * hop - (W >> 1);
      let mu = 0, cnt = 0, wsum = 0, wn = 0;
      for (let u = 0; u < W; u++) {
        const i = a + u;
        if (i >= 0 && i < T) {
          mu += nov[i]; cnt++;
          if (weight) { wsum += weight[i] * win[u]; wn += win[u]; }
        }
      }
      mu = cnt ? mu / cnt : 0;
      loud[m] = weight ? (wn > 0 ? wsum / wn : 0) : 1;
      for (let u = 0; u < W; u++) {
        const i = a + u;
        seg[u] = i >= 0 && i < T ? (nov[i] - mu) * win[u] : 0;
      }
      for (let lag = 0; lag <= lagMax; lag++) {
        let s = 0;
        for (let u = 0, v = lag; v < W; u++, v++) s += seg[u] * seg[v];
        ac[lag] = (s * W) / (W - lag);
      }
      const a0 = ac[0] > 1e-12 ? ac[0] : 1;
      let mx = 0;
      for (let s = 0; s < S; s++) {
        const v = cubicAt(ac, periods[s]) / a0;
        vals[s] = v > 0 ? v : 0;
        if (vals[s] > mx) mx = vals[s];
      }
      energy[m] = ac[0];
      peak[m] = mx;
      const o = m * S;
      for (let s = 0; s < S; s++) salience[o + s] = mx > 0 ? Math.log(0.05 + vals[s] / mx) : Math.log(0.05);
    }
  };
  yield* chunked(M, 2, windows, slicer, p0, p1);

  const eSorted = Float64Array.from(energy).sort();
  const eMed = eSorted[M >> 1] || 1;
  const confidence = new Float32Array(M);
  for (let m = 0; m < M; m++) confidence[m] = Math.min(1, energy[m] / eMed) * Math.min(1, peak[m] / 0.5) * loud[m];
  return { M, S, T, fps, hop, periods, salience, confidence };
}

/** Viterbi tempo path with a log-normal prior (centre BPM, width in octaves), smoothed and interpolated to frames. */
export function tempoPath(tg: Tempogram, priorBpm = 120, priorOctaves = 1): TempoCurve {
  const { M, S, T, fps, hop, periods, salience, confidence } = tg;
  const logPrior = new Float64Array(S);
  for (let s = 0; s < S; s++) {
    const oct = Math.log2((60 * fps) / periods[s] / priorBpm) / priorOctaves;
    logPrior[s] = -0.5 * oct * oct;
  }
  // Windows without evidence still lean (very slightly) on the prior, so silence gets the prior tempo, not a state
  // picked by tie-breaking.
  const emit = (m: number, s: number) => confidence[m] * (salience[m * S + s] + logPrior[s]) + 1e-3 * logPrior[s];
  const back = new Int16Array(M * S);
  let score = new Float64Array(S), next = new Float64Array(S);
  for (let s = 0; s < S; s++) score[s] = emit(0, s);
  for (let m = 1; m < M; m++) {
    let gBest = -Infinity, gArg = 0;
    for (let s = 0; s < S; s++) if (score[s] > gBest) { gBest = score[s]; gArg = s; }
    const o = m * S;
    for (let s = 0; s < S; s++) {
      let b = gBest - JUMP_COST, arg = gArg;
      const lo = Math.max(0, s - MAX_STEP), hi = Math.min(S - 1, s + MAX_STEP);
      for (let q = lo; q <= hi; q++) {
        const d = q - s;
        const v = score[q] - STEP_COST * d * d;
        if (v > b) { b = v; arg = q; }
      }
      next[s] = b + emit(m, s);
      back[o + s] = arg;
    }
    const tmp = score; score = next; next = tmp;
  }
  const path = new Int32Array(M);
  let best = 0;
  for (let s = 1; s < S; s++) if (score[s] > score[best]) best = s;
  path[M - 1] = best;
  for (let m = M - 1; m > 0; m--) path[m - 1] = back[m * S + path[m]];

  // Smooth the log period over ±1 s (not across jumps), then interpolate to frames.
  const logP = new Float64Array(M);
  for (let m = 0; m < M; m++) logP[m] = Math.log(periods[path[m]]);
  const sm = new Float64Array(M);
  const R = 2;
  for (let m = 0; m < M; m++) {
    let s = 0, w = 0;
    for (let k = -R; k <= R; k++) {
      const j = m + k;
      if (j < 0 || j >= M || Math.abs(logP[j] - logP[m]) > 0.1) continue;
      const wk = R + 1 - Math.abs(k);
      s += logP[j] * wk; w += wk;
    }
    sm[m] = s / w;
  }
  const period = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const x = t / hop, i = Math.min(M - 1, Math.floor(x)), f = Math.min(1, x - i);
    const v = i + 1 < M ? sm[i] * (1 - f) + sm[i + 1] * f : sm[i];
    period[t] = Math.exp(v);
  }
  const pathBpm = new Float32Array(M);
  for (let m = 0; m < M; m++) pathBpm[m] = (60 * fps) / Math.exp(sm[m]);
  return { period, pathBpm, hop };
}

/** Tempo that the path holds for the most confident time (median weighted by window confidence). */
export function pathTempo(tg: Tempogram, curve: TempoCurve): number {
  const idx = Array.from(curve.pathBpm.keys()).sort((a, b) => curve.pathBpm[a] - curve.pathBpm[b]);
  let total = 0;
  for (let m = 0; m < tg.M; m++) total += tg.confidence[m] + 1e-3;
  let acc = 0;
  for (const m of idx) {
    acc += tg.confidence[m] + 1e-3;
    if (acc >= total / 2) return curve.pathBpm[m];
  }
  return 120;
}

/**
 * Factor to apply to the path tempo `bpm`. A BPM hint (e.g. NetEase's song wiki, usually right but rounded) picks the
 * octave: the power of two that brings `bpm` within ±9 % of it. With the tempogram, a hint at 3∶2 or 2∶3 of an octave
 * of `bpm` is followed too unless the tempogram clearly backs `bpm` instead: the hinted tempo's best octave needs
 * HINT_RELATIVE of the support of `bpm`'s best octave. (Syncopated kicks, a beat and a half apart in drum & bass and
 * half-time future bass, give the dotted tempo a strong peak of its own: these songs' wiki BPM was right where the
 * path was not.) And whatever the hint, a path whose ¾ (or 3⁄2) has DOTTED of the support of the path's best octave
 * sits on such a dotted pulse: the better supported of the two is the song's beat. Otherwise 1 (a hint that matches
 * no relative of the tempo is ignored).
 */
export function tempoFactor(bpm: number, hint: number | undefined, tg?: Tempogram): number {
  if (!(bpm > 0)) return 1;
  if (hint && hint > 0) {
    const r = Math.log2(hint / bpm), k = Math.round(r);
    if (Math.abs(r - k) <= 0.125 && Math.abs(k) <= 2) return Math.pow(2, k);
    if (tg) {
      for (const f of [1.5, 2 / 3]) {
        const r3 = Math.log2(hint / (bpm * f)), k3 = Math.round(r3);
        if (Math.abs(r3 - k3) > 0.125 || Math.abs(k3) > 1) continue;
        const factor = f * Math.pow(2, k3);
        if (octaveSupport(tg, bpm * factor) >= HINT_RELATIVE * octaveSupport(tg, bpm)) return factor;
      }
    }
  }
  if (!tg) return 1;
  const s = octaveSupport(tg, bpm), s34 = tempoSupport(tg, 0.75 * bpm), s32 = tempoSupport(tg, 1.5 * bpm);
  return Math.max(s34, s32) >= DOTTED * s ? (s34 >= s32 ? 0.75 : 1.5) : 1;
}

/** Share of the support of the path's tempo family that a 3∶2 relative from the hint needs (see tempoFactor). */
export const HINT_RELATIVE = 0.5;
/**
 * Share of the support of the path's tempo family at which its ¾ or 3⁄2 marks the path as a dotted pulse. On 194
 * songs with a cited BPM, paths on the song's beat reached at most 0.50 (one at 0.74, its sources split between the
 * path and its 3⁄2); dotted paths mostly 0.61–1.3.
 */
const DOTTED = 0.6;

/** Best tempogram support among `bpm`, its half and its double. */
function octaveSupport(tg: Tempogram, bpm: number): number {
  return Math.max(tempoSupport(tg, 0.5 * bpm), tempoSupport(tg, bpm), tempoSupport(tg, 2 * bpm));
}

/** Mean tempogram salience (0..1) at `bpm` (±1.5 %), weighted by window confidence. */
export function tempoSupport(tg: Tempogram, bpm: number): number {
  const { M, S, fps, periods, salience, confidence } = tg;
  // The states within ±1.5 % (periods grow with the state index).
  let s0 = S, s1 = -1;
  for (let s = 0; s < S; s++) {
    if (Math.abs(Math.log((60 * fps) / periods[s] / bpm)) > 0.015) continue;
    s0 = Math.min(s0, s);
    s1 = s;
  }
  let sum = 0, wsum = 0;
  for (let m = 0; m < M; m++) {
    let best = -Infinity;
    for (let s = s0; s <= s1; s++) best = Math.max(best, salience[m * S + s]);
    sum += confidence[m] * (s1 >= s0 ? Math.exp(best) - 0.05 : 0);
    wsum += confidence[m];
  }
  return wsum > 0 ? sum / wsum : 0;
}

/** A grid slower than this (BPM) is cited at twice its tempo (see namedTempo). */
const NAMED_LOW = 81;
/** Up to this grid tempo, snares on every beat mark a half-time grid (see namedTempo). */
const NAMED_HIGH = 98;

/**
 * The tempo as it is usually cited and shown, from the grid's dominant tempo `bpm`: `bpm` or twice it. NetEase's wiki
 * BPM, which the grid follows to its octave, is often half the cited one (drum & bass 86 where 174 is cited). Against
 * the BPM cited for 197 songs of the NetEase cache (tools/truth/tempo.json: rhythm-game charts, Beatport, Spotify-
 * derived sites):
 * - a grid under NAMED_LOW is cited at double: 41 songs against 6 (sources split between the two, beatless game
 *   scores, single low-confidence sources);
 * - up to NAMED_HIGH, in 4/4, snares that are not on a kick on both the odd and the even beats of the bar (drum &
 *   bass's snare on every beat of its half-time grid) mean double too: 12 songs against 1. A backbeat on 2 and 4
 *   alone (Stressed Out at 85, I Like Me Better at 92) keeps the grid's tempo. Beats count by loudness (from 18 dB
 *   under the loud level), so an intro or a breakdown weighs little; a beat has a snare within 60 ms of it.
 */
export function namedTempo(
  bpm: number, beats: ArrayLike<number>, beatInBar: ArrayLike<number>, meter: number,
  kicks: ArrayLike<readonly [number, number]>, snares: ArrayLike<readonly [number, number]>, levelDb: Float32Array, fps: number,
): number {
  if (!(bpm > 0) || beats.length < 16) return bpm;
  if (bpm < NAMED_LOW) return 2 * bpm;
  if (bpm > NAMED_HIGH || meter !== 4) return bpm;
  // Snare hits with no kick at least half as strong within 35 ms (a bright kick's attack also passes the snare gate;
  // a drum & bass snare's body passes the kick gate, much weaker).
  const free: number[] = [];
  for (let i = 0, k = 0; i < snares.length; i++) {
    const t = snares[i][0];
    while (k < kicks.length && kicks[k][0] < t - 0.035) k++;
    let kick = 0;
    for (let j = k; j < kicks.length && kicks[j][0] <= t + 0.035; j++) kick = Math.max(kick, kicks[j][1]);
    if (kick < 0.5 * snares[i][1]) free.push(t);
  }
  const near = (t: number) => {
    let lo = 0, hi = free.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (free[m] < t - 0.06) lo = m + 1; else hi = m; }
    return lo < free.length && free[lo] <= t + 0.06 ? 1 : 0;
  };
  const ref = quantile(levelDb, 0.95);
  let odd = 0, even = 0, wo = 0, we = 0;
  for (let i = 0; i + 1 < beats.length; i++) {
    const f = Math.min(levelDb.length - 1, Math.max(0, Math.round(beats[i] * fps)));
    const w = Math.min(1, Math.max(0, (levelDb[f] - (ref - 18)) / 12));
    if (w <= 0) continue;
    if (beatInBar[i] % 2) { odd += w * near(beats[i]); wo += w; } else { even += w * near(beats[i]); we += w; }
  }
  const a = odd / (wo || 1), b = even / (we || 1), lo = Math.min(a, b);
  return lo >= 0.11 && Math.max(a, b) <= 3 * lo ? 2 * bpm : bpm;
}
