// The optional aligner pack (tools/aligner, docs/ALIGNER.md), a separate process on this machine (NetEase's page can't
// run workers). Two jobs:
//   - word times: NetEase gives most songs line-timed lyrics only, and the plugin then spreads each line's words over
//     it by syllable count. The first time such a song is played the pack listens to it and finds when each word is
//     sung; the result is kept per song and lyric, and used from then on.
//   - beats: Beat This! (src/analysis/beatthis.ts) before the song is analysed; kept per song.
//
// The pack is not part of the plugin: about 480 MB, downloaded from the project's releases when the user asks for it.
import type { LyricLine } from '../types.ts';
import type { BeatThisInput } from '../analysis/beatthis.ts';
import type { AlignResult } from '../lyrics/aligned.ts';
export { applyAlignment, type AlignResult, type AlignedLine } from '../lyrics/aligned.ts';
import { execArg } from './exec.ts';
import drumScript from '../../tools/aligner/drums.py?raw';
import rhythmScript from '../../tools/aligner/rhythm.py?raw';
import drumLicense from '../../tools/aligner/licenses/ADTOF-LICENSE.txt?raw';
import drumNotice from '../../tools/aligner/licenses/ADTOF-NOTICE.txt?raw';

const RELEASE = 'https://github.com/xiaoming6680/NCM-BetterMV/releases/download/aligner-v2/';
/** The pack format this plugin speaks (the pack's version.json). */
const PACK_VERSION = 2;
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
/** Beats are waited for before the MV starts: past this the song goes on with the plugin's own beats. */
const BEATS_TIMEOUT_MS = 40 * 1000;
const DRUM_REVISION = 'd0e809bb1c1b6fe8a4a00c576852117a0636ab5a';
/** The drum model: from the pack's own release first, else its pinned upload on Hugging Face (often out of reach in China). */
const DRUM_URLS = [`${RELEASE}adtof_frame_rnn.onnx`, `https://huggingface.co/thebluescreen/adtof-drums-onnx/resolve/${DRUM_REVISION}/adtof_frame_rnn.onnx`];
const DRUM_HASH = '189ca3c2bc7339a5f0fdc0bb11069d4bcc4fafabd142e945228c368c379b6227';
let drumRuntime: Promise<string | null> | undefined;

/** A small optional model for an already installed pack. No audio leaves the computer. */
function ensureDrumRuntime(dir: string): Promise<string | null> {
  return drumRuntime ??= (async () => {
    const path = `${dir}\\models\\adtof_frame_rnn.onnx`;
    try {
      if (!(await betterncm.fs.exists(path))) {
        let blob: Blob | null = null, why: unknown;
        for (const url of DRUM_URLS) {
          const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`ADTOF download HTTP ${response.status}`);
            const b = await response.blob();
            if (b.size !== 2171762) throw new Error('ADTOF model size mismatch');
            const hash = await sha256(b);
            if (hash && hash !== DRUM_HASH) throw new Error('ADTOF model checksum mismatch');
            blob = b;
            break;
          } catch (e) { why = e; } finally { clearTimeout(timeout); }
        }
        if (!blob) throw why;
        await betterncm.fs.writeFile(path, blob);
      }
      // The worker also checks SHA-256, including when WebCrypto is unavailable in the embedded browser.
      await betterncm.fs.writeFileText(`${dir}\\drums.py`, drumScript);
      await betterncm.fs.writeFileText(`${dir}\\rhythm.py`, rhythmScript);
      await betterncm.fs.writeFileText(`${dir}\\models\\ADTOF-LICENSE.txt`, drumLicense);
      await betterncm.fs.writeFileText(`${dir}\\models\\ADTOF-NOTICE.txt`, drumNotice);
      return path;
    } catch (e) { console.warn('[BetterMV] 鼓点模型暂不可用，使用声学检测', e); return null; }
  })();
}

export type PackState =
  | { kind: 'checking' }
  | { kind: 'none' }
  /** An earlier version is installed (without beats): updating downloads only what is new. */
  | { kind: 'outdated' }
  | { kind: 'installing'; done: number; total: number; note: string }
  | { kind: 'ready' }
  | { kind: 'removing' }
  | { kind: 'failed'; message: string };

