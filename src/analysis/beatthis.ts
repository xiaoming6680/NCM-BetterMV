// Beats from Beat This! (CPJKU, ISMIR 2024), tracked by the aligner pack (tools/aligner/beats.py), tidied here. Its
// beats land on the drums more often than the plugin's tracker and follow double-time passages and tempo ramps, but
// they also jump between 1× and 2× for a few beats at a time. What is kept (docs/ANALYSIS.md, “节拍：Beat This!”):
//   - steady stretches (8+ beats over 2+ s, each interval within 15 % of the stretch's median) as they are, a level
//     change between two of them included;
//   - between two steady stretches: a double-time grid where Beat This! finds beats far faster than either side, else
//     the plugin's own beats (tracked with Beat This!'s beat probability added to its novelty) where they continue
//     both stretches, else a tempo ramp, or a switch of level where the beat probability is highest;
//   - then one pace per song (onePace): double-time stretches back to the song's pace, fast songs on half their tempo.
// The bars come from the plugin's own bar finder (meter.ts), with Beat This!'s downbeat probability as evidence.

import type { Hit } from '../types.ts';

/** Drum hits transcribed by the pack's ADTOF model (tools/aligner/drums.py), independent of the beats. */
export interface DrumInput { kick: Hit[]; snare: Hit[]; hat: Hit[] }

/** What the pack gives for a song (its `beats` job). */
export interface BeatThisInput {
  /** Frames per second of the probabilities (50). */
  fps: number;
  /** Beat / downbeat probability per frame. */
  beatProb: ArrayLike<number>;
  downProb: ArrayLike<number>;
  /** Its own beats and downbeats (s): probability peaks above ½. */
  beats: number[];
  downbeats: number[];
  /** Drums from the same job, when the pack has the drum model (src/analysis/drums.ts). */
  drums?: DrumInput;
}

const TOL = 0.15, MIN_BEATS = 8, MIN_SEC = 2;
/** Beat This!'s beats sit this much after the attacks (Clarity, against the hand-made truth). */
const LATENCY = 0.012;

const median = (a: ArrayLike<number>): number => {
  const s = Array.from(a).sort((p, q) => p - q), n = s.length;
  return n % 2 ? s[n >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
};
const diff = (a: number[]) => a.slice(1).map((v, i) => v - a[i]);

/** Its tempo, for the tracker's octave: the mean interval of those within 15 % of the median one. */
export function beatThisTempo(beats: number[]): number | undefined {
  const ibi = diff(beats).sort((p, q) => p - q);
  if (ibi.length <= 8) return undefined;
  const med = ibi[ibi.length >> 1], keep = ibi.filter(v => Math.abs(v / med - 1) < 0.15);
  return 60 / (keep.reduce((p, q) => p + q, 0) / keep.length);
}

/** Whether Beat This! held a steady beat anywhere in the song: if not, it is left out altogether. */
export const usableBeatThis = (bt: BeatThisInput) => bt.beats.length >= MIN_BEATS && runsOf(bt.beats).length > 0;

/** Steady runs of beats, as [first, last] indices. */
function runsOf(b: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i0 = 0;
  for (let i = 1; i < b.length; i++) {
    if (i - i0 < 2) continue;
    const ref = median(diff(b.slice(Math.max(i0, i - 8), i)));
    if (Math.abs((b[i] - b[i - 1]) / ref - 1) >= TOL) { out.push([i0, i - 1]); i0 = i - 1; }
  }
  out.push([i0, b.length - 1]);
  return out.filter(([a, z]) => z - a + 1 >= MIN_BEATS && b[z] - b[a] >= MIN_SEC);
}

/** Each beat on a line fitted over ±4 beats (takes out the 20 ms steps of the 50 fps frames). */
function smooth(seg: number[]): number[] {
  const n = seg.length;
  return seg.map((_, i) => {
    const lo = Math.max(0, i - 4), hi = Math.min(n, i + 5), m = hi - lo;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = lo; j < hi; j++) { sx += j; sy += seg[j]; sxx += j * j; sxy += j * seg[j]; }
    const den = m * sxx - sx * sx;
    if (!den) return seg[i];
    const k = (m * sxy - sx * sy) / den;
    return (sy - k * sx) / m + k * i;
  });
}

