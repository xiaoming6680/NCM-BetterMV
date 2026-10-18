// Kinetic type (叠字), after the rhythm-game BGA of nora2r's B.B.K.K.B.K.K. (BOF2013, BGA by 出前), one of the
// references of issue #3: the word being sung is the picture. Set big in a heavy sans on the ink ground, it comes in
// with a hard slide (smeared along its way), and is repeated: copies stack up tight, of alternating sizes, and the
// drums add more. Behind and beside the words, flat bars hatched with 45° stripes in the cover's colours slide in;
// their stripes step on every drum like a belt. Each line of the song gets one layout, its words flowing into it:
//   echo   the words pile up, the newest at the bottom pushing the stack up; drums repeat the word sung
//   bar    the word on a hatched bar across the frame, the next one pushing it off; a bass meter under it
//   crop   the word fills the frame, the one before it bigger still and cut by the edges, drifting apart
//   panel  a paper panel slides over one side, the word stood up on it in ink, repeated, every other copy mirrored
//   chip   the word beside a hatched square that turns on the drums, three level meters (bass, mids, treble) below
// Between lines (or before the first) the song's name stands in the chip layout. A small ticker low on the frame
// writes the line so far, word by word, and its translation, so the line reads though one word fills the frame.
// Motion: slides and steps are critically damped snaps from rest (types.ts), every move lands within a few hundredths
// of the word or drum it follows; lines change layout at most every line (about every two or three seconds), the
// words inside a layout change at most about four times a second (closer words are set together).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { punch, rng, snap } from './types.ts';
import { textTexture, hasCjk, type TextTexture } from '../render/text.ts';
import { Accents } from './hits.ts';
import { lastIndex } from '../director/music.ts';
import type { LyricLine } from '../types.ts';

const H = 9; // page height in world units
const FOV = 22;
const DIST = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const FACE = 'bold' as const;
/** Seconds a word or bar takes to slide in, and the outgoing layout to slide off. */
const ENTER = 0.2, EXIT = 0.16;
/** Exposure of the slides' smear, seconds (a heavier smear than the lens's film half-turn: the BGA's look). */
const SHUTTER = 1 / 36;
/** Units (words set together) never closer than this: faster changes read as flicker. */
const MIN_GAP = 0.26;
/** snap()'s spring (types.ts), for its speed. */
const SK = 9, SK1 = 1 - (1 + SK) * Math.exp(-SK);
/** d snap(x) / dx: zero at rest, peaking a ninth of the way in. */
const snapRate = (x: number) => (x <= 0 || x >= 1 ? 0 : (SK * SK * x * Math.exp(-SK * x)) / SK1);
/** Visible height of a line of capitals (or CJK) as a share of the em, and the step between stacked rows. */
const CAP = { latin: 0.72, cjk: 0.92 };
const STEP = { latin: 0.8, cjk: 1.0 };
/** Row sizes in an echo stack, in turn. */
const ECHO_SIZES = [1, 0.62, 0.84, 0.7, 0.94, 0.56];
/** Text resolutions per role (cached per text; quantised so a word is drawn at most a few times). */
const PX = { big: 320, mid: 256, small: 192, tick: 72, trans: 60 };

type Kind = 'echo' | 'bar' | 'crop' | 'panel' | 'chip' | 'idle';
interface Part { text: string; start: number }
/** Words set together: a Latin word (with a short one before it), or two to four CJK characters. */
export interface Unit { parts: Part[]; start: number; cjk: boolean; line: number }
/** One layout: a line (or half a long one), or the stretch between lines. */
interface Block { kind: Kind; start: number; end: number; units: Unit[]; line: number; dir: 1 | -1; seed: number; hue: number; side: 1 | -1 }

/** What one frame draws, in page units (y up, the frame's centre at 0). */
interface WordCmd { kind: 'word'; text: string; px: number; em: number; cx: number; cy: number; color: THREE.Color; opacity: number; rot: number; mirror: boolean; vertical: boolean; vx: number; reveal: number; order: number }
interface BarCmd { kind: 'bar'; cx: number; cy: number; w: number; h: number; color: THREE.Color; opacity: number; rot: number; phase: number; period: number; duty: number; vx: number; order: number }
type Cmd = WordCmd | BarCmd;

const WORD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/**
 * A word: the glyph texture's coverage, tinted. `uStretch` widens the quad round the texture by the smear's length,
 * `uBlur` is the smear in texture widths (nine taps along x), `uReveal` cuts it off past that share of its width.
 */
