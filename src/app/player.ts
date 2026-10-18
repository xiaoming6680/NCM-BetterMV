// One renderer for the whole session; per song it builds the scenes the song's style needs and a director.
import * as THREE from 'three';
import { Engine, defaultFx } from '../render/engine.ts';
import { disposeText } from '../render/text.ts';
import { Music } from '../director/music.ts';
import { LyricTrack } from '../director/lyrics.ts';
import { Director, planLooks, planShots, type LookId } from '../director/director.ts';
import { Relief } from '../scenes/relief.ts';
import { Diorama } from '../scenes/diorama.ts';
import { Bokeh } from '../scenes/bokeh.ts';
import { Tunnel } from '../scenes/tunnel.ts';
import { VOICES, voiceFor } from '../scenes/lyricBlock.ts';
import { Drive } from '../scenes/drive.ts';
import { Kaleido } from '../scenes/kaleido.ts';
import { Flip } from '../scenes/flip.ts';
import { Rings } from '../scenes/rings.ts';
import { Poster } from '../scenes/poster.ts';
import { Ridges } from '../scenes/ridges.ts';
import { Halftone } from '../scenes/halftone.ts';
import { Particles } from '../scenes/particles.ts';
import { TypeWall } from '../scenes/typewall.ts';
import { Ink } from '../scenes/ink.ts';
import { ArmillaryScene } from '../scenes/armillary.ts';
import { CardsScene } from '../scenes/cards.ts';
import { DebugScene } from '../scenes/debug.ts';
import { SubdivideScene } from '../scenes/subdivide.ts';
import { ScopeScene } from '../scenes/scope.ts';
import { Vinyl } from '../scenes/vinyl.ts';
import { Clouds } from '../scenes/clouds.ts';
import { City, cityPrograms } from '../scenes/city.ts';
import { Aurora, auroraPrograms } from '../scenes/aurora.ts';
import { CanvasScene } from '../scenes/canvas.ts';
import { Pillars } from '../scenes/pillars.ts';
import { Ripple } from '../scenes/ripple.ts';
import { Channel } from '../scenes/channel.ts';
import { Orb } from '../scenes/orb.ts';
import { Menger } from '../scenes/menger.ts';
import { Sierpinski } from '../scenes/sierpinski.ts';
import { Cantor } from '../scenes/cantor.ts';
import { PaperCut } from '../scenes/papercut.ts';
import { RainScene } from '../scenes/rain.ts';
import { LanternScene } from '../scenes/lanterns.ts';
import { NeonScene } from '../scenes/neon.ts';
import { KineticType } from '../scenes/kinetic.ts';
import { BlackHole } from '../scenes/blackhole.ts';
import { Cubes } from '../scenes/cubes.ts';
import { DotMatrix } from '../scenes/dots.ts';
import { FractalPlate } from '../scenes/fractal.ts';
import { armillarySpec } from '../sigil/armillary.ts';
import type { MvScene, SceneId, SceneInit, Shot } from '../scenes/types.ts';
import type { Style } from '../style/style.ts';
import type { PreparedSong } from './prepare.ts';
import { Hud } from './hud.ts';

function disposeScene(root: THREE.Object3D, keep: THREE.Texture): void {
  const textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) textures.add(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if (u.value instanceof THREE.Texture) textures.add(u.value);
      m.dispose();
    }
  });
  for (const t of textures) if (t !== keep) t.dispose();
}

/**
 * Oscilloscope music: the whole MV is the scope in XY mode drawing the song's pictures, its framing changing at the
 * planned cuts but no more often than every 6 s (the speeding-up cuts of a build would only jolt the picture).
 */
function scopeOnly(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  for (const s of shots) {
    const last = out[out.length - 1];
    if (last && s.start - last.start < 6) { last.end = s.end; continue; }
    out.push({ ...s, run: undefined });
  }
  const framings = ['xy', 'xy-near', 'xy', 'xy-angle'];
  out.forEach((s, i) => { s.scene = 'scope'; s.variant = framings[i % framings.length]; });
  return out;
}

export class MvPlayer {
  readonly engine: Engine;
  readonly hud: Hud;
  private scenes: Partial<Record<SceneId, MvScene>> = {};
  private director: Director | null = null;
  private music: Music | null = null;
  song: PreparedSong | null = null;
  /** The lines as shown (moved by the song's lyric delay). */
  private lines: PreparedSong['lines'] = [];
  style: Style | null = null;
  /**
   * This play's seed: plates, cameras, cuts and looks are drawn from it, so a song plays differently each time (the
   * user: “还要随机性”). Reloading the same song for a settings change keeps it.
   */
  seed = 0;
  private seedFor = -1;
  /** Counts the loads begun: one built in slices (loadInSlices) stops when another begins. */
  private loads = 0;
  /** Whether the last frame drew a transition (both plates). */
  transitioning = false;

