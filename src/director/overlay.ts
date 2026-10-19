// Motion-graphics layer over every shot, after the user's MG pieces (《△ 三角》: hairlines, hard easing, exact beats).
//  · Drum shapes: in choruses and drops each drum puts a hairline shape up, so the more drums a song has, the more
//    shapes: a kick grows a triangle out of the middle, a snare flips a pair of small triangles in either side, a
//    hi-hat grows a small triangle near an edge. Ballads: circles, no hi-hats. A section with hardly any kicks takes
//    its downbeats for them.
//  · Countdown: through a build or pre-chorus that rises into a louder section, a bar low in the frame fills towards
//    the drop with a tick per beat and the bars left at its end; its last bar flickers in eighths.
//  · Snare ticks: in other loud pulse sections, each snare flashes short ticks at the four edges of the frame.
//  · Title card: each new section is announced top left — a rule sweeps out, the label slides in, then both go.
//  · Credits: over the first seconds the song's name and artists stand low on the left, over a rule that sweeps out;
//    again over the last seconds, once the last line has been sung.
//  · Badge: the song's armillary as a small hairline figure top right, turning, its core lifting on the kicks (beside
//    the HUD's notation: rings and marks), except while the armillary has the whole frame.
// Drawn additive in an orthographic frame (height 2), faded out with the picture.
import * as THREE from 'three';
import { LineBatch } from '../render/lines.ts';
import { textMesh, textPrimer, type Face } from '../render/text.ts';
import type { Music } from './music.ts';
import type { Style } from '../style/style.ts';
import type { Palette } from '../render/palette.ts';
import type { Shot } from '../scenes/types.ts';
import { clamp01, outExpo, rng, surge } from '../scenes/types.ts';
import type { Fx } from '../render/engine.ts';
import type { SectionLabel } from '../types.ts';
import { lastIndex } from './music.ts';
import type { Armillary } from '../sigil/armillary.ts';

const NAMES: Record<SectionLabel, string> = {
  intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏',
};

/** The plates filmed like a film (and the push tunnel): a hairline shape over them reads as a sticker on the lens. */
const FILMED = new Set(['drive', 'city', 'aurora', 'pillars', 'canvas']);

/** A drum's hits that put a shape up: their times and strengths, at least `gap` seconds apart. */
interface Hits { t: Float64Array; s: Float64Array }

/**
 * Where each of n hits puts its shape: anywhere in a box (centre cx, cy and half-sizes w, h; x in units of the frame's
 * half-width, y of its half-height), at least `jump` from where the one before went, so consecutive hits jump about.
 * Made once per song from the hit's index: seeking shows the same picture.
 */
function scatter(n: number, seed: number, cx: number, cy: number, w: number, h: number, jump: number): Float32Array {
  const out = new Float32Array(2 * n);
  let px = Infinity, py = Infinity;
  for (let i = 0; i < n; i++) {
    const random = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    let x = cx, y = cy;
    for (let k = 0; k < 8; k++) {
      x = cx + (random() * 2 - 1) * w; y = cy + (random() * 2 - 1) * h;
      if (Math.hypot(x - px, y - py) >= jump) break;
    }
    out[2 * i] = x; out[2 * i + 1] = y; px = x; py = y;
  }
  return out;
}
function spaced(hits: ReadonlyArray<readonly [number, number]>, min: number, gap: number): Hits {
  const t: number[] = [], s: number[] = [];
  for (const [at, k] of hits) if (k > min && (!t.length || at - t[t.length - 1] >= gap)) { t.push(at); s.push(k); }
  return { t: Float64Array.from(t), s: Float64Array.from(s) };
}

type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Card { index: number; label: Mesh }
/** The credits' name and artists, each twice (with a dark halo for dark plates, without for paper), and when. */
interface Credits { title: [Mesh, Mesh]; artist: [Mesh, Mesh] | null; windows: Array<[number, number]> }

