// Motion-graphics layer over every shot, after the user's MG pieces (《△ 三角》: hairlines, hard easing, exact beats).
//  · Bursts: on the downbeats of choruses and drops a hairline shape grows out of the middle (every beat in a drop);
//    triangles for pulse, circles for ballad.
//  · Countdown: through a build or pre-chorus that rises into a louder section, a ring fills around the middle with a
//    tick per beat and the bars left in its centre; its last bar flickers in eighths.
//  · Snare ticks: in loud pulse sections, each snare flashes short ticks at the four edges of the frame.
//  · Title card: each new section is announced top left — a rule sweeps out, the label slides in, then both go.
//  · Credits: over the first seconds the song's name and artists stand low on the left, over a rule that sweeps out;
//    again over the last seconds, once the last line has been sung.
//  · Badge: the song's crystal as a small hairline figure top right, turning, flashing on the kicks (beside the HUD's
//    notation and triangle count), except while the crystal has the whole frame.
// Drawn additive in an orthographic frame (height 2), faded out with the picture.
import * as THREE from 'three';
import { LineBatch } from '../render/lines.ts';
import { textMesh } from '../render/text.ts';
import type { Music } from './music.ts';
import type { Style } from '../style/style.ts';
import type { Palette } from '../render/palette.ts';
import type { Shot } from '../scenes/types.ts';
import { clamp01, outExpo, rng } from '../scenes/types.ts';
import type { Fx } from '../render/engine.ts';
import type { SectionLabel } from '../types.ts';
import { lastIndex } from './music.ts';
import type { Crystal } from '../sigil/crystal.ts';

const NAMES: Record<SectionLabel, string> = {
  intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏',
};

type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Card { index: number; label: Mesh }
/** The credits' name and artists, each twice (with a dark halo for dark plates, without for paper), and when. */
interface Credits { title: [Mesh, Mesh]; artist: [Mesh, Mesh] | null; windows: Array<[number, number]> }

