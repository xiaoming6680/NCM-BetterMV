// The README's and the release's moving pictures of the plugin's own UI: the MV page of the dev settings page
// (settings.html?mv&demo: the real overlay, menu, download sheet and settings over the demo picture) driven in headless
// Edge, a drawn cursor in place of the real one (headless pages have none), its frames taken with the DevTools
// screencast (Playwright's own video needs a download of its own ffmpeg) and turned into GIF for docs/images/ (the
// README and the release notes use the same files; ffmpeg's animated WebP keeps every frame whole and came out 9× the
// GIF's size).
//   bun tools/readme-media.ts [name …]        controls, menu, export, settings, loading (default: all)
//   bun tools/readme-media.ts --sketches       the install steps and opening the MV from NetEase (film/readme.html,
//                                              drawn frame by frame): docs/images/install.gif, open.gif. That page
//                                              uses the tutorial film's windows and is not in the repo yet.
// Needs a dev server (BMV_SERVER, default http://127.0.0.1:5175), Microsoft Edge, ffmpeg (BMV_FFMPEG) and
// playwright-core (BMV_PLAYWRIGHT). Writes docs/images/ui-<name>.gif; the frames stay in build/readme/.
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');
const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const SERVER = process.env.BMV_SERVER ?? 'http://127.0.0.1:5175';
const ROOT = path.resolve(import.meta.dir, '..');
const DOCS = path.join(ROOT, 'docs', 'images'), BUILD = path.join(ROOT, 'build', 'readme');
fs.mkdirSync(BUILD, { recursive: true });
const W = 1280, H = 720;

// The cursor: an arrow that follows the mouse, a ring where it presses.
const CURSOR = `(() => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none';
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.6-4.4 3 6.7 2.9-1.3-3-6.6 6.3-.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(255,255,255,.85);z-index:2147483646;pointer-events:none;opacity:0';
  addEventListener('DOMContentLoaded', () => { document.body.append(ring, c); });
  addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 5) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', e => {
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    ring.animate([{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 420, easing: 'ease-out' });
  }, true);
})();`;

