// The GPU half of the bench without NetEase: the dev harness in headless Edge (ANGLE D3D11, as in the client), each
// plate drawn frame by frame and timed on the GPU (tools/bench/inpage.ts drive). Frame pacing and the page's own
// thread are not measured here (headless Edge throttles animation frames): those need the client (tools/bench/run.ts)
// — except for what holds the page's thread up while a song is switched to (switch).
// Starts its own frozen dev server on port 5195 and stops it at the end.
//   bunx vite build --config tools/bench/vite.config.ts
//   bun tools/bench/headless.ts <suite> [--id 1332041346] [--at 41] [--frames 240] [--size 1209x784@1.5] [--root <copy>]
// Suites: scenes, passes, styles, res (GPU time per plate / pass / style / pixel ratio); stills (PNG frames for an A/B,
// --plan <style> for a style's own plan, then tools/bench/diff.py); spikes (the slowest frames of a minute of each
// style, and programs compiled during play); profile (CPU profile of a stretch); programs (D3D compiler warnings);
// soak, resize, long, leaks, recheck (what reloading, resizing and long play leave behind); switch (long tasks while
// other songs are prepared and put on as the plugin does it, --songs a,b, --cpu for where their time went).
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { SCENE_GROUPS } from '../../src/scenes/catalog.ts';

const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');
const root = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const suite = argv[0] ?? 'scenes';
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = opt('id', '1332041346');
const AT = Number(opt('at', '41'));
const FRAMES = Number(opt('frames', '240'));
const [size, dsf] = opt('size', '1209x784@1.5').split('@');
const [W, H] = size.split('x').map(Number);
const only = opt('only', '').split(',').filter(Boolean);
const out = path.resolve(root, opt('out', `dev/bench/headless-${suite}.json`));
const PORT = 5195;
// (--root: serve another checkout of the project, e.g. an export of HEAD for an A/B; the bench itself stays this one's.)
const site = path.resolve(opt('root', root));

/**
 * In the dev page (suite switch): song `id` read from the NetEase cache, prepared at full speed and put on the player
 * as the plugin does when the song changes, then a second of the MV. Its frames are drawn when the plugin's loop
 * would: from the load on (it only skips a song NetEase is still switching to), or, in a version with loadInSlices,
 * once it is warmed. Marks in ms from when its files were read.
 */
async function switchTo(id: string) {
  const load = (p: string) => import(p);
  const [P, W, S] = await Promise.all([load('/src/app/prepare.ts'), load('/src/meta/wiki.ts'), load('/src/plugin/source.ts')]);
  const player = (window as any).bmv.player;
  let drawing = false;
  const own = Object.getPrototypeOf(player).frame;
  player.frame = (t: number, dt: number) => (drawing ? own.call(player, t, dt) : null);
  const long: number[][] = [], ticks: number[] = [];
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push([e.startTime, e.duration]); });
  po.observe({ type: 'longtask' });
  let on = true;
  const tick = () => { ticks.push(performance.now()); if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // (A busy stretch the CPU profile is lined up by.)
  function bmvClockMarker() { const t = performance.now(); while (performance.now() - t < 6) { /* spin */ } return t; }
  const marker = bmvClockMarker();
  const json = (url: string) => fetch(url).then(r => r.json()).catch(() => null);
  const image = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
  const [detail, wiki, chorus, lyric, audio, cover] = await Promise.all([
    json(`/ncm/detail/${id}`), json(`/ncm/wiki/${id}`), json(`/ncm/chorus/${id}`), json(`/ncm/lyric/${id}`),
    fetch(`/ncm/audio/${id}`).then(r => r.arrayBuffer()), image(`/ncm/cover/${id}`),
  ]);
  const t0 = performance.now(), marks: Record<string, number> = {};
  const song = await P.prepareSong(
    { id: Number(id), name: detail?.name, artists: detail?.artists, audio, lyric, wiki: wiki ? W.parseWiki(wiki) : undefined, chorus: S.parseChorus(chorus, Number(id)), cover },
    { pause: P.yieldToPage },
  );
  marks.prepared = performance.now() - t0;
  const style = P.styleFor(song, 'auto'), sliced = typeof player.loadInSlices === 'function';
  if (sliced) await player.loadInSlices(P.yieldToPage, () => false, song, style, new Set(), 0, 7);
  else player.load(song, style, new Set(), undefined, undefined, 0, 7);
  marks.built = performance.now() - t0;
  drawing = !sliced;
  await player.warm(P.yieldToPage);
  marks.warmed = performance.now() - t0;
  drawing = true;
  await new Promise(r => setTimeout(r, 1000));
  on = false;
  po.disconnect();
  delete player.frame;
  const gaps = ticks.slice(1).map((t, i) => [ticks[i] - t0, t - ticks[i]]).filter(([, g]) => g > 50);
  return { name: detail?.name ?? id, style: style.id, plates: Object.keys(player.scenes).length, t0, marker, marks, long: long.filter(([a]) => a >= t0), gaps };
}

