// Beat tracking: Ellis-style dynamic programming over the beat novelty with the local period from the tempo
// curve, then a robust local quadratic fit of beat time against beat index so the grid is smooth but still
// follows gradual tempo changes.
import { chunked, gaussianSmooth, lowerBound, std, type Slicer } from './util.ts';

export const TIGHTNESS = 400;

/** Beat frames (fractional) from the DP. `period` is the local beat period in frames. */
export function* trackBeats(
  nov: Float32Array,
  period: Float32Array,
  slicer: Slicer,
  p0: number,
  p1: number,
  tightness = TIGHTNESS,
): Generator<number, Float64Array, void> {
  const T = nov.length;
  if (T < 4) return new Float64Array(0);
  const sm = gaussianSmooth(nov, 1.5);
  const sd = std(sm) || 1;
  const ls = new Float64Array(T);
  for (let t = 0; t < T; t++) ls[t] = sm[t] / sd;
  const C = new Float64Array(T), back = new Int32Array(T);
  const work = (t0: number, t1: number) => {
    for (let t = t0; t < t1; t++) {
      const P = period[t];
      const lo = Math.max(0, t - Math.round(2 * P)), hi = t - Math.round(P / 2);
      let best = -Infinity, arg = -1;
      for (let tau = lo; tau <= hi; tau++) {
        const r = Math.log((t - tau) / P);
        const v = C[tau] - tightness * r * r;
        if (v > best) { best = v; arg = tau; }
      }
      if (arg < 0) { C[t] = ls[t]; back[t] = -1; }
      else { C[t] = ls[t] + best; back[t] = arg; }
    }
  };
  yield* chunked(T, 1024, work, slicer, p0, p1);
  // Last beat: best cumulative score within the final period.
  const Pend = period[T - 1];
  let last = T - 1;
  for (let t = Math.max(0, T - Math.ceil(Pend)); t < T; t++) if (C[t] > C[last]) last = t;
  const rev: number[] = [];
  for (let t = last; t >= 0; t = back[t]) rev.push(t);
  const out = new Float64Array(rev.length);
  for (let i = 0; i < rev.length; i++) {
    const b = rev[rev.length - 1 - i];
    // Sub-frame peak position of the local score.
    let d = 0;
    if (b > 0 && b < T - 1) {
      const y0 = ls[b - 1], y1 = ls[b], y2 = ls[b + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < -1e-9) d = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
    }
    out[i] = b + d;
  }
  return out;
}

/**
 * Smooth beat times: robust (bisquare) local quadratic regression of time on beat index over ±K beats.
 * Grid breaks (an interval far from its neighbours) split the fit so real discontinuities survive. Beats inside a
 * locked region are an exact grid already and stay as they are; the DP beats between regions are fitted on their
 * own, with up to 4 grid beats on each side as fixed anchors (without a break there) so they join the grid smoothly.
 * (Fitted together with the DP beats, the exact beats set the robust scale to zero and outweighed them.)
 */
export function regularizeBeats(beats: Float64Array, regions: LockedRegion[] = [], K = 12, iterations = 3): Float64Array {
  const n = beats.length;
  const out = Float64Array.from(beats);
  if (n < 5) return out;
  const locked = new Uint8Array(n);
  for (const r of regions) {
    const eps = 0.01 * r.period;
    for (let i = lowerBound(beats, r.start - eps); i < n && beats[i] <= r.end + eps; i++) locked[i] = 1;
  }
  const iv = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) iv[i] = beats[i + 1] - beats[i];
  // Segment boundaries where an interval departs strongly from the local median interval (a break), and where
  // locked beats begin or end.
  const cuts: number[] = [0];
  const brk = new Uint8Array(n);
  for (let i = 0; i < n - 1; i++) {
    const loc: number[] = [];
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 2, i + 4); j++) if (j !== i) loc.push(iv[j]);
    loc.sort((a, b) => a - b);
    const md = loc.length ? loc[loc.length >> 1] : iv[i];
    const r = iv[i] / md;
    brk[i + 1] = r < 0.72 || r > 1.38 ? 1 : 0;
    if (brk[i + 1] || locked[i] !== locked[i + 1]) cuts.push(i + 1);
  }
  cuts.push(n);
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = cuts[c], b = cuts[c + 1];
    if (locked[a]) continue;
    let a0 = a, b0 = b;
    while (a0 > 0 && a - a0 < 4 && locked[a0 - 1] && !brk[a0]) a0--;
    while (b0 < n && b0 - b < 4 && locked[b0] && !brk[b0]) b0++;
    if (b0 - a0 >= 5) fitSegment(beats, out, a, b, K, iterations, a0, b0);
  }
  return out;
}

