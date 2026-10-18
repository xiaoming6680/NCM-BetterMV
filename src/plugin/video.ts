// The MV as a video file, made without playing the song: its frames rendered one after another at fixed times, as fast
// as the GPU and the encoder allow, and its audio encoded to MP3 beside them; src/plugin/mux.ts puts the two together as
// an MP4. MediaRecorder is the only video encoder in NetEase's Chromium 91 (no WebCodecs): it is handed
// the frames through a canvas it captures (a frame each time the page draws), and the times it stamps them with are
// dropped.
import lame from 'lamejs/lame.min.js?raw';
import type { MvPlayer } from '../app/player.ts';
import { avcC, isAnnexB, MP3_FRAME, mp3Frames, mp4, toAvcc, vpcC, WebmReader, type Mp4Video, type Mp4VideoSample } from './mux.ts';

export interface VideoFormat { width: number; height: number; fps: number }
/** What a download makes: 1080p at 60 frames a second. */
export const VIDEO: VideoFormat = { width: 1920, height: 1080, fps: 60 };

/** H.264 when the client has it (an MP4 anything plays), else VP9 or VP8. */
const TYPES: Array<[string, Mp4Video['codec']]> = [
  ['video/x-matroska;codecs=avc1', 'avc1'], ['video/webm;codecs=h264', 'avc1'], ['video/webm;codecs=vp9', 'vp09'], ['video/webm;codecs=vp8', 'vp08'],
];
/** Video bits a second of the song (room for the finish's grain at 1080p60). */
const BITS = 12_000_000;
/** Frames reach the encoder at most this many times faster than they play. */
const PACE = 4;
/**
 * With an encoder that spends its rate over the seconds the frames arrive in, they are given at this many times faster
 * than they play (no faster), and its rate is scaled to match: each frame then gets what a frame of BITS is due, and a
 * slower stretch only gives frames more.
 */
const TIMED_PACE = 2;

/**
 * How the recorder's encoder spends the bit rate it is given, which decides the rate it needs for BITS:
 * - Windows' own H.264 encoder (“Microsoft H.264 Encoder”, NetEase's: Chromium 91 encodes through Media Foundation)
 *   spends it over the time the frames arrive in, as a 30-frame stream of constant rate (a key frame every 30 frames,
 *   Baseline, no CABAC): measured at 30 frames a second it gives rate / 30 a frame, and a song given at 130 frames a
 *   second came out at a third of the rate meant;
 * - Edge's (a hardware encoder) gives rate / 30 to every frame whatever their pace.
 * Which one Chromium picks can change from one recording to the next in the same page (in NetEase a three-frame test
 * recording just before an export got the other one), so it is read from the export's own recording: Windows' encoder
 * writes its name in an SEI of the first frame. When the rate set was for the other kind, the recording starts again
 * with the right one, a few frames in; the kind is remembered for the next download.
 */
type Spending = 'timed' | 'perFrame';
const spending = new Map<string, Spending>();
/** The recording's encoder turned out to spend its rate the other way. */
class OtherEncoder extends Error { constructor(readonly how: Spending) { super('other encoder'); } }

/** The bit rate to give the recorder, and the pace to give it frames at (frames a second at most). */
function rateFor(codec: Mp4Video['codec'], fps: number, how: Spending): { rate: number; pace: number } {
  if (codec === 'avc1' && how === 'perFrame') return { rate: (BITS * 30) / fps, pace: fps * PACE };
  // (VP8 / VP9 spread their rate over the time the frames arrive in too.)
  return { rate: BITS * TIMED_PACE, pace: fps * TIMED_PACE };
}
/**
 * Frames given and not yet read back out of the recorder, at most, to begin with: Chromium drops frames past ten
 * waiting for the encoder, and some of these are encoded already, on their way back. Some encoders (Edge's hardware
 * H.264, at times) keep more than that before giving the first one out: while nothing comes back the room widens, by 8
 * every 0.4 s, up to WIDEST (else each side waits for the other).
 */
const AHEAD = 10, WIDEST = 120;
/** How often the recorder hands over what it has, ms (each piece read as it comes, to know how far it got). */
const SLICE = 25;
/** MP3: 320 kbps at 44.1 kHz; the encoder's delay (LAME's 576 plus the decoder's 529), left out by an edit list. */
const MP3_KBPS = 320, MP3_RATE = 44100, MP3_DELAY = 1105;

