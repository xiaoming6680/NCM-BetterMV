// Shoots the films in film/ frame by frame in headless Edge and puts the songs and effects under them, and renders
// the pictures the repository uses.
//
//   bun film/render.ts                    the film (film/index.html), 1920 × 1080 60 fps → build/film/
//   bun film/render.ts --stills 1,3.5     PNG stills at those seconds (build/film/still-*.png)
//   bun film/render.ts --audio            only the soundtrack (build/film/soundtrack.wav)
//   bun film/render.ts --images           the plugin's preview (plugin/preview.jpg) and the README's pictures (docs/images/)
//   bun film/render.ts --art              the plugin's push tunnel the README cover is drawn over (film/art/tunnel-h.jpg)
//   options: --from 0 --to 60 --fps 60 --workers 2 --out file.mp4 · --v for a 1080 × 1920 cut
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
const WIDE = !argv.includes('--v');
const [CW, CH] = WIDE ? [1280, 720] : [720, 1280];
const SCALE = 1.5;
const FPS = Number(opt('fps', '60'));
const tag = WIDE ? '' : '-vertical';

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

async function openPage() {
  const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e: Error) => console.error('页面错误：', e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') console.error('页面：', m.text()); });
  await page.goto(`${SERVER}/film/?render${WIDE ? '&h' : ''}`);
  await page.waitForFunction(() => (window as any).PROMO?.ready, null, { timeout: 60000 });
  await page.evaluate(() => (window as any).PROMO.ready);
  const cdp = await page.context().newCDPSession(page);
  return {
    page,
    async shot(t: number): Promise<Buffer> {
      await page.evaluate((t: number) => (window as any).PROMO.renderAt(t), t);
      // The clip's scale is what gives device pixels: without it Edge returns the CSS size, whatever the device scale.
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: CW, height: CH, scale: SCALE } });
      return Buffer.from(data, 'base64');
    },
  };
}

interface Plan { duration: number; audio: Array<{ id: number; from: number; T0: number; T1: number; fadeIn?: number; fadeOut?: number; level?: number }>; sfx: unknown[]; marks: Record<string, number> }

/** The songs' excerpts, each brought to the same loudness, plus the effects track → one WAV. */
async function soundtrack(plan: Plan, to: number): Promise<string> {
  const cache = path.join(OUT, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  for (const id of new Set(plan.audio.map(a => a.id))) {
    const file = path.join(cache, `${id}.audio`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(await (await fetch(`${SERVER}/ncm/audio/${id}`)).arrayBuffer()));
  }
  // Each excerpt's loudness, so a ballad and a drop sit at the same level (or at the level the film asks for).
  const gains = plan.audio.map(a => {
    const log = capture([FF, '-hide_banner', '-nostats', '-ss', String(a.from), '-t', String(a.T1 - a.T0), '-i', path.join(cache, `${a.id}.audio`), '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
    const m = log.match(/I:\s+(-?[\d.]+) LUFS/g);
    const lufs = m ? Number(m[m.length - 1].replace(/[^\d.-]/g, '')) : -14;
    return Math.max(-12, Math.min(9, (a.level ?? -13) - lufs));
  });
  const sfxJson = path.join(OUT, `sfx${tag}.json`), sfxWav = path.join(OUT, `sfx${tag}.wav`);
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
  const wav = path.join(OUT, `soundtrack${tag}.wav`);
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
    if (url.includes('scenes')) await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.screenshot({ path: file, type: 'jpeg', quality: url.includes('scenes') ? 92 : 100 });
    console.log(file);
    await page.close();
  }
  // The settings page as BetterNCM shows it on a dark theme (the dev page puts it on a light and a dark panel).
  const page = await still('/settings.html', 700, 1400, 2);
  await page.waitForTimeout(600);
  await (await page.$('#dark'))!.screenshot({ path: path.join(docs, 'settings.jpg'), type: 'jpeg', quality: 92 });
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

try {
  if (argv.includes('--images')) { await images(); process.exit(0); }
  if (argv.includes('--art')) { await art(); process.exit(0); }
  const first = await openPage();
  const plan: Plan = await first.page.evaluate(() => { const p = (window as any).PROMO; return { duration: p.duration, audio: p.audio, sfx: p.sfx, marks: p.marks }; });
  console.log(`时长 ${plan.duration.toFixed(2)} 秒`, Object.entries(plan.marks).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(' · '));

  if (opt('stills')) {
    for (const t of String(opt('stills')).split(',').map(Number)) {
      const file = path.join(OUT, `still${tag}-${t.toFixed(2)}.png`);
      fs.writeFileSync(file, await first.shot(t));
      console.log(file);
    }
  } else if (argv.includes('--audio')) {
    await soundtrack(plan, plan.duration);
  } else {
    const from = Number(opt('from', '0')), to = Math.min(plan.duration, Number(opt('to', String(plan.duration))));
    const total = Math.round((to - from) * FPS);
    const workers = Math.max(1, Math.min(Number(opt('workers', '2')), total));
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
    const music = await soundtrack(plan, plan.duration);
    const out = opt('out') ? path.resolve(String(opt('out'))) : path.join(OUT, `BetterMV-devlog${tag}${from > 0 || to < plan.duration ? `-${from}-${to}` : ''}.mp4`);
    run([FF, '-y', '-loglevel', 'error', '-i', video, '-ss', String(from), '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '256k', '-t', String(to - from), '-movflags', '+faststart', out]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(out);
  }
} finally {
  await browser.close();
}