/** Fits beats [a, b) into dst from the data [a0, b0) ⊇ [a, b); the beats outside [a, b) are anchors with full weight. */
function fitSegment(src: Float64Array, dst: Float64Array, a: number, b: number, K: number, iterations: number, a0: number, b0: number): void {
  const n = b0 - a0, i0 = a - a0, i1 = b - a0;
  const rw = new Float64Array(n).fill(1);
  const fit = new Float64Array(n);
  const res = new Float64Array(i1 - i0);
  for (let it = 0; it < iterations; it++) {
    for (let i = i0; i < i1; i++) {
      // Window of ±K beats, shifted inwards at the segment ends so it keeps 2K+1 points when possible.
      let lo = i - K, hi = i + K;
      if (lo < 0) { hi = Math.min(n - 1, hi - lo); lo = 0; }
      if (hi > n - 1) { lo = Math.max(0, lo - (hi - (n - 1))); hi = n - 1; }
      const span = Math.max(i - lo, hi - i) + 1;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (let j = lo; j <= hi; j++) {
        const u = j - i, q = Math.abs(u) / span;
        const tri = (1 - q * q * q) ** 3;
        const w = tri * rw[j];
        const y = src[a0 + j];
        s0 += w; s1 += w * u; s2 += w * u * u; s3 += w * u * u * u; s4 += w * u * u * u * u;
        t0 += w * y; t1 += w * u * y; t2 += w * u * u * y;
      }
      // Solve the 3×3 normal equations for the intercept (value at u = 0). The determinant is judged relative to
      // its scale: when the weight sits on fewer than three beats the system is singular, and rounding alone gives
      // a "solution" anywhere (this once spliced 0 s and −28 s into a grid); such a beat keeps its own time.
      const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
      const v = det > 1e-6 * s0 * s2 * s4 ? (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)) / det : NaN;
      fit[i] = Number.isFinite(v) ? v : src[a0 + i];
    }
    if (it === iterations - 1) break;
    for (let i = i0; i < i1; i++) res[i - i0] = Math.abs(src[a0 + i] - fit[i]);
    const sorted = Float64Array.from(res).sort();
    // Scale floor of one frame (10 ms): tighter beats than the DP's resolution are not a reason to reject the rest.
    const s = Math.max(6 * sorted[sorted.length >> 1], 0.01);
    for (let i = i0; i < i1; i++) {
      const r = res[i - i0] / s;
      rw[i] = r < 1 ? (1 - r * r) ** 2 : 0;
    }
  }
  for (let i = a; i < b; i++) dst[i] = fit[i - a0];
}

export interface LockedRegion {
  /** First and last grid beat (s). */
  start: number;
  end: number;
  period: number;
}

/** Onset evidence for the lock's grid decisions: frame signals at `fps`; beat time t is novelty frame (t + latency) · fps. */
export interface GridEvidence {
  /** Beat novelty (the DP's input). */
  nov: Float32Array;
  /** Kick onset strength (amplitude rise of the kick bins). */
  kick: Float32Array;
  /** Loudness weight 0..1 (1 within 12 dB of the song's loud level, 0 from 24 dB below). */
  weight?: Float32Array;
  /** Bass chroma (frames × 12) at `chromaFps`. */
  bass?: Float32Array;
  chromaFps?: number;
  fps: number;
  latency: number;
}

