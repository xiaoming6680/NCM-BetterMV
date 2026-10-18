// The MV as a video file, made by the video encoder program (docs/EXPORT.md): the song's frames drawn one after another
// at fixed times as fast as the GPU allows (nothing waits for the screen: no page frames, no replay), each packed to
// NV12 on the GPU (src/render/nv12.ts), read back without stalling and sent to bettermv-encode.exe, which has Windows'
// H.264 encoder (the graphics card's when there is one) and AAC write the MP4. src/plugin/video.ts is the way
// when the program can't be had.
import type { MvPlayer } from '../app/player.ts';
import { Nv12Packer, tick } from '../render/nv12.ts';
import { Encoder, EncoderUnavailable, type EncodeDone } from './encoder.ts';
import { Cancelled } from './video.ts';

export interface VideoSpec {
  width: number;
  height: number;
  fps: number;
  /** Video bits a second. */
  bitrate: number;
  /** The part of the song, s. */
  from: number;
  to: number;
}

export interface NativeJob {
  /** The song loaded in it; the engine draws at the spec's size (the caller sets it). */
  player: MvPlayer;
  /** The song's audio file. */
  audio: ArrayBuffer;
  /** The MP4's path. */
  path: string;
  spec: VideoSpec;
  /** Whether to try the graphics card's encoder first (else Windows' own, on the processor). */
  hardware: boolean;
  /** How far along, 0..1. */
  progress: (part: number) => void;
  cancelled: () => boolean;
  /** For tests: called with each frame's number once it is drawn (HUD not yet), in the task that packs it. */
  onFrame?: (i: number) => void;
}

/** The audio in the file: 44.1 kHz stereo AAC. */
const AUDIO_RATE = 44100, AAC_KBPS = 256;
/** Batches being sent at once at most (the page may have six connections to the program). */
const AHEAD = 3;
/**
 * A request's body is a Blob (an array is 10× slower to send), and a Blob's bytes stay in the browser until the page's
 * garbage collector finds the Blob object gone — which, with the little this page allocates, it does not for a long
 * time: a few hundred frames in, the browser ran out of blob memory (ERR_BLOB_OUT_OF_MEMORY, at about 2 GB). So every
 * so many bytes sent a large array is made and dropped: V8 counts it as memory held outside its heap and collects.
 * (The requests' answers are read to the end too: Encoder.call.)
 */
const GC_EVERY = 160 << 20;
let sentSince = 0;
let ballast: ArrayBuffer | null = null;
function collectBlobs(sent: number): void {
  sentSince += sent;
  if (sentSince < GC_EVERY) return;
  sentSince = 0;
  ballast = new ArrayBuffer(96 << 20);
  ballast = null;
}

/** Frames drawn before the first one kept, so the trails and eases of a clip that starts mid-song are in place. */
const RUNUP = 60;
/** The step the scenes are advanced by: a video of fewer frames a second draws the ones between too (the look is made for 60). */
const STEP = 60;

/** The decoded song's samples from `from` for `seconds` as 16-bit interleaved stereo (silence past its end). */
function pcmOf(buffer: AudioBuffer, from: number, seconds: number): Int16Array {
  const start = Math.round(from * AUDIO_RATE), n = Math.round(seconds * AUDIO_RATE);
  const left = buffer.getChannelData(0), right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const out = new Int16Array(n * 2);
  const end = Math.min(n, Math.max(0, left.length - start));
  const s16 = (v: number) => (v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767));
  for (let i = 0; i < end; i++) {
    out[2 * i] = s16(left[start + i]);
    out[2 * i + 1] = s16(right[start + i]);
  }
  return out;
}

