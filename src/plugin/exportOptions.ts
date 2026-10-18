// What a download can be made as (docs/EXPORT.md): the choices of the export sheet, what they come to (picture size, bit
// rate, the part of the song, file size, how long it takes) and where they are kept.

export type Aspect = 'wide' | 'tall' | 'square';
export type Quality = 'standard' | 'high' | 'max';
export type Part = 'all' | 'chorus' | 'custom';
export type EncoderChoice = 'auto' | 'gpu' | 'cpu';

export interface ExportOptions {
  aspect: Aspect;
  /** The short side of the picture, px. */
  size: 720 | 1080 | 2160;
  fps: 30 | 60;
  quality: Quality;
  part: Part;
  /** The part of the song for `custom`, s. */
  from: number;
  to: number;
  encoder: EncoderChoice;
}

export const DEFAULT_OPTIONS: ExportOptions = { aspect: 'wide', size: 1080, fps: 60, quality: 'high', part: 'all', from: 0, to: 30, encoder: 'auto' };

export const ASPECTS: Array<[Aspect, string]> = [['wide', '横屏 16:9'], ['tall', '竖屏 9:16'], ['square', '方形 1:1']];
export const SIZES: Array<[ExportOptions['size'], string]> = [[720, '720p'], [1080, '1080p'], [2160, '4K']];
export const FPS: Array<[ExportOptions['fps'], string]> = [[30, '30 帧'], [60, '60 帧']];
export const QUALITIES: Array<[Quality, string]> = [['standard', '标准'], ['high', '高'], ['max', '极高']];
export const PARTS: Array<[Part, string]> = [['all', '整首'], ['chorus', '副歌'], ['custom', '自定义']];
export const ENCODERS: Array<[EncoderChoice, string]> = [['auto', '自动'], ['gpu', '显卡'], ['cpu', '处理器']];

/** A section of the song: its label (`chorus`, `drop`, …) and where it is, s. */
export interface Span { label: string; start: number; end: number }

/** The picture's pixels (multiples of 4, as the encoder's packing wants). */
export function videoSize(aspect: Aspect, size: number): { width: number; height: number } {
  const long = Math.round((size * 16) / 9 / 4) * 4;
  return aspect === 'wide' ? { width: long, height: size } : aspect === 'tall' ? { width: size, height: long } : { width: size, height: size };
}

/** Bits per pixel of a frame, by quality: 1080p at 60 frames comes to 12, 20 and 32 Mbps. */
const BPP: Record<Quality, number> = { standard: 0.1, high: 0.16, max: 0.26 };
/** Video bits a second (a clip of fewer frames has more happening between them: a quarter more a pixel). */
export function bitrateFor(width: number, height: number, fps: number, quality: Quality): number {
  const rate = width * height * fps * BPP[quality] * (fps === 30 ? 1.25 : 1);
  return Math.round(Math.min(60e6, Math.max(2e6, rate)) / 1e5) * 1e5;
}

/** The part of the song the options ask for, s (the chorus: the song's first one, else its first drop, else the first half minute). */
export function partOf(o: ExportOptions, duration: number, sections: readonly Span[]): [number, number] {
  if (o.part === 'chorus') {
    const hit = sections.find(s => s.label === 'chorus') ?? sections.find(s => s.label === 'drop');
    const from = hit ? hit.start : 0, to = hit ? Math.min(hit.end, from + 90) : Math.min(30, duration);
    return [from, Math.min(duration, Math.max(to, from + 1))];
  }
  if (o.part === 'custom') {
    const from = Math.min(Math.max(0, o.from), Math.max(0, duration - 1));
    return [from, Math.min(duration, Math.max(o.to, from + 1))];
  }
  return [0, duration];
}

/** What a download comes to: its frames, the file's size (video and audio), the time it takes (`msPerFrame` known from a last one, else a guess). */
export function estimate(o: ExportOptions, range: [number, number], msPerFrame?: number): { frames: number; bytes: number; seconds: number; rate: number } {
  const { width, height } = videoSize(o.aspect, o.size);
  const length = range[1] - range[0], frames = Math.ceil(length * o.fps), rate = bitrateFor(width, height, o.fps, o.quality);
  // (Measured at 1080p: about 12 ms a frame at 60 frames a second, 8 at 30, with the pictures' size.)
  const guess = ((width * height) / 2073600) * (o.fps === 30 ? 8 : 12);
  return { frames, bytes: (rate / 8 + 32000) * length, seconds: (frames * (msPerFrame ?? guess)) / 1000 + 4, rate };
}

export const speedKey = (width: number, height: number, fps: number) => `${width}x${height}@${fps}`;

export const clock = (s: number) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** "1:05", "65", "0:30.5" as seconds; null when it isn't a time. */
export function parseClock(text: string): number | null {
  const m = text.trim().replace('：', ':').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null;
}

/** Whether the graphics card's encoder is asked for first. */
export const wantsHardware = (c: EncoderChoice) => c !== 'cpu';

const pick = <T>(list: ReadonlyArray<[T, string]>, v: unknown, fallback: T): T => (list.some(([k]) => k === v) ? (v as T) : fallback);

/** The options kept in the settings (anything out of place back to the default). */
export function loadOptions(): ExportOptions {
  let saved: Partial<ExportOptions> = {};
  try { saved = JSON.parse(String(plugin.getConfig('export', '{}'))) || {}; } catch { /* the defaults */ }
  const d = DEFAULT_OPTIONS, n = (v: unknown, fb: number) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  return {
    aspect: pick(ASPECTS, saved.aspect, d.aspect), size: pick(SIZES, Number(saved.size), d.size), fps: pick(FPS, Number(saved.fps), d.fps),
    quality: pick(QUALITIES, saved.quality, d.quality), part: pick(PARTS, saved.part, d.part), from: Math.max(0, n(saved.from, d.from)), to: Math.max(1, n(saved.to, d.to)),
    encoder: pick(ENCODERS, saved.encoder, d.encoder),
  };
}
export const saveOptions = (o: ExportOptions) => plugin.setConfig('export', JSON.stringify(o));

/** How long a frame took last time at this size and rate, ms (null: not made yet). */
export function loadSpeed(width: number, height: number, fps: number): number | undefined {
  try {
    const v = Number((JSON.parse(String(plugin.getConfig('exportSpeed', '{}'))) || {})[speedKey(width, height, fps)]);
    return v > 0 ? v : undefined;
  } catch { return undefined; }
}
export function saveSpeed(width: number, height: number, fps: number, msPerFrame: number): void {
  let all: Record<string, number> = {};
  try { all = JSON.parse(String(plugin.getConfig('exportSpeed', '{}'))) || {}; } catch { /* a new one */ }
  // (A faster run replaces the last; a slower one — the window minimized, a game running — only moves it a third of the way.)
  const key = speedKey(width, height, fps), before = Number(all[key]);
  all[key] = Math.round((before > 0 && msPerFrame > before ? before * 0.7 + msPerFrame * 0.3 : msPerFrame) * 100) / 100;
  plugin.setConfig('exportSpeed', JSON.stringify(all));
}