/** Evidence lookups: novelty support of a beat time, and whether a stretch of time is (nearly) silent. */
interface Probe {
  support(t: number): number;
  quiet(from: number, to: number): boolean;
}

interface Grid {
  offset: number;
  period: number;
  /** First and last beat time the grid covers. */
  t0: number;
  t1: number;
  /** Moved half a beat, onto the kicks. */
  half: boolean;
}

/**
 * Constant-tempo lock. Runs of beats whose DP intervals stay within ±2 % of one period are fitted with a constant
 * grid (circular mean phase, then least squares on the agreeing beats); neighbouring runs with the same period are
 * merged across short stretches of other intervals (a slip onto the off-beat and back), and every merged stretch
 * of at least `minBeats` beats where most beats sit tightly on one grid is replaced by that exact grid.
 * Produced music sits on a fixed grid; this repairs half-beat slips in sections whose onsets favour the off-beat
 * (open hats without a kick). Drifting (live) tempo fails the tightness test and keeps the DP beats.
 * With onset evidence, each grid is then continued over the DP beats beside it while it fits the onsets there
 * (extendGrid), and moved half a beat when the kicks sit between its beats (kicksOnHalfBeat).
 */
export function lockConstantTempo(beats: Float64Array, ev?: GridEvidence, minBeats = 32): { beats: Float64Array; regions: LockedRegion[] } {
  const n = beats.length;
  const regions: LockedRegion[] = [];
  if (n < minBeats) return { beats: Float64Array.from(beats), regions };
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = beats[i + 1] - beats[i];
  // Smoothed interval at each beat: median of the 8 intervals around it.
  const m = new Float64Array(n);
  const tmp: number[] = [];
  for (let i = 0; i < n; i++) {
    tmp.length = 0;
    for (let j = Math.max(0, i - 4); j < Math.min(n - 1, i + 4); j++) tmp.push(d[j]);
    tmp.sort((a, b) => a - b);
    m[i] = tmp[tmp.length >> 1];
  }
  // Greedy runs of constant tempo; a run ends after 4 consecutive beats off its reference period.
  const runs: Array<[number, number]> = [];
  let s = 0;
  while (s < n) {
    let ref = m[s], e = s + 1, miss = 0;
    const vals: number[] = [m[s]];
    while (e < n) {
      if (Math.abs(m[e] / ref - 1) < 0.02) {
        miss = 0;
        vals.push(m[e]);
        if ((vals.length & 7) === 0) ref = medianOf(vals);
      } else if (++miss >= 4) break;
      e++;
    }
    e -= miss;
    runs.push([s, e]);
    s = Math.max(e, s + 1);
  }
  // Fit runs of ≥ 16 beats, merging neighbours with the same period.
  interface Group { a: number; b: number; idx: number[]; fit: { offset: number; period: number } }
  const groups: Group[] = [];
  for (const [a, b] of runs) {
    if (b - a < 16) continue;
    const idx: number[] = [];
    for (let i = a; i < b; i++) idx.push(i);
    const fit = fitGrid(beats, idx);
    if (!fit) continue;
    // Merge with an earlier group of the same period within 64 beats, dropping shorter groups in between.
    let merged = false;
    for (let gi = groups.length - 1; gi >= 0 && !merged; gi--) {
      const g = groups[gi];
      if (a - g.b > 64) break;
      if (Math.abs(fit.period / g.fit.period - 1) >= 0.003) continue;
      let between = 0;
      for (let q = gi + 1; q < groups.length; q++) between += groups[q].idx.length;
      if (between >= Math.min(g.idx.length, idx.length)) continue;
      // The stretch between must keep the tempo: no interval far off, at most one beat gained or lost (a slip).
      const gapT = beats[a] - beats[g.b - 1], gapN = a - (g.b - 1);
      let steady = Math.abs(gapT / fit.period - gapN) <= 1;
      for (let i = g.b - 1; i < a && steady; i++) steady = Math.abs(d[i] / fit.period - 1) < 0.3;
      if (!steady) continue;
      const all = g.idx.concat(idx);
      // The period is known from both groups; only search around it so a slip is not mistaken for a tempo change.
      const known = (g.fit.period * g.idx.length + fit.period * idx.length) / all.length;
      const refit = fitGrid(beats, all, known, 0.001);
      if (!refit) continue;
      g.b = b; g.idx = all; g.fit = refit;
      groups.length = gi + 1;
      merged = true;
    }
    if (merged) continue;
    groups.push({ a, b, idx, fit });
  }
  const grids: Grid[] = [];
  for (const g of groups) {
    if (g.idx.length >= minBeats) grids.push({ offset: g.fit.offset, period: g.fit.period, t0: beats[g.a], t1: beats[g.b - 1], half: false });
  }
  if (ev && grids.length) {
    const probe = makeProbe(ev);
    for (let i = 0; i < grids.length; i++) {
      const g = grids[i], P = g.period;
      // Each side as far as the neighbouring grid (as extended so far) or the first / last DP beat.
      const lo = i > 0 ? grids[i - 1].t1 + 0.5 * grids[i - 1].period : beats[0] - 0.5 * P;
      const hi = i + 1 < grids.length ? grids[i + 1].t0 - 0.5 * grids[i + 1].period : beats[n - 1] + 0.5 * P;
      g.t0 = extendGrid(beats, g, -1, lo, probe);
      g.t1 = extendGrid(beats, g, 1, hi, probe);
    }
    // Neighbouring grids on one lattice (same period, in phase) close the few beats left between them.
    for (let i = 0; i + 1 < grids.length; i++) {
      const a = grids[i], b = grids[i + 1];
      const x = (b.t0 - a.offset) / a.period;
      if (Math.abs(b.period / a.period - 1) < 0.003 && Math.abs(x - Math.round(x)) < 0.1 && b.t0 - a.t1 < 4.5 * a.period) {
        a.t1 = Math.max(a.t1, b.t0 - a.period);
      }
    }
    for (const g of grids) {
      g.half = kicksOnHalfBeat(g, ev, probe);
      if (g.half) g.offset += 0.5 * g.period;
    }
  }
  // DP beats outside the grids (moved half a beat too where the grids around them moved) and the grid beats, each
  // with its local beat period and whether it is a grid beat.
  const out: Array<[number, number, boolean]> = [];
  for (let j = 0, gi = 0; j < n; j++) {
    const t = beats[j];
    while (gi < grids.length && t >= grids[gi].t1 + 0.5 * grids[gi].period) gi++;
    const g = gi < grids.length ? grids[gi] : undefined, prev = gi > 0 ? grids[gi - 1] : undefined;
    if (g && t > g.t0 - 0.5 * g.period) continue;
    const ja = Math.max(0, j - 1), jb = Math.min(n - 1, j + 1), p = (beats[jb] - beats[ja]) / (jb - ja);
    const half = (g || prev) && (!g || g.half) && (!prev || prev.half);
    out.push([half ? t + 0.5 * (j + 1 < n ? beats[j + 1] - t : t - beats[j - 1]) : t, p, false]);
  }
  for (const { offset, period, t0, t1 } of grids) {
    const k0 = Math.ceil((t0 - offset) / period - 0.5), k1 = Math.floor((t1 - offset) / period + 0.5);
    for (let k = k0; k <= k1; k++) out.push([offset + k * period, period, true]);
    regions.push({ start: offset + k0 * period, end: offset + k1 * period, period });
  }
  // Junctions: a beat closer to the previous one than 0.6 of the local interval (the shorter of the previous interval
  // and its own period) is a duplicate: a grid beat replaces a DP beat, otherwise the later one goes. Gaps over 1.6×
  // the longer one are filled evenly. (Judged by the previous interval alone, a jump onto a faster grid dropped
  // every other beat of it.)
  out.sort((x, y) => x[0] - y[0]);
  const clean: number[] = [], fromGrid: boolean[] = [];
  for (const [t, p, isGrid] of out) {
    const k = clean.length;
    if (k) {
      const prevIv = k >= 2 ? clean[k - 1] - clean[k - 2] : p;
      const gap = t - clean[k - 1];
      if (gap < 0.6 * Math.min(prevIv, p)) {
        if (isGrid && !fromGrid[k - 1]) { clean[k - 1] = t; fromGrid[k - 1] = true; }
        continue;
      }
      if (gap > 1.6 * Math.max(prevIv, p)) {
        const steps = Math.round(gap / (0.5 * (prevIv + p)));
        for (let q = 1; q < steps; q++) { clean.push(clean[k - 1] + (gap * q) / steps); fromGrid.push(false); }
      }
    }
    clean.push(t); fromGrid.push(isGrid);
  }
  return { beats: Float64Array.from(clean), regions };
}

