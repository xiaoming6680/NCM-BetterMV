// One renderer for the whole session; per song it builds the scenes the song's style needs and a director.
import * as THREE from 'three';
import { Engine, defaultFx } from '../render/engine.ts';
import { disposeText } from '../render/text.ts';
import { Music } from '../director/music.ts';
import { LyricTrack } from '../director/lyrics.ts';
import { Director, planLooks, planShots, type LookId } from '../director/director.ts';
import { Relief } from '../scenes/relief.ts';
import { Shatter } from '../scenes/shatter.ts';
import { Diorama } from '../scenes/diorama.ts';
import { Bokeh } from '../scenes/bokeh.ts';
import { Tunnel } from '../scenes/tunnel.ts';
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
import { CrystalScene } from '../scenes/crystal.ts';
import { CardsScene } from '../scenes/cards.ts';
import { DebugScene } from '../scenes/debug.ts';
import { SubdivideScene } from '../scenes/subdivide.ts';
import { AlignScene } from '../scenes/align.ts';
import { ScopeScene } from '../scenes/scope.ts';
import { Vinyl } from '../scenes/vinyl.ts';
import { Clouds } from '../scenes/clouds.ts';
import { crystalSpec } from '../sigil/crystal.ts';
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

  constructor(container: HTMLElement, pixelRatio?: number) {
    this.engine = new Engine(container, pixelRatio);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.hud = new Hud(container);
  }

  /**
   * `off`: plates and looks the user turned off in the settings. `only` (development): every shot on this plate,
   * cycling through the given camera setups; `forceLook` (development) puts every section but the drops in that look.
   * `lyricDelay`: seconds this song's words show later (negative: earlier), the user's per-song setting.
   */
  load(song: PreparedSong, style: Style, off: ReadonlySet<SceneId | LookId> = new Set(), only?: { scene: SceneId; variants: string[] }, forceLook?: LookId | 'none', lyricDelay = 0): void {
    this.unload();
    this.song = song;
    this.style = style;
    this.engine.setPalette(song.palette.ink, song.palette.signal);
    this.engine.setCover(song.cover);
    const music = this.music = new Music(song.analysis);
    this.hud.glyph = style.glyph;
    // (A copy moved by the delay: the song's own lines stay as parsed, for the next load.)
    const lines = lyricDelay ? song.lines.map(l => ({ ...l, start: l.start + lyricDelay, end: l.end + lyricDelay, words: l.words.map(w => ({ ...w, start: w.start + lyricDelay, end: w.end + lyricDelay })) })) : song.lines;
    this.lines = lines;
    const lyrics = new LyricTrack(lines);
    const init: SceneInit = {
      cover: song.cover, coverPixels: song.coverPixels, coverSize: song.coverSize, palette: song.palette,
      music, lyrics, aspect: this.engine.aspect, title: song.name, artists: song.artists, stereo: song.stereo, xyMusic: song.xyMusic, crystal: crystalSpec(song.analysis, song.id),
    };
    // Pure music (or a song whose lyrics NetEase doesn't have) gets no word plates.
    let shots = planShots(music, style, song.id, { graphic: song.palette.graphic, lyrics: song.lines.length > 0 }, off);
    if (only) shots.forEach((sh, i) => { sh.scene = only.scene; sh.variant = only.variants[i % only.variants.length]; });
    else if (song.xyMusic) shots = scopeOnly(shots);
    const look = style.look;
    const make: Record<SceneId, () => MvScene> = {
      relief: () => new Relief(init), shatter: () => new Shatter(init), diorama: () => new Diorama(init), bokeh: () => new Bokeh(init),
      tunnel: () => new Tunnel(init, look), drive: () => new Drive(init), kaleido: () => new Kaleido(init, look), flip: () => new Flip(init, look),
      rings: () => new Rings(init, look), poster: () => new Poster(init, look), ridges: () => new Ridges(init, look), halftone: () => new Halftone(init, look), particles: () => new Particles(init, look),
      typewall: () => new TypeWall(init), ink: () => new Ink(init, song.name), crystal: () => new CrystalScene(init), cards: () => new CardsScene(init), debug: () => new DebugScene(init), subdivide: () => new SubdivideScene(init, look), align: () => new AlignScene(init), scope: () => new ScopeScene(init),
      vinyl: () => new Vinyl(init, look), clouds: () => new Clouds(init, look),
    };
    for (const id of new Set(shots.map(s => s.scene))) this.scenes[id] = make[id]();
    const sections = song.analysis.sections;
    const looks = song.xyMusic || forceLook === 'none' ? [] : forceLook ? sections.map(s => (s.label === 'drop' ? null : forceLook)) : planLooks(sections, style, song.id, off);
    this.engine.setLooks(song.palette, song.lines.map(l => l.text + (l.translation ?? '')).join(''));
    this.director = new Director(style, shots, this.scenes, music, lyrics, song.palette, init.crystal, song.cover, !only && song.xyMusic, looks);
    const badge = this.director.crystal;
    this.hud.crystalLabel = badge ? `${badge.label} · ${badge.triangles}△` : '';
    const last = lines[lines.length - 1];
    const opening = this.director.shots[0]?.scene !== 'cards';
    this.director.overlay.setCredits(song.name ?? '', song.artists ?? [], lines[0]?.start ?? Infinity, last?.end ?? 0, song.duration, opening);
    this.resize();
  }

  unload(): void {
    const keep = this.song?.cover;
    for (const s of Object.values(this.scenes)) if (s && keep) disposeScene(s.scene, keep);
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
    (this.scenes.crystal as CrystalScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.cards as CardsScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.debug as DebugScene | undefined)?.setViewport(canvas.width, canvas.height);
    (this.scenes.align as AlignScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.scope as ScopeScene | undefined)?.setViewport(canvas.width, canvas.height, pr);
    (this.scenes.clouds as Clouds | undefined)?.setViewport(canvas.width, canvas.height, pr);
    this.director?.overlay.resize(this.engine.aspect);
    this.director?.overlay.setViewport(canvas.width, canvas.height, pr);
  }

  /** Renders song time t; returns the shot on screen, or null when nothing is loaded. */
  frame(t: number, dt: number): Shot | null {
    if (!this.director) return null;
    this.director.overlay.showBadge = this.hud.visible;
    const { scene, fx, shot, transition } = this.director.frame(t, dt, this.engine.aspect);
    this.engine.render(scene.scene, scene.camera, fx, t, transition, this.director.overlay);
    const info = this.music!.at(t);
    this.hud.update(shot, this.director.shots.indexOf(shot), this.director.shots.length, info.bar + 1, info.bpm);
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
    const lyrics = new LyricTrack(this.lines), aspect = this.engine.aspect;
    for (const [id, scene] of Object.entries(this.scenes) as Array<[SceneId, MvScene]>) {
      const shot = director.shots.find(s => s.scene === id);
      if (!shot) continue;
      const t = Math.min(shot.start + 0.2, (shot.start + shot.end) / 2);
      scene.update({ t, dt: 1 / 60, music, lyrics, palette: song.palette, shot, shotT: t - shot.start, aspect, fx: defaultFx() });
      this.engine.warm(scene.scene, scene.camera);
      await pause();
      if (cancelled() || this.director !== director) return;
    }
    this.engine.warm(director.overlay.scene, director.overlay.camera);
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