interface Manifest { version: number; files: Array<{ name: string; size: number; sha256: string; kind: 'zip' | 'model' }> }


let state: PackState = { kind: 'checking' };
const watchers = new Set<(s: PackState) => void>();
const set = (s: PackState) => { state = s; watchers.forEach(fn => fn(s)); };

/** The pack's state now, and every change after (returns the unsubscribe). */
export function watchPack(fn: (s: PackState) => void): () => void {
  watchers.add(fn);
  fn(state);
  return () => watchers.delete(fn);
}

let root: Promise<string> | null = null;
/** <BetterNCM data>\BetterMV\aligner */
const packDir = () => (root ??= betterncm.app.getDataPath().then(p => p.replace(/[\\/]+$/, '') + '\\BetterMV\\aligner'));

async function mkdirs(path: string): Promise<void> {
  const parts = path.split('\\');
  for (let i = 2; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('\\');
    if (!(await betterncm.fs.exists(p))) await betterncm.fs.mkdir(p);
  }
}

/** Whether the pack is installed (and speaks this plugin's format). */
export async function checkPack(): Promise<boolean> {
  try {
    const dir = await packDir();
    // (Also written by hand when the pack is installed manually, README: an editor may put a BOM before it.)
    const v = JSON.parse((await betterncm.fs.readFileText(`${dir}\\installed.json`)).replace(/^\uFEFF/, ''));
    const ok = v?.version === PACK_VERSION, old = typeof v?.version === 'number' && v.version < PACK_VERSION;
    if (state.kind === 'checking' || state.kind === 'ready' || state.kind === 'none' || state.kind === 'outdated') set({ kind: ok ? 'ready' : old ? 'outdated' : 'none' });
    return ok;
  } catch {
    if (state.kind === 'checking' || state.kind === 'ready' || state.kind === 'outdated') set({ kind: 'none' });
    return false;
  }
}

async function fetchBlob(url: string, size: number, onBytes: (n: number) => void): Promise<Blob> {
  const r = await fetch(url, { cache: 'no-store' }).catch(() => { throw new Error('下载中断，请检查网络后重试'); });
  if (!r.ok || !r.body) throw new Error(`下载失败（HTTP ${r.status}）`);
  const reader = r.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read().catch(() => { throw new Error('下载中断，请检查网络后重试'); });
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    got += value.length;
    onBytes(value.length);
  }
  if (size && got !== size) throw new Error('下载不完整，请重试');
  return new Blob(chunks);
}