/**
 * Support of a beat time: the strongest smoothed beat novelty within ±2 frames, in standard deviations. Quiet: the
 * mean loudness weight of the stretch is under 0.1 (over 22 dB below the loud parts: a fade-out, a silent gap).
 */
function makeProbe(ev: GridEvidence): Probe {
  const { fps, latency, weight } = ev;
  const sm = gaussianSmooth(ev.nov, 1.5);
  const sd = std(sm) || 1;
  const T = sm.length;
  return {
    support(t: number): number {
      const f = Math.round((t + latency) * fps);
      let m = 0;
      for (let i = Math.max(0, f - 2); i <= Math.min(T - 1, f + 2); i++) if (sm[i] > m) m = sm[i];
      return m / sd;
    },
    quiet(from: number, to: number): boolean {
      if (!weight) return false;
      const a = Math.max(0, Math.round(from * fps)), z = Math.min(weight.length, Math.round(to * fps));
      let s = 0;
      for (let f = a; f < z; f++) s += weight[f];
      return z > a && s < 0.1 * (z - a);
    },
  };
}

/**
 * Continues a locked grid over the DP beats on one side of it (dir −1 before, +1 after), no further than `limit`,
 * and returns its new first (last) beat time. The DP follows the tempo path, which can glide off to a tempo the song
 * never has where the onsets are mostly syncopated (a half-time drop over a melodic bass line, dotted-eighth
 * delays); a produced song keeps its grid there. Steps of 8 grid beats are taken while the grid lands on onsets —
 * well above its seven other 1/8-beat phases — about as well as the DP beats of the same stretch (running means,
 * and a looser test per step). A real tempo change walks the onsets off the grid within a few beats and stops it.
 * Steps where the DP beats already agree with the grid prove nothing either way (a drifting live tempo agrees for a
 * while); they are crossed only on the way to a step that needs the grid, and at most two in a row. Quiet steps (an
 * intro, a fade-out) need less: the grid only has to fit as well as the DP beats, or the DP runs at another tempo
 * (> 6 % off) — the onsets left there are echoes and reverb, and the DP only follows the tempo path. Finally the
 * trailing beats of the last tested step that land on no onset are left to the DP, so a tempo change inside that
 * step is not overrun.
 */
