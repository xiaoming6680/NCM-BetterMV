// Onset detection functions from the 100 fps spectra. The full-band SuperFlux-style log-mel flux and the dB flux of
// the kick bins drive tempo and beat tracking; amplitude (linear) flux per drum band drives the hits, because it is
// dominated by the loudest attacks (a kick, not the bass line under it).
import type { Spectra } from './spectrum.ts';
import { chunked, type Slicer } from './util.ts';

export interface Onsets {
  /** Full-band log-mel flux: mean positive dB rise per mel band (±1 band max filter on the reference). */
  flux: Float32Array;
  /** dB rise of the ≈40–150 Hz bins (beat novelty). */
  low: Float32Array;
  /** Amplitude rise of the ≈40–150 Hz bins (kick hits). */
  kick: Float32Array;
  /** Noise bursts: √(1–5 kHz rise × 5–11 kHz rise) × share of bands rising (snares, claps). */
  snare: Float32Array;
  /** The two amplitude rises of `snare`: 1–5 kHz and above 5 kHz (a hat rises mostly in the second). */
  snareMid: Float32Array;
  snareHigh: Float32Array;
  /** Amplitude rise above 6 kHz × share of bands rising (hats, shakers, cymbals). */
  hat: Float32Array;
  /** Summed amplitude of the kick bins, of the mel bands above 1 kHz and above 6 kHz (decay checks for the hits). */
  lowLevel: Float32Array;
  highLevel: Float32Array;
  hatLevel: Float32Array;
}

/** Frames between the compared spectra (20 ms at 100 fps). */
export const FLUX_LAG = 2;

export function* computeOnsets(s: Spectra, slicer: Slicer, p0: number, p1: number): Generator<number, Onsets, void> {
  const { nFrames, nMel, melDb, melAmp, melHz, nKick, kickDb, kickAmp } = s;
  const L = FLUX_LAG;
  const flux = new Float32Array(nFrames), low = new Float32Array(nFrames), kick = new Float32Array(nFrames);
  const snare = new Float32Array(nFrames), hat = new Float32Array(nFrames);
  const snareMid = new Float32Array(nFrames), snareHigh = new Float32Array(nFrames);
  const lowLevel = new Float32Array(nFrames), highLevel = new Float32Array(nFrames), hatLevel = new Float32Array(nFrames);
  let mLo = nMel, mHi = 0, hLo = nMel, h6 = nMel;
  for (let b = 0; b < nMel; b++) {
    if (melHz[b] >= 1000 && b < mLo) mLo = b;
    if (melHz[b] <= 5000) mHi = b;
    if (melHz[b] > 5000 && b < hLo) hLo = b;
    if (melHz[b] >= 6000 && b < h6) h6 = b;
  }
  const mc = Math.max(1, mHi - mLo + 1), hc = Math.max(1, nMel - hLo), h6c = Math.max(1, nMel - h6);
  const work = (t0: number, t1: number) => {
    for (let t = t0; t < t1; t++) {
      let la = 0, hla = 0, h6l = 0;
      for (let k = 0; k < nKick; k++) la += kickAmp[t * nKick + k];
      for (let b = mLo; b < nMel; b++) {
        hla += melAmp[t * nMel + b];
        if (b >= h6) h6l += melAmp[t * nMel + b];
      }
      lowLevel[t] = la;
      highLevel[t] = hla;
      hatLevel[t] = h6l;
      if (t < L) continue;
      const cur = t * nMel, ref = (t - L) * nMel;
      let sum = 0;
      for (let b = 0; b < nMel; b++) {
        let r = melDb[ref + b];
        if (b > 0 && melDb[ref + b - 1] > r) r = melDb[ref + b - 1];
        if (b + 1 < nMel && melDb[ref + b + 1] > r) r = melDb[ref + b + 1];
        const v = melDb[cur + b] - r;
        if (v > 0) sum += v;
      }
      flux[t] = sum / nMel;
      // Drum bands: amplitude rise, weighted by the share of bands whose level rises by more than 1 dB.
      let ma = 0, mn = 0, ha = 0, hn = 0, h6a = 0, h6n = 0;
      for (let b = mLo; b < nMel; b++) {
        const da = melAmp[cur + b] - melAmp[ref + b];
        const up = melDb[cur + b] - melDb[ref + b] > 1 ? 1 : 0;
        if (b <= mHi) {
          if (da > 0) ma += da;
          mn += up;
        } else {
          if (da > 0) ha += da;
          hn += up;
        }
        if (b >= h6) {
          if (da > 0) h6a += da;
          h6n += up;
        }
      }
      snare[t] = Math.sqrt(ma * ha) * ((mn + hn) / (mc + hc));
      snareMid[t] = ma;
      snareHigh[t] = ha;
      hat[t] = h6a * (h6n / h6c);
      const kc = t * nKick, kr = (t - L) * nKick;
      let ks = 0, ka = 0;
      for (let k = 0; k < nKick; k++) {
        const v = kickDb[kc + k] - kickDb[kr + k];
        if (v > 0) ks += v;
        const a = kickAmp[kc + k] - kickAmp[kr + k];
        if (a > 0) ka += a;
      }
      low[t] = ks / nKick;
      kick[t] = ka;
    }
  };
  yield* chunked(nFrames, 512, work, slicer, p0, p1);
  return { flux, low, kick, snare, snareMid, snareHigh, hat, lowLevel, highLevel, hatLevel };
}
