// Real FFT of a power-of-two size, computed as a half-size complex radix-2 FFT plus the usual split step.
// Only the power spectrum is needed by the analysis, so that is all this exposes.

export class RealFFT {
  readonly n: number;
  private readonly m: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly splitCos: Float64Array;
  private readonly splitSin: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error('RealFFT size must be a power of two ≥ 4');
    this.n = n;
    const m = (this.m = n >> 1);
    let bits = 0;
    while (1 << bits < m) bits++;
    this.rev = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(m >> 1 || 1);
    this.sin = new Float64Array(m >> 1 || 1);
    for (let k = 0; k < m >> 1; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / m);
      this.sin[k] = Math.sin((2 * Math.PI * k) / m);
    }
    this.splitCos = new Float64Array(m + 1);
    this.splitSin = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.splitCos[k] = Math.cos((2 * Math.PI * k) / n);
      this.splitSin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.re = new Float64Array(m);
    this.im = new Float64Array(m);
  }

  /** |X[k]|² for k = 0..n/2 of the real input `x` (length n) into `out` (length ≥ n/2 + 1). */
  power(x: ArrayLike<number>, out: Float64Array | Float32Array): void {
    const m = this.m, re = this.re, im = this.im, rev = this.rev, cos = this.cos, sin = this.sin;
    for (let j = 0; j < m; j++) {
      const r = rev[j];
      re[r] = x[2 * j];
      im[r] = x[2 * j + 1];
    }
    // Radix-2 decimation in time; twiddle e^{-2πik/m}.
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1, step = m / size;
      if (half < 8) {
        for (let j = 0; j < half; j++) {
          const wr = cos[j * step], wi = -sin[j * step];
          for (let a = j; a < m; a += size) {
            const b = a + half;
            const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      } else {
        for (let s = 0; s < m; s += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = s + j, b = a + half;
            const wr = cos[k], wi = -sin[k];
            const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    }
    // Split the packed spectrum of (even, odd) samples into the real signal's spectrum.
    const sc = this.splitCos, ss = this.splitSin;
    for (let k = 0; k <= m; k++) {
      const k1 = k === m ? 0 : k, k2 = k === 0 ? 0 : m - k;
      const a = re[k1], b = im[k1], c = re[k2], d = im[k2];
      const er = 0.5 * (a + c), ei = 0.5 * (b - d);
      const or = 0.5 * (a - c), oi = 0.5 * (b + d);
      const cw = sc[k], sw = ss[k];
      const xr = er + (cw * oi - sw * or);
      const xi = ei - (cw * or + sw * oi);
      out[k] = xr * xr + xi * xi;
    }
  }
}

/** Periodic Hann window. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