function extendGrid(beats: Float64Array, g: Grid, dir: number, limit: number, probe: Probe): number {
  const { support } = probe;
  const n = beats.length, P = g.period;
  const kEdge = Math.round(((dir > 0 ? g.t1 : g.t0) - g.offset) / P);
  let reach = dir > 0 ? g.t1 : g.t0, before = reach;
  let sg = 0, sb = 0, ng = 0, sd = 0, nd = 0, agreeing = 0;
  const grid: number[] = [], vs: number[] = [], bs: number[] = [];
  // The last tested step taken: its beats with their support and their other phases' mean support.
  const tail: number[] = [], tailV: number[] = [], tailB: number[] = [];
  for (let step = 0; ; step++) {
    grid.length = 0;
    for (let q = 1; q <= 8; q++) {
      const t = g.offset + (kEdge + dir * (8 * step + q)) * P;
      if (dir > 0 ? t > limit : t < limit) break;
      grid.push(t);
    }
    if (!grid.length) break;
    const m = grid.length, far = grid[m - 1];
    const lo = Math.min(grid[0], far) - 0.5 * P, hi = Math.max(grid[0], far) + 0.5 * P;
    let vd = 0, cd = 0, agree = 0, first = 0, last = 0;
    for (let j = lowerBound(beats, lo); j < n && beats[j] < hi; j++) {
      const x = (beats[j] - g.offset) / P;
      if (Math.abs(x - Math.round(x)) < 0.1) agree++;
      vd += support(beats[j]);
      if (!cd) first = beats[j];
      last = beats[j];
      cd++;
    }
    if (cd && Math.abs(cd - m) <= 1 && agree >= 0.75 * cd) {
      if (++agreeing > 2) break;
      continue;
    }
    agreeing = 0;
    let vg = 0, vb = 0;
    vs.length = bs.length = 0;
    for (const t of grid) {
      let b = 0;
      for (let p = 1; p < 8; p++) b += support(t + (p / 8) * P) / 7;
      vs.push(support(t)); bs.push(b);
      vg += vs[vs.length - 1]; vb += b;
    }
    const offTempo = cd < 3 || Math.abs((last - first) / (cd - 1) / P - 1) > 0.06;
    if (probe.quiet(lo, hi) && (offTempo || vg / m >= 0.8 * (vd / cd))) {
      reach = far;
      tail.length = tailV.length = tailB.length = 0;
      if (m < 8) break;
      continue;
    }
    sg += vg; sb += vb; ng += m; sd += vd; nd += cd;
    const stepOk = m < 4 || (vg >= vb && vg / m >= 0.5 * (cd ? vd / cd : 0));
    const runOk = sg >= 1.5 * sb && sg / ng >= 0.8 * (nd ? sd / nd : 0);
    if (!stepOk || !runOk) break;
    before = reach;
    reach = far;
    tail.length = tailV.length = tailB.length = 0;
    tail.push(...grid); tailV.push(...vs); tailB.push(...bs);
    if (m < 8) break;
  }
  for (let e = tail.length - 1; e >= 0 && tailV[e] < tailB[e]; e--) reach = e > 0 ? tail[e - 1] : before;
  return reach;
}

