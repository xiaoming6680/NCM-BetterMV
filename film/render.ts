// Shoots the films in film/ frame by frame in headless Edge and puts the songs and effects under them, and renders
// the pictures the repository uses.
//
//   bun film/render.ts                    the film (film/index.html), 1920 × 1080 60 fps → build/film/
//   bun film/render.ts --reel             the reel (film/reel.html) → build/film/BetterMV-reel.mp4 (with any option below)
//   bun film/render.ts --stills 1,3.5     PNG stills at those seconds (build/film/still-*.png)
//   bun film/render.ts --audio            only the soundtrack (build/film/soundtrack.wav)
//   bun film/render.ts --images           the plugin's preview (plugin/preview.jpg) and the README's pictures (docs/images/)
//   bun film/render.ts --cover            the film's cover from frames of the rendered film (build/film/cover-*.png)
//   bun film/render.ts --art              the plugin's push tunnel the README cover is drawn over (film/art/tunnel-h.jpg)
//   options: --from 0 --to 60 --fps 60 --workers 1 --out file.mp4
// One worker by default: each page holds a WebGL renderer per song (six), and with two pages some plates came out
// missing what they draw (the spectrum tube down to its middle ring, a kaleidoscope black for 0.2 s) — the same
// frames are whole when one page renders them.
//
// Needs the frozen dev server (bunx vite --config vite.frozen.config.ts, port 5191; BMV_SERVER points elsewhere): it
// serves the pages, the plugin's modules and the songs from the NetEase cache. Needs Microsoft Edge, ffmpeg
// (BMV_FFMPEG) and, for the effects, Python with numpy, scipy and soundfile. playwright-core is borrowed from another
// checkout unless BMV_PLAYWRIGHT points at one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');
const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const SERVER = process.env.BMV_SERVER ?? 'http://localhost:5191';
const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'build', 'film');
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true'; };
const [CW, CH] = [1280, 720];
const REEL = argv.includes('--reel');
/** The film's page, and the name its files are written under. */
const PAGE = REEL ? '/film/reel.html' : '/film/', NAME = REEL ? 'BetterMV-reel' : 'BetterMV', TAG = REEL ? '-reel' : '';
const SCALE = 1.5;
const FPS = Number(opt('fps', '60'));

function run(cmd: string[], quiet = false): void {
  const r = Bun.spawnSync(cmd, { stdout: quiet ? 'ignore' : 'inherit', stderr: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.exitCode !== 0) throw new Error(`${path.basename(cmd[0])} 退出码 ${r.exitCode}`);
}
function capture(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  return r.stdout.toString() + r.stderr.toString();
}

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

/** The film's page on the frame-by-frame clock; `query` adds to its URL (the reel's cover: '&clean'). */
async function openPage(query = '') {
  const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e: Error) => console.error('页面错误：', e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') console.error('页面：', m.text()); });
  await page.goto(`${SERVER}${PAGE}?render${query}`);
  // (A server just started compiles the modules on the first load: more than a minute.)
  await page.waitForFunction(() => (window as any).PROMO?.ready, null, { timeout: 180000 });
  await page.evaluate(() => (window as any).PROMO.ready);
  const cdp = await page.context().newCDPSession(page);
  return {
    page,
    async shot(t: number): Promise<Buffer> {
      const lost = await page.evaluate(async (t: number) => { const P = (window as any).PROMO; await P.renderAt(t); return P.lost?.() ?? 0; }, t);
      // (A lost context draws nothing ever after: the reel once came out white from its fifth song on.)
      if (lost) throw new Error(`${t.toFixed(2)} 秒：${lost} 个 WebGL 上下文丢失（多半是显存不够），后面的画面不能用`);
      // The clip's scale is what gives device pixels: without it Edge returns the CSS size, whatever the device scale.
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: CW, height: CH, scale: SCALE } });
      return Buffer.from(data, 'base64');
    },
  };
}

interface Plan { duration: number; audio: Array<{ id: number; from: number; T0: number; T1: number; fadeIn?: number; fadeOut?: number; level?: number; url?: string }>; sfx: unknown[]; marks: Record<string, number> }

