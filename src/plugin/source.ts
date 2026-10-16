// Everything about the playing song that the MV needs, fetched inside the client: lyrics and wiki from NetEase's
// public API, the cover from its CDN (CORS-enabled), and the whole audio — the client's own cached copy when it
// is complete, else the standard-quality stream the user is entitled to.
import type { Client } from './client.ts';
import { parseWiki, wikiUrl, type SongWiki } from '../meta/wiki.ts';
import type { NeteaseLyric } from '../lyrics/parse.ts';

const domain = () => {
  const d = window.APP_CONF?.domain;
  return typeof d === 'string' && /^https:\/\/[\w.-]+$/.test(d) ? d : 'https://music.163.com';
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A song that can't be had, with what to try (the waiting view shows it under the message). */
export class SourceError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

export async function fetchLyric(id: number): Promise<NeteaseLyric | null> {
  try {
    const r = await fetch(`${domain()}/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=${id}`);
    return await r.json();
  } catch { return null; }
}

export async function fetchWiki(id: number): Promise<SongWiki | undefined> {
  try { return parseWiki(await (await fetch(wikiUrl(id, domain()))).json()); } catch { return undefined; }
}

/** NetEase's chorus mark for the song (the highlight it plays), seconds; the analysis' chorus hint. */
export async function fetchChorus(id: number): Promise<[number, number] | undefined> {
  try { return parseChorus(await (await fetch(`${domain()}/api/song/chorus?ids=${encodeURIComponent('[' + id + ']')}`)).json(), id); } catch { return undefined; }
}

/** The mark for `id` out of /api/song/chorus's answer ({ chorus: [{ id, startTime, endTime }] }, ms). */
export function parseChorus(doc: unknown, id: number): [number, number] | undefined {
  const list = (doc as { chorus?: Array<{ id: number; startTime: number; endTime: number }> } | null)?.chorus;
  const c = Array.isArray(list) ? list.find(x => x && x.id === id) : undefined;
  return c && c.endTime > c.startTime && c.startTime >= 0 ? [c.startTime / 1000, c.endTime / 1000] : undefined;
}

export function loadCover(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('封面加载失败'));
    img.src = url.replace(/^http:/, 'https:').replace(/\?.*$/, '') + '?param=1024y1024';
  });
}

let cacheRoot: string | undefined;

/**
 * Where the client caches songs: the Cache folder inside its 缓存目录 setting (设置 → 下载设置), as the client
 * itself applied it at startup (Storage.cacheDir), else as stored in its settings. Recorded in the BetterNCM data
 * folder (BetterMV\ncm-cache.json) so the dev tools outside the client follow the same setting.
 */
export async function songCacheDir(client: Client): Promise<string | null> {
  if (cacheRoot) return cacheRoot;
  const settings = [client.storage?.cacheDir, client.store.getState()?.setting?.cacheDir];
  for (const base of settings) {
    if (typeof base !== 'string' || !base) continue;
    const dir = base.replace(/[\\/]+$/, '') + '/Cache';
    try { if (!await betterncm.fs.exists(dir)) continue; } catch { continue; }
    cacheRoot = dir;
    void recordCacheDir(dir);
    return dir;
  }
  return null;
}

async function recordCacheDir(dir: string): Promise<void> {
  try {
    const folder = (await betterncm.app.getDataPath()).replace(/[\\/]+$/, '') + '\\BetterMV';
    const file = folder + '\\ncm-cache.json';
    const text = JSON.stringify({ songs: dir.replace(/\//g, '\\') });
    if (await betterncm.fs.exists(file) && await betterncm.fs.readFileText(file) === text) return;
    if (!await betterncm.fs.exists(folder)) await betterncm.fs.mkdir(folder);
    await betterncm.fs.writeFileText(file, text);
  } catch { /* the dev tools fall back to the default folder */ }
}

/**
 * The client's complete cached copy of a song, decrypted (XOR 0xA3); null while it is still downloading. Throws when
 * the folder can't be listed: BetterNCM's read_dir then answers 500 with nothing in it, and its readDir fails with
 * “Unexpected end of JSON input”.
 */
export async function readCachedAudio(client: Client, id: number): Promise<ArrayBuffer | null> {
  const dir = await songCacheDir(client);
  if (!dir) return null;
  const names = (await betterncm.fs.readDir(dir))
    .map(e => String(e).split(/[\\/]/).pop()!)
    .filter(n => n.indexOf(id + '-') === 0 && /\.uc$/i.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const name of names) {
    try {
      const idx = JSON.parse(await betterncm.fs.readFileText(`${dir}/${name.replace(/\.uc$/i, '')}.idx`));
      const size = Number(idx.size), zone: string[] = idx.zone || [];
      if (!(zone.length === 1 && zone[0] === `0 ${size - 1}`)) continue;
    } catch { continue; }
    const bytes = new Uint8Array(await (await betterncm.fs.readFile(`${dir}/${name}`)).arrayBuffer());
    const words = bytes.length >>> 2, u32 = new Uint32Array(bytes.buffer, 0, words);
    for (let i = 0; i < words; i++) u32[i] ^= 0xa3a3a3a3;
    for (let i = words * 4; i < bytes.length; i++) bytes[i] ^= 0xa3;
    return bytes.buffer;
  }
  return null;
}

/** The standard-quality stream NetEase gives the logged-in user; null for trial clips or when not allowed. */
async function fetchStreamAudio(id: number): Promise<ArrayBuffer | null> {
  const r = await fetch(`${domain()}/api/song/enhance/player/url/v1?ids=${encodeURIComponent('[' + id + ']')}&level=standard&encodeType=mp3`, { credentials: 'include' });
  const d = (await r.json())?.data?.[0];
  if (!d || !d.url || d.freeTrialInfo) return null;
  const a = await fetch(String(d.url).replace(/^http:/, 'https:'));
  return a.ok ? await a.arrayBuffer() : null;
}

/**
 * Whole-song audio: the cache if complete, else the stream, else wait for the cache to finish. A cache folder that
 * can't be listed is passed over for the stream (a report on 0.9.0: the listing failed on that machine and every song
 * failed with it, “Unexpected end of JSON input”, the stream never tried).
 */
export async function getAudio(client: Client, id: number, cancelled: () => boolean): Promise<ArrayBuffer> {
  let cached: ArrayBuffer | null = null, unreadable = false;
  try {
    cached = await readCachedAudio(client, id);
  } catch (e) {
    unreadable = true;
    console.warn('[BetterMV] 无法读取缓存目录', e);
  }
  if (cached) return cached;
  const stream = await fetchStreamAudio(id).catch(() => null);
  if (stream) return stream;
  if (unreadable) {
    const dir = (await songCacheDir(client))?.replace(/\//g, '\\');
    throw new SourceError(`无法读取网易云的缓存目录${dir ? `（${dir}）` : ''}，也无法在线获取这首歌曲`,
      '请确认网易云“设置 → 下载设置 → 缓存目录”中的文件夹可以正常打开；登录网易云账号后，有播放权限的歌曲可直接在线获取。');
  }
  for (let i = 0; i < 90 && !cancelled(); i++) {
    await sleep(2000);
    const c = await readCachedAudio(client, id).catch(() => null);
    if (c) return c;
  }
  throw new Error('无法获取这首歌曲的完整音频');
}
