// Runs inside NetEase Cloud Music (injected over CDP by tools/bench/run.ts) and measures the plugin's own player: the
// one BetterMV shows (window.__betterMv.player), drawn by the plugin's own frame loop in the real window. Per frame:
// the CPU time of player.frame and the GPU time of everything it drew (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED:
// queries can't nest, so either one per frame, or one per draw call with the post pass it belongs to). A run forces a
// plate (every shot on it), a style, a look and the lens / finish / glow switches, seeks the song to the same passage
// and records for a few seconds.
import { STYLES, type StyleId } from '../../src/style/style.ts';
import { planShots } from '../../src/director/director.ts';
import { Music } from '../../src/director/music.ts';
import {
  findClient, isMaximized, seek, setPlayMode, setVolume, skip, toggleMaximize, togglePlay, volume, type Client, type PlayMode,
} from '../../src/plugin/client.ts';
import type { LookId, SceneId } from '../../src/scenes/types.ts';

type GL = WebGL2RenderingContext;
interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export interface RunOpts {
  /** Every shot on this plate (else the style's own plan). */
  scene?: SceneId;
  style: StyleId;
  look?: LookId | 'none';
  lens?: number;
  film?: number;
  bloom?: boolean;
  /** Drawing-buffer pixels per CSS pixel (the quality setting: high = min(dpr, 2), mid = 1, low = 0.7). */
  pr?: number;
  /** Seconds recorded, from song time `at`. */
  seconds: number;
  at: number;
  /** 'total': one GPU query per frame; 'passes': one per draw call, summed by post pass; 'cpu': no GPU queries. */
  mode?: 'total' | 'passes' | 'cpu';
  /** Draw at most this many frames a second, the way the plugin's frame cap does (0 = every display frame). */
  cap?: number;
  seed?: number;
}

interface FrameRec { at: number; cpu: number; gpu: number | null; passes?: Record<string, number> }

const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let client: Client | null = null;
let installed = false;
// 'cpu': frames and their CPU time only, no GPU queries (whose bookkeeping costs the page time of its own).
let mode: 'total' | 'passes' | 'cpu' | 'off' = 'off';
let cap = 0;
let due = 0;
let frames: FrameRec[] = [];
let label = 'other';
let depth = 0;
const pending: Array<{ query: WebGLQuery; rec: FrameRec; pass?: string }> = [];
let gl: GL;
let ext: TimerExt;
let disjointSeen = 0;

// (The plugin's player in NetEase; in the dev harness, its own: tools/bench/headless.ts drives that one frame by frame.)
const mv = () => ((window as any).__betterMv ?? { player: (window as any).bmv?.player }) as { open(): void; close(): void; player: any; clock: any };

function poll(): void {
  if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
    disjointSeen++;
    for (const p of pending.splice(0)) gl.deleteQuery(p.query);
    return;
  }
  while (pending.length) {
    const p = pending[0];
    if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
    const ms = gl.getQueryParameter(p.query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(p.query);
    pending.shift();
    if (p.pass) {
      p.rec.passes![p.pass] = (p.rec.passes![p.pass] ?? 0) + ms;
      p.rec.gpu = (p.rec.gpu ?? 0) + ms;
    } else p.rec.gpu = ms;
  }
}