async function sha256(blob: Blob): Promise<string | null> {
  const subtle = (window.crypto as Crypto | undefined)?.subtle;
  if (!subtle) return null;
  const hash = new Uint8Array(await subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
}

/** Download and unpack the pack; progress goes to the watchers. */
export async function installPack(): Promise<void> {
  if (state.kind === 'installing' || state.kind === 'removing') return;
  drumRuntime = undefined;
  set({ kind: 'installing', done: 0, total: 0, note: '正在读取文件清单…' });
  try {
    const dir = await packDir();
    const list = await fetch(RELEASE + 'aligner.json', { cache: 'no-store' }).catch(() => null);
    if (!list) throw new Error('无法连接 GitHub，请检查网络后重试');
    if (!list.ok) throw new Error(`无法获取文件清单（HTTP ${list.status}）`);
    const manifest: Manifest = await list.json().catch(() => { throw new Error('文件清单无法读取，请稍后重试'); });
    if (manifest.version !== PACK_VERSION) throw new Error('对齐包版本与插件不匹配，请先更新插件');
    const total = manifest.files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    await mkdirs(`${dir}\\models`);
    await mkdirs(`${dir}\\download`);
    // A pack left half-installed is not trusted.
    if (await betterncm.fs.exists(`${dir}\\installed.json`)) await betterncm.fs.remove(`${dir}\\installed.json`);
    // A model already there (from an earlier version of the pack, same name: joined from its parts on first use,
    // or still in parts) is kept rather than downloaded again.
    const have = async (name: string) => await betterncm.fs.exists(`${dir}\\models\\${name}`) || await betterncm.fs.exists(`${dir}\\models\\${name.replace(/\.\d{3}$/, '')}`);
    for (const [i, f] of manifest.files.entries()) {
      if (f.kind === 'model' && await have(f.name)) { done += f.size; continue; }
      const note = `正在下载 ${i + 1}/${manifest.files.length}`;
      set({ kind: 'installing', done, total, note });
      let shown = 0;
      const blob = await fetchBlob(RELEASE + f.name, f.size, n => {
        done += n;
        // The page redraws a few times a second, not on every chunk.
        if (Date.now() - shown > 250) { shown = Date.now(); set({ kind: 'installing', done, total, note }); }
      });
      const hash = await sha256(blob);
      if (hash && hash !== f.sha256) throw new Error('文件校验失败，请重试');
      if (f.kind === 'zip') {
        set({ kind: 'installing', done, total, note: '正在解压…' });
        const zip = `${dir}\\download\\${f.name}`;
        await betterncm.fs.writeFile(zip, blob);
        if (!(await betterncm.fs.unzip(zip, dir + '\\'))) throw new Error('解压失败');
        await betterncm.fs.remove(zip);
      } else {
        await betterncm.fs.writeFile(`${dir}\\models\\${f.name}`, blob);
      }
    }
    await betterncm.fs.writeFileText(`${dir}\\installed.json`, JSON.stringify({ version: manifest.version, files: manifest.files.map(f => f.name) }));
    set({ kind: 'ready' });
  } catch (e) {
    set({ kind: 'failed', message: String((e as Error)?.message || e) });
  }
}

/** Remove the pack and everything it kept (the folder goes through cmd: the file API removes files one by one). */
export async function removePack(): Promise<void> {
  if (state.kind === 'installing' || state.kind === 'removing') return;
  drumRuntime = undefined;
  set({ kind: 'removing' });
  const dir = await packDir();
  try {
    if (await betterncm.fs.exists(`${dir}\\installed.json`)) await betterncm.fs.remove(`${dir}\\installed.json`);
    await betterncm.app.exec(`cmd /c rmdir /s /q ${execArg(dir)}`, false, false);
    for (let i = 0; i < 40 && (await betterncm.fs.exists(dir)); i++) await sleep(250);
  } catch { /* gone or not, it is no longer installed */ }
  set({ kind: 'none' });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Lyrics worth aligning: timed by line only (word-timed lyrics already say when each word is sung). */
export const needsAlignment = (lines: LyricLine[]) => lines.length > 0 && lines.every(l => !l.timedWords);

/** What a job is keyed by: the song and its lines (a lyric edit on NetEase's side makes a new one). */
export function jobKey(id: number, lines: LyricLine[]): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify(lines.map(l => [Math.round(l.start * 100), l.words.map(w => w.text)]));
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${id}-${(h >>> 0).toString(16)}`;
}

/** An alignment made before for these lines, or null. */
export async function cachedAlignment(id: number, lines: LyricLine[]): Promise<AlignResult | null> {
  if (state.kind === 'checking') await checkPack();
  if (state.kind !== 'ready' || !needsAlignment(lines)) return null;
  try {
    const dir = await packDir();
    const r: AlignResult = JSON.parse(await betterncm.fs.readFileText(`${dir}\\cache\\${jobKey(id, lines)}.json`));
    return r && !r.error && Array.isArray(r.lines) && r.lines.length === lines.length ? r : null;
  } catch { return null; }
}

/** The lines as the pack takes them: backing lines (wholly in brackets) are not aligned. */
export const jobLines = (lines: LyricLine[], duration: number) =>
  lines.map((l, i) => ({ start: l.start, next: lines[i + 1]?.start ?? duration, words: l.backing ? [] : l.words.map(w => w.text) }));

/** The song as the pack hears it: 16 kHz mono, 16-bit. */
export async function pcm16k(audio: ArrayBuffer): Promise<Int16Array<ArrayBuffer>> {
  const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(audio.slice(0));
  const mono = decoded.getChannelData(0), pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)));
  return pcm;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Align a song's lines with its audio: decodes it to 16 kHz mono, hands it to the pack and waits for the result
 * (one job at a time). Null when the pack is missing, fails or takes too long.
 */
export function alignSong(id: number, lines: LyricLine[], duration: number, audio: ArrayBuffer, onStage?: (stage: string, progress: number) => void): Promise<AlignResult | null> {
  const run = async (): Promise<AlignResult | null> => {
    if (state.kind !== 'ready' || !needsAlignment(lines)) return null;
    const cached = await cachedAlignment(id, lines);
    if (cached) return cached;
    const dir = await packDir();
    const key = jobKey(id, lines);
    await mkdirs(`${dir}\\work`);
    await mkdirs(`${dir}\\cache`);
    const pcm = await pcm16k(audio);
    const pcmPath = `${dir}\\work\\${key}.pcm`, jobPath = `${dir}\\work\\${key}.job.json`;
    const out = `${dir}\\cache\\${key}.json`, progress = `${dir}\\work\\${key}.progress.json`;
    await betterncm.fs.writeFile(pcmPath, new Blob([pcm]));
    await betterncm.fs.writeFileText(jobPath, JSON.stringify({
      version: 1, id, audio: pcmPath, rate: 16000, channels: 1, out, progress, lines: jobLines(lines, duration),
    }));
    // (Started directly, without a window: BetterNCM hides it.)
    await betterncm.app.exec(`"${dir}\\python\\pythonw.exe" ${execArg(`${dir}\\align.py`)} ${execArg(jobPath)}`, false, false);
    const t0 = Date.now();
    while (Date.now() - t0 < JOB_TIMEOUT_MS) {
      await sleep(800);
      if (await betterncm.fs.exists(out)) {
        const r: AlignResult = JSON.parse(await betterncm.fs.readFileText(out));
        if (r.error) { console.warn('[BetterMV] 歌词对齐失败', r.error); await betterncm.fs.remove(out); return null; }
        return r.lines?.length === lines.length ? r : null;
      }
      if (onStage) {
        try {
          const p = JSON.parse(await betterncm.fs.readFileText(progress));
          onStage(String(p.stage), Number(p.progress) || 0);
        } catch { /* not written yet */ }
      }
    }
    console.warn('[BetterMV] 歌词对齐超时');
    return null;
  };
  const job = queue.then(run, run).catch(e => { console.warn('[BetterMV] 歌词对齐出错', e); return null; });
  queue = job;
  return job;
}

export interface BeatsResult { version: number; id: number; task: 'beats'; fps: number; beats: number[]; downbeats: number[]; beatProb: number[]; downProb: number[]; drums?: BeatThisInput['drums']; drumError?: string; device?: string; ms?: Record<string, number>; error?: string }

const beatsKey = (id: number, duration: number) => `rhythm-3-${id}-${Math.round(duration)}`;
/** Beat This! results from before the drum model (0.10): still good for the beats. */
const legacyKey = (id: number, duration: number) => `beats-${id}-${Math.round(duration)}`;
const asInput = (r: BeatsResult): BeatThisInput => ({ fps: r.fps, beatProb: r.beatProb, downProb: r.downProb, beats: r.beats, downbeats: r.downbeats, drums: r.drums });
const validBeats = (r: BeatsResult | null) => !!r && !r.error && r.task === 'beats' && Number.isFinite(r.fps) && r.fps > 0
  && [r.beats, r.downbeats, r.beatProb, r.downProb].every(Array.isArray);

/** Beats found before for this song (with drums, or from before the drum model), with the file they are in. */
async function foundBeats(id: number, duration: number): Promise<{ input: BeatThisInput; path: string } | null> {
  if (state.kind === 'checking') await checkPack();
  if (state.kind !== 'ready') return null;
  const dir = await packDir();
  for (const key of [beatsKey(id, duration), legacyKey(id, duration)]) {
    const path = `${dir}\\cache\\${key}.json`;
    try {
      const r: BeatsResult = JSON.parse(await betterncm.fs.readFileText(path));
      if (validBeats(r) && r.beats.length) return { input: asInput(r), path };
    } catch { /* none */ }
  }
  return null;
}

/** Beats found before for this song, or null. */
export async function cachedBeats(id: number, duration: number): Promise<BeatThisInput | null> {
  return (await foundBeats(id, duration))?.input ?? null;
}

let beatQueue: Promise<unknown> = Promise.resolve();

/**
 * A song's beats and independent drums from mono audio (44.1 kHz retains cymbal/snare detail). One job at
 * a time, apart from the word-time jobs. In the background (a song prepared ahead while an MV plays) on the CPU, so the
 * MV keeps the GPU. Null when the pack is missing, fails or takes too long.
 */
export function trackSongBeats(id: number, audio: () => Promise<{ mono: Float32Array; rate: number }>, duration: number, opts: { background?: boolean; onProgress?: (p: number) => void; cancelled?: () => boolean } = {}): Promise<BeatThisInput | null> {
  const run = async (): Promise<BeatThisInput | null> => {
    if (state.kind === 'checking') await checkPack();
    if (state.kind !== 'ready' || opts.cancelled?.()) return null;
    const found = await foundBeats(id, duration);
    if (found?.input.drums) return found.input;
    const dir = await packDir();
    const key = beatsKey(id, duration);
    const drumModel = await ensureDrumRuntime(dir);
    if (found && !drumModel) return found.input;
    if (opts.cancelled?.()) return null;
    await mkdirs(`${dir}\\work`);
    await mkdirs(`${dir}\\cache`);
    // Beats found before: only the drums are new, the job takes those beats instead of running Beat This! again.
    let beatsFrom: string | undefined;
    if (found) {
      beatsFrom = `${dir}\\work\\${key}.beats.json`;
      await betterncm.fs.writeFileText(beatsFrom, await betterncm.fs.readFileText(found.path));
    }
    const { mono, rate } = await audio();
    if (opts.cancelled?.()) return null;
    const pcm = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)));
    const pcmPath = `${dir}\\work\\${key}.pcm`, jobPath = `${dir}\\work\\${key}.job.json`;
    const out = `${dir}\\cache\\${key}.json`, progress = `${dir}\\work\\${key}.progress.json`;
    // Upgrading a cached beat-only result must not return that old file while the new job is running.
    if (await betterncm.fs.exists(out)) await betterncm.fs.remove(out);
    await betterncm.fs.writeFile(pcmPath, new Blob([pcm]));
    await betterncm.fs.writeFileText(jobPath, JSON.stringify({
      version: 1, task: 'beats', id, audio: pcmPath, rate, channels: 1, out, progress, drumModel, beatsFrom, ...(opts.background ? { device: 'cpu', threads: 2 } : {}),
    }));
    await betterncm.app.exec(`"${dir}\\python\\pythonw.exe" ${execArg(`${dir}\\${drumModel ? 'rhythm.py' : 'align.py'}`)} ${execArg(jobPath)}`, false, false);
    const t0 = Date.now();
    while (Date.now() - t0 < BEATS_TIMEOUT_MS * (opts.background ? 4 : 1)) {
      await sleep(300);
      if (await betterncm.fs.exists(out)) {
        const r: BeatsResult = JSON.parse(await betterncm.fs.readFileText(out));
        if (r.error) { console.warn('[BetterMV] 节拍识别失败', r.error); await betterncm.fs.remove(out); return null; }
        if (r.drumError) console.warn('[BetterMV] 鼓点模型识别失败，使用声学检测', r.drumError);
        return validBeats(r) ? asInput(r) : null;
      }
      if (opts.onProgress) {
        try {
          const p = JSON.parse(await betterncm.fs.readFileText(progress));
          opts.onProgress((Number(p.progress) || 0) * (drumModel && p.stage !== 'drums' ? 0.8 : 1));
        } catch { /* not written yet */ }
      }
    }
    console.warn('[BetterMV] 节拍识别超时');
    return null;
  };
  const job = beatQueue.then(run, run).catch(e => { console.warn('[BetterMV] 节拍识别出错', e); return null; });
  beatQueue = job;
  return job;
}
