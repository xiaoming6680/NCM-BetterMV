// The download's native path (src/plugin/export.ts + the encoder program, docs/EXPORT.md) in headless Edge against the
// dev harness, with the song's audio from the NetEase cache: the MP4 it writes, how fast, and how close it is to the
// frames the engine drew (PSNR / SSIM of a few frames against their pixels, read back as they were drawn).
//   bun tools/export-test.ts [--id 1332041346] [--from 40] [--to 50] [--size 1920x1080] [--fps 60] [--mbps 24]
//                            [--ref 100,300] [--out dev/export/test.mp4] [--seed 1]
// Needs the program built (scripts/build-encode.ps1 → dist/export/bettermv-encode.exe). Own dev server on 5197.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');
const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = opt('id', '1332041346'), FROM = Number(opt('from', '40')), TO = Number(opt('to', '50'));
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const FPS = Number(opt('fps', '60')), MBPS = Number(opt('mbps', '24'));
const REF = opt('ref', '100,300').split(',').filter(Boolean).map(Number);
const SEED = opt('seed', '1');
const HW = opt('hw', '1') !== '0';
// --gc <ms>: the page's garbage collected from outside at that interval (to tell blob memory piling up from something else).
const GC = Number(opt('gc', '0'));
const OUT = path.resolve(root, opt('out', 'dev/export/test.mp4'));
const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const PORT = 5197;
const EXE = path.join(root, 'dist/export/bettermv-encode.exe');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) fs.rmSync(OUT);

const server = await createServer({ root, configFile: path.join(root, 'vite.frozen.config.ts'), server: { port: PORT, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const ARGS = ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
// --persistent: a profile on disk, as NetEase has (a new page of `launch` is an in-memory one: blobs are not paged to disk there).
const PERSISTENT = argv.includes('--persistent');
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? '.', 'bmv-export-'));
const persistent = PERSISTENT ? await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, args: ARGS, viewport: { width: 1280, height: 720 } }) : null;
const browser = persistent ?? await chromium.launch({ channel: 'msedge', headless: true, args: ARGS });
const children: Array<{ kill(): void }> = [];
try {
  const page = persistent ? (persistent.pages()[0] ?? await persistent.newPage()) : await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
  page.on('console', (m: any) => { if (m.type() === 'error' || m.text().includes('[BetterMV]')) console.log('[page]', m.text()); });
  // (NetEase's betterncm.app.exec, for the one call the encoder client makes of it.)
  let gcTimer = 0;
  if (GC) { const cdp = await page.context().newCDPSession(page); gcTimer = setInterval(() => { cdp.send('HeapProfiler.collectGarbage').catch(() => {}); }, GC) as unknown as number; }
  await page.exposeFunction('__spawn', (cmd: string) => {
    const m = cmd.match(/^"([^"]+)"\s*(.*)$/)!;
    children.push(Bun.spawn([m[1], ...m[2].split(' ').filter(Boolean)], { stdout: 'ignore', stderr: 'ignore' }));
  });
  await page.addInitScript(() => { (window as any).betterncm = { app: { exec: async (cmd: string) => { (window as any).__spawn(cmd); return true; } } }; });
  await page.goto(`http://127.0.0.1:${PORT}/?id=${ID}&seed=${SEED}`);
  await page.waitForFunction(() => (window as any).bmv?.player?.director, null, { timeout: 240000 });
  const res = await page.evaluate(async ({ id, from, to, w, h, fps, bitrate, out, exe, origin, refs, hw }: any) => {
    (window as any).requestAnimationFrame = () => 0; // the harness's own loop would draw between the export's frames
    const load = (p: string) => import(p);
    const { exportNative } = await load('/src/plugin/export.ts');
    (window as any).__betterMvEncoder = { exe, args: `--dev-origin ${origin}`, hardware: hw };
    const bmv = (window as any).bmv, player = bmv.player;
    bmv.audio.pause();
    player.engine.fixedSize = { width: w, height: h };
    player.engine.setPixelRatio(1);
    player.resize();
    const audio = await fetch(`/ncm/audio/${id}`).then(r => r.arrayBuffer());
    const gl = player.engine.renderer.getContext();
    const wanted = new Set<number>(refs), got: Record<number, string> = {};
    const onFrame = (i: number) => {
      if (!wanted.has(i)) return;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = '';
      for (let k = 0; k < px.length; k += 0x8000) s += String.fromCharCode.apply(null, px.subarray(k, k + 0x8000) as unknown as number[]);
      got[i] = btoa(s);
    };
    const t0 = performance.now();
    const done = await exportNative({ player, audio, path: out, spec: { width: w, height: h, fps, bitrate, from, to }, hardware: true, progress: () => {}, cancelled: () => false, onFrame });
    return { done, secs: (performance.now() - t0) / 1000, refs: got };
  }, { id: ID, from: FROM, to: TO, w: W, h: H, fps: FPS, bitrate: MBPS * 1e6, out: OUT, exe: EXE, origin: `http://127.0.0.1:${PORT}`, refs: REF, hw: HW });
  const frames = Math.ceil((TO - FROM) * FPS);
  console.log(`done: ${JSON.stringify(res.done)}; ${res.secs.toFixed(1)} s for ${frames} frames = ${(frames / res.secs).toFixed(0)} frames/s (${((TO - FROM) / res.secs).toFixed(1)}× real time)`);
  const run = async (args: string[]) => {
    const p = Bun.spawn([FF, '-hide_banner', '-nostats', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    await p.exited;
    return o + e;
  };
  for (const [i, b64] of Object.entries(res.refs) as Array<[string, string]>) {
    const raw = path.join(path.dirname(OUT), `ref-${i}.rgba`), png = path.join(path.dirname(OUT), `ref-${i}.png`);
    fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
    await run(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', raw, '-vf', 'vflip', '-frames:v', '1', png]);
    const dec = path.join(path.dirname(OUT), `dec-${i}.png`);
    await run(['-y', '-i', OUT, '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', '-fps_mode', 'passthrough', dec]);
    const cmp = (f: string) => run(['-i', png, '-i', dec, '-lavfi', `[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]${f}`, '-f', 'null', '-']);
    const psnr = (await cmp('psnr')).match(/average:([\d.inf]+)/)?.[1], ssim = (await cmp('ssim')).match(/All:([\d.]+)/)?.[1];
    console.log(`frame ${i}: PSNR ${psnr} dB, SSIM ${ssim}`);
    fs.rmSync(raw);
  }
  console.log(OUT, (fs.statSync(OUT).size / 1048576).toFixed(1), 'MB');
} finally {
  for (const c of children) c.kill();
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  await server.close();
}