function probAt(p: ArrayLike<number>, fps: number, t: number): number {
  const f = t * fps, i = Math.floor(f), r = f - i;
  return i < 0 || i + 1 >= p.length ? 0 : p[i] * (1 - r) + p[i + 1] * r;
}
/** The highest probability within ±40 ms (a grid beat a frame or two off its peak still counts). */
const bestOf = (p: ArrayLike<number>, fps: number, t: number) =>
  Math.max(...[-0.04, -0.02, 0, 0.02, 0.04].map(d => probAt(p, fps, t + d)));

/** Beats strictly between a and b whose period moves smoothly from pa to pb (a tempo ramp), or null. */
function ramp(a: number, pa: number, b: number, pb: number): number[] | null {
  const gap = b - a;
  let best: [number, number[]] | null = null;
  for (let n = 1; n < 2000; n++) {
    const per = Array.from({ length: n }, (_, k) => pa * (pb / pa) ** ((k + 1) / n));
    const sum = per.reduce((p, q) => p + q, 0), err = Math.abs(sum - gap) / gap;
    if (!best || err < best[0]) best = [err, per];
    if (sum > gap * 1.5) break;
  }
  if (!best || best[0] > 0.15) return null;
  const per = best[1], scale = gap / per.reduce((p, q) => p + q, 0);
  const out: number[] = [];
  let t = a;
  for (let k = 0; k + 1 < per.length; k++) { t += per[k] * scale; out.push(t); }
  return out;
}

/**
 * Beats strictly between a and b. A level change (about 2∶1): a's grid continued forward, then b's backward, switching
 * where the extended beats have the most probability, the joining interval 0.6–1.6 of the periods. Otherwise the
 * period ramps from pa to pb (an accelerando, or the same tempo).
 */
function join(a: number, pa: number, b: number, pb: number, prob: ArrayLike<number>, fps: number): number[] {
  if (Math.abs(Math.log(pb / pa)) < Math.log(1.5)) {
    const r = ramp(a, pa, b, pb);
    if (r) return r;
  }
  const fwd: number[] = [], bwd: number[] = [];
  for (let k = 1; k < 400; k++) { const t = a + k * pa; if (t < b - 0.3 * pb) fwd.push(t); }
  for (let k = 1; k < 400; k++) { const t = b - k * pb; if (t > a + 0.3 * pa) bwd.push(t); }
  bwd.reverse();
  let best = -Infinity, choice: number[] = [];
  for (let i = 0; i <= fwd.length; i++) {
    const left = fwd.slice(0, i), last = left.length ? left[left.length - 1] : a;
    const right = bwd.filter(t => t > last + 0.6 * (pa + pb) / 2);
    const gap = (right.length ? right[0] : b) - last;
    if (gap < 0.6 * Math.min(pa, pb) || gap > 1.6 * Math.max(pa, pb)) continue;
    const score = left.concat(right).reduce((s, t) => s + bestOf(prob, fps, t), 0);
    if (score > best) { best = score; choice = left.concat(right); }
  }
  if (best === -Infinity) {
    // Nothing fits: evenly spaced at the mean period.
    const p = (pa + pb) / 2, n = Math.max(1, Math.round((b - a) / p));
    choice = Array.from({ length: n - 1 }, (_, k) => a + ((k + 1) * (b - a)) / n);
  }
  return choice;
}

/**
 * Beat This!'s beats in (lo, hi) all a whole number of half-periods apart, a third or more of them adjacent: it is
 * following the double-time pulse and only skipping beats (alternating 1× and 2× for a few beats at a time).
 */
