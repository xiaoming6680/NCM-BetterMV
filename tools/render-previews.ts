// Renders the settings page's scene sketches, public/previews/<scene>.webp (480×270): each plate on its own over the
// demo cover and made-up words (the harness's ?demo), in headless Edge against the frozen dev server (port 5191:
// `bunx vite --config vite.frozen.config.ts`). The song is only the timing — Clarity, from the NetEase cache.
//   bun tools/render-previews.ts [scene…]          the sketches
//   bun tools/render-previews.ts --try [scene…]    four candidate moments per scene, dev/stills/try-<scene>-<n>.png
import type { SceneId } from '../src/scenes/types.ts';
import type { SectionLabel } from '../src/types.ts';

// playwright-core is not a dependency here: borrowed from the NCM-BetterDownload checkout unless BMV_PLAYWRIGHT says otherwise.
const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');

const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const SERVER = 'http://localhost:5191';
const SONG = 3359522924;

/** Each plate: the style it is drawn in, its camera, the section to show it in and how far into it (picked with --try). */
const PLAN: Record<SceneId, { style: string; variants: string; in: SectionLabel; at: number }> = {
  drive: { style: 'pulse', variants: 'push', in: 'drop', at: 0.15 },
  tunnel: { style: 'pulse', variants: 'rush', in: 'build', at: 0.15 },
  rings: { style: 'pulse', variants: 'tilt', in: 'verse', at: 0.75 },
  ridges: { style: 'pulse', variants: 'front', in: 'verse', at: 0.75 },
  scope: { style: 'pulse', variants: 'wave', in: 'chorus', at: 0.15 },
  shatter: { style: 'pulse', variants: 'swarm-a', in: 'drop', at: 0.55 },
  flip: { style: 'pulse', variants: 'wave', in: 'chorus', at: 0.15 },
  align: { style: 'pulse', variants: 'swing', in: 'chorus', at: 0.55 },
  kaleido: { style: 'pulse', variants: 'petal', in: 'chorus', at: 0.55 },
  halftone: { style: 'pulse', variants: 'in', in: 'chorus', at: 0.35 },
  particles: { style: 'pulse', variants: 'burst', in: 'chorus', at: 0.35 },
  relief: { style: 'pulse', variants: 'crane', in: 'verse', at: 0.35 },
  diorama: { style: 'ballad', variants: 'drift', in: 'verse', at: 0.55 },
  bokeh: { style: 'ballad', variants: 'focus', in: 'chorus', at: 0.15 },
  ink: { style: 'ink', variants: 'scroll', in: 'verse', at: 0.35 },
  poster: { style: 'pulse', variants: 'stack', in: 'chorus', at: 0.15 },
  typewall: { style: 'word', variants: 'stack', in: 'chorus', at: 0.35 },
  cards: { style: 'pulse', variants: 'stack', in: 'intro', at: 0.35 },
  crystal: { style: 'pulse', variants: 'orbit', in: 'build', at: 0.35 },
  subdivide: { style: 'pulse', variants: 'ball', in: 'verse', at: 0.55 },
  debug: { style: 'pulse', variants: 'orbit', in: 'chorus', at: 0.15 },
};

const args = process.argv.slice(2);
const trying = args.includes('--try');
const only = args.filter(a => !a.startsWith('--')) as SceneId[];
const scenes = (only.length ? only : Object.keys(PLAN)) as SceneId[];

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));

/** Song time t, after a second of run-up (trails and eases settle), as raw RGBA rows bottom-up. */
async function frame(t: number): Promise<{ w: number; h: number; px: Buffer }> {
  const [w, h, b64] = await page.evaluate((t: number) => {
    const b = (window as any).bmv;
    for (let i = 60; i >= 1; i--) b.renderAt(t - i / 60);
    b.renderAt(t);
    const gl = b.player.engine.renderer.getContext(), c = gl.canvas;
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000) as unknown as number[]);
    return [c.width, c.height, btoa(s)] as [number, number, string];
  }, t);
  return { w, h, px: Buffer.from(b64, 'base64') };
}

async function encode(f: { w: number; h: number; px: Buffer }, out: string, filter: string, codec: string[]): Promise<void> {
  const ff = Bun.spawn([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${f.w}x${f.h}`, '-i', 'pipe:0',
    '-vf', `vflip,${filter}`, '-frames:v', '1', ...codec, out], { stdin: 'pipe', stderr: 'inherit' });
  ff.stdin.write(f.px);
  ff.stdin.end();
  if (await ff.exited) throw new Error('ffmpeg failed on ' + out);
}

for (const id of scenes) {
  const p = PLAN[id];
  await page.goto(`${SERVER}/?id=${SONG}&demo&style=${p.style}&plate=${id}&variants=${p.variants}`);
  await page.waitForFunction(() => (window as any).bmv?.player?.director, null, { timeout: 240000 });
  // (The HUD off takes the crystal badge with it: the sketch is the plate alone.)
  await page.evaluate(() => { const b = (window as any).bmv; b.audio.pause(); b.player.hud.visible = false; b.player.resize(); });
  const [from, to] = await page.evaluate((label: string) => {
    const s = (window as any).bmv.analysis.sections as Array<{ label: string; start: number; end: number }>;
    const hit = s.find(x => x.label === label) ?? s.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    return [hit.start, hit.end];
  }, p.in);
  const times = trying ? [0.15, 0.35, 0.55, 0.75] : [p.at];
  for (const [n, k] of times.entries()) {
    const t = from + (to - from) * k;
    const f = await frame(t);
    if (trying) await encode(f, `dev/stills/try-${id}-${n}.png`, 'scale=640:360', []);
    else await encode(f, `public/previews/${id}.webp`, 'scale=480:270:flags=lanczos', ['-c:v', 'libwebp', '-quality', '80']);
    console.log(id, t.toFixed(2));
  }
}
await browser.close();