/** The MP4 written at the job's path; what the encoder program says it made. */
export async function exportNative(job: NativeJob): Promise<EncodeDone> {
  const { player, spec } = job;
  const song = player.song;
  if (!song) throw new Error('没有正在显示的歌曲');
  const decoded = await new OfflineAudioContext(2, 1, AUDIO_RATE).decodeAudioData(job.audio.slice(0));
  const from = Math.max(0, spec.from), to = Math.min(decoded.duration, spec.to);
  const frames = Math.max(1, Math.ceil((to - from) * spec.fps));
  const { width: w, height: h, fps } = spec;
  // (Not started, or Windows can't encode here: the caller may try the recorder instead.)
  const encoder = await Encoder.launch().catch(e => { throw new EncoderUnavailable((e as Error)?.message || String(e)); });
  let packer: Nv12Packer | null = null;
  try {
    if (job.cancelled()) throw new Cancelled();
    const how = await encoder.begin({
      path: job.path, width: w, height: h, fps, bitrate: spec.bitrate,
      audioRate: AUDIO_RATE, audioChannels: 2, audioKbps: AAC_KBPS,
      // (Tests may turn the graphics card's encoder off: tools/export-test.ts --hw 0.)
      hardware: job.hardware && (window as unknown as { __betterMvEncoder?: { hardware?: boolean } }).__betterMvEncoder?.hardware !== false,
    }).catch(e => { throw new EncoderUnavailable((e as Error)?.message || String(e)); });
    await encoder.audio(pcmOf(decoded, from, frames / fps));
    if (job.cancelled()) throw new Cancelled();

    // (The layer and the armillary badge that goes with it are in every frame, whatever the controls do on the page.)
    player.hud.visible = true;
    packer = new Nv12Packer(player.engine.renderer, w, h);
    // The HUD drawn on a canvas of its own each frame (premultiplied, laid over the picture by the packing pass).
    const hud = document.createElement('canvas');
    hud.width = w;
    hud.height = h;
    const g = hud.getContext('2d')!;
    const drawHud = (dt: number) => { g.clearRect(0, 0, w, h); player.hud.draw(g, w, h, dt); };
    const sub = Math.max(1, Math.round(STEP / fps)), dt = 1 / (fps * sub);

    const pool: Uint8Array[] = [];
    const pending = new Set<Promise<void>>();
    let failure: unknown = null;
    const began = performance.now();
    /** Where the time went, ms: drawing and packing, copying out of the GPU's buffer, waiting for the sends, the turns given away. */
    const spent = { draw: 0, copy: 0, wait: 0, tick: 0 };
    const draw = (t: number) => { if (!player.frame(t, dt)) throw new Error('没有正在显示的歌曲'); };

    // (A clip from the middle of the song: its first second drawn and dropped.)
    if (from > 0) for (let k = RUNUP; k >= 1; k--) {
      const t = from - k / STEP;
      if (t < 0) continue;
      draw(t);
      drawHud(1 / STEP);
      if (k % 10 === 0) await tick();
    }

    /** A batch's frames out of the GPU's buffer and on their way to the program. */
    const send = (b: { first: number; n: number; slot: number }) => {
      const c0 = performance.now();
      const bytes = packer!.finish(b.slot, pool.pop() ?? new Uint8Array(packer!.bytes * packer!.batch), b.n);
      spent.copy += performance.now() - c0;
      collectBlobs(packer!.bytes * b.n);
      const p: Promise<void> = encoder.frames(b.first, bytes.subarray(0, packer!.bytes * b.n))
        .catch(e => { failure ??= e; })
        .finally(() => { pending.delete(p); });
      // (The bytes were copied into the request as it was made: they are free at once.)
      pool.push(bytes);
      pending.add(p);
    };
    let held: { first: number; n: number; slot: number } | null = null;
    for (let first = 0; first < frames; first += packer.batch) {
      if (job.cancelled()) throw new Cancelled();
      if (failure) throw failure;
      const w0 = performance.now();
      while (pending.size >= AHEAD) {
        await Promise.race(pending);
        if (failure) throw failure;
        if (job.cancelled()) throw new Cancelled();
      }
      const d0 = performance.now();
      spent.wait += d0 - w0;
      const n = Math.min(packer.batch, frames - first);
      for (let k = 0; k < n; k++) {
        const i = first + k, t = from + i / fps;
        for (let m = sub - 1; m >= 1; m--) draw(t - m / (fps * sub));
        draw(t);
        drawHud(1 / fps);
        job.onFrame?.(i);
        packer.pack(hud, k);
      }
      // (The batch's copy is started, then the last one's taken: that call waits for the GPU behind what is queued,
      // which is this batch and no more.)
      const slot = packer.start(n);
      spent.draw += performance.now() - d0;
      if (held) send(held);
      held = { first, n, slot };
      job.progress((first / frames) * 0.97);
      const k0 = performance.now();
      // (The page's own work — the requests' answers — gets its turn.)
      await tick();
      spent.tick += performance.now() - k0;
    }
    if (held) send(held);
    await Promise.all(pending);
    if (failure) throw failure;
    job.progress(0.98);
    const done = await encoder.finish(frames);
    const took = (performance.now() - began) / 1000;
    console.info(`[BetterMV] 下载：${frames} 帧用时 ${took.toFixed(1)} s（每秒 ${Math.round(frames / took)} 帧），${how === 'hardware' ? '显卡编码' : 'Windows 软件编码'} ${(spec.bitrate / 1e6).toFixed(1)} Mbps，文件 ${(done.bytes / 1048576).toFixed(0)} MB（编码程序 ${done.seconds.toFixed(1)} s；画 ${(spent.draw / 1000).toFixed(1)} s，取回 ${(spent.copy / 1000).toFixed(1)} s，等发送 ${(spent.wait / 1000).toFixed(1)} s，让出 ${(spent.tick / 1000).toFixed(1)} s）`);
    return done;
  } catch (e) {
    await encoder.cancel();
    throw e;
  } finally {
    packer?.dispose();
    void encoder.quit();
  }
}