/** Wraps the plugin's player once: its frame (timing, the cap), the renderer's draws and the post passes (labels). */
function install(): void {
  if (installed) return;
  // (The plugin's 画质 自动 rests from here on: its timer query can't nest with these, and the runs set the resolution
  // themselves; the suites that watch the plugin play by itself see it as 高.)
  if ('governed' in mv()) (mv() as any).governed = false;
  const player = mv().player;
  const engine = player.engine, renderer = engine.renderer;
  gl = renderer.getContext();
  ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt;
  if (!ext) throw new Error('no EXT_disjoint_timer_query_webgl2');
  const frame = player.frame.bind(player);
  let current: FrameRec | null = null;
  player.frame = (t: number, dt: number) => {
    if (mode === 'off') return frame(t, dt);
    const now = performance.now();
    if (cap) {
      const period = 1000 / cap;
      if (due && now < due - 1) return null;
      due = (due && now - due <= period ? due : now) + period;
    }
    if (mode !== 'cpu') poll();
    const rec: FrameRec = { at: now, cpu: 0, gpu: null };
    if (mode === 'passes') rec.passes = {};
    current = rec;
    let query: WebGLQuery | null = null;
    if (mode === 'total') { query = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    label = 'keepUp';
    const t0 = performance.now();
    const shot = frame(t, dt);
    rec.cpu = performance.now() - t0;
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query, rec }); }
    current = null;
    frames.push(rec);
    return shot;
  };
  const render = renderer.render.bind(renderer);
  renderer.render = (scene: unknown, camera: unknown) => {
    if (mode !== 'passes' || !current || depth > 0) { depth++; try { return render(scene, camera); } finally { depth--; } }
    const query = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    depth++;
    try { return render(scene, camera); } finally {
      depth--;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push({ query, rec: current, pass: label });
    }
  };
  const names: Record<string, unknown> = {
    shots: engine.shots, memory: engine.memory, echo: engine.echo, words: engine.wordsOver, bloom: engine.bloom,
    grade: engine.grade, finish: engine.finish, look: engine.look,
  };
  for (const [name, pass] of Object.entries(names) as Array<[string, any]>) {
    const r = pass.render.bind(pass);
    pass.render = (...a: unknown[]) => { label = name; try { return r(...a); } finally { label = 'other'; } };
  }
  // Inside the shot pass: the lens (depth of field, motion blur) apart from the plate itself.
  const lens = engine.shots.lens;
  for (const m of ['apply', 'overlay']) {
    const f = lens[m].bind(lens);
    lens[m] = (...a: unknown[]) => { const was = label; label = 'lens'; try { return f(...a); } finally { label = was; } };
  }
  installed = true;
}

/** The plates each style plans for the playing song, with the camera setups it uses on them. */
function platesFor(style: StyleId, seed: number): Map<SceneId, string[]> {
  const song = mv().player.song;
  const music = new Music(song.analysis);
  const shots = planShots(music, STYLES[style], seed, { graphic: song.palette.graphic, lyrics: song.lines.length > 0 });
  const out = new Map<SceneId, string[]>();
  for (const s of shots) {
    const v = out.get(s.scene) ?? [];
    if (!v.includes(s.variant)) v.push(s.variant);
    out.set(s.scene, v);
  }
  return out;
}

async function settle(): Promise<void> {
  const p = mv().player;
  await p.warm(() => sleep(0), () => false);
}