  constructor(container: HTMLElement, pixelRatio?: number) {
    this.engine = new Engine(container, pixelRatio);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.hud = new Hud(container);
    // The slowest programs (seconds for the city's ground under D3D) start compiling now, off the page's thread, while
    // the first song is still being read and analysed; the plates then find them ready (their palette is in uniforms).
    const camera = new THREE.PerspectiveCamera();
    for (const o of [...cityPrograms(), ...auroraPrograms()]) void this.engine.compile(o, camera);
    void this.engine.compilePost();
  }

  /**
   * `off`: plates and looks the user turned off in the settings. `only` (development): every shot on this plate,
   * cycling through the given camera setups; `forceLook` (development) puts every section but the drops in that look.
   * `lyricDelay`: seconds this song's words show later (negative: earlier), the user's per-song setting. `retake`
   * (development): rewrites the planned shots before the scenes are built (a film's own cuts, film/reel.ts).
   * `exposure`: seconds each plate has been on screen over the plays so far (planShots), or none (a fixed arrangement).
   */
  load(song: PreparedSong, style: Style, off: ReadonlySet<SceneId | LookId> = new Set(), only?: { scene: SceneId; variants: string[] }, forceLook?: LookId | 'none', lyricDelay = 0, seed?: number, retake?: (shots: Shot[], music: Music) => Shot[], exposure?: ReadonlyMap<string, number>): void {
    const steps = this.build(song, style, off, only, forceLook, lyricDelay, seed, retake, exposure);
    while (!steps.next().done) { /* all at once */ }
  }

  /**
   * load() in slices, a `pause` before it, after the shots are planned, after each plate is built and after the looks'
   * glyphs are drawn: a song's plates took 0.25–0.3 s in one go, a stall on the waiting view. True once built; false
   * when `cancelled` said so (what was built is unloaded) or another load took over meanwhile (true if that one built
   * this song).
   */
  async loadInSlices(pause: () => Promise<void>, cancelled: () => boolean, song: PreparedSong, style: Style, off: ReadonlySet<SceneId | LookId>, lyricDelay: number, seed: number, exposure?: ReadonlyMap<string, number>): Promise<boolean> {
    // (Not in the same task as what came before: the end of prepareSong.)
    await pause();
    if (cancelled()) return false;
    const steps = this.build(song, style, off, undefined, undefined, lyricDelay, seed, undefined, exposure);
    let step = steps.next();
    const token = this.loads;
    while (!step.done) {
      await pause();
      if (this.loads !== token) return this.song === song && this.director !== null;
      if (cancelled()) {
        this.unload();
        return false;
      }
      step = steps.next();
    }
    return true;
  }