export class MgOverlay {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  /** Where the badge is seen from (the camera, straight in front of it). */
  private badgeEye = new THREE.Vector3();
  private lines = new LineBatch(4000);
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private aspect = 16 / 9;
  private snares: Float64Array;
  /** The drum shapes' hits; `sparse`: the sections whose kick triangles go on the downbeats instead. */
  private kicks: Hits;
  private snareHits: Hits;
  private hats: Hits;
  private downbeats: Hits;
  /** Per hit, where its shape goes (scatter): kicks and downbeats in the middle of the frame, snare pairs to the sides. */
  private kickAt: Float32Array;
  private downAt: Float32Array;
  private snareAt: Float32Array;
  private sparse: boolean[];
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

  constructor(private palette: Palette, private style: Style, private music: Music, private badge: Armillary | null = null) {
    // (The labels and credits are made as they come up: their program is compiled with the plates beforehand.)
    this.scene.add(textPrimer());
    this.camera = new THREE.OrthographicCamera(-this.aspect, this.aspect, 1, -1, 0.1, 20);
    this.camera.position.set(0, 0, 5);
    if (badge) this.scene.add(badge.group);
    this.scene.add(this.lines.mesh);
    this.scrim.renderOrder = -1;
    this.scrim.visible = false;
    this.scene.add(this.scrim);
    this.soft = style.look === 'ballad';
    this.snares = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.4), h => h[0]);
    // At most 5 kicks, 6 snares and 6 hi-hats a second (a double kick drum or a hi-hat roll would strobe).
    this.kicks = spaced(music.a.hits.kick, 0.4, 0.2);
    this.snareHits = spaced(music.a.hits.snare, 0.4, 0.16);
    this.hats = spaced(music.a.hits.hat, 0.5, 0.16);
    this.downbeats = { t: Float64Array.from(music.downbeats), s: new Float64Array(music.downbeats.length).fill(0.8) };
    this.kickAt = scatter(this.kicks.t.length, 0x6b1c, 0, 0, 0.5, 0.4, 0.45);
    this.downAt = scatter(this.downbeats.t.length, 0x2d0b, 0, 0, 0.5, 0.4, 0.45);
    this.snareAt = scatter(this.snareHits.t.length, 0x51ed, 0.6, 0, 0.25, 0.55, 0.35);
    this.sparse = music.a.sections.map(s => {
      let n = 0;
      for (const t of this.kicks.t) if (t >= s.start && t < s.end) n++;
      return n / Math.max(1, s.end - s.start) < 0.3;
    });
    // "副歌 02": which occurrence of its label each section is.
    const seen = new Map<SectionLabel, number>();
    this.ordinal = music.a.sections.map(s => { const n = (seen.get(s.label) ?? 0) + 1; seen.set(s.label, n); return n; });
  }

  /**
   * The song's name and artists: at the opening, up until a little before the first line is sung (between 3.5 and
   * 8 seconds in); at the end, from 1.5 s after the last line (at most the last 7 s), if that leaves 3 s.
   */
  /**
   * `opening`: false when the opening cards already show the title. `titleFace`, `titleH`: the name's face and height,
   * the leaned-on face of the song's lyric voice (the player's; the wide display face it was set in is gone: the user
   * dropped it from pulse, “律动的英文字体就用那个新的，旧的不用了”, then everywhere, “以后都不要用这个字体”).
   */
  setCredits(title: string, artists: string[], firstLine: number, lastLine: number, duration: number, opening = true, titleFace: Face = 'condensedBlack', titleH = 0.13): void {
    if (!title) return;
    const make = (text: string, face: Face, h: number) => (['dark', 'none'] as const).map(halo => {
      const m = textMesh(text, face, h, { px: face === 'bold' ? 96 : 160, halo });
      m.material.toneMapped = false;
      m.visible = false;
      this.scene.add(m);
      return m;
    }) as [Mesh, Mesh];
    const artist = artists.length ? make(artists.join(' / '), 'bold', 0.052) : null;
    const windows: Array<[number, number]> = opening ? [[0.3, Math.min(8, Math.max(3.5, firstLine - 0.4))]] : [];
    const end: [number, number] = [Math.max(lastLine + 1.5, duration - 7), duration - 0.3];
    if (end[1] - end[0] >= 3 && end[0] > (windows[0]?.[1] ?? 0) + 5) windows.push(end);
    this.credits = { title: make(title, titleFace, titleH), artist, windows };
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
  /** Only the song's name and artists (oscilloscope music: nothing drawn over the scope's picture). */
  quiet = false;

  /** A push (src/director/moments.ts) under way: seconds since it, its strength, its seed. */
  rush: { age: number; k: number; seed: number } | null = null;

  update(t: number, shot: Shot, fx: Fx, light = false): void {
    const busy = !this.quiet;
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

    // Drum shapes in big sections, each drum's hits since the section began (newest first) while they last.
    // (Kinetic type is a page of its own, the dot wall a screen: shapes over them fight their own.)
    const shapes = busy && big && !FILMED.has(shot.scene) && shot.scene !== 'kinetic' && shot.scene !== 'dots';
    const each = (hits: Hits, life: number, draw: (i: number, age: number, x: number, s: number) => void) => {
      for (let i = lastIndex(hits.t, t); i >= 0; i--) {
        const age = t - hits.t[i];
        if (age >= life || hits.t[i] < sec.start - 0.01) break;
        draw(i, age, age / life, hits.s[i]);
      }
    };
    if (shapes) {
      // Kicks: a triangle grows at a place of its own in the middle of the frame (scatter: each kick jumps away from
      // the last), the newest in the signal colour; stronger kicks grow bigger.
      let newest = true;
      const sparse = this.sparse[shot.sectionIndex], kicks = sparse ? this.downbeats : this.kicks, at = sparse ? this.downAt : this.kickAt;
      each(kicks, Math.min(0.9, Math.max(0.5, beat * 1.4)), (i, _age, x, s) => {
        const random = rng(Math.round(kicks.t[i] * 1000));
        const turn = this.soft ? 0 : (random() - 0.5) * 0.5 + (random() < 0.5 ? -1 : 1) * 0.15 * outExpo(x);
        const r = 0.16 + outExpo(x) * (this.soft ? 0.75 : 0.7 + 0.6 * s);
        const k = (1 - x) * (1 - x) * (this.soft ? 0.35 : 0.3 + 0.3 * s);
        poly(at[2 * i] * this.aspect, at[2 * i + 1], r, this.soft ? 64 : 3, Math.PI / 2 + turn, 1.4, newest && !this.soft ? signal : paper, k);
        newest = false;
      });
      // Snares: a pair of triangles grows either side, pointing out, and flips over (a sixth of a turn) to point at
      // the middle; each pair at a place of its own (scatter), away from the pair before.
      each(this.snareHits, this.soft ? 0.7 : 0.55, (i, _age, x, s) => {
        const dx = this.snareAt[2 * i] * this.aspect, y = this.snareAt[2 * i + 1];
        const r = 0.06 + outExpo(x) * (0.14 + 0.1 * s);
        const flip = this.soft ? 0 : (Math.PI / 3) * outExpo(x * 2);
        const k = (1 - x) * (1 - x) * (this.soft ? 0.35 : 0.6);
        poly(dx, y, r, this.soft ? 48 : 3, flip, 1.4, paper, k);
        poly(-dx, y, r, this.soft ? 48 : 3, Math.PI - flip, 1.4, paper, k);
      });
      // Hi-hats: a small triangle grows near an edge of the frame, pointing any way.
      if (!this.soft) each(this.hats, 0.35, (i, _age, x, s) => {
        const random = rng(Math.round(this.hats.t[i] * 1000) ^ 0xa7);
        const side = random() < 0.5 ? -1 : 1, sideways = random() < 0.6;
        const px = sideways ? side * this.aspect * (0.8 + random() * 0.1) : (random() * 2 - 1) * this.aspect * 0.8;
        const py = sideways ? (random() * 2 - 1) * 0.78 : side * (0.78 + random() * 0.1);
        const r = 0.03 + outExpo(x) * (0.03 + 0.03 * s);
        poly(px, py, r, 3, random() * Math.PI * 2, 1.2, signal, (1 - x) * (1 - x) * 0.55);
      });
    }

    // A push: ribbons of light rush out of the middle, from rest to past the corners in a few tenths, fading.
    if (busy && this.rush && this.rush.age < 0.45) {
      const { age, k, seed } = this.rush, random = rng(seed);
      const fade = (1 - age / 0.45) * (1 - age / 0.45) * k;
      const colors = [signal, this.palette.accent, paper];
      for (let n = 0; n < 30; n++) {
        const a = random() * Math.PI * 2, speed = 0.7 + 0.6 * random(), len = 0.15 + 0.45 * random(), w = 1.5 + 5 * random();
        const r0 = 0.08 + 2.6 * speed * surge(age, 0.07);
        const r1 = r0 + len * Math.min(1, 0.3 + age / 0.06);
        seg(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, w, colors[n % 3], fade * (0.5 + 0.5 * random()));
      }
    }

    // Countdown through a build that rises into a louder section: a bar low in the frame fills towards the drop, a
    // tick per beat, the bars left at its end; its last bar flickers in eighths.
    const next = m.a.sections[shot.sectionIndex + 1];
    if (busy && (sec.label === 'build' || sec.label === 'pre') && next && next.energy > sec.energy + 0.08) {
      const p = clamp01((t - sec.start) / Math.max(0.1, sec.end - sec.start));
      const first = Math.ceil(m.beatPos(sec.start)), last = Math.floor(m.beatPos(sec.end - 0.001));
      const step = Math.max(1, Math.ceil((last - first + 1) / 64));
      const lastBar = sec.end - t <= m.at(t).barEnd - t + 0.01;
      const flick = lastBar && !this.soft ? (Math.floor(info.pos * 2) % 2 === 0 ? 1 : 0.3) : 1;
      const x0 = -0.55, x1 = 0.55, y = -0.84, k = 0.55 * flick;
      seg(x0, y, x1, y, 1, paper, 0.18 * flick);
      seg(x0, y, x0 + (x1 - x0) * p, y, 2, signal, k);
      for (let b = first; b <= last; b += step) {
        const at = m.timeOfBeat(b), fraction = clamp01((at - sec.start) / (sec.end - sec.start));
        const x = x0 + (x1 - x0) * fraction, passed = at <= t, bar = m.a.beatInBar[b] === 0;
        seg(x, y + 0.012, x, y + (bar ? 0.045 : 0.025), 1.2, passed ? signal : paper, (passed ? 0.7 : 0.25) * flick);
      }
      this.countdown(Math.max(1, m.barsBetween(t, sec.end)), x1 + 0.04, y, flick * vis);
    } else this.countdown(0, 0, 0, 0);

    // Snare ticks at the edges in loud pulse sections (where the snares put no shapes up).
    if (busy && !this.soft && sec.energy > 0.6 && !shapes) {
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
    this.titleCard(t, shot, beat, busy ? 1 - fx.fade : 0, seg);
    this.creditsCard(t, seg);
    // The armillary badge, 16 px across in radius, its centre 58 px from the right edge and 38 px from the top.
    const badge = this.badge;
    if (busy && badge && this.showBadge && shot.scene !== 'crystal' && shot.scene !== 'cards' && vis > 0.01) {
      const px = 2 / Math.max(1, this.resolution.y / this.pixelRatio);
      badge.group.position.set(this.aspect - 58 * px, 1 - 38 * px, 0);
      badge.group.scale.setScalar(16 * px);
      badge.set({ turn: t * 0.5, beat: m.at(t).pos, bar: 0, whirl: 0, open: 1, align: 0, recede: 0, merge: 0, pulse: m.pulse('kick', t, 0.1), alpha: vis * 0.85 });
      badge.lines(L, 1, 1, this.badgeEye.set(badge.group.position.x, badge.group.position.y, 5), true);
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
    const age = t - sec.start, life = this.music.barDuration(sec.start + 0.01) * 1.6;
    // (The type wall and the poster set their own type up there.)
    const show = vis > 0 && idx > 0 && age >= 0 && age < life && shot.scene !== 'poster' && shot.scene !== 'kinetic';
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
