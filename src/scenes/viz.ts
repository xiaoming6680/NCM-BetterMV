// The music-visualisation plates' shared ear: what the song sounds like at any time, worked out from the decoded
// channels (SceneInit.stereo) rather than the cached analysis, which keeps no spectra.
// - Spectrogram: the spectrum in columns, 60 a second, over log-spaced bands from the low bass to the top of the
//   decode; each column is computed the first time it is asked for and kept, so it is a pure function of time (seeks
//   and sample renders agree with playback) and costs one small FFT per new column.
// - SpecRing: the recent (and coming) columns in a texture, for shaders.
import * as THREE from 'three';
import { RealFFT, hann } from '../analysis/fft.ts';
import type { Stereo } from './types.ts';

/** Spectrogram columns a second. */
export const COLS = 60;

const pow2At = (x: number) => 1 << Math.round(Math.log2(x));

/** The mono mix of the channels at sample i (0 outside the song), −1..1. */
function monoAt(st: Stereo, i: number): number {
  return i >= 0 && i < st.left.length ? (st.left[i] + st.right[i]) / 65534 : 0;
}

const shared = new WeakMap<Stereo, Map<string, Spectrogram>>();

export class Spectrogram {
  /** The song's spectrogram with these bands, made once and shared by every plate that asks (one FFT per column). */
  static of(stereo: Stereo | undefined, duration: number, bands = 96, fMin = 32): Spectrogram {
    if (!stereo) return new Spectrogram(stereo, duration, bands, fMin);
    const byKey = shared.get(stereo) ?? shared.set(stereo, new Map()).get(stereo)!;
    const key = `${bands}:${fMin}:${Math.ceil(duration)}`;
    return byKey.get(key) ?? byKey.set(key, new Spectrogram(stereo, duration, bands, fMin)).get(key)!;
  }

  readonly bands: number;
  /** Centre frequency of each band, Hz, low to high. */
  readonly hz: Float32Array;
  /** Columns in the song. */
  readonly length: number;
  /** length × bands, 0..1: level above the song's floor, tilted +3 dB an octave so the treble reads beside the bass. */
  private data: Float32Array;
  private have: Uint8Array;
  private fft: RealFFT;
  private size: number;
  private win: Float64Array;
  private frame: Float64Array;
  private pow: Float64Array;
  /** Per band: the bins averaged (lo..hi inclusive), or for a band narrower than a bin, the fractional bin read. */
  private lo: Int32Array;
  private hi: Int32Array;
  private frac: Float32Array;
  private tilt: Float32Array;
  private floor = -70;
  private range = 50;
  private cursor = 0;

  constructor(private stereo: Stereo | undefined, duration: number, bands = 96, fMin = 32) {
    this.bands = bands;
    const rate = stereo?.rate ?? 22050;
    // About 11 Hz a bin (93 ms at 22.05 kHz): the bass bands are still apart, a kick still a kick.
    this.size = pow2At(rate / 11);
    this.fft = new RealFFT(this.size);
    this.win = hann(this.size);
    this.frame = new Float64Array(this.size);
    this.pow = new Float64Array(this.size / 2 + 1);
    this.length = Math.max(1, Math.ceil(duration * COLS) + 1);
    this.data = new Float32Array(this.length * bands);
    this.have = new Uint8Array(this.length);
    const fMax = Math.min(14000, rate * 0.45), df = rate / this.size;
    this.hz = new Float32Array(bands);
    this.lo = new Int32Array(bands);
    this.hi = new Int32Array(bands);
    this.frac = new Float32Array(bands);
    this.tilt = new Float32Array(bands);
    const f = (b: number) => fMin * Math.pow(fMax / fMin, b / (bands - 1));
    for (let b = 0; b < bands; b++) {
      const c = f(b), lo = Math.sqrt(f(b - 1) * c), hi = Math.sqrt(c * f(b + 1));
      this.hz[b] = c;
      this.lo[b] = Math.max(1, Math.ceil(lo / df));
      this.hi[b] = Math.min(this.size / 2, Math.floor(hi / df));
      this.frac[b] = c / df;
      this.tilt[b] = 3 * Math.log2(c / 1000);
    }
    this.calibrate();
  }

  /** Level range from a few hundred columns spread over the song: the top is its 99.5th percentile, 50 dB of range. */
  private calibrate(): void {
    if (!this.stereo) return;
    const n = Math.min(400, this.length), all: number[] = [], col = new Float32Array(this.bands);
    for (let k = 0; k < n; k++) {
      this.raw(Math.floor(((k + 0.5) / n) * this.length), col);
      for (let b = 0; b < this.bands; b++) all.push(col[b]);
    }
    all.sort((a, b) => a - b);
    const top = all[Math.floor(all.length * 0.995)] ?? 0;
    this.floor = top - this.range;
  }

