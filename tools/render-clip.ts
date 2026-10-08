// Sample clips and stills of the dev harness, in headless Edge against the frozen dev server (port 5191, or BMV_SERVER:
// `bunx vite --config vite.frozen.config.ts`), with the song's audio from the NetEase cache.
//   bun tools/render-clip.ts "<query>" <from> <to> <out.mp4> [--fps 30] [--size 1280x720]
//   bun tools/render-clip.ts "<query>" --stills <t1,t2,…> <out-prefix>        PNGs <out-prefix>-<t>.png
// <query> is the harness's (id=…&style=…&look=…&plate=…); times are song seconds, or sN.F for N.F seconds into the
// first section labelled N… (e.g. "chorus+4" is four seconds into the first chorus).
const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');

const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const SERVER = process.env.BMV_SERVER ?? 'http://localhost:5191';

const args = process.argv.slice(2);
const flag = (name: string, def: string) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const fps = Number(flag('--fps', '30'));
const [W, H] = flag('--size', '1280x720').split('x').map(Number);
const stills = flag('--stills', '');
const query = args[0];

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
page.on('console', (m: any) => { if (m.type() === 'error') console.error('[console]', m.text()); });
await page.goto(`${SERVER}/?${query}`);
await page.waitForFunction(() => (window as any).bmv?.player?.director, null, { timeout: 240000 });
await page.evaluate(() => { const b = (window as any).bmv; b.audio.pause(); b.player.hud.visible = false; b.player.resize(); });
const songId = await page.evaluate(() => (window as any).bmv.song.id as number);
const sections: Array<[string, number, number]> = await page.evaluate(() => (window as any).bmv.analysis.sections.map((s: any) => [s.label, s.start, s.end]));

/** "93.5", or "chorus+4" / "chorus2+4" (the n-th section with that label). */
function when(s: string): number {
  const m = s.match(/^([a-z]+)(\d*)([+-][\d.]+)?$/);
  if (!m) return Number(s);
  const hits = sections.filter(x => x[0] === m[1]);
  const hit = hits[Math.max(0, (Number(m[2]) || 1) - 1)];
  if (!hit) throw new Error(`no section ${m[1]}${m[2]} (${sections.map(x => x[0]).join(' ')})`);
  return hit[1] + Number(m[3] ?? 0);
}

async function grab(t: number, runup: number): Promise<Buffer> {
  const b64 = await page.evaluate(([t, runup]: [number, number]) => {
    const b = (window as any).bmv;
    for (let i = runup; i >= 1; i--) b.renderAt(t - i / 60);
    b.renderAt(t);
    const gl = b.player.engine.renderer.getContext(), c = gl.canvas;
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000) as unknown as number[]);
    return btoa(s);
  }, [t, runup]);
  return Buffer.from(b64, 'base64');
}

if (stills) {
  const prefix = args[1];
  for (const s of stills.split(',')) {
    const t = when(s);
    const px = await grab(t, 40);
    const ff = Bun.spawn([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-vf', 'vflip', '-frames:v', '1', `${prefix}-${s}.png`], { stdin: 'pipe' });
    ff.stdin.write(px); ff.stdin.end(); await ff.exited;
    console.log(s, t.toFixed(2));
  }
} else {
  const from = when(args[1]), to = when(args[2]), out = args[3];
  const audio = await fetch(`${SERVER}/ncm/audio/${songId}`).then(r => r.arrayBuffer());
  const tmp = `${out}.audio`;
  await Bun.write(tmp, audio);
  const ff = Bun.spawn([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
    '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', tmp, '-vf', 'vflip', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdin: 'pipe', stderr: 'inherit' });
  const n = Math.round((to - from) * fps);
  // Frames rendered at 60 Hz between output frames, so trails and eases run as they do live.
  const sub = Math.max(1, Math.round(60 / fps));
  await grab(from, 40);
  for (let i = 0; i < n; i++) {
    const t = from + i / fps;
    const px = await grab(t, i ? sub - 1 : 0);
    ff.stdin.write(px);
    if (i % 60 === 0) console.log(`${i}/${n}`);
  }
  ff.stdin.end();
  await ff.exited;
  await Bun.file(tmp).delete?.();
  try { (await import('node:fs')).unlinkSync(tmp); } catch {}
  console.log('wrote', out);
}
await browser.close();