  private *build(song: PreparedSong, style: Style, off: ReadonlySet<SceneId | LookId>, only: { scene: SceneId; variants: string[] } | undefined, forceLook: LookId | 'none' | undefined, lyricDelay: number, seed: number | undefined, retake?: (shots: Shot[], music: Music) => Shot[], exposure?: ReadonlyMap<string, number>): Generator<void, void> {
    const token = ++this.loads;
    if (this.seedFor !== song.id || seed !== undefined) {
      this.seed = seed ?? (Math.random() * 4294967296) >>> 0;
      this.seedFor = song.id;
    }
    this.unload();
    this.song = song;
    this.style = style;
    this.engine.setPalette(song.palette.ink, song.palette.signal);
    this.engine.setFinish(song.palette, style.finish);
    this.engine.setCover(song.cover);
    const music = this.music = new Music(song.analysis);
    this.hud.glyph = style.glyph;
    // (A copy moved by the delay: the song's own lines stay as parsed, for the next load.)
    const lines = lyricDelay ? song.lines.map(l => ({ ...l, start: l.start + lyricDelay, end: l.end + lyricDelay, words: l.words.map(w => ({ ...w, start: w.start + lyricDelay, end: w.end + lyricDelay })) })) : song.lines;
    this.lines = lines;
    const lyrics = new LyricTrack(lines);
    const init: SceneInit = {
      cover: song.cover, coverPixels: song.coverPixels, coverSize: song.coverSize, palette: song.palette,
      music, lyrics, aspect: this.engine.aspect, title: song.name, artists: song.artists, stereo: song.stereo, xyMusic: song.xyMusic, armillary: armillarySpec(song.analysis, song.id), seed: this.seed,
    };
    // Pure music (or a song whose lyrics NetEase doesn't have) gets no word plates.
    let shots = planShots(music, style, this.seed, { graphic: song.palette.graphic, lyrics: song.lines.length > 0 }, off, exposure);
    if (only) shots.forEach((sh, i) => { sh.scene = only.scene; sh.variant = only.variants[i % only.variants.length]; });
    else if (song.xyMusic) shots = scopeOnly(shots);
    if (retake) shots = retake(shots, music);
    const look = style.look;
    // The plates with a version of their own on rice paper (the 墨 style); the rest draw ink as they draw a ballad.
    const paper = style.id === 'ink' ? 'ink' : look;
    const make: Record<SceneId, () => MvScene> = {
      relief: () => new Relief(init), diorama: () => new Diorama(init), bokeh: () => new Bokeh(init),
      tunnel: () => new Tunnel(init, look), drive: () => new Drive(init), kaleido: () => new Kaleido(init, look), flip: () => new Flip(init, look),
      rings: () => new Rings(init, look), poster: () => new Poster(init, look), ridges: () => new Ridges(init, paper), halftone: () => new Halftone(init, look), particles: () => new Particles(init, look),
      typewall: () => new TypeWall(init), ink: () => new Ink(init, song.name), crystal: () => new ArmillaryScene(init), cards: () => new CardsScene(init), debug: () => new DebugScene(init), subdivide: () => new SubdivideScene(init, look), scope: () => new ScopeScene(init),
      vinyl: () => new Vinyl(init, look), clouds: () => new Clouds(init, paper), city: () => new City(init, look), aurora: () => new Aurora(init, look),
      canvas: () => new CanvasScene(init, paper, init.seed), pillars: () => new Pillars(init, look, init.seed),
      ripple: () => new Ripple(init, look), channel: () => new Channel(init, look), orb: () => new Orb(init, look),
      menger: () => new Menger(init, look), sierpinski: () => new Sierpinski(init, look), cantor: () => new Cantor(init, look),
      papercut: () => new PaperCut(init), rain: () => new RainScene(init), lanterns: () => new LanternScene(init), neon: () => new NeonScene(init),
      kinetic: () => new KineticType(init), blackhole: () => new BlackHole(init, look), cubes: () => new Cubes(init, look), dots: () => new DotMatrix(init, look),
    };
    // (The plates slow to build even alone, built in steps of their own: the canvas's stroke plan, the subdivided
    // ball's levels; 0.1–0.25 s each in NetEase's Chromium.)
    const stepped: Partial<Record<SceneId, () => Generator<void, MvScene>>> = {
      canvas: () => CanvasScene.building(init, paper, init.seed), subdivide: () => SubdivideScene.building(init, look),
    };
    yield;
    if (this.loads !== token) return;
    for (const id of new Set(shots.map(s => s.scene))) {
      const steps = stepped[id];
      this.scenes[id] = steps ? yield* steps() : make[id]();
      yield;
      if (this.loads !== token) return;
    }
    // (The director's sections, joined: Shot.sectionIndex counts these.)
    const sections = music.a.sections;
    const looks = song.xyMusic || forceLook === 'none' ? [] : forceLook ? sections.map(s => (s.label === 'drop' ? null : forceLook)) : planLooks(sections, style, this.seed, off);
    yield* this.engine.settingLooks(song.palette, song.lines.map(l => l.text + (l.translation ?? '')).join(''));
    yield;
    if (this.loads !== token) return;
    this.director = new Director(style, shots, this.scenes, music, lyrics, song.palette, init.armillary, song.cover, !only && song.xyMusic, looks);
    this.hud.sigilLabel = this.director.sigil?.label ?? '';
    const last = lines[lines.length - 1];
    const opening = this.director.shots[0]?.scene !== 'cards';
    // The name in the leaned-on face of the song's lyric voice: pulse's condensed capitals, a ballad's serif, ink's
    // Garamond and Kai.
    const voice = VOICES[voiceFor(style.id === 'ink' ? 'ink' : look, this.seed)];
    this.director.overlay.setCredits(song.name ?? '', song.artists ?? [], lines[0]?.start ?? Infinity, last?.end ?? 0, song.duration, opening, voice.faces[1], 0.11 * voice.scale);
    this.resize();
  }

  unload(): void {
    const keep = this.song?.cover;
    for (const s of Object.values(this.scenes)) if (s && keep) { disposeScene(s.scene, keep); s.dispose?.(); }
    if (this.director && keep) disposeScene(this.director.overlay.scene, keep);
    this.scenes = {};
    this.director = null;
    this.engine.setCover(null);
    if (this.song) this.song.cover.dispose();
    this.song = null;
    disposeText();
  }

