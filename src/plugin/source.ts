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

export async function fetchLyric(id: number): Promise<NeteaseLyric | null> {
  try {
    const r = await fetch(`${domain()}/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=${id}`);
    return await r.json();
  } catch { return null; }
}

export async function fetchWiki(id: number): Promise<SongWiki | undefined> {
  try { return parseWiki(await (await fetch(wikiUrl(id, domain()))).json()); } catch { return undefined; }
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

let cacheRoot: string | null | undefined;

async function songCacheDir(client: Client): Promise<string | null> {
  if (cacheRoot !== undefined) return cacheRoot;
  const candidates: string[] = [];
  if (client.storage?.cacheDir) candidates.push(client.storage.cacheDir.replace(/[\\/]+$/, '') + '/Cache');
  try {
    for (const entry of await betterncm.fs.readDir('C:/Users')) {
      candidates.push(`C:/Users/${String(entry).split(/[\\/]/).pop()}/AppData/Local/NetEase/CloudMusic/Cache/Cache`);
    }
  } catch { /* no access */ }
  for (const dir of candidates) {
    try { if (await betterncm.fs.exists(dir)) return (cacheRoot = dir); } catch { /* next */ }
  }
  return (cacheRoot = null);
}

/** The client's complete cached copy of a song, decrypted (XOR 0xA3); null while it is still downloading. */
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

/** Whole-song audio: the cache if complete, else the stream, else wait for the cache to finish. */
export async function getAudio(client: Client, id: number, cancelled: () => boolean): Promise<ArrayBuffer> {
  const cached = await readCachedAudio(client, id);
  if (cached) return cached;
  const stream = await fetchStreamAudio(id).catch(() => null);
  if (stream) return stream;
  for (let i = 0; i < 90 && !cancelled(); i++) {
    await sleep(2000);
    const c = await readCachedAudio(client, id);
    if (c) return c;
  }
  throw new Error('无法获取这首歌曲的完整音频');
}