const WORD_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform float uOpacity, uStretch, uBlur, uReveal, uRevealEdge;
varying vec2 vUv;
void main() {
  float u0 = 0.5 + (vUv.x - 0.5) * uStretch;
  float a = 0.0;
  for (int i = 0; i < 9; i++) {
    float u = u0 + (float(i) / 8.0 - 0.5) * uBlur;
    if (u > 0.0 && u < 1.0) a += texture2D(map, vec2(u, vUv.y)).a;
  }
  a *= 1.0 / 9.0;
  a *= 1.0 - smoothstep(uReveal - uRevealEdge, uReveal, u0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;
/**
 * A flat bar, hatched: stripes at 45° `uPeriod` world units apart, `uDuty` of each filled (1 = solid), moved along by
 * `uPhase` periods; smeared along x by `uBlur` world units (eight taps), the quad widened by as much.
 */
const BAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uOpacity, uPhase, uPeriod, uDuty, uBlur;
varying vec2 vUv;
float cover(vec2 p, float aa) {
  float inside = step(abs(p.x), uSize.x * 0.5) * step(abs(p.y), uSize.y * 0.5);
  if (uDuty >= 1.0) return inside;
  float s = (p.x + p.y) / uPeriod + uPhase, f = fract(s);
  return inside * smoothstep(0.0, aa, f) * (1.0 - smoothstep(uDuty, uDuty + aa, f));
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uSize.x + abs(uBlur), uSize.y);
  float aa = max(fwidth((p.x + p.y) / uPeriod) * 1.2, 1e-3);
  float a = 0.0;
  if (abs(uBlur) < 1e-3) a = cover(p, aa);
  else {
    for (int i = 0; i < 8; i++) a += cover(p + vec2((float(i) / 7.0 - 0.5) * uBlur, 0.0), aa);
    a *= 1.0 / 8.0;
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const CJK_MARKS = /[，。、！？；：,.!?;:"“”‘’()（）「」『』《》〈〉…—~～·\s]/g;

/** A line's words in units: Latin a word each (a word of one or two letters joins the next), CJK in runs of 2–4. */
export function unitsOf(line: LyricLine, index: number): Unit[] {
  const out: Unit[] = [];
  const cjk = hasCjk(line.text);
  let cur: Unit | null = null;
  let carry: Part | null = null;
  const room = (u: Unit) => (cjk ? Array.from(u.parts.map(p => p.text).join('')).length : u.parts.map(p => p.text).join(' ').length);
  for (const w of line.words) {
    if (cjk) {
      const glyphs = w.text.replace(CJK_MARKS, '');
      const ends = /[，。、！？；：,.!?;:\s]$/.test(w.text);
      if (glyphs) {
        const n = Array.from(glyphs).length;
        // Too close after the unit's start, it joins it (even past four); else a new unit past four characters.
        const join = cur && (w.start - cur.start < MIN_GAP || room(cur) + n <= 4);
        if (join && cur && room(cur) + n <= 6) cur.parts.push({ text: glyphs, start: w.start });
        else { cur = { parts: [{ text: glyphs, start: w.start }], start: w.start, cjk, line: index }; out.push(cur); }
      }
      if (ends) cur = null;
      continue;
    }
    // (Marks inside a word stay — world.execute — those round it go.)
    const text = w.text.toUpperCase().replace(/[()（）\[\]［］「」『』《》<>]/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/\s+/g, ' ');
    if (!text) continue;
    if (cur && w.start - cur.start < MIN_GAP && room(cur) + text.length < 18) { cur.parts.push({ text, start: w.start }); continue; }
    if (text.length <= 2 && !carry && w !== line.words[line.words.length - 1]) { carry = { text, start: w.start }; continue; }
    const parts = carry ? [carry, { text, start: w.start }] : [{ text, start: w.start }];
    cur = { parts, start: parts[0].start, cjk, line: index };
    out.push(cur);
    carry = null;
  }
  if (carry) out.push({ parts: [carry], start: carry.start, cjk, line: index });
  return out;
}

/** The unit's text as sung by t (all of it when t is past its end). */
export function sung(u: Unit, t: number): string {
  const parts = u.parts.filter((p, i) => i === 0 || p.start <= t);
  return parts.map(p => p.text).join(u.cjk ? '' : ' ');
}
export const whole = (u: Unit) => u.parts.map(p => p.text).join(u.cjk ? '' : ' ');

type Mat = THREE.ShaderMaterial;
type Quad = THREE.Mesh<THREE.PlaneGeometry, Mat>;

export class KineticType implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  private page = new THREE.Group();
  private plane = new THREE.PlaneGeometry(1, 1);
  private words: Quad[] = [];
  private bars: Quad[] = [];
  private blocks: Block[] = [];
  private starts: Float64Array;
  private hits: Accents;
  private cmds: Cmd[] = [];
  private W = 16;
  private colors: THREE.Color[];
  private paper: THREE.Color;
  private ink: THREE.Color;
  private title: string;

  constructor(private init: SceneInit) {
    const { palette, music, lyrics } = init;
    this.ink = palette.ink.clone().multiplyScalar(0.55);
    this.scene.background = this.ink.clone();
    this.paper = palette.paper.clone();
    // The words' colours: the cover's two and its paper, each lifted off the ink if it is too dark to read on it.
    const lift = (c: THREE.Color) => { const out = c.clone(); if (lum(out) < 0.2) out.lerp(this.paper, 0.45); return out; };
    this.colors = [lift(palette.signal), this.paper.clone(), lift(palette.accent)];
    this.hits = Accents.of(music);
    // The song's name without what is in brackets (a translation, a feat.), for the stretches between lines.
    this.title = (init.title ?? '').replace(/\s*[(（\[【][^)）\]】]*[)）\]】]\s*/g, ' ').trim();
    this.scene.add(this.page);
    this.plan(lyrics.lines, init.seed ?? 1);
    this.starts = Float64Array.from(this.blocks, b => b.start);
    this.resize(init.aspect);
  }

  /** The song's layouts, decided up front: a frame is a function of t. */
  private plan(lines: LyricLine[], seed: number): void {
    const random = rng((seed ^ 0x4b1d) >>> 0);
    const track = this.init.lyrics;
    const sets: Array<{ units: Unit[]; line: number; end: number }> = [];
    lines.forEach((line, i) => {
      if (line.backing) return;
      const units = unitsOf(line, i);
      if (!units.length) return;
      const end = track.leaveAt(i) + track.exitTime;
      // A long line in two layouts, split at the unit nearest its middle.
      const span = line.end - units[0].start;
      if (span > 3.6 && units.length >= 4) {
        const mid = units[0].start + span / 2;
        let k = 1;
        for (let j = 1; j < units.length; j++) if (Math.abs(units[j].start - mid) < Math.abs(units[k].start - mid)) k = j;
        sets.push({ units: units.slice(0, k), line: i, end: units[k].start }, { units: units.slice(k), line: i, end });
      } else sets.push({ units, line: i, end });
    });
    const KINDS: Kind[] = ['echo', 'bar', 'crop', 'chip', 'panel'];
    const WEIGHT = [3, 3, 2, 2, 1.2];
    let last: Kind = 'idle', lastPanel = -9;
    const block = (kind: Kind, start: number, end: number, units: Unit[], line: number): Block => ({
      kind, start, end, units, line, dir: random() < 0.5 ? 1 : -1, seed: Math.floor(random() * 2 ** 31), hue: Math.floor(random() * 3), side: random() < 0.5 ? 1 : -1,
    });
    let t = 0;
    sets.forEach((s, n) => {
      const start = s.units[0].start;
      if (start - t > 0.4) this.blocks.push(block('idle', t, start, [], -1));
      const next = sets[n + 1];
      const end = Math.min(s.end, next ? next.units[0].start : Infinity);
      let kind: Kind;
      for (let tries = 0; ; tries++) {
        let r = random() * WEIGHT.reduce((a, b) => a + b, 0), k = 0;
        while (r > WEIGHT[k]) r -= WEIGHT[k++];
        kind = KINDS[k];
        // No layout twice running; the paper panel rarely, and only on a line long enough to read it.
        if (tries > 20) break;
        if (kind === last) continue;
        if (kind === 'panel' && (n - lastPanel < 3 || end - start < 1.4)) continue;
        break;
      }
      if (kind === 'panel') lastPanel = n;
      last = kind;
      this.blocks.push(block(kind, start, end, s.units, s.line));
      t = end;
    });
    if (!this.blocks.length || t < this.init.music.duration) this.blocks.push(block('idle', t, Infinity, [], -1));
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.W = H * aspect;
  }

  private quad(frag: string, uniforms: Record<string, THREE.IUniform>): Quad {
    const m = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
      vertexShader: WORD_VERT, fragmentShader: frag, uniforms, transparent: true, depthTest: false, depthWrite: false,
      // (Mirrored copies are drawn from behind.)
      side: THREE.DoubleSide,
    })) as Quad;
    m.frustumCulled = false;
    this.page.add(m);
    return m;
  }

  private wordQuad(): Quad {
    const q = this.quad(WORD_FRAG, {
      map: { value: null }, uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uStretch: { value: 1 }, uBlur: { value: 0 },
      uReveal: { value: 2 }, uRevealEdge: { value: 0.02 },
    });
    // (The words are the lyrics: hidden in an outgoing shot, kept out of the trails.)
    q.userData.lyrics = true;
    return q;
  }

  private barQuad(): Quad {
    return this.quad(BAR_FRAG, {
      uColor: { value: new THREE.Color() }, uSize: { value: new THREE.Vector2(1, 1) }, uOpacity: { value: 1 }, uPhase: { value: 0 },
      uPeriod: { value: 0.3 }, uDuty: { value: 0.5 }, uBlur: { value: 0 },
    });
  }

  /** Width of `text` set at an em of 1. */
  private adv(text: string, px: number, vertical = false): number {
    const tex = textTexture(text, FACE, px, 'none', vertical);
    return (vertical ? tex.boxH - 2 * tex.pad : tex.advance) / tex.px;
  }

  /** The em that sets `text` at most `maxW` wide and at most `maxEm`. */
  private fit(text: string, px: number, maxW: number, maxEm: number): number {
    return Math.min(maxEm, maxW / Math.max(0.3, this.adv(text, px)));
  }

  /** Hits (times) in (from, to]. */
  private hitsIn(from: number, to: number): number[] {
    const T = this.hits.times, out: number[] = [];
    for (let i = Math.max(0, lastIndex(T, from)); i < T.length && T[i] <= to; i++) if (T[i] > from) out.push(T[i]);
    return out;
  }

  /** How many steps the hits in (from, t] have taken, each a snap over `dur`: for belts and turns. */
  private steps(from: number, t: number, dur: number): number {
    let s = 0;
    for (const h of this.hitsIn(from, t)) s += snap((t - h) / dur);
    return s;
  }

  /** The units of a block sung by t, and which is the one being sung. */
  private shown(b: Block, t: number): Unit[] {
    return b.units.filter(u => u.start <= t);
  }

  private color(b: Block, k: number): THREE.Color {
    return this.colors[(b.hue + k) % this.colors.length];
  }

  // ———————————————————————————————————————————— layouts

  /** A slide from `dist` away to rest, `age` after it began, over `dur`: its offset and its speed. */
  private slide(age: number, dist: number, dur = ENTER): [number, number] {
    const x = age / dur;
    return [(1 - snap(x)) * dist, -dist * snapRate(x) / dur];
  }

  private word(text: string, px: number, em: number, cx: number, cy: number, color: THREE.Color, opacity = 1, extra: Partial<WordCmd> = {}): WordCmd {
    const c: WordCmd = { kind: 'word', text, px, em, cx, cy, color, opacity, rot: 0, mirror: false, vertical: false, vx: 0, reveal: 2, order: 20, ...extra };
    this.cmds.push(c);
    return c;
  }

  private bar(cx: number, cy: number, w: number, h: number, color: THREE.Color, extra: Partial<BarCmd> = {}): BarCmd {
    const c: BarCmd = { kind: 'bar', cx, cy, w, h, color, opacity: 1, rot: 0, phase: 0, period: H * 0.028, duty: 0.5, vx: 0, order: 10, ...extra };
    this.cmds.push(c);
    return c;
  }

  /** echo: the block's words pile up (newest at the bottom, pushing the rest up); strong drums repeat the word. */
  private echo(b: Block, t: number): void {
    const W = this.W, units = this.shown(b, t), random = rng(b.seed);
    const cjk = units[0]?.cjk ?? false, px = PX.mid;
    const maxAdv = Math.max(...b.units.map(u => this.adv(whole(u), px)));
    const em0 = Math.min(H * 0.24, (W * 0.8) / Math.max(0.3, maxAdv));
    type Row = { text: string; start: number; color: THREE.Color; ghost: boolean; size: number };
    const rows: Row[] = [];
    units.forEach((u, k) => {
      const until = units[k + 1]?.start ?? b.end;
      rows.push({ text: sung(u, t), start: u.start, color: this.color(b, k), ghost: false, size: 0 });
      // Strong drums while the word is held repeat it (not within 0.3 s of it or of the last repeat; at most three).
      let lastAt = u.start, n = 0;
      // (Not in its last 0.3 s either: a copy that slides in just as the layout leaves is a stutter.)
      for (const h of this.hitsIn(u.start + 0.3, Math.min(t, until - 0.3))) {
        const i = lastIndex(this.hits.times, h);
        if (this.hits.strength[i] < 0.55 || h - lastAt < 0.3 || n >= 3) continue;
        rows.push({ text: whole(u), start: h, color: this.color(b, k), ghost: true, size: 0 });
        lastAt = h; n++;
      }
    });
    rows.forEach((r, i) => { r.size = ECHO_SIZES[(i + (b.seed % 3)) % ECHO_SIZES.length]; });
    const step = (r: Row) => em0 * r.size * (cjk ? STEP.cjk : STEP.latin);
    const x0 = -W / 2 + W * (0.09 + 0.1 * random());
    const base = -H * 0.2;
    for (let i = rows.length - 1, lift = 0; i >= 0; i--) {
      const r = rows[i], age = t - r.start;
      // Rows above the newest ride up as each newer one comes in.
      const y = base + lift + step(r) / 2;
      const newer = rows.length - 1 - i;
      if (y - step(r) / 2 > H * 0.62 || newer > 5) break;
      const [off, v] = this.slide(age, (i % 2 ? -1 : 1) * b.dir * W * 0.75);
      const em = em0 * r.size * (1 + 0.035 * this.knock(t, r.start));
      const w = this.adv(r.text, px) * em;
      const jitter = ((i * 7919 + b.seed) % 5) / 4 - 0.5;
      const newest = i === rows.length - 1;
      const color = newest || r.ghost ? r.color : this.paper;
      const opacity = newest ? 1 : r.ghost ? 0.62 : Math.max(0.3, 0.92 - newer * 0.16);
      this.word(r.text, px, em, x0 + w / 2 + jitter * W * 0.05 + off, y, color, opacity, { vx: v });
      // Each row pushes the ones above it up by its own step as it slides in.
      lift += step(r) * snap(age / ENTER);
    }
  }

  /** A word's knock on the drums since it came in: a little growth that settles. */
  private knock(t: number, since: number): number {
    const i = lastIndex(this.hits.times, t);
    if (i < 0 || this.hits.times[i] <= since + 0.05) return 0;
    return this.hits.strength[i] * punch(t - this.hits.times[i], 0.12);
  }

  /** bar: the word on a hatched bar across the frame, each new word pushing the last off; a bass meter under it. */
  private barLayout(b: Block, t: number): void {
    const W = this.W, units = this.shown(b, t), random = rng(b.seed), age = t - b.start;
    const px = PX.big;
    const maxAdv = Math.max(...b.units.map(u => this.adv(whole(u), px)));
    const em = Math.min(H * 0.3, (W * 0.78) / Math.max(0.3, maxAdv));
    const cjk = units[0]?.cjk ?? false, capH = em * (cjk ? CAP.cjk : CAP.latin);
    const y0 = H * (random() * 0.16 - 0.06);
    const hatch = b.hue % 2 ? this.colors[2] : this.colors[0];
    const [bo, bv] = this.slide(age, -b.dir * W * 1.3, 0.24);
    const belt = this.steps(b.start, t, 0.14);
    // The bar, over-wide so its ends are never seen; its stripes thicken with the level.
    const level = this.init.music.env('rms', t);
    this.bar(bo, y0, W * 1.6, capH * 1.32, hatch, { phase: belt, duty: 0.38 + 0.22 * level, vx: bv, period: H * 0.034 });
    // Under it, solid and thin, a bass meter from the left edge.
    const low = this.init.music.env('low', t);
    const [mo, mv] = this.slide(age - 0.06, -b.dir * W * 1.3, 0.24);
    const mw = W * (0.08 + 0.55 * low);
    this.bar(-W / 2 + mw / 2 + mo, y0 - capH * 0.66 - H * 0.03, mw, H * 0.018, this.colors[1], { duty: 1, vx: mv });
    // The words: the one being sung slides in, the one before slides off the other way.
    const x0 = -W / 2 + W * 0.08;
    units.forEach((u, k) => {
      const next = units[k + 1];
      const text = sung(u, t), w = this.adv(text, px) * em;
      if (next) {
        const out = t - next.start;
        if (out >= EXIT) return;
        const go = snap(out / EXIT) * b.dir * W * 1.1, gv = (b.dir * W * 1.1 * snapRate(out / EXIT)) / EXIT;
        this.word(text, px, em, x0 + w / 2 + go, y0, this.paper, 1, { vx: gv, order: 21 });
        return;
      }
      const [o, v] = this.slide(t - u.start, -b.dir * W * 0.7);
      const grow = 1 + 0.03 * this.knock(t, u.start);
      this.word(text, px, em * grow, x0 + w / 2 + o, y0, this.paper, 1, { vx: v, order: 22 });
      // A strong drum on a held word leaves a dim copy above the bar.
      const echo = this.hitsIn(u.start + 0.3, t).find(h => this.hits.strength[lastIndex(this.hits.times, h)] >= 0.55);
      if (echo !== undefined) {
        const [eo, ev] = this.slide(t - echo, -b.dir * W * 0.4);
        this.word(text, px, em * 0.62, x0 + (w * 0.62) / 2 + eo, y0 + capH * 1.05, this.color(b, k), 0.7, { vx: ev });
      }
    });
  }

  /**
   * crop: the word being sung, whole and big, low in the frame; above it the one before, bigger still and cut by the
   * edges; the two drift apart, a step further on each drum.
   */
  private crop(b: Block, t: number): void {
    const W = this.W, units = this.shown(b, t), age = t - b.start;
    const px = PX.big;
    const u = units[units.length - 1], prev = units[units.length - 2];
    const text = sung(u, t);
    const em = this.fit(whole(u), px, W * 0.9, H * 0.4);
    const drift = (t - b.start) * W * 0.03 + this.steps(b.start, t, 0.2) * W * 0.016;
    const [o, v] = this.slide(t - u.start, -b.dir * W * 0.8);
    const w = this.adv(text, px) * em;
    // (In a colour, never the paper of the word behind it.)
    const tint = this.colors[(b.hue + units.length) % 2 ? 2 : 0];
    this.word(text, px, em * (1 + 0.03 * this.knock(t, u.start)), -W / 2 + W * 0.05 + w / 2 + o + drift * b.dir * 0.4, -H * 0.17, tint, 1, { vx: v, order: 22 });
    // The one before (the first word: itself), stepping up out of the word's place as the next comes in.
    const back = prev ?? u, bt = whole(back);
    const bem = Math.max(H * 0.6, em * 1.4), bw = this.adv(bt, px) * bem;
    const bcap = bem * (back.cjk ? CAP.cjk : CAP.latin);
    const rise = snap((t - u.start) / (ENTER * 1.2));
    // (Its foot a little above the middle, its head cut by the top edge.)
    const by = H * 0.08 + bcap / 2 - (1 - rise) * H * 0.35;
    this.word(bt, px, bem, W / 2 - bw / 2 + W * 0.1 - drift * b.dir, by, this.paper, (prev ? 0.92 : 0.5) * rise, { order: 18 });
    // A hatched square low in the free corner turns a quarter on each drum.
    const s = H * 0.12, turn = (this.steps(b.start, t, 0.16) * Math.PI) / 2;
    const [co, cv] = this.slide(age - 0.05, W * 0.5);
    this.bar(W / 2 - W * 0.08 + co, -H / 2 + H * 0.13, s, s, this.colors[2], { rot: turn, period: H * 0.022, vx: cv, order: 12 });
  }

  /** panel: paper over one side, the word stood up on it in ink, repeated, every other copy mirrored. */
  private panel(b: Block, t: number): void {
    const W = this.W, units = this.shown(b, t), age = t - b.start;
    const u = units[units.length - 1], text = sung(u, t);
    const side = b.side, pw = W * 0.4;
    const [po, pv] = this.slide(age, side * pw * 1.1, 0.24);
    const px0 = side * (W / 2 - pw / 2) + po;
    this.bar(px0, 0, pw, H * 1.1, this.paper, { duty: 1, vx: pv, order: 5 });
    // Columns of the word in ink, read bottom to top (CJK top to bottom), stepping a cell on each drum.
    const px = PX.mid, cols = 3, cw = pw / cols;
    const vertical = u.cjk;
    const full = whole(u);
    const em = vertical ? cw * 0.78 : cw * 0.82;
    const len = (vertical ? this.adv(full, px, true) : this.adv(full, px)) * em + em * 0.3;
    const belt = this.steps(u.start, t, 0.14);
    for (let c = 0; c < cols; c++) {
      const x = px0 - pw / 2 + cw * (c + 0.5);
      const dirc = c % 2 ? -1 : 1;
      const shift = (((belt + c * 0.37) * em * 1.4 * dirc) % len + len) % len;
      for (let k = -2; k <= Math.ceil(H / len) + 1; k++) {
        const y = -H / 2 + k * len + shift;
        if (y - len / 2 > H / 2 || y + len / 2 < -H / 2) continue;
        this.word(full, px, em, x, y, this.ink, 1, { rot: vertical ? 0 : Math.PI / 2, mirror: !vertical && (c + k) % 2 === 1, vertical, vx: 0, order: 8 });
      }
    }
    // The other side: the word in colour, and the ones before it small and dim above.
    const free = -side, cx = free * W * 0.22;
    const mem = this.fit(full, PX.mid, W * 0.5, H * 0.24);
    const [o, v] = this.slide(t - u.start, free * W * 0.5);
    this.word(text, PX.mid, mem * (1 + 0.03 * this.knock(t, u.start)), cx + o, -H * 0.02, this.color(b, units.length - 1), 1, { vx: v, order: 22 });
    units.slice(Math.max(0, units.length - 3), -1).reverse().forEach((p, k) => {
      const pem = mem * 0.42;
      this.word(whole(p), PX.small, pem, cx, H * 0.14 + k * pem * 0.95, this.paper, 0.55 - k * 0.15, { order: 20 });
    });
  }

  /** chip: the word beside a hatched square that turns on the drums; three level meters below. */
  private chip(b: Block, t: number, idleText?: string): void {
    const W = this.W, age = t - b.start;
    const units = this.shown(b, t), u = units[units.length - 1];
    const text = idleText ?? sung(u, t);
    const full = idleText ?? whole(u);
    const px = PX.mid;
    const em = this.fit(full, px, W * 0.52, idleText ? H * 0.12 : H * 0.22);
    const cjk = idleText ? hasCjk(idleText) : u.cjk, capH = em * (cjk ? CAP.cjk : CAP.latin);
    const w = this.adv(text, px) * em, fw = this.adv(full, px) * em;
    const s = capH * 1.05, gap = capH * 0.35;
    const left = -(fw + s + gap) / 2;
    const since = idleText ? b.start : u.start;
    const [o, v] = idleText ? this.slide(age, -b.dir * W * 0.5) : this.slide(t - u.start, -b.dir * W * 0.5);
    const [co, cv] = this.slide(age, b.dir * W * 0.6, 0.22);
    const turn = (this.steps(b.start, t, 0.16) * Math.PI) / 2 + (idleText ? 0 : units.length - 1) * (Math.PI / 2) * snap((t - since) / 0.18);
    this.bar(left + s / 2 + co, H * 0.03, s, s, this.colors[2], { rot: turn, period: H * 0.02, vx: cv, order: 12 });
    this.word(text, px, em * (1 + 0.03 * this.knock(t, since)), left + s + gap + w / 2 + o, H * 0.03, idleText ? this.paper : this.color(b, units.length - 1), 1, { vx: v, order: 22 });
    // Bass, mids and treble, hatched, from under the square; the stripes run on.
    const m = this.init.music;
    const levels: Array<[number, THREE.Color]> = [[m.env('low', t), this.colors[0]], [m.env('mid', t), this.colors[1]], [m.env('high', t), this.colors[2]]];
    const mh = H * 0.024, top = H * 0.03 - s / 2 - H * 0.05, span = Math.max(fw + s + gap, W * 0.3);
    levels.forEach(([lv, c], k) => {
      const lw = Math.max(H * 0.02, span * Math.min(1, lv));
      const [mo, mv] = this.slide(age - 0.04 * (k + 1), -b.dir * W * 0.8, 0.22);
      this.bar(left + lw / 2 + mo, top - k * mh * 1.7, lw, mh, c, { phase: t * 1.5 + k, period: H * 0.016, duty: 0.55, vx: mv, order: 11 });
    });
  }

  /** The line so far, word by word, low on the frame, and its translation typed out under it. */
  private ticker(t: number, avoid: number): void {
    const W = this.W;
    const states = this.init.lyrics.visible(t);
    const st = states[states.length - 1];
    if (!st || st.line.backing) return;
    const fade = 1 - st.exit;
    if (fade <= 0) return;
    const em = H * 0.034, y = -H / 2 + H * 0.09, margin = W * 0.06;
    const cjk = hasCjk(st.line.text);
    const done = st.words.filter(w => w.age >= 0).map(w => (cjk ? w.word.text : w.word.text.toUpperCase()).trim()).filter(Boolean);
    if (!done.length) return;
    // The trailing words that fit in half the width (measured a word at a time: each is drawn once and kept).
    const space = cjk ? 0 : 0.28;
    let from = done.length - 1, width = this.adv(done[from], PX.tick);
    while (from > 0 && (width + space + this.adv(done[from - 1], PX.tick)) * em < W * 0.5) width += space + this.adv(done[--from], PX.tick);
    const text = done.slice(from).join(cjk ? '' : ' ');
    const w = this.adv(text, PX.tick) * em;
    const x = avoid < 0 ? W / 2 - margin - w / 2 : -W / 2 + margin + w / 2;
    this.word(text, PX.tick, em, x, y, this.paper, 0.85 * fade, { order: 30 });
    const tr = st.line.translation?.trim();
    if (tr) {
      const tem = Math.min(em * 0.8, (W * 0.6) / Math.max(0.3, this.adv(tr, PX.trans)));
      const tw = this.adv(tr, PX.trans) * tem;
      const tx = avoid < 0 ? W / 2 - margin - tw / 2 : -W / 2 + margin + tw / 2;
      this.word(tr, PX.trans, tem, tx, y - em * 1.3, this.paper, 0.55 * fade, { reveal: st.translationProgress * 1.02, order: 30 });
    }
  }

  private compose(b: Block, t: number): void {
    if (b.kind === 'idle') {
      const name = this.title ? (hasCjk(this.title) ? Array.from(this.title.replace(CJK_MARKS, '')).slice(0, 6).join('') : this.title.toUpperCase().split(/\s+/).slice(0, 3).join(' ')) : '';
      if (name) this.chip(b, t, name);
      return;
    }
    if (!this.shown(b, t).length) return;
    if (b.kind === 'echo') this.echo(b, t);
    else if (b.kind === 'bar') this.barLayout(b, t);
    else if (b.kind === 'crop') this.crop(b, t);
    else if (b.kind === 'panel') this.panel(b, t);
    else this.chip(b, t);
  }

  update(ctx: FrameCtx): void {
    const { t, shot } = ctx;
    const W = this.W;
    this.cmds.length = 0;
    const i = Math.max(0, lastIndex(this.starts, t));
    const b = this.blocks[i], prev = this.blocks[i - 1];
    // The outgoing layout slides off the way the new one comes in.
    if (prev && t - b.start < EXIT) {
      const from = this.cmds.length;
      this.compose(prev, Math.min(t, prev.end));
      const out = t - b.start, d = b.dir * W * 1.2;
      const off = snap(out / EXIT) * d, v = (d * snapRate(out / EXIT)) / EXIT;
      for (let k = from; k < this.cmds.length; k++) { const c = this.cmds[k]; c.cx += off; c.vx += v; c.order -= 40; }
    }
    this.compose(b, t);
    this.ticker(t, b.kind === 'panel' ? b.side : 1);
    this.commit();

    // A still camera, the page square to it; a tilted shot leans it a few degrees, turning slowly.
    const random = rng(shot.seed);
    const cam = this.camera;
    cam.position.set(0, 0, DIST);
    cam.lookAt(0, 0, 0);
    if (shot.variant === 'tilt') cam.rotateZ((random() < 0.5 ? -1 : 1) * (0.05 + 0.03 * Math.sin(t * 0.4)));
    // Each kick knocks the page a little towards the lens.
    const kick = this.init.music.pulse('kick', t, 0.12);
    this.page.position.z = kick * H * 0.012;
    cam.updateMatrixWorld();
    ctx.fx.bloom = 0.12;
    ctx.fx.vignette = 0.32;
    ctx.fx.grain = 0.035;
  }

  /** The frame's commands onto the pooled quads. */
  private commit(): void {
    let nw = 0, nb = 0;
    for (const c of this.cmds) {
      if (c.kind === 'word') {
        const q = this.words[nw] ?? (this.words[nw] = this.wordQuad());
        nw++;
        const tex: TextTexture = textTexture(c.text, FACE, c.px, 'none', c.vertical);
        const unit = c.em / tex.px, bw = tex.boxW * unit, bh = tex.boxH * unit;
        // The smear: how far it moved while the shutter was open, as a share of its width (capped).
        const blur = Math.min(this.W * 0.4, Math.abs(c.vx) * SHUTTER);
        const stretch = 1 + blur / bw;
        const u = q.material.uniforms;
        u.map.value = tex.texture;
        (u.uColor.value as THREE.Color).copy(c.color);
        u.uOpacity.value = c.opacity;
        u.uStretch.value = stretch;
        u.uBlur.value = blur / bw;
        u.uReveal.value = c.reveal >= 1.5 ? 2 : (tex.pad + c.reveal * tex.advance) / tex.boxW;
        q.scale.set(bw * stretch * (c.mirror ? -1 : 1), bh, 1);
        q.rotation.z = c.rot;
        q.position.set(c.cx, c.cy, 0);
        q.renderOrder = c.order;
        q.visible = c.opacity > 0.002;
      } else {
        const q = this.bars[nb] ?? (this.bars[nb] = this.barQuad());
        nb++;
        const blur = Math.min(this.W * 0.5, Math.abs(c.vx) * SHUTTER);
        const u = q.material.uniforms;
        (u.uColor.value as THREE.Color).copy(c.color);
        (u.uSize.value as THREE.Vector2).set(c.w, c.h);
        u.uOpacity.value = c.opacity;
        u.uPhase.value = c.phase;
        u.uPeriod.value = c.period;
        u.uDuty.value = c.duty;
        u.uBlur.value = blur;
        q.scale.set(c.w + blur, c.h, 1);
        q.rotation.z = c.rot;
        q.position.set(c.cx, c.cy, -0.01);
        q.renderOrder = c.order;
        q.visible = c.opacity > 0.002;
      }
    }
    for (let k = nw; k < this.words.length; k++) this.words[k].visible = false;
    for (let k = nb; k < this.bars.length; k++) this.bars[k].visible = false;
  }

  dispose(): void {
    this.plane.dispose();
    for (const q of [...this.words, ...this.bars]) q.material.dispose();
  }
}
