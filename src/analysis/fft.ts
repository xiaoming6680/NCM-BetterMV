// Real FFT of a power-of-two size, computed as a half-size complex radix-2 FFT plus the usual split step.
// Only the power spectrum is needed by the analysis, so that is all this exposes.

export class RealFFT {
  readonly n: number;
  private readonly m: number;
  private readonly rev: Uint32Array;
  /** Twiddles e^{-2πij/size} for the stages from size 8 on, each stage's half in a row (j < size/2). */
  private readonly twRe: Float64Array;
  private readonly twIm: Float64Array;
  private readonly splitCos: Float64Array;
  private readonly splitSin: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(n: number) {
    if (n < 8 || (n & (n - 1)) !== 0) throw new Error('RealFFT size must be a power of two ≥ 8');
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
    // (The same values the stages used to read from one table of e^{-2πik/m} with a stride.)
    const len = Math.max(1, m - 4);
    this.twRe = new Float64Array(len);
    this.twIm = new Float64Array(len);
    for (let size = 8, o = 0; size <= m; o += size >> 1, size <<= 1) {
      const step = m / size;
      for (let j = 0; j < size >> 1; j++) {
        this.twRe[o + j] = Math.cos((2 * Math.PI * j * step) / m);
        this.twIm[o + j] = -Math.sin((2 * Math.PI * j * step) / m);
      }
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
    const m = this.m, re = this.re, im = this.im, rev = this.rev;
    // Bit-reversed load with the first two stages (sizes 2 and 4, twiddles 1 and −i) done on the way in.
    for (let a = 0; a < m; a += 4) {
      const r0 = rev[a] << 1, r1 = rev[a + 1] << 1, r2 = rev[a + 2] << 1, r3 = rev[a + 3] << 1;
      const x0r = x[r0], x0i = x[r0 + 1], x1r = x[r1], x1i = x[r1 + 1];
      const x2r = x[r2], x2i = x[r2 + 1], x3r = x[r3], x3i = x[r3 + 1];
      const a0r = x0r + x1r, a0i = x0i + x1i, a1r = x0r - x1r, a1i = x0i - x1i;
      const b0r = x2r + x3r, b0i = x2i + x3i, b1r = x2r - x3r, b1i = x2i - x3i;
      re[a] = a0r + b0r; im[a] = a0i + b0i;
      re[a + 2] = a0r - b0r; im[a + 2] = a0i - b0i;
      // (b1 · −i = (b1i, −b1r))
      re[a + 1] = a1r + b1i; im[a + 1] = a1i - b1r;
      re[a + 3] = a1r - b1i; im[a + 3] = a1i + b1r;
    }
    // Radix-2 decimation in time from size 8, two stages per pass over the data where it can (the same butterflies in
    // the same order, half the loads and stores).
    const twRe = this.twRe, twIm = this.twIm;
    let size = 8, o = 0;
    for (; size * 2 <= m; o += (size >> 1) + size, size <<= 2) {
      const q = size >> 1, o2 = o + q;
      for (let s = 0; s < m; s += size << 1) {
        for (let j = 0; j < q; j++) {
          const p0 = s + j, p1 = p0 + q, p2 = p0 + size, p3 = p2 + q;
          // Stage `size`: (p0, p1) and (p2, p3), both with twiddle j.
          let wr = twRe[o + j], wi = twIm[o + j];
          let br = re[p1], bi = im[p1];
          let tr = br * wr - bi * wi, ti = br * wi + bi * wr;
          let ar = re[p0], ai = im[p0];
          const x1r = ar - tr, x1i = ai - ti, x0r = ar + tr, x0i = ai + ti;
          br = re[p3]; bi = im[p3];
          tr = br * wr - bi * wi; ti = br * wi + bi * wr;
          ar = re[p2]; ai = im[p2];
          const x3r = ar - tr, x3i = ai - ti, x2r = ar + tr, x2i = ai + ti;
          // Stage 2·size: (p0, p2) with twiddle j, (p1, p3) with j + q.
          wr = twRe[o2 + j]; wi = twIm[o2 + j];
          tr = x2r * wr - x2i * wi; ti = x2r * wi + x2i * wr;
          re[p2] = x0r - tr; im[p2] = x0i - ti;
          re[p0] = x0r + tr; im[p0] = x0i + ti;
          wr = twRe[o2 + j + q]; wi = twIm[o2 + j + q];
          tr = x3r * wr - x3i * wi; ti = x3r * wi + x3i * wr;
          re[p3] = x1r - tr; im[p3] = x1i - ti;
          re[p1] = x1r + tr; im[p1] = x1i + ti;
        }
      }
    }
    if (size <= m) {
      const half = size >> 1;
      for (let s = 0; s < m; s += size) {
        for (let j = 0; j < half; j++) {
          const a = s + j, b = a + half;
          const wr = twRe[o + j], wi = twIm[o + j];
          const br = re[b], bi = im[b];
          const tr = br * wr - bi * wi, ti = br * wi + bi * wr;
          const ar = re[a], ai = im[a];
          re[b] = ar - tr; im[b] = ai - ti;
          re[a] = ar + tr; im[a] = ai + ti;
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