/**
 * Whether the grid belongs half a beat later. The novelty the DP follows weighs every onset, so a clap on every
 * beat of a half-time groove (kick, clap, kick, clap at double tempo) can pull the grid onto the claps with the kicks
 * in between. Produced music puts its beat on the kick, and changes bass notes on the beat: move when the kick
 * onsets half a beat away are much stronger than on the grid, there are real onsets there, and the bass changes
 * there at least as much. (Kick ratio on the test songs: ≤ 1.0 on all but the one clap-on-the-beat song, 2.1.)
 */
function kicksOnHalfBeat(g: Grid, ev: GridEvidence, probe: Probe): boolean {
  const { kick, fps, bass, chromaFps = 10 } = ev;
  const { support } = probe;
  // Strongest kick onset within −30…+60 ms, as in the beat features.
  const kickAt = (t: number) => {
    let m = 0;
    const a = Math.max(0, Math.round((t - 0.03) * fps)), z = Math.min(kick.length - 1, Math.round((t + 0.06) * fps));
    for (let f = a; f <= z; f++) if (kick[f] > m) m = kick[f];
    return m;
  };
  // Bass chroma change: cosine distance between the 0.2 s before and after.
  const nc = bass ? Math.floor(bass.length / 12) : 0;
  const bassChange = (t: number) => {
    const c = Math.round(t * chromaFps);
    if (!bass || c < 2 || c + 2 > nc) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < 12; k++) {
      const x = bass[(c - 2) * 12 + k] + bass[(c - 1) * 12 + k], y = bass[c * 12 + k] + bass[(c + 1) * 12 + k];
      dot += x * y; na += x * x; nb += y * y;
    }
    return na > 1e-12 && nb > 1e-12 ? 1 - dot / Math.sqrt(na * nb) : 0;
  };
  const P = g.period;
  let k0 = 0, kh = 0, s0 = 0, sh = 0, b0 = 0, bh = 0;
  for (let k = Math.ceil((g.t0 - g.offset) / P - 0.5); g.offset + k * P <= g.t1 + 0.5 * P; k++) {
    const t = g.offset + k * P;
    k0 += kickAt(t); kh += kickAt(t + 0.5 * P);
    s0 += support(t); sh += support(t + 0.5 * P);
    b0 += bassChange(t); bh += bassChange(t + 0.5 * P);
  }
  return kh > 1.5 * k0 && sh > 0.5 * s0 && bh >= b0;
}