export class MgOverlay {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private lines = new LineBatch(4000);
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private aspect = 16 / 9;
  private snares: Float64Array;
  private card: Card | null = null;
  private ordinal: number[];
  private readonly soft: boolean;
  private light = false;
  private credits: Credits | null = null;
  /**
   * A soft shadow up from the bottom-left corner behind the credits, so they read over a bright picture. (The frame is
   * HDR at this point — a bright sky is several times white — so near the words it has to be all but opaque.)
   */
  private scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uAlpha; varying vec2 vUv;
      void main() { float d = length(vUv * vec2(1.0, 1.15)); gl_FragColor = vec4(0.0, 0.0, 0.0, uAlpha * (1.0 - smoothstep(0.4, 1.0, d))); }`,
  }));

  /** The badge shows with the HUD (the player hides both while the playback controls are up). */
  showBadge = true;

  constructor(private palette: Palette, private style: Style, private music: Music, private badge: Crystal | null = null) {
    this.camera = new THREE.OrthographicCamera(-this.aspect, this.aspect, 1, -1, 0.1, 20);
    this.camera.position.set(0, 0, 5);
    if (badge) this.scene.add(badge.group);
    this.scene.add(this.lines.mesh);
    this.scrim.renderOrder = -1;
    this.scrim.visible = false;
    this.scene.add(this.scrim);
    this.soft = style.look === 'ballad';
    this.snares = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.4), h => h[0]);
    // "副歌 02": which occurrence of its label each section is.
    const seen = new Map<SectionLabel, number>();
    this.ordinal = music.a.sections.map(s => { const n = (seen.get(s.label) ?? 0) + 1; seen.set(s.label, n); return n; });
  }

  /**
   * The song's name and artists: at the opening, up until a little before the first line is sung (between 3.5 and
   * 8 seconds in); at the end, from 1.5 s after the last line (at most the last 7 s), if that leaves 3 s.
   */
  /** `opening`: false when the opening cards already show the title. */
  setCredits(title: string, artists: string[], firstLine: number, lastLine: number, duration: number, opening = true): void {
    if (!title) return;
    const make = (text: string, face: 'display' | 'bold', h: number) => (['dark', 'none'] as const).map(halo => {
      const m = textMesh(text, face, h, { px: face === 'display' ? 160 : 96, halo });
      m.material.toneMapped = false;
      m.visible = false;
      this.scene.add(m);
      return m;
    }) as [Mesh, Mesh];
    const artist = artists.length ? make(artists.join(' / '), 'bold', 0.052) : null;
    const windows: Array<[number, number]> = opening ? [[0.3, Math.min(8, Math.max(3.5, firstLine - 0.4))]] : [];
    const end: [number, number] = [Math.max(lastLine + 1.5, duration - 7), duration - 0.3];
    if (end[1] - end[0] >= 3 && end[0] > (windows[0]?.[1] ?? 0) + 5) windows.push(end);
    this.credits = { title: make(title, 'display', 0.11), artist, windows };
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  /** `light`: the plate is on paper — the glowing hairlines would vanish there, so only the title card shows, in ink. */
  update(t: number, shot: Shot, fx: Fx, light = false): void {
    const L = this.lines;
    L.clear();
    this.light = light;
    const m = this.music, info = m.at(t), sec = shot.section;
    const beat = 60 / Math.max(40, info.bpm);
    const vis = (1 - fx.fade) * (light ? 0 : 1);
    const { paper, signal } = this.palette;
    const seg = (ax: number, ay: number, bx: number, by: number, w: number, c: THREE.Color, k: number) => {
      if (k * vis > 0.004) L.seg(ax, ay, 0, bx, by, 0, w, c.r * k * vis, c.g * k * vis, c.b * k * vis);
    };
    const poly = (cx: number, cy: number, r: number, sides: number, rot: number, w: number, c: THREE.Color, k: number) => {
      for (let i = 0; i < sides; i++) {
        const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
        seg(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, w, c, k);
      }
    };
    const big = sec.label === 'chorus' || sec.label === 'drop';

    // Bursts from the middle on downbeats of big sections (every beat in a drop).
    if (big && shot.scene !== 'drive') {
      const every = sec.label === 'drop' && !this.soft ? 1 : m.meter;
      const n = Math.floor(info.pos / every);
      for (let q = 0; q < 2; q++) {
        const at = (n - q) * every, age = (info.pos - at) * beat;
        if (age < 0 || at < m.beatPos(sec.start) - 0.01) continue;
        const life = beat * every * 1.1, x = clamp01(age / life);
        if (x >= 1) continue;
        const r = 0.18 + outExpo(x) * (this.soft ? 0.9 : 1.35);
        const k = (1 - x) * (1 - x) * (this.soft ? 0.35 : 0.55);
        const rot = Math.PI / 2 + (this.soft ? 0 : (rng(at * 7919)() - 0.5) * 0.5);
        poly(0, 0, r, this.soft ? 64 : 3, rot, 1.4, q === 0 && !this.soft ? signal : paper, k);
      }
    }

    // Countdown through a build that rises into a louder section: a bar low in the frame fills towards the drop, a
    // tick per beat, the bars left at its end; its last bar flickers in eighths.
    const next = m.a.sections[shot.sectionIndex + 1];
    if ((sec.label === 'build' || sec.label === 'pre') && next && next.energy > sec.energy + 0.08) {
      const p = clamp01((t - sec.start) / Math.max(0.1, sec.end - sec.start));
      const beats = Math.min(64, Math.max(1, Math.round((sec.end - sec.start) / beat)));
      const lastBar = sec.end - t < beat * m.meter;
      const flick = lastBar && !this.soft ? (Math.floor(info.pos * 2) % 2 === 0 ? 1 : 0.3) : 1;
      const x0 = -0.55, x1 = 0.55, y = -0.84, k = 0.55 * flick;
      seg(x0, y, x1, y, 1, paper, 0.18 * flick);
      seg(x0, y, x0 + (x1 - x0) * p, y, 2, signal, k);
      for (let b = 0; b <= beats; b++) {
        const x = x0 + ((x1 - x0) * b) / beats, passed = b / beats <= p, bar = b % m.meter === 0;
        seg(x, y + 0.012, x, y + (bar ? 0.045 : 0.025), 1.2, passed ? signal : paper, (passed ? 0.7 : 0.25) * flick);
      }
      this.countdown(Math.ceil(((sec.end - t) / beat - 1e-3) / m.meter), x1 + 0.04, y, flick * vis);
    } else this.countdown(0, 0, 0, 0);

    // Snare ticks at the edges in loud pulse sections.
    if (!this.soft && sec.energy > 0.6) {
      const i = lastIndex(this.snares, t);
      const age = i >= 0 ? t - this.snares[i] : 99;
      if (age < 0.18) {
        const k = (1 - age / 0.18) * 0.7, A = this.aspect, d = 0.07;
        seg(-A + 0.05, 0, -A + 0.05 + d, 0, 1.6, paper, k);
        seg(A - 0.05, 0, A - 0.05 - d, 0, 1.6, paper, k);
        seg(0, 0.95, 0, 0.95 - d, 1.6, paper, k);
        seg(0, -0.95, 0, -0.95 + d, 1.6, paper, k);
      }
    }

    // Title card for each new section after the first.
    this.titleCard(t, shot, beat, 1 - fx.fade, seg);
    this.creditsCard(t, seg);
    // Branching (pdoom's FOOM, the technique): through the bar before a drop, hairlines grow out of the middle along
    // the triangle's three directions and fork on every eighth note — 3, 6, 12 … 384 tips — filling the frame as
    // the drop lands.
    if (shot.scene === 'crystal' && shot.variant === 'orbit') {
      const e8 = clamp01((t - shot.start) / Math.max(0.2, shot.end - shot.start)) * 8;
      const flick = 0.75 + 0.25 * Math.cos(e8 * Math.PI * 2);
      const grow = (level: number, x: number, y: number, ang: number, len: number) => {
        const f = clamp01(e8 - level);
        if (f <= 0) return;
        const ex = x + Math.cos(ang) * len * f, ey = y + Math.sin(ang) * len * f;
        seg(x, y, ex, ey, level < 2 ? 1.6 : 1.1, level % 2 ? signal : paper, (1.3 - level * 0.06) * flick);
        if (f < 1 || level >= 7) return;
        const spread = 0.62 - level * 0.03;
        grow(level + 1, ex, ey, ang - spread, len * 0.8);
        grow(level + 1, ex, ey, ang + spread, len * 0.8);
      };
      for (let r = 0; r < 3; r++) grow(0, 0, 0, Math.PI / 2 + (r * Math.PI * 2) / 3, 0.4);
    }

    // The crystal badge, 16 px across in radius, its centre 58 px from the right edge and 38 px from the top.
    const badge = this.badge;
    if (badge && this.showBadge && shot.scene !== 'crystal' && vis > 0.01) {
      const px = 2 / Math.max(1, this.resolution.y / this.pixelRatio);
      badge.group.position.set(this.aspect - 58 * px, 1 - 38 * px, 0);
      badge.group.scale.setScalar(16 * px);
      badge.set({ turn: t * 0.6, tilt: 0.4, flash: m.pulse('kick', t, 0.1), burst: 0, alpha: vis * 0.85 });
      badge.group.updateMatrixWorld();
      badge.lines(L, 1, 1);
    } else badge?.set({ alpha: 0 });
    L.commit(this.resolution, this.pixelRatio);
  }

  private creditsCard(t: number, seg: (ax: number, ay: number, bx: number, by: number, w: number, c: THREE.Color, k: number) => void): void {
    const o = this.credits;
    if (!o) return;
    const w = o.windows.find(([a, b]) => t >= a && t < b);
    const show = !!w, [from, to] = w ?? [0, 0];
    const pick = this.light ? 1 : 0;
    for (const pair of [o.title, o.artist]) if (pair) pair.forEach((m, i) => { m.visible = show && i === pick; });
    this.scrim.visible = show && !this.light;
    if (!show) return;
    const title = o.title[pick], artist = o.artist?.[pick];
    const x0 = -this.aspect + 0.14, y = -0.5;
    const into = (d: number) => outExpo(clamp01((t - from - d) / 0.9));
    const out = 1 - clamp01((t - (to - 0.7)) / 0.7);
    const ink = this.light ? this.palette.ink : this.palette.paper;
    // The rule sweeps out first; the name rises onto it; the artists follow under it.
    const maxW = this.aspect * 1.3;
    const titleW = Math.min(maxW, title.userData.width as number);
    title.scale.setScalar(titleW / (title.userData.width as number));
    seg(x0, y, x0 + (titleW + 0.06) * into(0), y, 1.4, this.palette.signal, 0.9 * out);
    title.position.set(x0, y + 0.085 - (1 - into(0.15)) * 0.05, 0);
    title.material.color.copy(ink);
    title.material.opacity = into(0.15) * out;
    this.scrim.scale.set(Math.max(1.8, titleW + 1.1), 1.15, 1);
    this.scrim.position.set(-this.aspect + this.scrim.scale.x / 2, -1 + 1.15 / 2, -1);
    (this.scrim.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.96 * into(0) * out;
    if (artist) {
      artist.scale.setScalar(Math.min(1, maxW / (artist.userData.width as number)));
      artist.position.set(x0 + (1 - into(0.35)) * -0.04, y - 0.07, 0);
      artist.material.color.copy(ink);
      artist.material.opacity = 0.75 * into(0.35) * out;
    }
  }

  private digits = new Map<number, Mesh>();
  private shownDigit: Mesh | null = null;

  /** The bars left before the drop, at the end of the countdown bar ("04"). */
  private countdown(n: number, x: number, y: number, k: number): void {
    if (this.shownDigit) this.shownDigit.visible = false;
    if (n <= 0 || k <= 0.01) return;
    let mesh = this.digits.get(n);
    if (!mesh) {
      mesh = textMesh(String(n).padStart(2, '0'), 'bold', 0.04, { px: 96, halo: 'none' });
      mesh.material.toneMapped = false;
      this.scene.add(mesh);
      this.digits.set(n, mesh);
    }
    mesh.visible = true;
    mesh.position.set(x, y + 0.02, 0);
    mesh.material.color.copy(this.palette.signal);
    mesh.material.opacity = 0.85 * k;
    this.shownDigit = mesh;
  }

  private titleCard(t: number, shot: Shot, beat: number, vis: number, seg: (ax: number, ay: number, bx: number, by: number, w: number, c: THREE.Color, k: number) => void): void {
    const idx = shot.sectionIndex, sec = shot.section;
    const age = t - sec.start, life = beat * this.music.meter * 1.6;
    // (The type wall and the poster set their own type up there.)
    const show = idx > 0 && age >= 0 && age < life && shot.scene !== 'typewall' && shot.scene !== 'poster';
    if (!show) {
      if (this.card) this.card.label.visible = false;
      return;
    }
    if (!this.card || this.card.index !== idx) {
      if (this.card) { this.scene.remove(this.card.label); this.card.label.geometry.dispose(); this.card.label.material.dispose(); }
      const text = `${NAMES[sec.label]}  ${String(this.ordinal[idx]).padStart(2, '0')}`;
      const label = textMesh(text, 'bold', 0.045, { px: 96, halo: 'none' });
      label.material.toneMapped = false;
      this.scene.add(label);
      this.card = { index: idx, label };
    }
    const x0 = -this.aspect + 0.12, y = 0.8;
    const into = outExpo(clamp01(age / (beat * 0.75)));
    const out = clamp01((age - (life - beat)) / beat);
    const rule = 0.34 * into * (1 - out);
    const k = 0.55 * (1 - out) * vis;
    seg(x0, y - 0.045, x0 + rule, y - 0.045, 1.2, this.palette.signal, 0.9 * (1 - out));
    const label = this.card.label;
    label.visible = k > 0.01;
    label.position.set(x0 + (1 - into) * -0.05, y, 0);
    label.material.color.copy(this.light ? this.palette.ink : this.palette.paper);
    label.material.opacity = k * into;
  }
}