export class Cancelled extends Error {}

export interface ExportJob {
  /** The song loaded in it; it is drawn at the format's size (the caller sets the engine's size). */
  player: MvPlayer;
  /** The song's audio file. */
  audio: ArrayBuffer;
  /** Where the capture canvas goes (it must be in the page). */
  parent: HTMLElement;
  format?: VideoFormat;
  /** How far along, 0..1. */
  progress: (part: number) => void;
  cancelled: () => boolean;
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/** The MP4 of the MV of the player's song. */
export async function exportMv(job: ExportJob): Promise<Blob> {
  const { player, format = VIDEO } = job;
  const song = player.song;
  if (!song) throw new Error('没有正在显示的歌曲');
  if (typeof MediaRecorder === 'undefined') throw new Error('网易云的内核不支持编码视频');
  const type = TYPES.find(([t]) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('网易云的内核不支持编码视频');
  // The audio decoded (natively, quick), then encoded a frame's worth at a time beside the frames.
  const decoded = await new OfflineAudioContext(2, 1, MP3_RATE).decodeAudioData(job.audio.slice(0));
  const frames = Math.ceil(decoded.duration * format.fps);
  let how = spending.get(type[0]) ?? 'perFrame';
  for (;;) {
    const audio = new Mp3Encoder(decoded);
    try {
      const video = await drawFrames(job, format, type, frames, how, i => audio.encodeTo(((i + 1) / format.fps) * decoded.sampleRate));
      const mp3 = audio.finish();
      job.progress(1);
      return mp4(video, { data: mp3, ...mp3Frames(mp3), delay: MP3_DELAY, length: decoded.length });
    } catch (e) {
      if (!(e instanceof OtherEncoder) || e.how === how) throw e;
      how = e.how;
      spending.set(type[0], how);
    }
  }
}

/** The frames drawn and encoded, as the MP4's video track; `beside(i)` runs after frame i is given. */
async function drawFrames(job: ExportJob, format: VideoFormat, [mime, codec]: [string, Mp4Video['codec']], n: number, how: Spending, beside: (i: number) => void): Promise<Mp4Video> {
  const { player } = job, { width: w, height: h, fps } = format, { rate, pace } = rateFor(codec, fps, how);
  const gl = player.engine.renderer.domElement;
  // The frame composed here (the picture, then the HUD that is HTML over it on the page) and captured from here.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none';
  job.parent.append(canvas);
  const g = canvas.getContext('2d', { alpha: false })!;
  const track = canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(new MediaStream([track]), { mimeType: mime, videoBitsPerSecond: rate });
  const reader = new WebmReader(), chunks: Blob[] = [];
  let reading = Promise.resolve(), failed: unknown = null, picked: Spending | null = null;
  const waiting: Array<() => void> = [];
  const wake = () => waiting.splice(0).forEach(fn => fn());
  recorder.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    chunks.push(e.data);
    reading = reading.then(async () => {
      try {
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        reader.push(bytes);
        // (Its name, if any, is in the first frame: by the second one it would have come.)
        if (!picked && codec === 'avc1') {
          if (new TextDecoder('latin1').decode(bytes).indexOf('Microsoft H.264 Encoder') >= 0) picked = 'timed';
          else if (reader.frames.length > 1) picked = 'perFrame';
        }
      } catch (err) { failed = err; }
      wake();
    });
  };
  recorder.onerror = e => { failed = (e as unknown as { error?: unknown }).error ?? new Error('视频编码出错'); wake(); };
  const stopped = new Promise<void>(r => { recorder.onstop = () => r(); });
  /** Resolves once the recorder's next piece is read (or after a moment). */
  const more = () => new Promise<void>(r => { waiting.push(r); window.setTimeout(r, 250); });
  const given: number[] = [];
  /**
   * The last frame given that has come back out of the encoder: found by its time, as Chromium drops a frame now and
   * then (counting the frames out would leave the count behind for good, and the drawing waiting on it).
   */
  let back = -1, placed = 0, outAt = 0, lost = 0;
  const caughtUp = () => {
    const out = reader.frames;
    for (; placed < out.length; placed++) {
      const want = out[placed].time - out[0].time + given[0];
      let k = Math.max(0, back + 1);
      while (k + 1 < given.length && Math.abs(given[k + 1] - want) <= Math.abs(given[k] - want)) k++;
      if (back >= 0) lost += k - back - 1;
      back = k;
      outAt = performance.now();
    }
    return back;
  };
  /**
   * The time between frames given, ms: from the pace, 30 % longer each time frames turn out lost (more than the
   * capture and the encoder manage just then: the GPU may be encoding something else too), 10 % shorter again after
   * every 30 frames without a loss.
   */
  const fastest = 1000 / pace;
  let gap = fastest, seenLost = 0, clean = 0;
  let ahead = AHEAD, widened = 0;
  /** Waits for the encoder: more room when it holds frames back, a failure when it errs or stays silent with all of it. */
  const waitForEncoder = async () => {
    await more();
    if (job.cancelled()) throw new Cancelled();
    if (failed) throw failed;
    const now = performance.now();
    if (ahead < WIDEST && now - Math.max(outAt, widened) > 400) { ahead = Math.min(WIDEST, ahead + 8); widened = now; }
    else if (now - Math.max(outAt, widened) > 15000) {
      console.warn('[BetterMV] 视频编码停止响应', { given: given.length, out: reader.frames.length, back, ahead, pieces: chunks.length, state: recorder.state });
      throw new Error('视频编码停止响应');
    }
  };
  try {
    recorder.start(SLICE);
    player.hud.visible = true;
    outAt = performance.now();
    let last = 0;
    for (let i = 0; i < n; i++) {
      if (job.cancelled()) throw new Cancelled();
      if (failed) throw failed;
      // Held up by the room: an encoder that keeps a dozen frames gives one out for each one in, and the room then
      // sets the pace. Lost frames take both the room and the pace back.
      const held = performance.now();
      while (i - 1 - caughtUp() >= ahead) await waitForEncoder();
      if (picked && picked !== how) throw new OtherEncoder(picked);
      if (performance.now() - held > 15 && ahead < WIDEST) ahead += 2;
      if (lost > seenLost) { gap = Math.min(gap * 1.3, 1000); ahead = Math.max(AHEAD, ahead - 4); seenLost = lost; clean = 0; }
      else if (++clean >= 30) { gap = Math.max(fastest, gap / 1.1); clean = 0; }
      // Drawn at the start of a page frame, which then captures it: one drawing a page frame (a second one before the
      // page draws would replace the first, which is lost).
      do await nextFrame(); while (performance.now() < last + gap);
      last = performance.now();
      player.frame(i / fps, 1 / fps);
      // (In the same task as the drawing: the picture's buffer is cleared once the page shows it.)
      g.drawImage(gl, 0, 0, w, h);
      player.hud.draw(g, w, h, 1 / fps);
      track.requestFrame();
      given.push(performance.now());
      beside(i);
      if (i % 15 === 0) job.progress((i / n) * 0.97);
    }
    // The last frames captured and back out of the encoder before the recorder stops (it drops what it still has).
    await nextFrame();
    for (const until = performance.now() + 3000; caughtUp() < n - 1 && performance.now() < until;) await more();
    const took = (performance.now() - given[0]) / 1000;
    console.info(`[BetterMV] 下载：${n} 帧用时 ${took.toFixed(1)} s（每秒 ${Math.round(n / took)} 帧），丢 ${lost} 帧，${mime}，${how === 'timed' ? 'Windows 编码器' : '每帧定额编码器'} ${(rate / 1e6).toFixed(1)} Mbps，在途最多 ${ahead} 帧`);
    recorder.stop();
    await stopped;
    await reading;
    if (failed) throw failed;
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    track.stop();
    canvas.remove();
  }
  const out = reader.frames;
  if (!out.length) throw new Error('视频编码失败');
  // Each frame's place in the song: in order when none was lost, else by when it reached the recorder.
  const at = out.length === n ? out.map((_, k) => k) : placeByTime(out.map(f => f.time), given);
  at[0] = 0;
  const durations = at.map((i, k) => (k + 1 < at.length ? at[k + 1] : n) - i);
  const webm = new Blob(chunks);
  let samples: Mp4VideoSample[], config: Uint8Array;
  if (codec === 'avc1' && isAnnexB(reader.codecPrivate)) {
    // Start codes into lengths, a few MB at a time, each piece handed back as a blob (out of the page's memory).
    const sets = { sps: [] as Uint8Array[], pps: [] as Uint8Array[] };
    samples = [];
    for (let k = 0; k < out.length;) {
      const from = out[k].offset;
      let to = k;
      while (to < out.length && out[to].offset + out[to].size - from < 16 << 20) to++;
      if (to === k) to = k + 1;
      const bytes = new Uint8Array(await webm.slice(from, out[to - 1].offset + out[to - 1].size).arrayBuffer());
      const pieces = out.slice(k, to).map(f => toAvcc(bytes.subarray(f.offset - from, f.offset - from + f.size), sets));
      const blob = new Blob(pieces as BlobPart[]);
      let p = 0;
      pieces.forEach((piece, j) => {
        samples.push({ data: blob.slice(p, p + piece.length), size: piece.length, key: out[k + j].key, duration: durations[k + j] });
        p += piece.length;
      });
      k = to;
    }
    if (!sets.sps.length || !sets.pps.length) throw new Error('视频编码失败（缺少参数集）');
    config = avcC(sets.sps, sets.pps);
  } else {
    samples = out.map((f, k) => ({ data: webm.slice(f.offset, f.offset + f.size), size: f.size, key: f.key, duration: durations[k] }));
    config = codec === 'avc1' ? reader.codecPrivate! : vpcC(codec === 'vp09' ? 41 : 0);
  }
  return { codec, config, width: reader.width || w, height: reader.height || h, fps, samples };
}

/** Which frame given each frame out of the recorder is: the nearest in time, in order. */
function placeByTime(times: number[], given: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  for (const t of times) {
    const want = t - times[0] + given[0];
    while (i + 1 < given.length && Math.abs(given[i + 1] - want) <= Math.abs(given[i] - want)) i++;
    out.push(i);
    i = Math.min(i + 1, given.length - 1);
  }
  return out;
}

interface Lame { Mp3Encoder: new (channels: number, rate: number, kbps: number) => { encodeBuffer(l: Int16Array, r: Int16Array): Int8Array; flush(): Int8Array } }
let lamejs: Lame | null = null;

/**
 * lamejs on the page's own thread, a frame's worth of the song at a time (about 1.5 ms a frame in NetEase): NetEase's
 * page only runs workers from its own origin (its Content-Security-Policy refuses blob: scripts). lamejs is a classic
 * script, evaluated once (the page allows eval; BetterNCM runs plugins that way).
 */
class Mp3Encoder {
  private enc: ReturnType<typeof this.make>;
  private channels: Float32Array[];
  private pcm: Int16Array[];
  private done = 0;
  private out: Int8Array[] = [];
  private size = 0;

