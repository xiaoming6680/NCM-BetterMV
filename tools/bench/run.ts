// Frame-time bench in the real client: drives tools/bench/inpage.ts inside NetEase Cloud Music over CDP and samples the
// processes' CPU and the GPU's 3D engine (typeperf) alongside. NetEase must run with --remote-debugging-port=9222 and
// BetterMV loaded; its window is brought to the front (a hidden window draws nothing).
//   bunx vite build --config tools/bench/vite.config.ts
//   bun tools/bench/run.ts <suite> [--out dev/bench/name.json] [--at 41] [--seconds 4] [--mode total|cpu] [--resume]
// Suites: scenes (every plate, post on / off), passes (per-pass GPU time of every plate), styles (each style's own
// plan, each look), res (quality steps and a maximized window), cap60 (60 fps cap: CPU and GPU load), stills (frames
// for an A/B), and the plugin as it plays by itself: long (list loop, --seconds), switch (six skips), resize
// (maximize / restore), background (minimized for 20 s). Page errors and the machine's free commit are logged too.
// The page reloads whenever plugins_dev changes (BetterNCM): runs are retried, and --resume skips the ones done.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SCENE_GROUPS } from '../../src/scenes/catalog.ts';

const root = path.resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const suite = argv[0] ?? 'scenes';
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const AT = Number(opt('at', '41'));
const SECONDS = Number(opt('seconds', '4'));
const out = path.resolve(root, opt('out', `dev/bench/${suite}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`));
const only = opt('only', '').split(',').filter(Boolean);

// ---- CDP ----
let ws: WebSocket | null = null;
/** Errors the page reported while the suite ran. */
const problems: string[] = [];
let seq = 0;
const waiting = new Map<number, (m: any) => void>();
async function connect(): Promise<void> {
  ws?.close();
  const list = await (await fetch('http://127.0.0.1:9222/json')).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = list.find(p => p.type === 'page' && p.url.includes('app.html'));
  if (!page) throw new Error('NetEase page not found on :9222');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws!.addEventListener('open', res, { once: true }); ws!.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(String(ev.data));
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); return; }
    // The page's own errors meanwhile: uncaught exceptions, console.error, the browser's error log.
    const at = new Date().toISOString().slice(11, 19);
    if (m.method === 'Runtime.exceptionThrown') problems.push(`${at} exception ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.slice(0, 400));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`${at} console.error ${m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`${at} log ${m.params.entry.source} ${m.params.entry.text} ${m.params.entry.url ?? ''}`.slice(0, 400));
  });
  for (const method of ['Runtime.enable', 'Log.enable']) ws.send(JSON.stringify({ id: ++seq, method }));
}
async function evaluate<T = any>(expression: string, timeoutS = 120): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) await connect();
  const id = ++seq;
  const m = await new Promise<any>((res, rej) => {
    const timer = setTimeout(() => { waiting.delete(id); rej(new Error(`timeout: ${expression.slice(0, 80)}`)); }, timeoutS * 1000);
    waiting.set(id, v => { clearTimeout(timer); res(v); });
    ws!.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value as T;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const windowCmd = (action: string) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'window.ps1'), action], { encoding: 'utf8' }).stdout.trim();

/** The bench injected, the MV open and drawing, the window in front; again after a reload or a restart. */
async function ensure(): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ok = await evaluate<boolean>('!!(window.__bmvBench && window.__betterMv?.player?.song && !document.hidden)', 10);
      if (ok) return null;
      if (await evaluate<boolean>('document.hidden', 10)) { windowCmd('front'); await sleep(800); }
      if (!await evaluate<boolean>('!!window.__bmvBench', 10)) await evaluate(fs.readFileSync(path.join(root, 'dist/bench/inpage.js'), 'utf8'), 30);
      await evaluate('__bmvBench.state()', 30);
      await evaluate('(__bmvBench.volume(0), __bmvBench.playMode("playOneCycle"), __bmvBench.play(true))', 10);
      return await evaluate('__bmvBench.init()', 180);
    } catch (e) {
      console.error('ensure:', (e as Error).message);
      await sleep(3000);
      try { await connect(); } catch { /* not up yet */ }
    }
  }
  throw new Error('could not get the bench running in NetEase');
}

// ---- counters ----
interface Sample { at: number; cpuTotal: number; ncm: Map<number, number>; gpu: Map<number, number>; gpuMem: Map<number, number>; commitFree: number }
function startCounters(file: string): () => Promise<Sample[]> {
  const tp = spawn('typeperf', ['\\Processor(_Total)\\% Processor Time', '\\Process(cloudmusic*)\\% Processor Time', '\\Process(cloudmusic*)\\ID Process',
    '\\GPU Engine(*engtype_3D)\\Utilization Percentage', '\\GPU Process Memory(*)\\Dedicated Usage', '\\Memory\\Committed Bytes', '\\Memory\\Commit Limit', '-si', '1', '-f', 'CSV', '-o', file, '-y'], { stdio: 'ignore' });
  return async () => {
    await sleep(1500);
    tp.kill();
    await sleep(300);
    return readCounters(file);
  };
}