type Page = any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Where an element's middle is (or a point in it, 0..1 across and down). */
async function at(page: Page, sel: any, fx = 0.5, fy = 0.5): Promise<[number, number]> {
  const loc = typeof sel === 'string' ? page.locator(sel).first() : sel;
  // (A row further down a panel is scrolled to first, as a person would.)
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error('not on the page: ' + sel);
  return [box.x + box.width * fx, box.y + box.height * fy];
}
let mouse: [number, number] = [W * 0.62, H * 0.55];
/** The cursor to a point at a person's pace (about 0.45 s for half the screen, eased). */
async function moveTo(page: Page, x: number, y: number, ms?: number): Promise<void> {
  const [x0, y0] = mouse, d = Math.hypot(x - x0, y - y0), dur = ms ?? Math.max(220, Math.min(700, d * 0.9));
  const n = Math.max(2, Math.round(dur / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await sleep(dur / n);
  }
  mouse = [x, y];
}
async function clickOn(page: Page, sel: any, opts: { right?: boolean; fx?: number; fy?: number } = {}): Promise<void> {
  const [x, y] = await at(page, sel, opts.fx, opts.fy);
  await moveTo(page, x, y);
  await sleep(140);
  await page.mouse.click(x, y, { button: opts.right ? 'right' : 'left' });
}
const item = (page: Page, text: string) => page.locator('.bmv-mi', { hasText: text }).first();
const button = (page: Page, text: string) => page.locator('button', { hasText: text }).first();

/** Each film: what it does on the page. Times are kept near a person's (the GIF plays at the speed it was shot). */
const FILMS: Record<string, (page: Page) => Promise<void>> = {
  // The controls come up when the mouse moves, the progress bar shows the song's sections, the play list opens.
  async controls(page) {
    await page.evaluate(() => (window as any).overlay.closePanel());
    await sleep(3200); // the controls go away when the mouse rests
    await moveTo(page, W * 0.5, H * 0.62, 600);
    await sleep(500);
    const [x0, y] = await at(page, '.bmv-track', 0.04), [x1] = await at(page, '.bmv-track', 0.96);
    await moveTo(page, x0, y, 600);
    // Along the sections, slowly enough to read their names.
    const steps = 6;
    for (let i = 1; i <= steps; i++) { await moveTo(page, x0 + ((x1 - x0) * i) / steps, y, 420); await sleep(380); }
    await clickOn(page, page.getByRole('button', { name: '播放列表' }));
    await sleep(700);
    const [qx, qy] = await at(page, '.bmv-q', 0.5, 0.5);
    await moveTo(page, qx, qy + 120, 500);
    await sleep(1200);
  },
  // Right click: the menu, the style submenu, then 下载 MV….
  async menu(page) {
    await page.evaluate(() => (window as any).overlay.closePanel());
    await sleep(600);
    await clickOn(page, '.bmv-stage', { right: true, fx: 0.42, fy: 0.42 });
    await sleep(700);
    await moveTo(page, ...(await at(page, item(page, '风格'))), 500);
    await sleep(900);
    await moveTo(page, ...(await at(page, item(page, '换一种编排'))), 400);
    await sleep(500);
    await moveTo(page, ...(await at(page, item(page, '保存当前画面'))), 300);
    await sleep(400);
    await moveTo(page, ...(await at(page, item(page, '下载 MV…'))), 300);
    await sleep(900);
  },
  // The download sheet: portrait, the chorus, export; the progress on the waiting view, then the file saved.
  async export(page) {
    await page.evaluate(() => (window as any).overlay.closePanel());
    await sleep(500);
    await clickOn(page, '.bmv-stage', { right: true, fx: 0.42, fy: 0.42 });
    await sleep(500);
    await clickOn(page, item(page, '下载 MV…'));
    await sleep(900);
    await clickOn(page, button(page, '竖屏 9:16'));
    await sleep(600);
    await clickOn(page, button(page, '副歌'));
    await sleep(900);
    await clickOn(page, button(page, '导出'));
    await sleep(2600);
    // (The dev page's made-up download takes 12 s: its end comes sooner here.)
    await page.evaluate(() => { const o = (window as any).overlay; o.status(null); o.notice('MV 已保存', { sub: '示例歌曲 - 歌手甲', action: { label: '在文件夹中显示', run() {} }, hideAfter: 12000 }); });
    await sleep(2200);
  },
  // The gear: the MV page's settings (the song's own and the common ones), then the scenes with their sketches and the
  // OBS output.
  async settings(page) {
    await page.evaluate(() => (window as any).overlay.closePanel());
    await sleep(500);
    await clickOn(page, page.getByRole('button', { name: '设置' }));
    await sleep(1400);
    const nav = (text: string) => page.locator('.bmv-sheet .bmv-row.is-nav', { hasText: text }).first();
    const back = async () => { await clickOn(page, page.locator('.bmv-back:visible').first()); await sleep(800); };
    await clickOn(page, nav('场景'));
    await sleep(1000);
    // Over a few scenes: each shows its sketch.
    const tiles = page.locator('.bmv-tile:visible');
    for (const i of [0, 2, 5, 7]) { if (i < await tiles.count()) { await moveTo(page, ...(await at(page, tiles.nth(i))), 380); await sleep(750); } }
    await back();
    await clickOn(page, nav('直播'));
    await sleep(1600);
    await back();
    await sleep(500);
  },
  // The waiting view of a song played for the first time: reading, decoding, beats, analysis, the picture.
  async loading(page) {
    await page.evaluate(() => (window as any).overlay.closePanel());
    const steps: Array<[string, number, number]> = [['正在读取歌曲…', 0.03, 500], ['正在解码音频…', 0.08, 600], ['正在识别节拍…', 0.12, 900],
      ['正在分析节拍与段落…', 0.3, 500], ['正在分析节拍与段落…', 0.6, 500], ['正在分析节拍与段落…', 0.86, 500], ['正在准备画面…', 0.92, 700]];
    for (const [text, progress, ms] of steps) { await page.evaluate(([t, p]: [string, number]) => (window as any).overlay.status(t, { progress: p }), [text, progress]); await sleep(ms); }
    await page.evaluate(() => (window as any).overlay.status(null));
    await sleep(1800);
  },
};

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const runFF = (args: string[]) => { const r = Bun.spawnSync([FF, '-v', 'error', '-y', ...args]); if (r.exitCode) throw new Error(r.stderr.toString()); };

if (process.argv.includes('--sketches')) {
  // The MV page's two moments the open sketch cuts to, without a cursor: the waiting view mid-analysis, the MV.
  const shots = await browser.newPage({ viewport: { width: W, height: H } });
  await shots.goto(`${SERVER}/settings.html?mv&demo`);
  await shots.waitForFunction(() => (window as any).overlay);
  await Promise.all([shots.waitForLoadState('networkidle'), sleep(800)]);
  await shots.evaluate(() => { const o = (window as any).overlay; o.closePanel(); o.status('正在分析节拍与段落…', { progress: 0.45 }); });
  await sleep(700);
  await shots.screenshot({ path: path.join(BUILD, 'shot-loading.jpg'), type: 'jpeg', quality: 92 });
  await shots.evaluate(() => (window as any).overlay.status(null));
  await shots.mouse.move(W * 0.5, H * 0.5);
  await sleep(900);
  await shots.screenshot({ path: path.join(BUILD, 'shot-mv.jpg'), type: 'jpeg', quality: 92 });
  await shots.close();
  for (const [part, out] of [['install', 'install'], ['open', 'open']] as const) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
    await page.goto(`${SERVER}/film/readme.html?part=${part}`);
    await page.waitForFunction(() => (window as any).ready, null, { timeout: 60000 });
    const dur: number = await page.evaluate(() => (window as any).duration);
    const dir = path.join(BUILD, 'sketch-' + part);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // From the moment its window is up (a first frame of an empty ground is what a still preview of the GIF shows).
    const fps = 15, from = 0.6, n = Math.round((dur - from) * fps);
    for (let i = 0; i < n; i++) {
      await page.evaluate((t: number) => (window as any).renderAt(t), from + i / fps);
      await page.locator('#frame').screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.png`) });
    }
    await page.close();
    const gif = path.join(DOCS, `${out}.gif`);
    runFF(['-framerate', String(fps), '-i', path.join(dir, 'f%05d.png'), '-vf', 'scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif]);
    console.log(out, (fs.statSync(gif).size / 1e6).toFixed(1), 'MB', gif);
  }
  await browser.close();
  process.exit(0);
}
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FILMS);
for (const name of names) {
  const film = FILMS[name];
  if (!film) throw new Error('no film ' + name);
  const dir = path.join(BUILD, 'video-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
  await page.goto(`${SERVER}/settings.html?mv&demo`);
  await page.waitForFunction(() => (window as any).overlay);
  await Promise.all([page.waitForLoadState('networkidle'), sleep(800)]);
  mouse = [W * 0.62, H * 0.55];
  await page.mouse.move(...mouse);
  // (The dev page opens the play list: shut before the first frame, so a film opens on the MV page itself.)
  await page.evaluate(() => (window as any).overlay.closePanel());
  await sleep(500);
  // Frames as the page draws them, each with its time (a still page sends none: the last one is held).
  const cdp = await context.newCDPSession(page);
  const frames: Array<{ t: number; file: string }> = [];
  cdp.on('Page.screencastFrame', (f: any) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ t: f.metadata.timestamp, file });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await film(page);
  await sleep(200);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await context.close();
  if (!frames.length) throw new Error('no frames for ' + name);
  // An ffconcat list: each frame for as long as it stayed on the page.
  const list = frames.map((f, i) => `file '${path.basename(f.file)}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? (frames[0].t + (end - start))) - f.t).toFixed(4)}`);
  fs.writeFileSync(path.join(dir, 'list.txt'), `ffconcat version 1.0\n${list.join('\n')}\nfile '${path.basename(frames[frames.length - 1].file)}'\n`);
  const src = ['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt')];
  // 880 wide, 15 fps, one palette for the whole film, only the changed pixels each frame.
  const gif = path.join(DOCS, `ui-${name}.gif`);
  const run = (args: string[]) => { const r = Bun.spawnSync([FF, '-v', 'error', '-y', ...args]); if (r.exitCode) throw new Error(r.stderr.toString()); };
  run([...src, '-vf', 'fps=15,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif]);
  console.log(name, (fs.statSync(gif).size / 1e6).toFixed(1), 'MB', gif);
}
await browser.close();
