// Short-time spectra of the whole song: one 100 fps STFT (~46 ms window) for mel bands, band energies and the kick bins,
// and one 10 fps STFT (~186 ms window) for treble and bass chroma.
import { RealFFT, hann } from './fft.ts';
import { chunked, type Slicer } from './util.ts';

export const FPS = 100;
export const CHROMA_FPS = 10;

export interface Spectra {
  sampleRate: number;
  fps: number;
  nFrames: number;
  /** Mel bands per frame. */
  nMel: number;
  melHz: Float32Array;
  /** nFrames × nMel mel power in dB, floored 80 dB below the loudest band value. */
  melDb: Float32Array;
  /** nFrames × nMel mel amplitude (square root of the band power). */
  melAmp: Float32Array;
  /** Kick region FFT bins (≈40–150 Hz) per frame, dB with the same floor. */
  nKick: number;
  kickDb: Float32Array;
  /** Kick region bin amplitudes. */
  kickAmp: Float32Array;
  /** Mean-square level per frame (window weighted). */
  power: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  chromaFps: number;
  nChroma: number;
  /** nChroma × 12, pitch class 0 = C. Magnitude sums over 200–4000 Hz. */
  chroma: Float32Array;
  /** nChroma × 12 over 40–200 Hz. */
  bass: Float32Array;
}

const pow2Near = (x: number) => 1 << Math.max(8, Math.round(Math.log2(x)));
const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

interface Filterbank {
  start: Int32Array;
  len: Int32Array;
  offset: Int32Array;
  weights: Float64Array;
}

function melFilterbank(nMel: number, n: number, sr: number, fMin: number, fMax: number, centers: Float32Array): Filterbank {
  const bins = n / 2 + 1, df = sr / n;
  const mLo = hzToMel(fMin), mHi = hzToMel(fMax);
  const edges = new Float64Array(nMel + 2);
  for (let i = 0; i < nMel + 2; i++) edges[i] = melToHz(mLo + ((mHi - mLo) * i) / (nMel + 1));
  const start = new Int32Array(nMel), len = new Int32Array(nMel), offset = new Int32Array(nMel);
  const w: number[] = [];
  for (let b = 0; b < nMel; b++) {
    const lo = edges[b], c = edges[b + 1], hi = edges[b + 2];
    centers[b] = c;
    const k0 = Math.max(0, Math.ceil(lo / df)), k1 = Math.min(bins - 1, Math.floor(hi / df));
    const ws: number[] = [];
    let sum = 0;
    for (let k = k0; k <= k1; k++) {
      const f = k * df;
      const v = f <= c ? (f - lo) / (c - lo) : (hi - f) / (hi - c);
      ws.push(v > 0 ? v : 0);
      sum += v > 0 ? v : 0;
    }
    offset[b] = w.length;
    if (sum <= 1e-9) {
      // Narrower than a bin: take the nearest bin.
      start[b] = Math.min(bins - 1, Math.round(c / df));
      len[b] = 1;
      w.push(1);
    } else {
      start[b] = k0;
      len[b] = ws.length;
      for (const v of ws) w.push(v / sum);
    }
  }
  return { start, len, offset, weights: Float64Array.from(w) };
}

/** Pitch-class map for chroma: each bin in [fLo, fHi] splits its magnitude between the two nearest semitones. */
function chromaMap(n: number, sr: number, fLo: number, fHi: number) {
  const df = sr / n;
  const k0 = Math.max(1, Math.ceil(fLo / df)), k1 = Math.min(n / 2, Math.floor(fHi / df));
  const count = Math.max(0, k1 - k0 + 1);
  const pcA = new Uint8Array(count), pcB = new Uint8Array(count), wA = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const f = (k0 + i) * df;
    const p = 69 + 12 * Math.log2(f / 440);
    const lo = Math.floor(p), frac = p - lo;
    pcA[i] = ((lo % 12) + 12) % 12;
    pcB[i] = (pcA[i] + 1) % 12;
    wA[i] = Math.cos((frac * Math.PI) / 2) ** 2;
  }
  return { k0, count, pcA, pcB, wA };
}

