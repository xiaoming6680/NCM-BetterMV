// The optional aligner pack (tools/aligner, docs/ALIGNER.md): NetEase gives most songs line-timed lyrics only, and the
// plugin then spreads each line's words over it by syllable count. With the pack installed, the first time such a
// song is played the pack listens to it on this machine (a separate process: NetEase's page can't run workers) and
// finds when each word is sung; the result is kept per song and lyric, and used from then on.
//
// The pack is not part of the plugin: about 400 MB, downloaded from the project's releases when the user asks for it.
import type { LyricLine } from '../types.ts';
import { syllables } from '../lyrics/parse.ts';

const RELEASE = 'https://github.com/xiaoming6680/NCM-BetterMV/releases/download/aligner-v1/';
/** The pack format this plugin speaks (the pack's version.json). */
const PACK_VERSION = 1;
/** Lines whose letters fit the audio worse than this (mean probability) keep the spread estimate (docs/ALIGNER.md). */
const MIN_CONF = 0.005;
const JOB_TIMEOUT_MS = 8 * 60 * 1000;

export type PackState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'installing'; done: number; total: number; note: string }
  | { kind: 'ready' }
  | { kind: 'removing' }
  | { kind: 'failed'; message: string };

interface Manifest { version: number; files: Array<{ name: string; size: number; sha256: string; kind: 'zip' | 'model' }> }

export interface AlignedLine { words: Array<[number, number] | [number, null] | null>; conf: number | null }
export interface AlignResult { version: number; id: number; lines: AlignedLine[]; device?: string; ms?: Record<string, number>; error?: string }

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
    const v = JSON.parse(await betterncm.fs.readFileText(`${dir}\\installed.json`));
    const ok = v?.version === PACK_VERSION;
    if (state.kind === 'checking' || state.kind === 'ready' || state.kind === 'none') set({ kind: ok ? 'ready' : 'none' });
    return ok;
  } catch {
    if (state.kind === 'checking' || state.kind === 'ready') set({ kind: 'none' });
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
    for (const [i, f] of manifest.files.entries()) {
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
  set({ kind: 'removing' });
  const dir = await packDir();
  try {
    if (await betterncm.fs.exists(`${dir}\\installed.json`)) await betterncm.fs.remove(`${dir}\\installed.json`);
    await betterncm.app.exec(`cmd /c rmdir /s /q "${dir}"`, false, false);
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
    await betterncm.app.exec(`cmd /c start "" /b "${dir}\\python\\pythonw.exe" "${dir}\\align.py" "${jobPath}"`, false, false);
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

/**
 * Word times from an alignment, written into the lines in place. Words the pack couldn't place (backing vocals in
 * brackets, numbers) are put between their placed neighbours by syllable count; lines it fitted poorly keep the
 * estimate. Returns how many lines changed.
 */
export function applyAlignment(lines: LyricLine[], result: AlignResult): number {
  let changed = 0;
  lines.forEach((line, i) => {
    const r = result.lines[i];
    if (!r || r.conf === null || r.conf < MIN_CONF || r.words.length !== line.words.length) return;
    const starts = r.words.map(w => (w && typeof w[0] === 'number' ? w[0] : null));
    const known = starts.flatMap((s, j) => (s === null ? [] : [j]));
    if (!known.length) return;
    const syl = line.words.map(w => syllables(w.text));
    const next = lines[i + 1]?.start ?? Infinity;
    const t: number[] = new Array(line.words.length);
    for (const j of known) t[j] = starts[j]!;
    // Before the first placed word and after the last: 0.3 s a syllable; between two placed words: by syllables.
    for (let j = known[0] - 1; j >= 0; j--) t[j] = t[j + 1] - 0.3 * syl[j];
    for (let k = 0; k < known.length - 1; k++) {
      const a = known[k], b = known[k + 1];
      let total = 0;
      for (let j = a; j < b; j++) total += syl[j];
      let acc = 0;
      for (let j = a + 1; j < b; j++) { acc += syl[j - 1]; t[j] = t[a] + (t[b] - t[a]) * acc / total; }
    }
    for (let j = known[known.length - 1] + 1; j < t.length; j++) t[j] = t[j - 1] + 0.3 * syl[j - 1];
    for (let j = 1; j < t.length; j++) t[j] = Math.max(t[j], t[j - 1]);
    line.words.forEach((w, j) => {
      const sungTo = r.words[j]?.[1];
      if (j + 1 < t.length) {
        // A word lasts until the next unless the singer clearly stopped (then a little past where its letters end).
        const gap = typeof sungTo === 'number' ? t[j + 1] - sungTo : 0;
        w.start = t[j];
        w.end = gap > 0.6 ? Math.max(t[j] + 0.12, sungTo! + 0.15) : t[j + 1];
      } else {
        w.start = t[j];
        const end = Math.max(typeof sungTo === 'number' ? sungTo + 0.2 : 0, t[j] + 0.3 * syl[j]);
        w.end = Math.max(t[j] + 0.15, Math.min(end, next - 0.05));
      }
    });
    line.start = Math.min(line.start, line.words[0].start);
    line.end = Math.max(line.end, line.words[line.words.length - 1].end);
    changed++;
  });
  return changed;
}