  constructor(buffer: AudioBuffer) {
    this.channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, k) => buffer.getChannelData(k));
    this.pcm = this.channels.map(() => new Int16Array(MP3_FRAME * 8));
    this.enc = this.make(buffer.sampleRate);
  }

  private make(rate: number) {
    lamejs ??= new Function(`${lame}\nreturn lamejs;`)() as Lame;
    return new lamejs.Mp3Encoder(this.channels.length, rate, MP3_KBPS);
  }

  /** The song up to that sample encoded. */
  encodeTo(end: number): void {
    end = Math.min(Math.round(end), this.channels[0].length);
    while (this.done < end) {
      const n = Math.min(end - this.done, this.pcm[0].length);
      this.channels.forEach((c, k) => {
        const p = this.pcm[k];
        for (let j = 0; j < n; j++) { const v = c[this.done + j]; p[j] = v >= 1 ? 32767 : v <= -1 ? -32768 : v * 32767; }
      });
      this.keep(this.enc.encodeBuffer(this.pcm[0].subarray(0, n), (this.pcm[1] ?? this.pcm[0]).subarray(0, n)));
      this.done += n;
    }
  }

  /** The rest encoded; the MP3 stream. */
  finish(): Uint8Array<ArrayBuffer> {
    this.encodeTo(this.channels[0].length);
    this.keep(this.enc.flush());
    const all = new Uint8Array(this.size);
    let at = 0;
    for (const b of this.out) { all.set(new Uint8Array(b.buffer, b.byteOffset, b.length), at); at += b.length; }
    this.out = [];
    return all;
  }

  private keep(b: Int8Array): void {
    if (!b.length) return;
    this.out.push(b);
    this.size += b.length;
  }
}
