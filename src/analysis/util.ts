// Small numeric helpers shared by the analysis stages. Everything works on typed arrays and allocates once per call.

export type Num = ArrayLike<number>;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();

/** Tracks how long the current slice of work has run; stages yield when `due()` says so and call `resume()` after. */
export class Slicer {
  private start = now();
  private readonly sliceMs: number;
  constructor(sliceMs: number) {
    this.sliceMs = sliceMs;
  }
  due(): boolean {
    return now() - this.start >= this.sliceMs;
  }
  resume(): void {
    this.start = now();
  }
}

/**
 * Runs `work(from, to)` over [0, n) in chunks of `size`, yielding progress (p0..p1) whenever the slice is used up.
 * Hot loops live in `work` (an ordinary function) so the JIT optimises them normally; the generator only steps.
 */
export function* chunked(
  n: number,
  size: number,
  work: (from: number, to: number) => void,
  slicer: Slicer,
  p0: number,
  p1: number,
): Generator<number, void, void> {
  for (let i = 0; i < n; i += size) {
    const j = Math.min(n, i + size);
    work(i, j);
    if (slicer.due()) {
      yield p0 + ((p1 - p0) * j) / n;
      slicer.resume();
    }
  }
}

/** p-th quantile (0..1) of the finite values in `a`, linear interpolation. */
export function quantile(a: Num, p: number): number {
  const s = new Float64Array(a.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v === v && v !== Infinity && v !== -Infinity) s[n++] = v;
  }
  if (!n) return 0;
  const v = s.subarray(0, n).sort();
  const x = Math.min(n - 1, Math.max(0, p * (n - 1)));
  const i = Math.floor(x), f = x - i;
  return i + 1 < n ? v[i] * (1 - f) + v[i + 1] * f : v[i];
}

export function median(a: Num): number {
  return quantile(a, 0.5);
}

export function mean(a: Num, from = 0, to = a.length): number {
  from = Math.max(0, from); to = Math.min(a.length, to);
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
}

export function std(a: Num): number {
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0;
}

/** Centred moving average over ±half samples (window shrinks at the edges). */
export function movingAverage(a: Num, half: number): Float32Array {
  const n = a.length, out = new Float32Array(n), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i];
  half = Math.max(0, Math.round(half));
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
    out[i] = (cs[hi] - cs[lo]) / (hi - lo);
  }
  return out;
}

/** Centred moving maximum over ±half samples. */
export function movingMax(a: Num, half: number): Float32Array {
  const n = a.length, out = new Float32Array(n);
  // Van Herk / Gil-Werman would be O(n); the windows used here are short, so the direct loop is fine.
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) if (a[j] > m) m = a[j];
    out[i] = m;
  }
  return out;
}

/** Convolution with a normalised Gaussian of standard deviation `sigma` samples. */
export function gaussianSmooth(a: Num, sigma: number): Float32Array {
  const n = a.length, out = new Float32Array(n);
  if (sigma <= 0.3) {
    for (let i = 0; i < n; i++) out[i] = a[i];
    return out;
  }
  const r = Math.ceil(sigma * 3), k = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp((-0.5 * i * i) / (sigma * sigma));
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    const lo = Math.max(-r, -i), hi = Math.min(r, n - 1 - i);
    for (let j = lo; j <= hi; j++) {
      s += a[i + j] * k[j + r];
      w += k[j + r];
    }
    out[i] = s / w;
  }
  return out;
}

/** One-pole envelope follower with separate attack and release time constants (seconds). */
export function attackRelease(a: Num, fps: number, attack: number, release: number): Float32Array {
  const n = a.length, out = new Float32Array(n);
  const ka = 1 - Math.exp(-1 / (fps * attack)), kr = 1 - Math.exp(-1 / (fps * release));
  let y = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    y += (x > y ? ka : kr) * (x - y);
    out[i] = y;
  }
  return out;
}

/** Divide by the p-th quantile (default 99th percentile) and clip to 0..1. */
export function normalizeQuantile(a: Num, p = 0.99): Float32Array {
  const q = quantile(a, p);
  const out = new Float32Array(a.length);
  if (!(q > 0)) return out;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] / q;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/** Robust z-score (median / 1.4826·MAD); falls back to the standard deviation when the MAD is zero. */
export function robustZ(a: Num): Float32Array {
  const m = median(a);
  const dev = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) dev[i] = Math.abs(a[i] - m);
  let s = 1.4826 * median(dev);
  if (!(s > 1e-12)) s = std(a);
  if (!(s > 1e-12)) s = 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - m) / s;
  return out;
}

/** Value of `a` at fractional index x (linear interpolation, clamped). */
export function lerpAt(a: Num, x: number): number {
  if (x <= 0) return a[0];
  const n = a.length;
  if (x >= n - 1) return a[n - 1];
  const i = Math.floor(x), f = x - i;
  return a[i] * (1 - f) + a[i + 1] * f;
}

/** Index of the first element of sorted `a` that is ≥ x. */
export function lowerBound(a: Num, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