const server = await createServer({ root: site, configFile: path.join(site, 'vite.frozen.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=user-gesture-required'],
});
const results: any[] = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(dsf ?? 1) });
  page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/?id=${ID}&style=pulse&seed=7`);
  await page.waitForFunction(() => (window as any).bmv?.player?.director, null, { timeout: 240000 });
  await page.evaluate(() => { const b = (window as any).bmv; b.audio.pause(); b.audio.muted = true; b.player.hud.visible = false; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'dist/bench/inpage.js'), 'utf8') });
  const env = await page.evaluate(() => {
    const gl = (window as any).bmv.player.engine.renderer.getContext() as WebGL2RenderingContext;
    const info = gl.getExtension('WEBGL_debug_renderer_info') as any;
    return { gpu: gl.getParameter(info.UNMASKED_RENDERER_WEBGL), ua: navigator.userAgent, timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), dpr: devicePixelRatio };
  });
  console.log(env);
  const report = () => fs.writeFileSync(out, JSON.stringify({ suite, host: 'edge-headless', site, at: AT, frames: FRAMES, env, results }, null, 1));
  const drive = async (o: Record<string, unknown>) => {
    const r = await page.evaluate((o: any) => (window as any).__bmvBench.drive(o), { at: AT, frames: FRAMES, ...o });
    r.mode = o.mode ?? 'total';
    r.pr = o.pr;
    results.push(r);
    report();
    const p = Object.keys(r.passes).length ? ' ' + Object.entries(r.passes).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    console.log(`${String(r.scene).padEnd(10)} ${r.style.padEnd(6)} look=${String(r.look).padEnd(5)} lens=${r.lens} film=${r.film} bloom=${r.bloom ? 1 : 0} ${r.canvas.join('x')}  gpu=${r.gpu.p50}/${r.gpu.p95}/${r.gpu.max} n=${r.gpu.n}${p}${r.disjoint ? ' DISJOINT' : ''}`);
  };
  const STYLES = ['pulse', 'ballad', 'word', 'ink'];
  const scenes = SCENE_GROUPS.flatMap(g => g.scenes.map(s => s.id)).filter(id => !only.length || only.includes(id));
  if (suite === 'scenes' || suite === 'passes') {
    const owner = new Map<string, string>();
    for (const style of STYLES) for (const seed of [7, 11, 23, 42]) {
      const plates = await page.evaluate(([s, seed]: [string, number]) => (window as any).__bmvBench.plates(s, seed), [style, seed] as [string, number]);
      for (const id of Object.keys(plates)) if (!owner.has(id)) owner.set(id, style);
    }
    for (const scene of scenes) {
      const style = owner.get(scene) ?? 'pulse';
      if (suite === 'passes') await drive({ scene, style, mode: 'passes' });
      else { await drive({ scene, style }); await drive({ scene, style, lens: 0, film: 0 }); }
    }
  } else if (suite === 'styles') {
    for (const style of STYLES) { await drive({ style, look: 'none', frames: FRAMES * 3 }); await drive({ style, frames: FRAMES * 3 }); }
    // (A forced look covers every section but the drops: measured in the first verse.)
    for (const look of ['none', 'riso', 'hibit', 'ascii', 'vhs']) await drive({ style: 'pulse', look, at: Number(opt('verse', '12')), frames: FRAMES * 2 });
  } else if (suite === 'res') {
    for (const style of ['pulse', 'ballad']) for (const pr of [1.5, 1.25, 1, 0.85, 0.7]) await drive({ style, pr, frames: FRAMES * 2 });
    await drive({ style: 'ballad', pr: 0.7, lens: 0, frames: FRAMES * 2 });
    await drive({ style: 'pulse', lens: 0, film: 0, frames: FRAMES * 2 });
    await drive({ style: 'pulse', bloom: false, frames: FRAMES * 2 });
  } else if (['soak', 'resize', 'long'].includes(suite)) {
    // Stability: what is left behind (JS heap, three's geometries, textures, programs) and what the frames cost —
    // soak: the plan built and torn down again and again (each style in turn, a new seed, a new stretch of the song;
    // what switching songs does to the player); resize: the window at other sizes; long: minutes of play on one plan.
    const mem = () => page.evaluate(() => (window as any).__bmvBench.mem());
    const line = (label: string, r: any, m: any) => {
      results.push({ ...r, label, mem: m });
      report();
      console.log(`${label.padEnd(16)} ${r.canvas.join('x').padEnd(10)} gpu=${r.gpu.p50}/${r.gpu.p95}/${r.gpu.max} cpu=${r.cpu.p50}/${r.cpu.p95}/${r.cpu.max} heap=${m.heapMB}MB geo=${m.geometries} tex=${m.textures} prog=${m.programs}`);
    };
    const run = (o: Record<string, unknown>) => page.evaluate((o: any) => (window as any).__bmvBench.drive(o), { at: AT, frames: FRAMES, ...o });
    if (suite === 'soak') {
      const cycles = Number(opt('cycles', '24'));
      for (let i = 0; i < cycles; i++) {
        const style = STYLES[i % 4];
        line(`load ${i + 1} ${style}`, await run({ style, seed: 100 + i, at: 10 + ((i * 23) % 150), frames: 600 }), await mem());
      }
    } else if (suite === 'resize') {
      await run({ style: 'pulse', frames: 10 });
      for (const [w, h] of [[1209, 784], [1600, 900], [800, 600], [1920, 1080], [600, 900], [1280, 720], [1209, 784]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(400);
        line(`${w}x${h}@${dsf ?? 1}`, await run({ style: 'pulse', frames: 360, keep: true }), await mem());
      }
    } else {
      await run({ style: opt('style', 'pulse'), frames: 10 });
      const minutes = Number(opt('minutes', '10'));
      for (let k = 0; k < minutes; k++) line(`minute ${k + 1}`, await run({ style: 'pulse', at: 5 + ((k * 60) % 180), frames: 3600, keep: true }), await mem());
    }
  } else if (suite === 'recheck') {
    // Tearing plans down must not spoil the next ones: the same frames of each style's plan, fresh and again after
    // every other style has been loaded and dropped, into --dir/first and --dir/again.
    const dir = path.resolve(root, opt('dir', 'dev/bench/stills/recheck'));
    const ts = opt('ts', '26.3,44.2,52.6,61.1').split(',').map(Number);
    const shoot = async (sub: string) => {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
      for (const style of opt('styles', STYLES.join(',')).split(',')) {
        const urls: string[] = await page.evaluate((o: any) => (window as any).__bmvBench.capture(o), { style, ts });
        urls.forEach((u, i) => fs.writeFileSync(path.join(dir, sub, `${style}-${ts[i]}.png`), Buffer.from(u.split(',')[1], 'base64')));
      }
    };
    await shoot('first');
    for (let i = 0; i < 8; i++) await page.evaluate((o: any) => (window as any).__bmvBench.drive(o), { style: STYLES[i % 4], seed: 300 + i, at: 20 + i * 13, frames: 120 });
    await shoot('again');
    console.log('stills in', path.relative(root, dir));
  } else if (suite === 'leaks') {
    // What reloading leaves behind: resources still held after 4 and after 8 more loads (each style in turn); a group
    // that grows between the two is a leak.
    const run = (o: Record<string, unknown>) => page.evaluate((o: any) => (window as any).__bmvBench.drive(o), { at: AT, frames: 300, ...o });
    await run({ style: 'pulse' });
    console.log(await page.evaluate(() => (window as any).__bmvBench.track()));
    const snap = async () => page.evaluate(() => (window as any).__bmvBench.leaks(40));
    for (let i = 0; i < 4; i++) await run({ style: STYLES[i % 4], seed: 200 + i, at: 10 + i * 31 });
    const a = await snap();
    for (let i = 4; i < 8; i++) await run({ style: STYLES[i % 4], seed: 200 + i, at: 10 + i * 31 });
    const b = await snap();
    const before = new Map<string, number>(a.top);
    console.log(`held: ${a.total} after 4 loads, ${b.total} after 8`);
    for (const [k, n] of b.top as Array<[string, number]>) if (n > (before.get(k) ?? 0)) console.log(`  +${n - (before.get(k) ?? 0)} (${before.get(k) ?? 0} → ${n})  ${k}`);
    results.push({ a, b });
    report();
  } else if (suite === 'profile') {
    // CPU profile of a stretch of a style's plan (--style, --from, --frames): the functions that took the most time.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    const style = opt('style', 'pulse'), from = Number(opt('from', '26'));
    // (Loaded and warmed first, outside the profile.)
    await drive({ style, at: from - 30, frames: 2 });
    await cdp.send('Profiler.start');
    await drive({ style, at: from, frames: FRAMES, keep: true });
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map<string, number>(), dt = new Map<number, number>();
    profile.samples.forEach((id: number, i: number) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
    for (const [id, us] of dt) {
      const n: any = byId.get(id), f = n.callFrame;
      const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
      self.set(k, (self.get(k) ?? 0) + us / 1000);
    }
    for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${k}`);
    // Who calls the heaviest native functions (--who getImageData,getProgramInfoLog).
    const parent = new Map<number, number>();
    for (const n of profile.nodes as any[]) for (const c of n.children ?? []) parent.set(c, n.id);
    for (const name of opt('who', 'getImageData,getProgramInfoLog').split(',')) {
      const stacks = new Map<string, number>();
      for (const [id, us] of dt) {
        const n: any = byId.get(id);
        if (n.callFrame.functionName !== name) continue;
        const chain: string[] = [];
        for (let p = parent.get(id); p && chain.length < 7; p = parent.get(p)) { const f = (byId.get(p) as any).callFrame; chain.push(`${f.functionName || '(anon)'}:${f.url.replace(/^.*[/]src[/]/, '').replace(/[?].*$/, '').replace(/^.*[/]deps[/].*$/, 'three')}:${f.lineNumber + 1}`); }
        const k = chain.join(' < ');
        stacks.set(k, (stacks.get(k) ?? 0) + us / 1000);
      }
      for (const [k, ms] of [...stacks].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`  ${name} ${ms.toFixed(1)} ms ← ${k}`);
    }
  } else if (suite === 'spikes') {
    // The slowest frames of each style's own plan over a minute of the song, with what each pass took.
    for (const style of STYLES) {
      await drive({ style, mode: 'passes', at: Number(opt('from', '8')), frames: FRAMES * 15 });
      for (const f of results[results.length - 1].slow) console.log('   ', JSON.stringify(f));
      for (const l of results[results.length - 1].late) console.log('    late program:', l);
    }
  } else if (suite === 'programs') {
    // Which plates' shaders draw D3D compiler warnings (each plate loaded and drawn a few frames).
    const seen = new Set<string>();
    for (const scene of scenes) {
      await page.evaluate((o: any) => (window as any).__bmvBench.drive(o), { scene, style: 'pulse', at: AT, frames: 3 });
      const list: any[] = await page.evaluate(() => (window as any).__bmvBench.programs());
      for (const x of list) {
        const k = x.where.replace(/ \(offscreen\)/, '') + x.frag;
        if (seen.has(k)) continue;
        seen.add(k);
        results.push(x);
        console.log(`${x.where.padEnd(22)} ${x.warn.padEnd(18)} ${x.frag.slice(0, 110)}`);
      }
    }
    report();
  } else if (suite === 'stills') {
    // Frames for an A/B (PNG, the canvas as drawn): every plate (or --only) at three moments, into --dir.
    const dir = path.resolve(root, opt('dir', 'dev/bench/stills/headless'));
    fs.mkdirSync(dir, { recursive: true });
    const ts = opt('ts', `${AT + 1},${AT + 3.3},${AT + 7.7}`).split(',').map(Number);
    const owner = new Map<string, string>();
    for (const style of STYLES) for (const seed of [7, 11, 23, 42]) {
      const plates = await page.evaluate(([s, seed]: [string, number]) => (window as any).__bmvBench.plates(s, seed), [style, seed] as [string, number]);
      for (const id of Object.keys(plates)) if (!owner.has(id)) owner.set(id, style);
    }
    // (--plan <style>: the style's own plan instead of one plate at a time, so cuts, transitions and looks come up.)
    const plan = opt('plan', '');
    for (const scene of plan ? ['auto'] : scenes) {
      const o = { scene: scene === 'auto' ? undefined : scene, style: plan || opt('style', '') || owner.get(scene) || 'pulse', ts,
        pr: opt('pr', '') ? Number(opt('pr', '')) : undefined, lens: Number(opt('lens', '1')) };
      const urls: string[] = await page.evaluate((o: any) => (window as any).__bmvBench.capture(o), o);
      urls.forEach((u, i) => fs.writeFileSync(path.join(dir, `${plan ? plan : scene}-${ts[i]}.png`), Buffer.from(u.split(',')[1], 'base64')));
      console.log(scene, urls.length);
    }
  } else if (suite === 'switch') {
    // Switching songs the plugin's way, into other songs of the NetEase cache (--songs a,b; else the first three):
    // prepareSong at full speed, the plates built (loadInSlices where the code has it), warmed, the new song's frames
    // drawn when the plugin's loop would draw them. The page's long tasks and animation-frame gaps per switch; --cpu
    // adds what the longest tasks spent their time on (a CPU profile cut to each).
    const cpu = argv.includes('--cpu');
    const cdp = await page.context().newCDPSession(page);
    if (cpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); }
    const list: string[] = await page.evaluate(() => fetch('/ncm/list').then(r => r.json()));
    const songs = opt('songs', '').split(',').filter(Boolean);
    for (const id of songs.length ? songs : list.filter(x => x !== ID).slice(0, 3)) {
      if (cpu) await cdp.send('Profiler.start');
      const r = await page.evaluate(switchTo, id);
      const ms = (k: string) => Math.round(r.marks[k]);
      console.log(`${r.name} (${id}) ${r.style}, ${r.plates} plates: prepared ${ms('prepared')}  built ${ms('built')}  warmed ${ms('warmed')} ms after reading`);
      console.log(`  longest frame gap ${Math.round(Math.max(0, ...r.gaps.map((g: number[]) => g[1])))} ms; long tasks ${r.long.map(([a, d]: number[]) => `${Math.round(d)}@${Math.round(a - r.t0)}`).join(' ') || 'none'}`);
      results.push({ id, ...r });
      report();
      if (!cpu) continue;
      const { profile } = await cdp.send('Profiler.stop');
      // (Sample times, on the profiler's clock, lined up with the page's by the marker's samples.)
      const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
      const parent = new Map<number, number>();
      for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const stack = (id: number) => { const s: any[] = []; for (let p: number | undefined = id; p; p = parent.get(p)) s.push(byId.get(p).callFrame); return s; };
      const times: number[] = [];
      let t = profile.startTime;
      for (const d of profile.timeDeltas) times.push((t += d) / 1000);
      const at = profile.samples.findIndex((s: number) => stack(s).some((f: any) => f.functionName === 'bmvClockMarker'));
      if (at < 0) { console.log('  (no marker in the profile)'); continue; }
      const offset = times[at] - r.marker;
      const where = (f: any) => `${f.functionName || '(anon)'} ${String(f.url).replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\/.*$/, 'three').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
      for (const [a, d] of [...r.long].sort((x: number[], y: number[]) => y[1] - x[1]).slice(0, 3)) {
        const incl = new Map<string, number>();
        profile.samples.forEach((s: number, i: number) => {
          if (times[i] - offset < a || times[i] - offset > a + d) return;
          for (const k of new Set(stack(s).map(where))) incl.set(k, (incl.get(k) ?? 0) + (profile.timeDeltas[i + 1] ?? 250) / 1000);
        });
        console.log(`  ${Math.round(d)} ms @${Math.round(a - r.t0)}:`);
        for (const [k, v] of [...incl].filter(([k]) => !/^\((root|program)\)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`    ${v.toFixed(1).padStart(6)} ${k}`);
      }
    }
  } else throw new Error(`unknown suite ${suite}`);
  console.log(`→ ${path.relative(root, out)}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
