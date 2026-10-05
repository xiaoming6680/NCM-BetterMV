// Everything a song needs before its MV can play: decoded audio → analysis (time-sliced), lyrics, style, palette,
// cover texture and pixels. Shared by the plugin and the dev harness.
import * as THREE from 'three';
import { parseNeteaseLyric, type NeteaseLyric } from '../lyrics/parse.ts';
import { analyzeSteps } from '../analysis/index.ts';
import { chooseStyle, STYLES, type StyleChoice, type StyleId } from '../style/style.ts';
import { paletteFromImage, type Palette } from '../render/palette.ts';
import type { SongWiki } from '../meta/wiki.ts';
import type { Analysis, LyricLine } from '../types.ts';
import { xyMusic } from '../analysis/xy.ts';
import type { Stereo } from '../scenes/types.ts';

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
  /** The audio for the oscilloscope plate: both channels, 16-bit, scaled together to their peak. */
  stereo: Stereo;
  /** Oscilloscope music (src/analysis/xy.ts): the whole MV is the scope in XY mode. */
  xyMusic: boolean;
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
  /** Corrects the parsed lyrics in place before the analysis reads them (plugin: word times from the aligner pack). */
  refineLines?: (lines: LyricLine[], duration: number) => Promise<void>;
}

export class Cancelled extends Error {}

export const WAVE_RATE = 22050;
/** Oscilloscope music keeps its channels at this rate (its pictures are drawn up to several kHz); other songs at WAVE_RATE. */
const XY_RATE = 44100;

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

/** Both channels at `rate` (a mono file gives the same signal twice). */
async function decodeStereo(buffer: ArrayBuffer, rate: number): Promise<{ left: Float32Array; right: Float32Array }> {
  const audio = await new OfflineAudioContext(2, 1, rate).decodeAudioData(buffer);
  const left = audio.getChannelData(0);
  return { left, right: audio.numberOfChannels > 1 ? audio.getChannelData(1) : left };
}

/** 16-bit channels scaled together to their peak, every `step`-th pair of samples averaged in (step 1 or 2). */
function toStereo(left: Float32Array, right: Float32Array, rate: number, step: number): Stereo {
  let peak = 1e-6;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const n = Math.floor(left.length / step), l = new Int16Array(n), r = new Int16Array(n), k = 32767 / peak / step;
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < step; j++) { a += left[i * step + j]; b += right[i * step + j]; }
    l[i] = Math.round(a * k); r[i] = Math.round(b * k);
  }
  return { rate: rate / step, left: l, right: r };
}

export async function prepareSong(input: SongInput, opts: PrepareOptions): Promise<PreparedSong> {
  const t0 = performance.now();
  const check = () => { if (opts.cancelled?.()) throw new Cancelled(); };
  opts.onProgress?.('decode', 0);
  const { samples, duration } = await decodeMono(input.audio.slice(0));
  check();
  const lines = input.lyric ? parseNeteaseLyric(input.lyric, duration) : [];
  if (opts.refineLines && lines.length) await opts.refineLines(lines, duration);
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
  // The channels kept for the oscilloscope (decoded again in stereo; the analysis above keeps its mono path).
  const both = await decodeStereo(input.audio.slice(0), XY_RATE);
  check();
  const xy = xyMusic(both.left, both.right, XY_RATE).xy;
  const stereo = toStereo(both.left, both.right, XY_RATE, xy ? 1 : XY_RATE / WAVE_RATE);
  const cover = new THREE.Texture(input.cover);
  cover.colorSpace = THREE.SRGBColorSpace;
  cover.anisotropy = 8;
  cover.needsUpdate = true;
  return {
    id: input.id, name: input.name, artists: input.artists, duration, lines, analysis, wiki: input.wiki, choice,
    palette, cover, coverPixels, coverSize, stereo, xyMusic: xy, ms: Math.round(performance.now() - t0),
  };
}

/** The style to play a song in: the user's choice, else (or for a setting this version doesn't know) the automatic one. */
export const styleFor = (song: PreparedSong, override?: StyleId | 'auto') =>
  (override && override !== 'auto' ? STYLES[override] : undefined) ?? song.choice.style;