export function* computeSpectra(
  x: Float32Array,
  sr: number,
  slicer: Slicer,
  p0: number,
  p1: number,
): Generator<number, Spectra, void> {
  const len = x.length;
  const hop = sr / FPS;
  const nFrames = Math.max(1, Math.floor(len / hop) + 1);
  const n = pow2Near(sr * 0.0464);
  const bins = n / 2 + 1, df = sr / n;
  const fft = new RealFFT(n), win = hann(n);
  let winSq = 0;
  for (let i = 0; i < n; i++) winSq += win[i] * win[i];
  const powScale = 2 / (n * winSq);

  const nMel = 64;
  const melHz = new Float32Array(nMel);
  const fb = melFilterbank(nMel, n, sr, 30, Math.min(11000, sr / 2 - 50), melHz);
  const kickLo = Math.max(1, Math.ceil(40 / df)), kickHi = Math.max(kickLo, Math.floor(150 / df));
  const nKick = kickHi - kickLo + 1;
  const lowHi = Math.floor(150 / df), midLo = lowHi + 1, midHi = Math.floor(2000 / df), highLo = Math.ceil(4000 / df);

  const melDb = new Float32Array(nFrames * nMel), melAmp = new Float32Array(nFrames * nMel);
  const kickDb = new Float32Array(nFrames * nKick), kickAmp = new Float32Array(nFrames * nKick);
  const power = new Float32Array(nFrames), low = new Float32Array(nFrames), mid = new Float32Array(nFrames), high = new Float32Array(nFrames);
  const buf = new Float64Array(n), pw = new Float64Array(bins);
  const { start, len: flen, offset, weights } = fb;

  // Progress: STFT ≈ 64 %, dB conversion ≈ 6 %, chroma ≈ 30 % of this stage.
  const pA = p0 + (p1 - p0) * 0.64, pB = p0 + (p1 - p0) * 0.7;
  const frames = (i0: number, i1: number) => {
    for (let i = i0; i < i1; i++) {
      const s0 = Math.round(i * hop) - (n >> 1);
      if (s0 >= 0 && s0 + n <= len) {
        for (let j = 0; j < n; j++) buf[j] = x[s0 + j] * win[j];
      } else {
        for (let j = 0; j < n; j++) {
          const k = s0 + j;
          buf[j] = k >= 0 && k < len ? x[k] * win[j] : 0;
        }
      }
      fft.power(buf, pw);
      const mo = i * nMel;
      for (let b = 0; b < nMel; b++) {
        let acc = 0;
        const s = start[b], o = offset[b], l = flen[b];
        for (let k = 0; k < l; k++) acc += pw[s + k] * weights[o + k];
        melDb[mo + b] = acc * powScale;
        melAmp[mo + b] = Math.sqrt(acc * powScale);
      }
      const ko = i * nKick;
      for (let k = 0; k < nKick; k++) {
        kickDb[ko + k] = pw[kickLo + k] * powScale;
        kickAmp[ko + k] = Math.sqrt(pw[kickLo + k] * powScale);
      }
      let tot = 0, lo = 0, md = 0, hi = 0;
      for (let k = 1; k < bins; k++) {
        const v = pw[k];
        tot += v;
        if (k <= lowHi) lo += v;
        else if (k <= midHi) {
          if (k >= midLo) md += v;
        } else if (k >= highLo) hi += v;
      }
      power[i] = tot * powScale;
      low[i] = lo * powScale;
      mid[i] = md * powScale;
      high[i] = hi * powScale;
    }
  };
  yield* chunked(nFrames, 64, frames, slicer, p0, pA);

  // dB with a floor 80 dB below the loudest value (so silence and dither do not produce flux).
  const floorOf = (a: Float32Array) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return Math.max(m, 1e-12) * 1e-8;
  };
  const toDb = (a: Float32Array, floor: number) => (i0: number, i1: number) => {
    for (let i = i0; i < i1; i++) a[i] = 10 * Math.log10(a[i] > floor ? a[i] : floor);
  };
  yield* chunked(melDb.length, 1 << 16, toDb(melDb, floorOf(melDb)), slicer, pA, pB);
  yield* chunked(kickDb.length, 1 << 16, toDb(kickDb, floorOf(kickDb)), slicer, pB, pB);

  // Chroma from a longer window at 10 fps.
  const n2 = pow2Near(sr * 0.186);
  const hop2 = sr / CHROMA_FPS;
  const nChroma = Math.max(1, Math.floor(len / hop2) + 1);
  const fft2 = new RealFFT(n2), win2 = hann(n2);
  const buf2 = new Float64Array(n2), pw2 = new Float64Array(n2 / 2 + 1);
  const treb = chromaMap(n2, sr, 200, 4000), bassMap = chromaMap(n2, sr, 40, 200);
  const chroma = new Float32Array(nChroma * 12), bass = new Float32Array(nChroma * 12);
  const addChroma = (map: ReturnType<typeof chromaMap>, dst: Float32Array, o: number) => {
    const { k0, count, pcA, pcB, wA } = map;
    for (let j = 0; j < count; j++) {
      const m = Math.sqrt(pw2[k0 + j]);
      dst[o + pcA[j]] += m * wA[j];
      dst[o + pcB[j]] += m * (1 - wA[j]);
    }
  };
  const chromaFrames = (i0: number, i1: number) => {
    for (let i = i0; i < i1; i++) {
      const s0 = Math.round(i * hop2) - (n2 >> 1);
      if (s0 >= 0 && s0 + n2 <= len) {
        for (let j = 0; j < n2; j++) buf2[j] = x[s0 + j] * win2[j];
      } else {
        for (let j = 0; j < n2; j++) {
          const k = s0 + j;
          buf2[j] = k >= 0 && k < len ? x[k] * win2[j] : 0;
        }
      }
      fft2.power(buf2, pw2);
      addChroma(treb, chroma, i * 12);
      addChroma(bassMap, bass, i * 12);
    }
  };
  yield* chunked(nChroma, 8, chromaFrames, slicer, pB, p1);
  return {
    sampleRate: sr, fps: FPS, nFrames, nMel, melHz, melDb, melAmp, nKick, kickDb, kickAmp, power, low, mid, high,
    chromaFps: CHROMA_FPS, nChroma, chroma, bass,
  };
}