function onFinerGrid(raw: number[], lo: number, hi: number, P: number): boolean {
  const w = raw.filter(t => t > lo + 0.02 && t < hi - 0.02);
  if (w.length < 6) return false;
  const r = diff(w).map(d => d / (P / 2));
  const fits = r.filter(v => { const k = Math.round(v); return Math.abs(v - k) < 0.15 && k >= 1; }).length;
  const adjacent = r.filter(v => Math.round(v) === 1).length;
  return fits / r.length >= 0.8 && adjacent / r.length >= 0.3;
}

/**
 * An erratic stretch where Beat This! finds beats far faster than on either side (fast drum fills, a double-time
 * passage it could not hold steady): a steady grid at twice the faster side's rate running on from a (every other beat
 * on a's grid), unless the off-beat half of it has clearly more beat probability. Null when it is not such a stretch.
 */
function dense(raw: number[], a: number, pa: number, b: number, pb: number, prob: ArrayLike<number>, fps: number): number[] | null {
  const gap = b - a;
  if (gap < 2) return null;
  const n = raw.filter(t => t > a + 0.02 && t < b - 0.02).length;
  if (n / gap < 1.4 / Math.min(pa, pb) && !onFinerGrid(raw, a, b, Math.min(pa, pb))) return null;
  const P = Math.min(pa, pb) / 2, grid: number[] = [];
  for (let k = 1; k < 4000; k++) { const t = a + k * P; if (t < b - 0.5 * P) grid.push(t); }
  const shifted = grid.map(t => t + P / 2).filter(t => t < b - 0.5 * P);
  const mean = (ts: number[]) => ts.reduce((s, t) => s + bestOf(prob, fps, t), 0) / Math.max(1, ts.length);
  return mean(grid) >= 0.8 * mean(shifted) ? grid : null;
}

/** The plugin's own beats between two steady stretches, when they continue them (on one of their levels). */
function fromMerged(merged: number[], a: number, pa: number, b: number, pb: number): number[] | null {
  const m = merged.filter(t => t > a + 0.5 * pa && t < b - 0.5 * pb);
  const ibi = diff([a, ...m, b]);
  const lo = 0.6 * Math.min(pa, pb), hi = 1.6 * Math.max(pa, pb);
  if (!ibi.every(d => d >= lo && d <= hi)) return null;
  if (ibi.length > 2) {
    const med = median(ibi);
    if (Math.min(Math.abs(med / pa - 1), Math.abs(med / pb - 1)) > 0.15) return null;
  }
  return m;
}

/**
 * Beat This!'s beats tidied, with the plugin's own beats (`merged`) for the stretches it could not hold. Null when it
 * has no steady stretch at all (the plugin's beats stay).
 */
export function tidyBeats(bt: BeatThisInput, merged: number[]): number[] | null {
  const b = bt.beats, fps = bt.fps, prob = bt.beatProb;
  if (b.length < MIN_BEATS) return null;
  const runs = runsOf(b);
  if (!runs.length) return null;
  const beats: number[] = [];
  let prevEnd = 0, prevPer = 0;
  runs.forEach(([a, z], k) => {
    const seg = smooth(b.slice(a, z + 1)), per = median(diff(seg));
    if (k === 0) {
      // Back to the first beat Beat This! found.
      const pp = onFinerGrid(b, b[0] - 1, seg[0], per) ? per / 2 : per, pre: number[] = [];
      for (let j = 1; j < 4000; j++) { const t = seg[0] - j * pp; if (t >= b[0] - 0.5 * pp) pre.push(t); }
      beats.push(...pre.reverse());
    } else {
      const pa = prevPer, pz = per;
      beats.push(...(dense(b, prevEnd, pa, seg[0], pz, prob, fps) ?? fromMerged(merged, prevEnd, pa, seg[0], pz) ?? join(prevEnd, pa, seg[0], pz, prob, fps)));
    }
    beats.push(...seg);
    prevEnd = seg[seg.length - 1]; prevPer = per;
  });
  const qp = onFinerGrid(b, prevEnd, b[b.length - 1] + 1, prevPer) ? prevPer / 2 : prevPer;
  for (let j = 1; j < 4000; j++) { const t = prevEnd + j * qp; if (t <= b[b.length - 1] + 0.5 * qp) beats.push(t); }
  // In time order; a beat within 50 ms of the one before it goes.
  const sorted = beats.slice().sort((p, q) => p - q);
  const out = sorted.filter((t, k) => k === 0 || t - sorted[k - 1] > 0.05);
  const r4 = (t: number) => Math.round((t - LATENCY) * 10000) / 10000;
  return out.map(r4);
}