function readCounters(file: string): Sample[] {
    if (!fs.existsSync(file)) return [];
    const rows = fs.readFileSync(file, 'latin1').trim().split(/\r?\n/).map(l => l.slice(1, -1).split('","'));
    const head = rows[0];
    const out: Sample[] = [];
    for (const r of rows.slice(1)) {
      const [d, t] = r[0].split(' ');
      const [mo, da, yr] = d.split('/').map(Number);
      const [hh, mm, ss] = t.split(':');
      const at = new Date(yr, mo - 1, da, Number(hh), Number(mm), Number(ss)).getTime();
      const s: Sample = { at, cpuTotal: Number(r[1]), ncm: new Map(), gpu: new Map(), gpuMem: new Map(), commitFree: NaN };
      const cpuOf = new Map<string, number>(), pidOf = new Map<string, number>();
      let committed = NaN, limit = NaN;
      head.forEach((h, i) => {
        const v = Number(r[i]);
        if (!Number.isFinite(v)) return;
        if (h.endsWith('\\Memory\\Committed Bytes')) committed = v;
        if (h.endsWith('\\Memory\\Commit Limit')) limit = v;
        let m = /Process\((cloudmusic(?:#\d+)?)\)\\% Processor Time/.exec(h);
        if (m) cpuOf.set(m[1], v);
        m = /Process\((cloudmusic(?:#\d+)?)\)\\ID Process/.exec(h);
        if (m) pidOf.set(m[1], v);
        m = /GPU Engine\(pid_(\d+)_/.exec(h);
        if (m) s.gpu.set(Number(m[1]), (s.gpu.get(Number(m[1])) ?? 0) + v);
        m = /GPU Process Memory\(pid_(\d+)_/.exec(h);
        if (m) s.gpuMem.set(Number(m[1]), (s.gpuMem.get(Number(m[1])) ?? 0) + v);
      });
      s.commitFree = (limit - committed) / 2 ** 30;
      for (const [name, pid] of pidOf) if (cpuOf.has(name)) s.ncm.set(pid, cpuOf.get(name)!);
      out.push(s);
    }
    return out;
}

function ncmPids(): Record<string, number> {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='cloudmusic.exe'\" | ForEach-Object { $t = if ($_.CommandLine -match '--type=([\\w-]+)') { $Matches[1] } else { 'browser' }; \"$($_.ProcessId) $t\" }"], { encoding: 'utf8' });
  const out: Record<string, number> = {};
  for (const l of r.stdout.trim().split(/\r?\n/)) { const [pid, type] = l.trim().split(' '); if (type && !(type in out)) out[type] = Number(pid); }
  return out;
}

/** Mean load over a run: NetEase's CPU (% of one core, all its processes), the 3D engine for its GPU process and for the rest. */
function load(samples: Sample[], t0: number, t1: number, pids: Record<string, number>) {
  const s = samples.filter(x => x.at >= t0 + 500 && x.at <= t1 + 500);
  if (!s.length) return null;
  const mean = (f: (x: Sample) => number) => Math.round(s.reduce((a, x) => a + f(x), 0) / s.length * 10) / 10;
  const gp = pids['gpu-process'];
  return {
    n: s.length,
    ncmCpu: mean(x => [...x.ncm.values()].reduce((a, b) => a + b, 0)),
    renderer: mean(x => x.ncm.get(pids.renderer) ?? 0),
    gpuProc: mean(x => x.ncm.get(gp) ?? 0),
    gpu3d: mean(x => x.gpu.get(gp) ?? 0),
    others3d: mean(x => [...x.gpu.entries()].filter(([p]) => p !== gp).reduce((a, [, v]) => a + v, 0)),
    sysCpu: mean(x => x.cpuTotal),
    gpuMemMB: Math.round(Math.max(...s.map(x => x.gpuMem.get(gp) ?? 0)) / 1048576),
    /** The least free commit (GB) the machine had meanwhile: a crash when it ran out is not the plugin's doing. */
    commitFreeGB: Math.round(Math.min(...s.map(x => x.commitFree)) * 10) / 10,
  };
}

// ---- suites ----
const SCENES = SCENE_GROUPS.flatMap(g => g.scenes.map(s => s.id)).filter(id => !only.length || only.includes(id));
const STYLE_IDS = ['pulse', 'ballad', 'word', 'ink'] as const;

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const env = await ensure() ?? await evaluate('__bmvBench.init()', 180);
  const basePr = env.pr;
  const pids = ncmPids();
  // (One counter log per invocation: a resumed suite keeps the earlier logs for the earlier runs.)
  const counterFile = out.replace(/\.json$/, `-${Date.now()}.csv`);
  const stop = startCounters(counterFile);
  // (--resume: keep the runs already in the output file and skip them; BetterNCM reloads the page whenever plugins_dev
  // changes, which ends a run halfway.)
  const results: any[] = argv.includes('--resume') && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).results.filter(Boolean) : [];
  const report = () => fs.writeFileSync(out, JSON.stringify({ suite, at: AT, seconds: SECONDS, env, pids, results, problems }, null, 1));
  const key = (o: any) => [o.scene ?? 'auto', o.style, o.look ?? 'auto', o.lens ?? 1, o.film ?? 1, o.bloom ?? true, o.cap ?? 0, o.mode ?? 'total', o.pr ?? basePr].join('|');
  const done = new Set(results.map(r => key({ ...r, mode: r.mode ?? (Object.keys(r.passes ?? {}).length ? 'passes' : 'total'), pr: r.pr ?? basePr })));
  const run = async (o: Record<string, unknown>) => {
    if (done.has(key(o))) return null;
    let r: any = null;
    for (let attempt = 0; attempt < 4 && !r; attempt++) {
      try {
        await ensure();
        r = await evaluate(`__bmvBench.run(${JSON.stringify(o)})`, 240);
      } catch (e) { console.error('retry:', (e as Error).message.split('\n')[0]); await sleep(4000); }
    }
    if (!r) throw new Error(`gave up on ${JSON.stringify(o)}`);
    r.mode = o.mode ?? 'total';
    r.pr = o.pr ?? basePr;
    results.push(r);
    report();
    const p = r.passes && Object.keys(r.passes).length ? ' ' + Object.entries(r.passes).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    console.log(`${String(r.scene).padEnd(10)} ${r.style.padEnd(6)} look=${String(r.look).padEnd(5)} lens=${r.lens} film=${r.film} bloom=${r.bloom ? 1 : 0} cap=${r.cap} ${r.canvas.join('x')}  fps=${r.fps}  gap p50/p95/max=${r.gap.p50}/${r.gap.p95}/${r.gap.max}  cpu=${r.cpu.p50}/${r.cpu.p95}  gpu=${r.gpu.p50}/${r.gpu.p95}/${r.gpu.max}${p}${r.disjoint ? ' DISJOINT' : ''}`);
    return r;
  };
  try {
    if (suite === 'scenes' || suite === 'passes') {
      // The style each plate is planned in for this song (some plates belong to one style), with its camera setups.
      const owner = new Map<string, string>();
      for (const style of STYLE_IDS) {
        for (const seed of [7, 11, 23, 42]) {
          const plates = await evaluate<Record<string, string[]>>(`__bmvBench.plates(${JSON.stringify(style)}, ${seed})`);
          for (const id of Object.keys(plates)) if (!owner.has(id)) owner.set(id, style);
        }
      }
      for (const scene of SCENES) {
        const style = owner.get(scene) ?? 'pulse';
        if (suite === 'passes') await run({ scene, style, at: AT, seconds: SECONDS, mode: 'passes' });
        else {
          await run({ scene, style, at: AT, seconds: SECONDS });
          await run({ scene, style, at: AT, seconds: SECONDS, lens: 0, film: 0 });
        }
      }
    } else if (suite === 'styles') {
      for (const style of STYLE_IDS) {
        await run({ style, at: AT, seconds: SECONDS * 3, look: 'none' });
        await run({ style, at: AT, seconds: SECONDS * 3 });
      }
      for (const look of ['riso', 'hibit', 'ascii', 'vhs']) await run({ style: 'pulse', at: AT, seconds: SECONDS * 2, look });
    } else if (suite === 'res') {
      for (const pr of [basePr, 1, 0.7]) await run({ style: 'pulse', at: AT, seconds: SECONDS * 2, pr });
      await run({ style: 'pulse', at: AT, seconds: SECONDS * 2, pr: basePr, lens: 0, film: 0 });
      await run({ style: 'pulse', at: AT, seconds: SECONDS * 2, pr: basePr, bloom: false });
      await evaluate('__bmvBench.maximize(true)');
      await sleep(1500);
      for (const pr of [basePr, 1, 0.7]) await run({ style: 'pulse', at: AT, seconds: SECONDS * 2, pr });
      await evaluate('__bmvBench.maximize(false)');
      await sleep(1500);
    } else if (suite === 'cap60') {
      for (const style of STYLE_IDS) await run({ style, at: AT, seconds: SECONDS * 3, cap: 60 });
      for (const pr of [1, 0.7]) await run({ style: 'pulse', at: AT, seconds: SECONDS * 3, cap: 60, pr });
      await run({ style: 'pulse', at: AT, seconds: SECONDS * 3, cap: 30 });
    } else if (suite === 'stills') {
      // The same frames for an A/B: --label names the build or setting; PNGs into dev/bench/stills/<label>/.
      const label = opt('label', 'a');
      const dir = path.join(root, 'dev/bench/stills', label);
      fs.mkdirSync(dir, { recursive: true });
      const ts = opt('ts', `${AT + 1},${AT + 3.3},${AT + 7.7}`).split(',').map(Number);
      const pr = Number(opt('pr', String(basePr)));
      const style = opt('style', 'pulse');
      const plates = only.length ? only : ['auto'];
      for (const scene of plates) {
        await ensure();
        const shots = await evaluate<string[]>(`__bmvBench.capture(${JSON.stringify({ scene: scene === 'auto' ? undefined : scene, style, ts, pr, lens: Number(opt('lens', '1')), film: Number(opt('film', '1')) })})`, 240);
        shots.forEach((url, i) => fs.writeFileSync(path.join(dir, `${scene}-${ts[i]}.png`), Buffer.from(url.split(',')[1], 'base64')));
        console.log(`${scene}: ${shots.length} stills → ${path.relative(root, dir)}`);
      }
    } else if (['long', 'switch', 'resize', 'background'].includes(suite)) {
      // The plugin as it plays by itself (its own plan, settings as set), watched in chunks.
      await evaluate(`__bmvBench.reset(${basePr})`, 120);
      const watch = async (seconds: number, label: string, during?: () => Promise<void>) => {
        await ensure();
        const [r] = await Promise.all([evaluate(`__bmvBench.watch(${seconds}, { mode: ${JSON.stringify(opt('mode', 'total'))} })`, seconds + 60), during?.()]);
        r.label = label;
        results.push(r);
        report();
        console.log(`${label.padEnd(14)} drawn=${r.drawn} fps=${r.fps} gap p95/max=${r.gap.p95}/${r.gap.max} raf max=${r.rafGap.max} gpu=${r.gpu.p50}/${r.gpu.p95} cpu=${r.cpu.p50}/${r.cpu.p95} long=${r.longRaf.length} heap=${r.mem.heapMB}MB tex=${r.mem.textures} geo=${r.mem.geometries} prog=${r.mem.programs} song=${r.mem.song}/${r.mem.playing} errors=${problems.length}`);
        return r;
      };
      if (suite === 'long') {
        // List loop over the play list: songs change by themselves, every one prepared and disposed in turn.
        await evaluate('__bmvBench.playMode("playCycle")');
        const chunks = Math.max(1, Math.round(SECONDS / 60));
        for (let i = 0; i < chunks; i++) await watch(60, `long ${i + 1}/${chunks}`);
        await evaluate('__bmvBench.playMode("playOneCycle")');
      } else if (suite === 'switch') {
        for (let i = 0; i < 6; i++) await watch(20, `switch ${i + 1}`, async () => { await sleep(2000); await evaluate('__bmvBench.skip(1)'); });
      } else if (suite === 'resize') {
        await watch(10, 'before');
        await watch(32, 'resizing', async () => {
          for (let i = 0; i < 6; i++) { await sleep(5000); await evaluate(`__bmvBench.maximize(${i % 2 === 0})`); }
        });
        await evaluate('__bmvBench.maximize(false)');
        await watch(10, 'after');
      } else {
        await watch(10, 'before');
        await watch(40, 'minimized', async () => { await sleep(10000); windowCmd('min'); await sleep(20000); windowCmd('front'); });
        await watch(10, 'after');
      }
    } else throw new Error(`unknown suite ${suite}`);
  } finally {
    try { await evaluate(`__bmvBench.reset(${basePr})`, 120); } catch (e) { console.error('reset:', (e as Error).message); }
    const samples = await stop();
    const base = path.basename(out, '.json');
    for (const f of fs.readdirSync(path.dirname(out))) {
      if (f.startsWith(base + '-') && f.endsWith('.csv') && path.join(path.dirname(out), f) !== counterFile) samples.push(...readCounters(path.join(path.dirname(out), f)));
    }
    for (const r of results) if (r && !r.load) r.load = load(samples, r.t0, r.t1, pids);
    report();
    for (const p of problems) console.log('  page error:', p);
    console.log(`→ ${path.relative(root, out)}`);
    ws?.close();
  }
}

await main();
process.exit(0);