  resize(): void {
    this.engine.resize();
    for (const s of Object.values(this.scenes)) s!.resize(this.engine.aspect);
    const canvas = this.engine.renderer.domElement;
    (this.scenes.bokeh as Bokeh | undefined)?.setViewportHeight(canvas.height);
    const pr = this.engine.renderer.getPixelRatio();
    (this.scenes.tunnel as Tunnel | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.drive as Drive | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.rings as Rings | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.ridges as Ridges | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.halftone as Halftone | undefined)?.setViewport(canvas.width, canvas.height);
    (this.scenes.particles as Particles | undefined)?.setViewportHeight(canvas.height);
    (this.scenes.ink as Ink | undefined)?.setViewport(canvas.width, canvas.height);
    (this.scenes.crystal as ArmillaryScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.cards as CardsScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.debug as DebugScene | undefined)?.setViewport(canvas.width, canvas.height);
    (this.scenes.scope as ScopeScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.orb as Orb | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.clouds as Clouds | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.city as City | undefined)?.setViewport(canvas.width, canvas.height);
    (this.scenes.blackhole as BlackHole | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.dots as DotMatrix | undefined)?.setViewport(canvas.width, canvas.height);
    for (const s of Object.values(this.scenes)) if (s instanceof FractalPlate) s.setViewport(canvas.width, canvas.height, pr);
    this.director?.overlay.resize(this.engine.aspect);
    this.director?.overlay.setViewport(canvas.width, canvas.height, pr);
  }

  /** Renders song time t; returns the shot on screen, or null when nothing is loaded. */
  frame(t: number, dt: number): Shot | null {
    if (!this.director) return null;
    this.director.overlay.showBadge = this.hud.visible;
    const { scene, fx, shot, transition } = this.director.frame(t, dt, this.engine.aspect);
    this.transitioning = transition !== null;
    for (const s of Object.values(this.scenes)) s?.keepUp?.(t, this.engine.renderer);
    this.engine.render(scene.scene, scene.camera, fx, t, transition, this.director.overlay);
    const info = this.music!.at(t);
    this.hud.update(shot, this.director.shots.indexOf(shot), this.director.shots.length, info.bar + 1, this.music!.shownBpm(t));
    return shot;
  }

  /**
   * Readies every plate before the MV shows (each posed at its first shot and drawn off screen), then the motion
   * graphics layer and the transition quad, a plate between `pause`s — so no cut stalls on a plate's first
   * appearance. Stops when `cancelled` says so or another song is loaded.
   */
  async warm(pause: () => Promise<void>, cancelled: () => boolean = () => false): Promise<void> {
    const director = this.director, music = this.music, song = this.song;
    if (!director || !music || !song) return;
    const stop = () => cancelled() || this.director !== director;
    const lyrics = new LyricTrack(this.lines), aspect = this.engine.aspect;
    const posed: MvScene[] = [], compiling: Array<Promise<unknown>> = [];
    // Every plate's shaders compile together off the page's thread (Engine.compile), each set going once the plate is
    // posed, a plate between pauses (posing them all in one go — their words drawn — held the page up for 0.2 s).
    for (const [id, scene] of Object.entries(this.scenes) as Array<[SceneId, MvScene]>) {
      const shot = director.shots.find(s => s.scene === id);
      if (!shot) continue;
      const t = Math.min(shot.start + 0.2, (shot.start + shot.end) / 2);
      scene.update({ t, dt: 1 / 60, music, lyrics, palette: song.palette, shot, shotT: t - shot.start, aspect, fx: defaultFx() });
      posed.push(scene);
      compiling.push(this.engine.compile(scene.scene, scene.camera, scene.offscreen));
      await pause();
      if (stop()) return;
    }
    compiling.push(this.engine.compile(director.overlay.scene, director.overlay.camera), this.engine.compilePost());
    await Promise.all(compiling);
    if (stop()) return;
    // Then each plate is drawn once, the next only when the GPU is done with the last (Engine.idle): drawn right
    // behind it, a plate's first use of its programs waited on the page's thread for the one before, 50–110 ms each.
    for (const { scene, camera } of [...posed, director.overlay]) {
      this.engine.warm(scene, camera);
      await this.engine.idle(pause);
      if (stop()) return;
    }
    this.engine.warm();
  }

  get shots(): Shot[] { return this.director?.shots ?? []; }

  dispose(): void {
    this.unload();
    this.hud.dispose();
    this.engine.renderer.dispose();
    this.engine.renderer.domElement.remove();
  }
}
