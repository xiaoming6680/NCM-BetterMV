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