  /** The tilted dB of column c's bands into out. */
  private raw(c: number, out: Float32Array): void {
    const st = this.stereo!, n = this.size, x = this.frame, w = this.win;
    const i0 = Math.round((c / COLS) * st.rate) - (n >> 1);
    for (let i = 0; i < n; i++) x[i] = monoAt(st, i0 + i) * w[i];
    this.fft.power(x, this.pow);
    const p = this.pow, norm = 4 / (n * n);
    for (let b = 0; b < this.bands; b++) {
      let v: number;
      if (this.hi[b] >= this.lo[b] + 1) {
        let s = 0;
        for (let k = this.lo[b]; k <= this.hi[b]; k++) s += p[k];
        v = s / (this.hi[b] - this.lo[b] + 1);
      } else {
        const fb = this.frac[b], k = Math.floor(fb), u = fb - k;
        v = p[k] * (1 - u) + p[k + 1] * u;
      }
      out[b] = 10 * Math.log10(v * norm + 1e-12) + this.tilt[b];
    }
  }

  /** Column c (0..1 per band; zeros outside the song). Don't keep the array: it is a view into the store. */
  column(c: number): Float32Array {
    c = Math.max(0, Math.min(this.length - 1, Math.round(c)));
    const out = this.data.subarray(c * this.bands, (c + 1) * this.bands);
    if (!this.have[c]) {
      this.have[c] = 1;
      if (this.stereo) {
        this.raw(c, out);
        const f = this.floor, r = 1 / this.range;
        for (let b = 0; b < this.bands; b++) { const v = (out[b] - f) * r; out[b] = v < 0 ? 0 : v > 1 ? 1 : v; }
      }
    }
    return out;
  }

  /** The spectrum at time t (between columns) into out. */
  at(t: number, out: Float32Array): Float32Array {
    const x = t * COLS, c = Math.floor(x), u = x - c;
    const a = this.column(c), b = this.column(c + 1);
    for (let i = 0; i < this.bands; i++) out[i] = a[i] + (b[i] - a[i]) * u;
    return out;
  }

  /** Whether column c is already worked out. */
  ready(c: number): boolean { return c < 0 || c >= this.length || this.have[c] === 1; }

  /**
   * Works out columns ahead of the play for up to `ms` (keepUp: the time between frames goes into the columns a plate
   * will want next, so cutting to it doesn't stall): from t onwards, then on through the song.
   */
  prefetch(t: number, ms: number): void {
    if (!this.stereo) return;
    const until = performance.now() + ms;
    let c = Math.max(0, Math.floor(t * COLS));
    if (this.cursor < c || this.cursor > c + 60 * COLS) this.cursor = c;
    while (this.cursor < this.length) {
      if (!this.have[this.cursor]) {
        this.column(this.cursor);
        if ((this.cursor & 7) === 0 && performance.now() > until) return;
      }
      this.cursor++;
    }
  }
}

/**
 * The spectrogram on the GPU: a ring of RING columns (rows of a texture, one band per texel, level in red), for
 * shaders that read the song's recent (or coming) spectrum. `sync(c0, c1)` puts columns c0..c1 in, each lightly
 * smoothed over time and frequency; a shader reads column c at row mod(c, RING).
 */
export class SpecRing {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  private rowCol: Int32Array;
  private tmp: Float32Array;
  private out: Float32Array;

  constructor(readonly spec: Spectrogram, readonly rows: number) {
    const nb = spec.bands;
    this.data = new Uint8Array(nb * rows * 4);
    this.rowCol = new Int32Array(rows).fill(-1);
    this.tmp = new Float32Array(nb);
    this.out = new Float32Array(nb);
    this.texture = new THREE.DataTexture(this.data, nb, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  private smoothed(c: number): Float32Array {
    const nb = this.spec.bands, out = this.out.fill(0), tmp = this.tmp;
    const a = this.spec.column(c - 1), b = this.spec.column(c), d = this.spec.column(c + 1);
    for (let i = 0; i < nb; i++) tmp[i] = 0.25 * a[i] + 0.5 * b[i] + 0.25 * d[i];
    for (let i = 0; i < nb; i++) out[i] = 0.25 * tmp[Math.max(0, i - 1)] + 0.5 * tmp[i] + 0.25 * tmp[Math.min(nb - 1, i + 1)];
    return out;
  }

  sync(c0: number, c1: number): void {
    const nb = this.spec.bands, rows = this.rows, changed: number[] = [];
    for (let c = c0; c <= c1; c++) {
      const r = ((c % rows) + rows) % rows;
      if (this.rowCol[r] === c) continue;
      this.rowCol[r] = c;
      const col = c >= 0 && c < this.spec.length ? this.smoothed(c) : null, o = r * nb * 4;
      for (let b = 0; b < nb; b++) this.data[o + b * 4] = col ? Math.round(col[b] * 255) : 0;
      changed.push(r);
    }
    if (!changed.length) return;
    this.texture.clearUpdateRanges();
    if (changed.length <= rows / 8) for (const r of changed) this.texture.addUpdateRange(r * nb * 4, nb * 4);
    this.texture.needsUpdate = true;
  }
}