/**
 * One pace per song (cut lengths, bars and cruise speeds were tuned on the plugin's own grid, which followed drum & bass
 * and rhythm-game songs at half their tempo): the pace is the song's main tempo `main`, or half of it from 160 BPM up,
 * and the stretches at about twice the pace (1.7× or more, not a 3∶2 change: all of such a fast song, a 256 passage
 * in a 128 song) keep every other beat, the half on which Beat This! puts more downbeat probability. Tempo ramps and
 * slower stretches stay as they are; the beats keep Beat This!'s phase.
 */
export function onePace(beats: number[], downProb: ArrayLike<number>, fps: number, main: number): number[] {
  const pace = main >= 160 ? main / 2 : main, n = beats.length;
  if (n < 8) return beats;
  const fast = beats.map((_, i) => {
    const lo = Math.max(0, i - 2), hi = Math.min(n - 1, i + 2);
    return (60 * (hi - lo)) / (beats[hi] - beats[lo]) >= 1.7 * pace;
  });
  const keep = new Array<boolean>(n).fill(true);
  for (let i = 0; i < n;) {
    if (!fast[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && fast[j + 1]) j++;
    let even = 0, odd = 0;
    for (let k = i; k <= j; k++) { const p = bestOf(downProb, fps, beats[k]); if ((k - i) % 2) odd += p; else even += p; }
    const parity = odd > even ? 1 : 0;
    for (let k = i; k <= j; k++) if ((k - i) % 2 !== parity) keep[k] = false;
    i = j + 1;
  }
  return beats.filter((_, i) => keep[i]);
}

/** Beat This!'s downbeat probability at each beat (the highest within ±40 ms), for the bar finder. */
export const downbeatEvidence = (bt: BeatThisInput, beats: number[]) => Float32Array.from(beats, t => bestOf(bt.downProb, bt.fps, t));

/** A beat within this of the fitted grid is on it (s); Beat This!'s own beats scatter ±10–20 ms round a fixed grid. */
const GRID_TOL = 0.035;
/** A stretch is locked from this many beats and seconds up, with this share of its beats on the grid… */
const GRID_MIN_BEATS = 32, GRID_MIN_SEC = 16, GRID_SHARE = 0.85;
/** …ending where this many beats in a row are off it. */
const GRID_MISSES = 6;
/** Two locked stretches up to this far apart (s) on one grid become one, the beats between them replaced. */
const GRID_JOIN_SEC = 20;
/** A grid point with no beat gets one where this share of the 16 round it have one (not in a half-time passage). */
const GRID_FILL = 0.75;

/**
 * A stretch on one grid: its beats on the grid (grid index, time), all the beats it took in (`raw`, those off the grid
 * too), the grid points to fill whatever (a joined gap) and the index of the last beat it took in.
 */
interface GridRun { t0: number; period: number; gs: number[]; ts: number[]; raw: number[]; fill: Set<number>; last: number }

/** Least-squares line t = t0 + g·period through (g, t). */
function fitLine(g: number[], t: number[]): [number, number] {
  const m = g.length;
  let sg = 0, st = 0, sgg = 0, sgt = 0;
  for (let k = 0; k < m; k++) { sg += g[k]; st += t[k]; sgg += g[k] * g[k]; sgt += g[k] * t[k]; }
  const den = m * sgg - sg * sg;
  const period = den ? (m * sgt - sg * st) / den : 0;
  return [(st - period * sg) / m, period];
}

/** The beats within the tolerance of the grid t0 + g·period, one per grid point, refitted on them. */
function collect(raw: number[], t0: number, period: number): { t0: number; period: number; gs: number[]; ts: number[] } {
  const gs: number[] = [], ts: number[] = [];
  for (const t of raw) {
    const g = Math.round((t - t0) / period);
    if (Math.abs(t - (t0 + g * period)) > GRID_TOL) continue;
    if (gs.length && g === gs[gs.length - 1]) {
      // Two beats on one point: the nearer stays.
      if (Math.abs(t - (t0 + g * period)) < Math.abs(ts[ts.length - 1] - (t0 + g * period))) ts[ts.length - 1] = t;
      continue;
    }
    gs.push(g); ts.push(t);
  }
  const [a, p] = gs.length >= 2 ? fitLine(gs, ts) : [t0, period];
  return { t0: a, period: p, gs, ts };
}

/** Every beat within the tolerance of the line (a drifting, played tempo is no fixed grid). */
const onLine = (r: GridRun) => r.gs.every((g, k) => Math.abs(r.ts[k] - (r.t0 + g * r.period)) <= GRID_TOL);

/** The longest stretch from beat i that sits on one fixed grid, or null. */
function gridRun(b: number[], i: number): GridRun | null {
  const n = b.length, seed = Math.min(n, i + 16);
  if (seed - i < 16) return null;
  const per = median(diff(b.slice(i, seed)));
  if (!(per > 0) || diff(b.slice(i, seed)).filter(d => Math.abs(d / per - 1) < 0.1).length < 12) return null;
  const gs: number[] = [], ts: number[] = [];
  let t0 = b[i], period = per, misses = 0, last = i;
  for (let j = i; j < n; j++) {
    const g = Math.round((b[j] - t0) / period), r = b[j] - (t0 + g * period);
    if (Math.abs(r) <= GRID_TOL && (!gs.length || g > gs[gs.length - 1])) {
      gs.push(g); ts.push(b[j]); misses = 0; last = j;
      if (gs.length >= 4 && gs.length % 4 === 0) [t0, period] = fitLine(gs, ts);
    } else if (++misses >= GRID_MISSES) break;
  }
  if (gs.length < GRID_MIN_BEATS) return null;
  [t0, period] = fitLine(gs, ts);
  // Again on the final grid: beats near its start, missed while the seed grid was still rough, come in.
  const raw = b.slice(i, last + 1), c = collect(raw, t0, period);
  if (c.gs.length < GRID_MIN_BEATS) return null;
  const g0 = c.gs[0], g1 = c.gs[c.gs.length - 1];
  // Most beats of the stretch on the grid, and most grid points with a beat (not a grid at twice the tempo).
  if ((g1 - g0) * c.period < GRID_MIN_SEC || c.gs.length < GRID_SHARE * raw.length || c.gs.length < GRID_SHARE * (g1 - g0 + 1)) return null;
  const run = { ...c, raw, fill: new Set<number>(), last };
  return onLine(run) ? run : null;
}

/**
 * a and b as one stretch on one grid (the same tempo, in phase), the `loose` beats between them about one per grid
 * point (misplaced, or a double-time burst; half as many is a half-time passage, which stays), or null.
 */
function joinRuns(a: GridRun, b: GridRun, loose: number[]): GridRun | null {
  if (b.ts[0] - a.ts[a.ts.length - 1] > GRID_JOIN_SEC || Math.abs(b.period / a.period - 1) > 0.003) return null;
  const gs = a.gs.slice(), ts = a.ts.slice(), end = gs[gs.length - 1];
  for (const t of b.ts) {
    const g = Math.round((t - a.t0) / a.period);
    if (g <= gs[gs.length - 1]) return null;
    gs.push(g); ts.push(t);
  }
  const start = gs[a.gs.length], gap = start - end - 1;
  if (loose.length < GRID_FILL * gap) return null;
  // (b's grid indices are moved onto a's: b.gs[0] is `start` there.)
  const fill = new Set([...a.fill, ...Array.from({ length: gap }, (_, k) => end + 1 + k)]);
  for (const g of b.fill) fill.add(g - b.gs[0] + start);
  const raw = [...a.raw, ...loose, ...b.raw], [t0, period] = fitLine(gs, ts);
  const run = { ...collect(raw, t0, period), raw, fill, last: b.last };
  return onLine(run) ? run : null;
}

/**
 * The beats of a stretch: its grid points with a beat, and the empty ones where most round them have one; where few
 * have one, its own beats off the grid stay (a half-time passage keeps its every other beat, a free intro its beats).
 */
function gridBeats(r: GridRun): number[] {
  const g0 = r.gs[0], g1 = r.gs[r.gs.length - 1], n = g1 - g0 + 1;
  const has = new Uint8Array(n);
  for (const g of r.gs) has[g - g0] = 1;
  for (const g of r.fill) has[g - g0] = 1;
  const sum = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) sum[k + 1] = sum[k] + has[k];
  const dense = new Uint8Array(n), out: number[] = [];
  for (let k = 0; k < n; k++) {
    const lo = Math.max(0, k - 8), hi = Math.min(n, k + 9);
    dense[k] = sum[hi] - sum[lo] >= GRID_FILL * (hi - lo) ? 1 : 0;
    if (has[k] || dense[k]) out.push(Math.round((r.t0 + (g0 + k) * r.period) * 10000) / 10000);
  }
  for (const t of r.raw) {
    const k = Math.max(0, Math.min(n - 1, Math.round((t - r.t0) / r.period) - g0));
    if (!dense[k] && !has[k]) out.push(t);
  }
  return out.sort((p, q) => p - q);
}