/** The songs' excerpts, each brought to the same loudness, plus the effects track → one WAV. */
async function soundtrack(plan: Plan, to: number): Promise<string> {
  const cache = path.join(OUT, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  for (const a of plan.audio) {
    const file = path.join(cache, `${a.id}.audio`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(await (await fetch(`${SERVER}${a.url ?? `/ncm/audio/${a.id}`}`)).arrayBuffer()));
  }
  // Each excerpt's loudness, so a ballad and a drop sit at the same level (or at the level the film asks for).
  const gains = plan.audio.map(a => {
    const log = capture([FF, '-hide_banner', '-nostats', '-ss', String(a.from), '-t', String(a.T1 - a.T0), '-i', path.join(cache, `${a.id}.audio`), '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
    const m = log.match(/I:\s+(-?[\d.]+) LUFS/g);
    const lufs = m ? Number(m[m.length - 1].replace(/[^\d.-]/g, '')) : -14;
    return Math.max(-12, Math.min(9, (a.level ?? -13) - lufs));
  });
  const sfxJson = path.join(OUT, `sfx${TAG}.json`), sfxWav = path.join(OUT, `sfx${TAG}.wav`);
  fs.writeFileSync(sfxJson, JSON.stringify(plan.sfx));
  run(['python', path.join(ROOT, 'film', 'sfx.py'), sfxJson, sfxWav, String(plan.duration + 1)], true);
  const inputs: string[] = [], chains: string[] = [];
  plan.audio.forEach((a, i) => {
    inputs.push('-i', path.join(cache, `${a.id}.audio`));
    const dur = a.T1 - a.T0, fi = a.fadeIn ?? 0, fo = a.fadeOut ?? 0.02;
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${a.from.toFixed(4)}:duration=${dur.toFixed(4)},asetpts=PTS-STARTPTS,` +
      `${fi > 0 ? `afade=t=in:d=${fi},` : ''}afade=t=out:st=${Math.max(0, dur - fo).toFixed(4)}:d=${fo},volume=${gains[i].toFixed(2)}dB,adelay=${Math.round(a.T0 * 1000)}:all=1[a${i}]`);
  });
  const n = plan.audio.length;
  inputs.push('-i', sfxWav);
  chains.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0dB[fx]`);
  const mix = `${plan.audio.map((_, i) => `[a${i}]`).join('')}[fx]amix=inputs=${n + 1}:normalize=0:duration=longest,atrim=duration=${to.toFixed(3)},` +
    `alimiter=limit=0.89:level=false,loudnorm=I=-14:TP=-1.2:LRA=11[out]`;
  const wav = path.join(OUT, `soundtrack${TAG}.wav`);
  run([FF, '-y', '-loglevel', 'error', ...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s24le', wav]);
  console.log(wav);
  return wav;
}

/** A page of the dev server, its fonts and pictures loaded. */
async function still(url: string, width: number, height: number, scale = 1) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  page.on('pageerror', (e: Error) => console.error('页面错误：', e.message));
  await page.goto(`${SERVER}${url}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  });
  await page.waitForTimeout(300);
  return page;
}

async function images(): Promise<void> {
  // Written straight to where they are used. The README shows its pictures 880 wide (620 for the settings page), so
  // they are shot at 2x. Below quality 100 Chrome's JPEG encoder leaves blotches in the dark glows.
  const docs = path.join(ROOT, 'docs', 'images');
  fs.mkdirSync(docs, { recursive: true });
  const shots: Array<[string, number, number, number, string]> = [
    ['/film/preview.html?store', 960, 480, 1, path.join(ROOT, 'plugin', 'preview.jpg')],
    ['/film/preview.html', 880, 440, 2, path.join(docs, 'cover.jpg')],
    ['/film/scenes.html', 1760, 600, 1, path.join(docs, 'scenes.jpg')],
  ];
  for (const [url, w, h, scale, file] of shots) {
    const page = await still(url, w, h, scale);
    // (The scene overview is as tall as its groups: the whole page.)
    if (url.includes('scenes')) await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.screenshot({ path: file, type: 'jpeg', quality: url.includes('scenes') ? 92 : 100, fullPage: url.includes('scenes') });
    console.log(file);
    await page.close();
  }
  // The settings page as BetterNCM shows it on a dark theme (the dev page puts it on a light and a dark panel), from
  // the top to the first row of scene sketches (the scene overview above shows them all).
  const page = await still('/settings.html', 700, 1400, 2);
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => {
    const dark = document.getElementById('dark')!.getBoundingClientRect();
    const tiles = document.querySelector('#dark .bmv-tiles')?.getBoundingClientRect();
    return { x: dark.x, y: dark.y + scrollY, width: dark.width, height: tiles ? tiles.bottom - dark.y + 12 : dark.height };
  });
  await page.screenshot({ path: path.join(docs, 'settings.jpg'), type: 'jpeg', quality: 92, clip, fullPage: true });
  console.log(path.join(docs, 'settings.jpg'));
  await page.close();
  // The MV page's controls with the play list open, over the plugin's push tunnel (the dev page's ?mv&demo).
  const mv = await still('/settings.html?mv&demo', 1280, 720, 1.5);
  await mv.waitForTimeout(600);
  await mv.screenshot({ path: path.join(docs, 'controls.jpg'), type: 'jpeg', quality: 92 });
  console.log(path.join(docs, 'controls.jpg'));
  await mv.close();
}

/** The README cover's picture: the plugin's own push tunnel in The Nights' drop, no HUD. */
async function art(): Promise<void> {
  const dir = path.join(ROOT, 'film', 'art');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, w, h] of [['tunnel-h.jpg', 1280, 720]] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: SCALE });
    await page.goto(`${SERVER}/?id=29771146`);
    await page.waitForFunction(() => (window as any).bmv?.player, null, { timeout: 300000 });
    const [cw, ch, b64] = await page.evaluate((t: number) => {
      const b = (window as any).bmv;
      b.audio.pause();
      b.player.hud.visible = false;
      for (let i = 90; i >= 1; i--) b.player.frame(t - i / 60, 1 / 60);
      b.player.frame(t, 1 / 60);
      const gl = b.player.engine.renderer.getContext(), c = gl.canvas;
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let str = '';
      for (let j = 0; j < px.length; j += 0x8000) str += String.fromCharCode.apply(null, px.subarray(j, j + 0x8000) as unknown as number[]);
      return [c.width, c.height, btoa(str)];
    }, 68.2);
    const ff = Bun.spawn([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${cw}x${ch}`, '-i', 'pipe:0',
      '-vf', 'vflip', '-frames:v', '1', '-q:v', '3', path.join(dir, name)], { stdin: 'pipe', stderr: 'inherit' });
    ff.stdin.write(Buffer.from(b64 as string, 'base64'));
    ff.stdin.end();
    if (await ff.exited) throw new Error('ffmpeg 失败');
    console.log(path.join(dir, name));
    await page.close();
  }
}

/**
 * The film's cover: frames cut from the rendered film (build/film/BetterMV.mp4) into build/film/cover-frames/,
 * then film/cover.html shot at 16:9 (and its left 4:3, where the words are) and, with ?tall, 3:4.
 */
async function cover(): Promise<void> {
  const film = path.join(OUT, `${NAME}.mp4`), dir = path.join(OUT, 'cover-frames');
  fs.mkdirSync(dir, { recursive: true });
  const frameAt = (t: string, file: string) => run([FF, '-y', '-loglevel', 'error', '-ss', t, '-i', film, '-frames:v', '1', '-q:v', '2', path.join(dir, file)]);
  // The promo: the Sierpinski fractal (Can You Hear Me), no sung words in it to fight the line (the tunnel's and the
  // orb's carry the song's); --at picks another moment. The reel: a wall of eight of its plates (--at t,t,…), drawn
  // by its page without the words over the parts (most of its best plates are under them).
  if (REEL) {
    const pg = await openPage('&clean');
    for (const [i, t] of String(opt('at', '6,18.6,22.3,45,24.6,32.5,39.6,17.6')).split(',').entries()) {
      const png = path.join(dir, `reel-${i}.png`);
      fs.writeFileSync(png, await pg.shot(Number(t)));
      run([FF, '-y', '-loglevel', 'error', '-i', png, '-q:v', '2', path.join(dir, `reel-${i}.jpg`)]);
      fs.rmSync(png);
    }
    await pg.page.close();
  } else frameAt(String(opt('at', '31.5')), 'frame.jpg');
  const q = REEL ? '?reel' : '', tq = REEL ? '?tall&reel' : '?tall';
  for (const [url, w, h, shots] of [
    [`/film/cover.html${q}`, 1920, 1080, [[`cover${TAG}-16x9.png`, null], [`cover${TAG}-4x3.png`, { x: 0, y: 0, width: 1440, height: 1080 }]]],
    [`/film/cover.html${tq}`, 1080, 1440, [[`cover${TAG}-3x4.png`, null]]],
  ] as const) {
    const page = await still(url, w, h);
    for (const [name, clip] of shots) {
      await page.screenshot({ path: path.join(OUT, name), ...(clip ? { clip } : {}) });
      console.log(path.join(OUT, name));
    }
    await page.close();
  }
}

try {
  if (argv.includes('--images')) { await images(); process.exit(0); }
  if (argv.includes('--cover')) { await cover(); process.exit(0); }
  if (argv.includes('--art')) { await art(); process.exit(0); }
  const first = await openPage();
  const plan: Plan = await first.page.evaluate(() => { const p = (window as any).PROMO; return { duration: p.duration, audio: p.audio, sfx: p.sfx, marks: p.marks }; });
  console.log(`时长 ${plan.duration.toFixed(2)} 秒`, Object.entries(plan.marks).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(' · '));

  if (opt('stills')) {
    for (const t of String(opt('stills')).split(',').map(Number)) {
      const file = path.join(OUT, `still${TAG}-${t.toFixed(2)}.png`);
      fs.writeFileSync(file, await first.shot(t));
      console.log(file);
    }
  } else if (argv.includes('--audio')) {
    await soundtrack(plan, plan.duration);
  } else {
    const from = Number(opt('from', '0')), to = Math.min(plan.duration, Number(opt('to', String(plan.duration))));
    const total = Math.round((to - from) * FPS);
    const workers = Math.max(1, Math.min(Number(opt('workers', '1')), total));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmv-film-'));
    const chunk = Math.ceil(total / workers), parts: string[] = [];
    const pages = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, openPage)))];
    let done = 0;
    const started = Date.now();
    console.log(`渲染 ${total} 帧（${CW * SCALE}×${CH * SCALE} ${FPS} fps，${workers} 路）…`);
    await Promise.all(pages.map(async (view, w) => {
      const a = w * chunk, b = Math.min(total, a + chunk);
      if (a >= b) return;
      const part = path.join(tmp, `part${w}.mp4`);
      parts[w] = part;
      const enc = Bun.spawn([FF, '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-g', String(FPS), part], { stdin: 'pipe', stderr: 'inherit' });
      for (let i = a; i < b; i++) {
        enc.stdin.write(await view.shot(from + i / FPS));
        if (++done % FPS === 0 || done === total) {
          const s = (Date.now() - started) / 1000;
          process.stdout.write(`\r${(done / total * 100).toFixed(1)}%  ${done}/${total}  已用 ${s.toFixed(0)} 秒  剩余约 ${(s / done * (total - done)).toFixed(0)} 秒   `);
        }
      }
      enc.stdin.end();
      if (await enc.exited) throw new Error('ffmpeg 编码失败');
    }));
    console.log('');
    const list = path.join(tmp, 'parts.txt');
    fs.writeFileSync(list, parts.filter(Boolean).map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    const video = path.join(tmp, 'video.mp4');
    run([FF, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
    // (An encoder that runs out of memory reading its pipe stops taking frames and still exits 0: one render came out
    // 42 frames short, everything after the gap ahead of the sound. So the frames are counted.)
    const probe = FF.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const frames = parseInt(capture([probe, '-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', video]), 10);
    if (frames !== total) throw new Error(`视频有 ${frames} 帧，应有 ${total} 帧：编码中途出错（多半是内存不够），请关掉别的任务重渲`);
    const music = await soundtrack(plan, plan.duration);
    const out = opt('out') ? path.resolve(String(opt('out'))) : path.join(OUT, `${NAME}${from > 0 || to < plan.duration ? `-${from}-${to}` : ''}.mp4`);
    run([FF, '-y', '-loglevel', 'error', '-i', video, '-ss', String(from), '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '256k', '-t', String(to - from), '-movflags', '+faststart', out]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(out);
  }
} finally {
  await browser.close();
}