const bench = {
  /** NetEase's state, without opening the MV. */
  async state() {
    client ??= await findClient();
    const s = client!.store.getState();
    return {
      song: s.playing?.resourceTrackId, name: s.playing?.resourceName, playing: s.playing?.playingState, mode: s.playing?.playingMode,
      volume: volume(client!.store), max: !!s.app?.isMaxWindow, open: !!mv()?.player?.song,
      list: (s.playingList?.curPlayingList ?? []).map((i: any) => [i.track?.id, i.track?.name]).slice(0, 40),
    };
  },
  async init() {
    client ??= await findClient();
    if (!client) throw new Error('client not found');
    if (!mv()?.player?.song) {
      mv().open();
      for (let i = 0; i < 600 && !mv().player?.song; i++) await sleep(100);
      if (!mv().player?.song) throw new Error('MV did not start');
    }
    await sleep(1500);
    install();
    const p = mv().player, c = p.engine.renderer.domElement as HTMLCanvasElement;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: info ? gl.getParameter((info as any).UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      dpr: devicePixelRatio, window: [innerWidth, innerHeight], canvas: [c.width, c.height], pr: p.engine.renderer.getPixelRatio(),
      song: { id: p.song.id, name: p.song.name, duration: p.song.duration, sections: p.song.analysis.sections.map((s: any) => [s.label, Math.round(s.start)]) },
      style: p.style?.id, volume: volume(client.store),
    };
  },
  plates(style: StyleId, seed = 7) { return Object.fromEntries(platesFor(style, seed)); },
  volume(v?: number) { if (v !== undefined) setVolume(client!.store, v); return volume(client!.store); },
  play(on = true) { togglePlay(client!.store, !on); },
  /** Quits NetEase the way its own 退出 does (after a run, so the debugging port doesn't stay open). */
  quit() { client!.store.dispatch({ type: 'app/exitApp' }); },
  skip(flag: 1 | -1 = 1) { skip(client!.store, flag); },
  /** Memory: the page's JS heap, three's live GPU resources, and whether the MV shows the song NetEase plays. */
  mem() {
    const p = mv().player, info = p?.engine.renderer.info, pm = (performance as any).memory;
    return {
      heapMB: pm ? Math.round(pm.usedJSHeapSize / 1048576) : null, geometries: info?.memory.geometries, textures: info?.memory.textures,
      programs: info?.programs?.length, song: p?.song?.id ?? null, playing: mv().clock?.songId ?? null, hidden: document.hidden,
    };
  },
  maximize(on: boolean) { if (isMaximized(client!.store) !== on) toggleMaximize(client!.store); },
  playMode(m: PlayMode) { setPlayMode(client!.store, m); },
  async run(o: RunOpts) {
    const p = mv().player, e = p.engine, seed = o.seed ?? 7;
    mode = 'off';
    e.lensScale = o.lens ?? 1;
    e.filmScale = o.film ?? 1;
    e.bloom.enabled = o.bloom ?? true;
    const pr = o.pr ?? Math.min(devicePixelRatio || 1, 2);
    if (pr !== e.renderer.getPixelRatio()) { e.setPixelRatio(pr); p.resize(); }
    let only: { scene: SceneId; variants: string[] } | undefined;
    if (o.scene) {
      const own = platesFor(o.style, seed).get(o.scene);
      only = { scene: o.scene, variants: own ?? ['front'] };
    }
    p.load(p.song, STYLES[o.style], new Set(), only, o.look, 0, seed);
    await settle();
    seek(client!.store, o.at);
    await sleep(700);
    frames = [];
    disjointSeen = 0;
    cap = o.cap ?? 0;
    due = 0;
    mode = o.mode ?? 'total';
    const t0 = performance.now();
    await sleep(o.seconds * 1000);
    mode = 'off';
    const t1 = performance.now();
    for (let i = 0; i < 10 && pending.length; i++) { await sleep(30); poll(); }
    const fr = frames.slice(1);
    const gaps = fr.slice(1).map((f, i) => f.at - fr[i].at);
    const gpu = fr.map(f => f.gpu).filter((x): x is number => x !== null);
    const cpu = fr.map(f => f.cpu);
    const passes: Record<string, number> = {};
    if (o.mode === 'passes') {
      const keys = new Set(fr.flatMap(f => Object.keys(f.passes ?? {})));
      for (const k of keys) passes[k] = r2(q(fr.map(f => f.passes?.[k] ?? 0), 0.5));
    }
    const c = e.renderer.domElement as HTMLCanvasElement;
    return {
      scene: o.scene ?? 'auto', style: o.style, look: o.look ?? 'auto', lens: e.lensScale, film: e.filmScale, bloom: e.bloom.enabled, cap,
      canvas: [c.width, c.height], frames: fr.length, fps: r2(fr.length / ((t1 - t0) / 1000)),
      gap: { p50: r2(q(gaps, 0.5)), p95: r2(q(gaps, 0.95)), p99: r2(q(gaps, 0.99)), max: r2(Math.max(...gaps)) },
      cpu: { p50: r2(q(cpu, 0.5)), p95: r2(q(cpu, 0.95)), max: r2(Math.max(...cpu)) },
      gpu: { p50: r2(q(gpu, 0.5)), p95: r2(q(gpu, 0.95)), max: r2(Math.max(...gpu)), n: gpu.length },
      passes, disjoint: disjointSeen, t0: Date.now() - (performance.now() - t0), t1: Date.now() - (performance.now() - t1),
    };
  },
  /**
   * Leak hunting: from now on, every geometry and texture the renderer takes up is noted with where it was made (a
   * geometry: its first setAttribute; a texture: its first upload), and forgotten when disposed. leaks() counts the
   * ones still held, by where they came from.
   */
  track() {
    const p = mv().player;
    let g: any = null;
    p.engine.renderer.domElement && Object.values(p.scenes ?? {}).some((s: any) => s.scene.traverse((o: any) => { if (!g && o.geometry) g = o.geometry; }));
    if (!g) throw new Error('no geometry to find the classes from');
    let geoProto = Object.getPrototypeOf(g);
    while (!Object.prototype.hasOwnProperty.call(geoProto, 'setAttribute')) geoProto = Object.getPrototypeOf(geoProto);
    const dispatcher = Object.getPrototypeOf(geoProto);
    const w = window as any;
    if (w.__bmvLive) return 'already';
    const live = w.__bmvLive = new Map<any, string>();
    const born = new WeakMap<any, string>();
    const where = () => (new Error().stack ?? '').split('\n').slice(2).map(l => l.trim())
      .filter(l => /\/src\//.test(l) && !/tools\/bench|inpage/.test(l)).slice(0, 3).map(l => l.replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\/src\//, '').replace(/\?[^:]*/, '').replace(/\)$/, '')).join(' < ');
    const setAttribute = geoProto.setAttribute;
    geoProto.setAttribute = function (this: any, ...a: unknown[]) { if (!born.has(this)) born.set(this, where()); return setAttribute.apply(this, a); };
    const add = dispatcher.addEventListener, fire = dispatcher.dispatchEvent;
    // (A new geometry's owner: on its first draw, the plate and the chain of parents it hangs from.)
    const pending = new Set<any>();
    dispatcher.addEventListener = function (this: any, type: string, fn: unknown) {
      if (type === 'dispose' && (this.isBufferGeometry || this.isTexture) && !live.has(this)) {
        live.set(this, `${this.isTexture ? 'texture' : 'geometry'} ${this.constructor?.name ?? ''} ${this.isTexture ? where() : born.get(this) ?? '?'}`);
        if (this.isBufferGeometry) pending.add(this);
      }
      return add.call(this, type, fn);
    };
    const r = p.engine.renderer, render = r.render;
    r.render = function (this: any, scene: any, camera: any) {
      const out = render.call(this, scene, camera);
      if (pending.size) {
        const plate = Object.entries(mv().player.scenes ?? {}).find(([, s]: any) => s.scene === scene)?.[0] ?? (scene === mv().player.director?.overlay?.scene ? 'overlay' : scene.type);
        scene.traverse((o: any) => {
          if (!o.geometry || !pending.has(o.geometry)) return;
          const chain: string[] = [];
          for (let q = o.parent; q && chain.length < 4; q = q.parent) chain.push(`${q.type}${q.userData?.lyrics ? '(lyrics)' : ''}`);
          live.set(o.geometry, `${live.get(o.geometry)} @ ${plate}: ${chain.join(' < ')}`);
          pending.delete(o.geometry);
        });
      }
      return out;
    };
    dispatcher.dispatchEvent = function (this: any, e: { type: string }) { if (e.type === 'dispose') live.delete(this); return fire.call(this, e); };
    return 'tracking';
  },
  leaks(top = 15) {
    const live = (window as any).__bmvLive as Map<any, string> | undefined;
    if (!live) return null;
    const by = new Map<string, number>();
    for (const v of live.values()) by.set(v, (by.get(v) ?? 0) + 1);
    return { total: live.size, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, top) };
  },
  /**
   * The D3D compiler's warnings on the programs the loaded plates (and the post chain) use: X3595 (a gradient
   * instruction in a loop of varying length) and the like mark texture reads FXC can't keep in real flow control.
   */
  programs() {
    const p = mv().player, r = p.engine.renderer, g = r.getContext() as GL;
    const seen = new Map<unknown, { where: string; type: string; log: string; frag: string }>();
    const visit = (root: any, where: string) => root?.traverse?.((x: any) => {
      for (const m of Array.isArray(x.material) ? x.material : x.material ? [x.material] : []) {
        const prog = r.properties.get(m).currentProgram;
        if (prog && !seen.has(prog)) seen.set(prog, { where, type: m.type, log: g.getProgramInfoLog(prog.program) ?? '', frag: String(m.fragmentShader ?? '').replace(/\s+/g, ' ').slice(0, 160) });
      }
    });
    for (const [id, s] of Object.entries(p.scenes ?? {}) as Array<[string, any]>) { visit(s.scene, id); for (const o of s.offscreen ?? []) visit(o, `${id} (offscreen)`); }
    const e = p.engine;
    for (const [name, pass] of Object.entries({ shots: e.shots, bloom: e.bloom, grade: e.grade, finish: e.finish, look: e.look, echo: e.echo }) as Array<[string, any]>) {
      for (const v of Object.values(pass)) if (v && (v as any).isMaterial) visit({ traverse: (f: any) => f({ material: v }) }, `post:${name}`);
    }
    for (const m of e.shots.lens.materials) visit({ traverse: (f: any) => f({ material: m }) }, 'post:lens');
    return [...seen.values()].filter(x => /warning X\d+/.test(x.log)).map(x => ({ where: x.where, type: x.type, warn: [...new Set(x.log.match(/X\d{4}/g))].join(','), frag: x.frag }));
  },
  /**
   * GPU cost without a frame loop (the dev harness in headless Edge, where animation frames are throttled): `frames`
   * frames of song time from `at`, 60 a second, drawn back to back after a run-up, each timed on the GPU.
   */
  async drive(o: RunOpts & { frames?: number; keep?: boolean }) {
    install();
    if (o.keep) return bench.measure(o);
    const p = mv().player, e = p.engine, seed = o.seed ?? 7, n = o.frames ?? 240;
    mode = 'off';
    e.lensScale = o.lens ?? 1;
    e.filmScale = o.film ?? 1;
    e.bloom.enabled = o.bloom ?? true;
    const pr = o.pr ?? Math.min(devicePixelRatio || 1, 2);
    if (pr !== e.renderer.getPixelRatio()) { e.setPixelRatio(pr); p.resize(); }
    const own = o.scene ? platesFor(o.style, seed).get(o.scene) : undefined;
    p.load(p.song, STYLES[o.style], new Set(), o.scene ? { scene: o.scene, variants: own ?? ['front'] } : undefined, o.look, 0, seed);
    await settle();
    return bench.measure(o);
  },
  /** drive()'s frames on the plan already loaded (keep: true): a profile can then leave the loading out. */
  async measure(o: RunOpts & { frames?: number }) {
    const p = mv().player, e = p.engine, n = o.frames ?? 240;
    // (Programs first made while these frames were drawn: the warm-up missed them, so their first frame waited.)
    const before = new Set(e.renderer.info.programs ?? []);
    // (The harness's own loop draws the audio's time every animation frame: held off while these frames are drawn.)
    const frame = p.frame;
    p.frame = () => null;
    try {
      for (let i = -30; i < 0; i++) frame(o.at + i / 60, 1 / 60);
      for (let i = 0; i < 20 && pending.length; i++) { await sleep(20); poll(); }
      frames = []; disjointSeen = 0; cap = 0; due = 0;
      mode = o.mode ?? 'total';
      for (let i = 0; i < n; i++) {
        frame(o.at + i / 60, 1 / 60);
        (frames[frames.length - 1] as any).t = o.at + i / 60;
        (frames[frames.length - 1] as any).shot = p.shots.find((s: any) => o.at + i / 60 >= s.start && o.at + i / 60 < s.end)?.scene;
        if (i % 20 === 19) { gl.finish(); await sleep(0); }
      }
    } finally { mode = 'off'; p.frame = frame; }
    for (let i = 0; i < 100 && pending.length; i++) { await sleep(20); poll(); }
    const gpu = frames.map(f => f.gpu).filter((x): x is number => x !== null), cpu = frames.map(f => f.cpu);
    const passes: Record<string, number> = {};
    if (o.mode === 'passes') {
      const keys = new Set(frames.flatMap(f => Object.keys(f.passes ?? {})));
      for (const k of keys) passes[k] = r2(q(frames.map(f => f.passes?.[k] ?? 0), 0.5));
    }
    const c = e.renderer.domElement as HTMLCanvasElement;
    return {
      scene: o.scene ?? 'auto', style: o.style, look: o.look ?? 'auto', lens: e.lensScale, film: e.filmScale, bloom: e.bloom.enabled, cap: 0,
      canvas: [c.width, c.height], frames: frames.length, fps: NaN, gap: { p50: NaN, p95: NaN, p99: NaN, max: NaN },
      cpu: { p50: r2(q(cpu, 0.5)), p95: r2(q(cpu, 0.95)), max: r2(Math.max(...cpu)) },
      gpu: { p50: r2(q(gpu, 0.5)), p95: r2(q(gpu, 0.95)), max: r2(Math.max(...gpu)), n: gpu.length },
      passes, disjoint: disjointSeen,
      late: (e.renderer.info.programs ?? []).filter((x: any) => !before.has(x)).map((x: any) => {
        // Which plate's material it is, and what about it differs from the programs made in the warm-up.
        const users: string[] = [];
        const all: Array<[string, any]> = [...Object.entries(p.scenes ?? {}), ['overlay', { scene: p.director?.overlay?.scene }]];
        for (const [id, sc] of all) {
          for (const root of [sc.scene, ...(sc.offscreen ?? [])]) root?.traverse?.((o: any) => {
            for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
              if (e.renderer.properties.get(m).currentProgram === x) users.push(`${id}:${m.type}${m.name ? '(' + m.name + ')' : ''}:${o.type}${o.userData?.lyrics ? ':lyrics' : ''}:${String(m.fragmentShader ?? '').replace(/\s+/g, ' ').slice(0, 60)}`);
            }
          });
        }
        const key = String(x.cacheKey).split(',');
        const twin = [...before].map((y: any) => String(y.cacheKey).split(',')).filter(k => k[0] === key[0] && k.length === key.length)
          .map(k => ({ k, d: k.reduce((n, v, i) => n + (v !== key[i] ? 1 : 0), 0) })).sort((u, v) => u.d - v.d)[0];
        const differs = twin ? key.map((v, i) => (v !== twin.k[i] ? `#${i}:${twin.k[i]}->${v}` : '')).filter(Boolean).join(' ') : 'no twin';
        // (And against the nearest program that has a map too.)
        const mapped = [...before].map((y: any) => String(y.cacheKey).split(',')).filter(k => k[0] === key[0] && k.length === key.length && k[5] === key[5])
          .map(k => ({ k, d: k.reduce((n, v, i) => n + (v !== key[i] ? 1 : 0), 0) })).sort((u, v) => u.d - v.d)[0];
        const vsMapped = mapped ? key.map((v, i) => (v !== mapped.k[i] ? `#${i}:${mapped.k[i]}->${v}` : '')).filter(Boolean).join(' ') : 'none';
        // (Anything else alive that uses it: three's own list of materials per program isn't kept, so look through every
        // object the renderer has drawn this frame via the render lists' last items.)
        return `${x.name} len=${key.length} [${[...new Set(users)].slice(0, 3).join(' | ')}] ${differs} | vs same-uv: ${vsMapped}`;
      }),
      slow: [...frames].filter(f => f.gpu !== null).sort((x, y) => y.gpu! - x.gpu!).slice(0, 5)
        .map(f => ({ t: r2((f as any).t), shot: (f as any).shot, gpu: r2(f.gpu!), cpu: r2(f.cpu), passes: f.passes && Object.fromEntries(Object.entries(f.passes).map(([k, v]) => [k, r2(v)])) })),
    };
  },
  /**
   * Stills for A/B comparisons: the same plan (style, plate, seed) drawn at song times `ts` (each after two frames
   * leading up to it, so the motion blur has a last pose), as PNG data URLs. The plugin's own frames are held meanwhile.
   */
  async capture(o: { scene?: SceneId; style: StyleId; look?: LookId | 'none'; pr?: number; lens?: number; film?: number; seed?: number; ts: number[] }) {
    install();
    const p = mv().player, e = p.engine, seed = o.seed ?? 7;
    e.lensScale = o.lens ?? 1;
    e.filmScale = o.film ?? 1;
    const pr = o.pr ?? Math.min(devicePixelRatio || 1, 2);
    if (pr !== e.renderer.getPixelRatio()) { e.setPixelRatio(pr); p.resize(); }
    const own = o.scene ? platesFor(o.style, seed).get(o.scene) : undefined;
    p.load(p.song, STYLES[o.style], new Set(), o.scene ? { scene: o.scene, variants: own ?? ['front'] } : undefined, o.look, 0, seed);
    await settle();
    const frame = p.frame;
    p.frame = () => null;
    try {
      const out: string[] = [];
      for (const t of o.ts) {
        frame(t - 2 / 60, 1 / 60);
        frame(t - 1 / 60, 1 / 60);
        frame(t, 1 / 60);
        out.push((e.renderer.domElement as HTMLCanvasElement).toDataURL('image/png'));
      }
      return out;
    } finally { p.frame = frame; }
  },
  /** Back to what the plugin shows by itself: its own plan, lens, finish and glow, and the quality's pixel ratio. */
  async reset(pr: number) {
    const p = mv().player, e = p.engine;
    mode = 'off';
    e.lensScale = 1; e.filmScale = 1; e.bloom.enabled = true;
    if (pr !== e.renderer.getPixelRatio()) { e.setPixelRatio(pr); p.resize(); }
    p.load(p.song, p.style, new Set());
    await settle();
  },
  /** Records the plugin's own frames (whatever it shows) for `seconds`: for long runs, switching songs, resizing. */
  async watch(seconds: number, o: { cap?: number; mode?: 'total' | 'cpu' | 'off' } = {}) {
    frames = []; disjointSeen = 0; cap = o.cap ?? 0; due = 0; mode = o.mode ?? 'total';
    // Every animation frame the page gets, drawn or not: a long gap is the page's thread held up (or the window hidden).
    const ticks: number[] = [];
    let on = true;
    const tick = (t: number) => { ticks.push(t); if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    await sleep(seconds * 1000);
    on = false;
    mode = 'off';
    const t1 = performance.now();
    for (let i = 0; i < 10 && pending.length; i++) { await sleep(30); poll(); }
    const gapsOf = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]);
    const drawn = frames.map(f => f.at), gaps = gapsOf(drawn), rafGaps = gapsOf(ticks);
    const gpu = frames.map(f => f.gpu).filter((x): x is number => x !== null);
    const long = (ts: number[], gs: number[]) => gs.map((g, i) => [r2(ts[i] - t0), r2(g)]).filter(([, g]) => g > 50);
    return {
      t0: Date.now() - (performance.now() - t0), t1: Date.now() - (performance.now() - t1), seconds: r2((t1 - t0) / 1000),
      drawn: drawn.length, fps: r2(drawn.length / ((t1 - t0) / 1000)), raf: ticks.length,
      gap: { p50: r2(q(gaps, 0.5)), p95: r2(q(gaps, 0.95)), p99: r2(q(gaps, 0.99)), max: r2(Math.max(0, ...gaps)) },
      rafGap: { p50: r2(q(rafGaps, 0.5)), p99: r2(q(rafGaps, 0.99)), max: r2(Math.max(0, ...rafGaps)) },
      gpu: { p50: r2(q(gpu, 0.5)), p95: r2(q(gpu, 0.95)), max: r2(Math.max(0, ...gpu)) },
      cpu: { p50: r2(q(frames.map(f => f.cpu), 0.5)), p95: r2(q(frames.map(f => f.cpu), 0.95)), max: r2(Math.max(0, ...frames.map(f => f.cpu))) },
      longDrawn: long(drawn, gaps).slice(0, 40), longRaf: long(ticks, rafGaps).slice(0, 40), disjoint: disjointSeen, mem: bench.mem(),
    };
  },
};

(window as any).__bmvBench = bench;
