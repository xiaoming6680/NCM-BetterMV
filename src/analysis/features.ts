// Beat-synchronous features: chroma, bass chroma, MFCC-like timbre, loudness and drum-band onset strength per beat.
// Bars and sections are built from these.
import type { Spectra } from './spectrum.ts';
import type { Onsets } from './onset.ts';

export const N_MFCC = 13;

export interface BeatFeatures {
  n: number;
  /** n × 12 treble chroma, L2-normalised per beat. */
  chroma: Float32Array;
  /** n × 12 bass chroma, L2-normalised per beat. */
  bass: Float32Array;
  /** n × 13 DCT of the mean log-mel spectrum (c0 = mean level in dB). */
  mfcc: Float32Array;
  /** Mean level in dB. */
  db: Float32Array;
  /** Mean high-band (> 4 kHz) share of the level, dB relative to the full band. */
  bright: Float32Array;
  /** Strongest onset of each band close to the beat (−30…+60 ms). */
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  flux: Float32Array;
  /** Mean full-band flux over the beat (onset density). */
  density: Float32Array;
}

/** Beat i spans [beats[i], beats[i+1]); the last beat spans one median interval. */
export function beatFeatures(spec: Spectra, ons: Onsets, beats: number[]): BeatFeatures {
  const n = beats.length, fps = spec.fps, nMel = spec.nMel;
  const chroma = new Float32Array(n * 12), bass = new Float32Array(n * 12), mfcc = new Float32Array(n * N_MFCC);
  const db = new Float32Array(n), bright = new Float32Array(n), density = new Float32Array(n);
  const kick = new Float32Array(n), snare = new Float32Array(n), hat = new Float32Array(n), flux = new Float32Array(n);
  const dct = new Float64Array(N_MFCC * nMel);
  for (let k = 0; k < N_MFCC; k++) for (let b = 0; b < nMel; b++) dct[k * nMel + b] = Math.cos((Math.PI * k * (b + 0.5)) / nMel) / nMel;
  const mel = new Float64Array(nMel);
  let medIv = 0.5;
  if (n > 1) {
    const iv: number[] = [];
    for (let i = 0; i + 1 < n; i++) iv.push(beats[i + 1] - beats[i]);
    iv.sort((a, b) => a - b);
    medIv = iv[iv.length >> 1];
  }
  const cf = spec.chromaFps;
  for (let i = 0; i < n; i++) {
    const t0 = beats[i], t1 = i + 1 < n ? beats[i + 1] : beats[i] + medIv;
    // 100 fps frames
    let f0 = Math.max(0, Math.round(t0 * fps)), f1 = Math.min(spec.nFrames, Math.round(t1 * fps));
    if (f1 <= f0) f1 = Math.min(spec.nFrames, f0 + 1);
    mel.fill(0);
    let p = 0, hp = 0, dens = 0;
    for (let f = f0; f < f1; f++) {
      const o = f * nMel;
      for (let b = 0; b < nMel; b++) mel[b] += spec.melDb[o + b];
      p += spec.power[f];
      hp += spec.high[f];
      dens += ons.flux[f];
    }
    const cnt = Math.max(1, f1 - f0);
    for (let b = 0; b < nMel; b++) mel[b] /= cnt;
    for (let k = 0; k < N_MFCC; k++) {
      let s = 0;
      for (let b = 0; b < nMel; b++) s += mel[b] * dct[k * nMel + b];
      mfcc[i * N_MFCC + k] = s;
    }
    db[i] = 10 * Math.log10(p / cnt + 1e-12);
    bright[i] = 10 * Math.log10((hp + 1e-12) / (p + 1e-12));
    density[i] = dens / cnt;
    // Onsets near the beat.
    const a = Math.max(0, Math.round((t0 - 0.03) * fps)), z = Math.min(spec.nFrames - 1, Math.round((t0 + 0.06) * fps));
    let mk = 0, ms = 0, mh = 0, mf = 0;
    for (let f = a; f <= z; f++) {
      if (ons.kick[f] > mk) mk = ons.kick[f];
      if (ons.snare[f] > ms) ms = ons.snare[f];
      if (ons.hat[f] > mh) mh = ons.hat[f];
      if (ons.flux[f] > mf) mf = ons.flux[f];
    }
    kick[i] = mk; snare[i] = ms; hat[i] = mh; flux[i] = mf;
    // 10 fps chroma frames whose centre lies in the beat (at least the nearest one).
    let c0 = Math.ceil(t0 * cf), c1 = Math.floor(t1 * cf - 1e-9);
    if (c1 < c0) c0 = c1 = Math.round(((t0 + t1) / 2) * cf);
    c0 = Math.max(0, Math.min(spec.nChroma - 1, c0));
    c1 = Math.max(c0, Math.min(spec.nChroma - 1, c1));
    for (let c = c0; c <= c1; c++) {
      for (let k = 0; k < 12; k++) {
        chroma[i * 12 + k] += spec.chroma[c * 12 + k];
        bass[i * 12 + k] += spec.bass[c * 12 + k];
      }
    }
    normalize12(chroma, i);
    normalize12(bass, i);
  }
  return { n, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
}

function normalize12(a: Float32Array, i: number): void {
  let s = 0;
  for (let k = 0; k < 12; k++) s += a[i * 12 + k] * a[i * 12 + k];
  s = Math.sqrt(s);
  if (s > 1e-12) for (let k = 0; k < 12; k++) a[i * 12 + k] /= s;
}

/** Cosine distance between the means of rows [a0, a1) and [b0, b1) of an n × d matrix (rows clamped to range). */
export function blockDistance(m: Float32Array, d: number, n: number, a0: number, a1: number, b0: number, b1: number): number {
  a0 = Math.max(0, a0); a1 = Math.min(n, a1); b0 = Math.max(0, b0); b1 = Math.min(n, b1);
  if (a1 <= a0 || b1 <= b0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < d; k++) {
    let sa = 0, sb = 0;
    for (let i = a0; i < a1; i++) sa += m[i * d + k];
    for (let i = b0; i < b1; i++) sb += m[i * d + k];
    sa /= a1 - a0; sb /= b1 - b0;
    dot += sa * sb; na += sa * sa; nb += sb * sb;
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return 1 - dot / Math.sqrt(na * nb);
}
