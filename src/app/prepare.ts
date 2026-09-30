// Everything a song needs before its MV can play: decoded audio → analysis (time-sliced), lyrics, style, palette,
// cover texture and pixels. Shared by the plugin and the dev harness.
import * as THREE from 'three';
import { parseNeteaseLyric, type NeteaseLyric } from '../lyrics/parse.ts';
import { analyzeSteps } from '../analysis/index.ts';
import { chooseStyle, STYLES, type StyleChoice, type StyleId } from '../style/style.ts';
import { paletteFromImage, type Palette } from '../render/palette.ts';
import type { SongWiki } from '../meta/wiki.ts';
import type { Analysis, LyricLine } from '../types.ts';

export interface SongInput {
  id: number;
  name?: string;
  artists?: string[];
  /** Encoded audio (FLAC / MP3 …) of the whole song. */
  audio: ArrayBuffer;
  lyric: NeteaseLyric | null;
  wiki?: SongWiki;
  cover: HTMLImageElement;
}

export interface PreparedSong {
  id: number;
  name?: string;
  artists?: string[];
  duration: number;
  lines: LyricLine[];
  analysis: Analysis;
  wiki?: SongWiki;
  choice: StyleChoice;
  palette: Palette;
  cover: THREE.Texture;
  coverPixels: Uint8ClampedArray;
  coverSize: number;
  /** The decoded audio, mono, 16-bit at WAVE_RATE (the oscilloscope plate draws it). */
  wave: Int16Array;
  /** Milliseconds spent decoding + analysing. */
  ms: number;
}

export type Stage = 'decode' | 'analyse';

export interface PrepareOptions {
  /** Gives the page a breath between analysis slices (animation frame in the plugin, setTimeout when hidden). */
  pause: () => Promise<void>;
  onProgress?: (stage: Stage, progress: number) => void;
  /** Stops early when the song changed meanwhile. */
  cancelled?: () => boolean;
  /** Use an analysis made elsewhere (dev: the hand-made Clarity analysis). */
  analysis?: (lines: LyricLine[]) => Promise<Analysis>;
}

export class Cancelled extends Error {}

export const WAVE_RATE = 22050;

async function decodeMono(buffer: ArrayBuffer, rate = 22050): Promise<{ samples: Float32Array; duration: number }> {
  const ctx = new OfflineAudioContext(1, 1, rate);
  const audio = await ctx.decodeAudioData(buffer);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return { samples: out, duration: audio.duration };
}

export async function prepareSong(input: SongInput, opts: PrepareOptions): Promise<PreparedSong> {
  const t0 = performance.now();
  const check = () => { if (opts.cancelled?.()) throw new Cancelled(); };
  opts.onProgress?.('decode', 0);
  const { samples, duration } = await decodeMono(input.audio.slice(0));
  check();
  const lines = input.lyric ? parseNeteaseLyric(input.lyric, duration) : [];
  let analysis: Analysis;
  if (opts.analysis) analysis = await opts.analysis(lines);
  else {
    const steps = analyzeSteps(samples, 22050, { lyrics: lines, bpmHint: input.wiki?.bpm });
    for (;;) {
      const r = steps.next();
      if (r.done) { analysis = r.value; break; }
      opts.onProgress?.('analyse', r.value);
      await opts.pause();
      check();
    }
  }
  const choice = chooseStyle(analysis, input.wiki, lines.length > 0);

  const palette = paletteFromImage(input.cover);
  const coverSize = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = coverSize;
  const c2 = cv.getContext('2d', { willReadFrequently: true })!;
  c2.drawImage(input.cover, 0, 0, coverSize, coverSize);
  const coverPixels = c2.getImageData(0, 0, coverSize, coverSize).data;
  // The waveform kept for the oscilloscope: 16-bit, scaled to its own peak.
  let peak = 1e-6;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const wave = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) wave[i] = Math.round((samples[i] / peak) * 32767);
  const cover = new THREE.Texture(input.cover);
  cover.colorSpace = THREE.SRGBColorSpace;
  cover.anisotropy = 8;
  cover.needsUpdate = true;
  return {
    id: input.id, name: input.name, artists: input.artists, duration, lines, analysis, wiki: input.wiki, choice,
    palette, cover, coverPixels, coverSize, wave, ms: Math.round(performance.now() - t0),
  };
}

/** The style to play a song in: the user's choice, else (or for a setting this version doesn't know) the automatic one. */
export const styleFor = (song: PreparedSong, override?: StyleId | 'auto') =>
  (override && override !== 'auto' ? STYLES[override] : undefined) ?? song.choice.style;