/**
 * Produced music runs on a fixed grid: every stretch of 32+ beats over 16+ s whose beats (85 % or more of them) sit
 * within 35 ms of one constant grid, and nearly every grid point with a beat, becomes that exact grid; two such
 * stretches on one grid up to 20 s apart become one when the beats between them are about one per grid point. This
 * takes out the beats Beat This! put between the grid's (a double-time burst onePace only half folded), its slow
 * drifts round a break and its 20 ms frame steps. A half-time passage on the grid keeps its every other beat, now on
 * the grid; a played tempo drifts off any one line within a few bars and stays as it is.
 */
export function steadyGrid(beats: number[]): number[] {
  // Locked stretches and the beats between them, in time order.
  const parts: Array<GridRun | number> = [];
  for (let i = 0; i < beats.length;) {
    const run = gridRun(beats, i);
    if (!run) { parts.push(beats[i++]); continue; }
    // The stretch before, with only loose beats in between, on the same grid: one stretch.
    let k = parts.length - 1;
    while (k >= 0 && typeof parts[k] === 'number') k--;
    const joined = k >= 0 ? joinRuns(parts[k] as GridRun, run, parts.slice(k + 1) as number[]) : null;
    if (joined) parts.splice(k, parts.length - k, joined);
    else parts.push(run);
    i = run.last + 1;
  }
  const out: number[] = [];
  // End and period of the last locked stretch: a beat left over at a seam within half a period of the grid goes.
  let lockedEnd = -Infinity, lockedPer = 0;
  for (const p of parts) {
    if (typeof p === 'number') {
      if (p > lockedEnd + 0.5 * lockedPer) out.push(p);
      continue;
    }
    const own = gridBeats(p);
    while (out.length && out[out.length - 1] > own[0] - 0.5 * p.period) out.pop();
    out.push(...own);
    lockedEnd = out[out.length - 1]; lockedPer = p.period;
  }
  return out;
}
