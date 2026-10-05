import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Dev harness only. Serves what the plugin will get inside NetEase: the client's cached audio of a song
// (XOR 0xA3, read in place), its lyrics, details and cover from NetEase's public API, plus local test files.

function localFiles(prefix: string, root: string): Plugin {
  const base = path.resolve(root);
  return {
    name: 'local-files' + prefix.replace(/\//g, '-'),
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]);
        const file = path.resolve(base, '.' + rel);
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Length', String(fs.statSync(file).size));
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

const CACHE = process.env.BMV_NCM_CACHE || path.join(process.env.LOCALAPPDATA || 'C:/Users/18961/AppData/Local', 'NetEase/CloudMusic/Cache/Cache');
const API = 'https://music.163.com';

/** Complete cached copies: songId → file name (highest quality code wins). */
function cachedSongs(): Map<string, string> {
  const out = new Map<string, { name: string; rank: number }>();
  for (const name of fs.readdirSync(CACHE)) {
    const m = name.match(/^(\d+)-(\d+)-[0-9a-f]+\.uc$/i);
    if (!m) continue;
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(CACHE, name.replace(/\.uc$/i, '.idx')), 'utf8'));
      const size = Number(idx.size);
      const zones: string[] = idx.zone || [];
      if (!(zones.length === 1 && zones[0] === `0 ${size - 1}`)) continue; // only fully downloaded songs
    } catch { continue; }
    const rank = Number(m[2]);
    const prev = out.get(m[1]);
    if (!prev || rank > prev.rank) out.set(m[1], { name, rank });
  }
  return new Map(Array.from(out, ([id, v]) => [id, v.name]));
}

/**
 * NetEase answers too many requests with {"code":405,"msg":"操作频繁"}: lyrics, wiki, details and covers are kept in
 * dev/ncm-cache/ (git-ignored) after the first good answer, so the harness and the eval tool ask only once per song.
 */