/**
 * Final guard for the beat list: finite, within [0, duration], strictly increasing, and no beat within 30 % of the
 * median interval after the previous one (the later one is dropped).
 */
export function cleanBeats(beats: ArrayLike<number>, duration: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i];
    if (Number.isFinite(t) && t >= 0 && t <= duration) v.push(t);
  }
  v.sort((a, b) => a - b);
  const iv: number[] = [];
  for (let i = 0; i + 1 < v.length; i++) if (v[i + 1] > v[i]) iv.push(v[i + 1] - v[i]);
  const minGap = iv.length ? 0.3 * medianOf(iv) : 0;
  const out: number[] = [];
  for (const t of v) if (!out.length || t - out[out.length - 1] > minGap) out.push(t);
  return out;
}

function medianOf(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Circular-mean grid over the given beats: best period near their median interval, phase of the majority, LS refinement. */
function fitGrid(beats: Float64Array, idx: number[], around = 0, span = 0.015): { offset: number; period: number } | null {
  const iv: number[] = [];
  for (let j = 0; j + 1 < idx.length; j++) if (idx[j + 1] === idx[j] + 1) iv.push(beats[idx[j + 1]] - beats[idx[j]]);
  if (iv.length < 8) return null;
  const p0 = around > 0 ? around : medianOf(iv);
  let bestR = -1, bestP = p0, bestPh = 0;
  const t0 = beats[idx[0]];
  const steps = Math.max(1, Math.round(span / 0.0002));
  for (let q = -steps; q <= steps; q++) {
    const P = p0 * (1 + q * 0.0002);
    let re = 0, im = 0;
    for (const i of idx) {
      const ph = (2 * Math.PI * (beats[i] - t0)) / P;
      re += Math.cos(ph); im += Math.sin(ph);
    }
    const R = Math.hypot(re, im) / idx.length;
    if (R > bestR) { bestR = R; bestP = P; bestPh = Math.atan2(im, re); }
  }
  let offset = t0 + (bestPh / (2 * Math.PI)) * bestP, period = bestP;
  // Least squares on the agreeing beats (grid index from the circular fit), twice.
  let agree = 0;
  for (let pass = 0; pass < 2; pass++) {
    let s0 = 0, s1 = 0, s2 = 0, sy = 0, sky = 0;
    agree = 0;
    for (const i of idx) {
      const x = (beats[i] - offset) / period, k = Math.round(x);
      if (Math.abs(x - k) > 0.1) continue;
      agree++;
      s0++; s1 += k; s2 += k * k; sy += beats[i]; sky += k * beats[i];
    }
    const det = s0 * s2 - s1 * s1;
    if (agree < 8 || Math.abs(det) < 1e-9) return null;
    period = (s0 * sky - s1 * sy) / det;
    offset = (sy - period * s1) / s0;
  }
  if (agree < 0.5 * idx.length) return null;
  // The agreeing beats must sit tightly on the grid (a produced, fixed-tempo stretch).
  let se = 0;
  for (const i of idx) {
    const x = (beats[i] - offset) / period, k = Math.round(x);
    if (Math.abs(x - k) <= 0.1) se += (beats[i] - offset - k * period) ** 2;
  }
  if (Math.sqrt(se / agree) > 0.035 * period) return null;
  return { offset, period };
}