const NCM_CACHE = path.resolve(import.meta.dirname, 'dev/ncm-cache');
async function remember(name: string, get: () => Promise<unknown>, ok: (d: unknown) => boolean): Promise<unknown> {
  const file = path.join(NCM_CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = await get();
  if (ok(data)) {
    fs.mkdirSync(NCM_CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  }
  return data;
}
async function songDetail(id: string): Promise<{ id: number; name: string; artists: string[]; album?: string; cover?: string; duration: number } | null> {
  // The v3 endpoint (songs[].ar / al / dt) first — the old one is the first to be rate-limited.
  const d = await remember(`detail-${id}.json`, async () => {
    const v3 = await (await fetch(`${API}/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify([{ id: Number(id) }]))}`)).json().catch(() => null);
    if (v3?.songs?.[0]) return v3;
    return (await fetch(`${API}/api/song/detail/?ids=%5B${id}%5D`)).json();
  }, x => !!(x as any)?.songs?.[0]) as any;
  const s = d?.songs?.[0];
  if (!s) return null;
  const artists = (s.ar ?? s.artists ?? []).map((a: any) => a.name), album = s.al ?? s.album;
  return { id: s.id, name: s.name, artists, album: album?.name, cover: album?.picUrl, duration: (s.dt ?? s.duration) / 1000 };
}

function ncm(): Plugin {
  const json = (res: any, data: unknown) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
  return {
    name: 'ncm-dev',
    configureServer(server) {
      server.middlewares.use('/ncm', async (req, res, next) => {
        try {
          const [, kind, id] = (req.url || '').split('?')[0].split('/');
          if (kind === 'list') return json(res, Array.from(cachedSongs().keys()));
          if (!id || !/^\d+$/.test(id)) return next();
          if (kind === 'audio') {
            const name = cachedSongs().get(id);
            if (!name) { res.statusCode = 404; return res.end('not cached'); }
            const buf = fs.readFileSync(path.join(CACHE, name));
            for (let i = 0; i < buf.length; i++) buf[i] ^= 0xa3;
            const flac = buf.subarray(0, 4).toString('latin1') === 'fLaC';
            res.setHeader('Content-Type', flac ? 'audio/flac' : 'audio/mpeg');
            res.setHeader('Content-Length', String(buf.length));
            return res.end(buf);
          }
          if (kind === 'lyric') return json(res, await remember(`lyric-${id}.json`, async () => {
            const r = await fetch(`${API}/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=${id}`);
            return r.json();
          }, d => !!d && (d as any).code === 200));
          if (kind === 'wiki') return json(res, await remember(`wiki-${id}.json`, async () => {
            const r = await fetch(`${API}/api/song/play/about/block/page?songId=${id}`);
            return r.json();
          }, d => !!d && (d as any).code === 200));
          if (kind === 'detail') return json(res, await songDetail(id));
          if (kind === 'cover') {
            const file = path.join(NCM_CACHE, `cover-${id}.jpg`);
            if (!fs.existsSync(file)) {
              const url = (await songDetail(id))?.cover;
              if (!url) return next();
              const img = await fetch(url.replace(/^http:/, 'https:') + '?param=1024y1024');
              if (!img.ok) return next();
              fs.mkdirSync(NCM_CACHE, { recursive: true });
              fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
            }
            res.setHeader('Content-Type', 'image/jpeg');
            return res.end(fs.readFileSync(file));
          }
          next();
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

/** POST /stills/<name>.png (raw PNG body) saves a frame to dev/stills/ — for checking renders while the page is hidden. */
function stills(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'dev/stills');
  return {
    name: 'stills',
    configureServer(server) {
      server.middlewares.use('/stills', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        if (req.method !== 'POST' || !/^[\w.-]+\.png$/.test(name)) return next();
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

/**
 * POST /align/<key>: [u32 JSON length][job JSON][16-bit PCM] — runs the aligner pack's align.py (tools/aligner) the way
 * the plugin does and answers with its output. Python and model from an unpacked pack in dev/aligner (or
 * BMV_ALIGNER_PYTHON / BMV_ALIGNER_MODEL); the script itself is always the repo's. Results are kept in dev/align/.
 */
function align(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'dev/align');
  const pack = path.resolve(import.meta.dirname, 'dev/aligner');
  const python = process.env.BMV_ALIGNER_PYTHON || path.join(pack, 'python/python.exe');
  const model = process.env.BMV_ALIGNER_MODEL || path.join(pack, 'models/mms_fa.onnx');
  return {
    name: 'align',
    configureServer(server) {
      server.middlewares.use('/align', (req, res, next) => {
        const key = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        if (req.method !== 'POST' || !/^[\w-]+$/.test(key)) return next();
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(dir, { recursive: true });
          const out = path.join(dir, `${key}.json`);
          const reply = () => { res.setHeader('Content-Type', 'application/json'); res.end(fs.readFileSync(out)); };
          if (fs.existsSync(out)) return reply();
          const body = Buffer.concat(chunks), n = body.readUInt32LE(0);
          const job = JSON.parse(body.subarray(4, 4 + n).toString('utf8'));
          const pcm = path.join(dir, `${key}.pcm`), jobPath = path.join(dir, `${key}.job.json`);
          fs.writeFileSync(pcm, body.subarray(4 + n));
          fs.writeFileSync(jobPath, JSON.stringify({ ...job, audio: pcm, out, progress: path.join(dir, `${key}.progress.json`), model }));
          const py = spawn(python, [path.resolve(import.meta.dirname, 'tools/aligner/align.py'), jobPath], { stdio: 'inherit' });
          py.on('close', () => (fs.existsSync(out) ? reply() : (res.statusCode = 500, res.end('{"error":"align.py wrote nothing"}'))));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    ncm(),
    stills(),
    align(),
    localFiles('/media', process.env.BMV_MEDIA || 'E:/CloudMusic'),
    localFiles('/devdata', path.resolve(import.meta.dirname, 'dev')),
    localFiles('/reference', 'D:/!XM的项目/个人项目/Clarity_MV/data'),
  ],
  server: { port: 5190, strictPort: false },
  build: { target: 'chrome91' },
  // The settings page shows the plugin's version (plugin/manifest.json).
  define: { __VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'plugin/manifest.json'), 'utf8')).version) },
});
