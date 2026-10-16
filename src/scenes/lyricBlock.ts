// The sung line as one block of type standing in the world (docs/TREATMENT.md, 歌词重做：整句、字体、效果).
// The chunked signs (LyricGates) put two or three words on screen at a time, piled one sign onto the next and, to
// stay readable, rode with the camera while sung (the user, 2026-10-13: “歌词表现的方式已经开始不行了”). Here the
// whole line is set as one piece — rows balanced, the words the singer holds set bigger — each word still coming on
// as it is sung and the translation typing itself out under it. The plate stands the block where its camera, flying
// a path known in advance (a function of time), sees it all the while it is sung and comes up to it as it ends
// (standAhead): the block stays where it was put, and the camera flies at it and past it as the next line comes up.
import * as THREE from 'three';
import { textMesh, textPrimer, primer, hasCjk, inkPoints, type Face } from '../render/text.ts';
import type { LyricTrack, LineState } from '../director/lyrics.ts';
import type { Music } from '../director/music.ts';
import type { LyricLine } from '../types.ts';
import type { Palette } from '../render/palette.ts';
import { tokenize } from '../lyrics/parse.ts';
import { paintWord, scrimFragment, scrimVertex } from './lyricRig.ts';
import { clamp01, outExpo, smooth, snap } from './types.ts';

type TextMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

// ── Stress ───────────────────────────────────────────────────────────────────────────────────────────────────────

const syllables = (s: string) => (hasCjk(s) ? Array.from(s.replace(/[\p{P}\s]/gu, '')).length : (s.match(/[aeiouyàâäéèêëîïôöùûü]+/gi)?.length ?? 1)) || 1;

/**
 * How hard each word of a line is leaned on, 0..2: the words held well past the line's usual syllable (a long note,
 * sung out) are set bigger, the longest biggest. At most two words a line, one of them biggest; none when the word
 * times were only spread over the line (no word-level lyrics), or when every word is held alike.
 */
export function stress(line: LyricLine, music: Music | null): number[] {
  const ws = line.words, out = ws.map(() => 0);
  if (!line.timedWords || ws.length < 3) return out;
  const per = ws.map(w => (w.end - w.start) / syllables(w.text));
  const med = Math.max(0.1, [...per].sort((a, b) => a - b)[Math.floor(per.length / 2)]);
  // A word sung louder than the line around it counts a little more (the mids carry the voice).
  const loud = ws.map(w => (music ? (music.env('mid', w.start + 0.05) + music.env('mid', (w.start + w.end) / 2)) / 2 : 1));
  const meanLoud = Math.max(1e-3, loud.reduce((a, b) => a + b, 0) / loud.length);
  const score = per.map((p, i) => (p / med) * (0.75 + 0.25 * Math.min(1.6, loud[i] / meanLoud)));
  const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const [top, second] = order, held = (i: number) => ws[i].end - ws[i].start;
  if (score[top] >= 2.4 && held(top) >= 0.5) out[top] = 2;
  else if (score[top] >= 1.7 && held(top) >= 0.32) out[top] = 1;
  if (out[top] && second !== undefined && score[second] >= 1.8 && held(second) >= 0.35) out[second] = 1;
  return out;
}

// ── Voices ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The type a song's lyrics are set in (the user: “字体和效果也考虑”). One per song, by its style, the ballad's varied
 * from play to play (voiceFor):
 *   condensed Archivo Condensed in capitals, the held words in Black and bigger; strikes like a neon tube (pulse, rap)
 *   garamond  Cormorant Garamond, the held words in its italic; written in by a light as it is sung; CJK in Kai (ballad)
 *   didone    Bodoni Moda at display size, the held words in its bold; written in (ballad)
 * (Pulse also had a wide voice in Archivo Expanded Black; the user kept the condensed one: “律动的英文字体就用那个新的，
 * 旧的不用了”.)
 */
export type VoiceId = 'condensed' | 'garamond' | 'didone';
interface Voice {
  /** Faces by stress: plain, leaned on, held. */
  faces: [Face, Face, Face];
  /** Sizes by stress, in ems. */
  sizes: [number, number, number];
  trans: Face;
  /** Latin set in capitals. */
  caps?: boolean;
  /** How a word comes on: strikes like a neon tube, or is written in by a light while it is sung. */
  on: 'neon' | 'write';
  /** A plain word's em against the block's (a face with a small x-height is set bigger to read the same). */
  scale: number;
  /** The space between Latin words, ems. */
  space: number;
}
export const VOICES: Record<VoiceId, Voice> = {
  condensed: { faces: ['condensed', 'condensedBlack', 'condensedBlack'], sizes: [1, 1.3, 1.7], trans: 'bold', caps: true, on: 'neon', scale: 1.18, space: 0.2 },
  garamond: { faces: ['garamond', 'garamondItalic', 'garamondItalic'], sizes: [1, 1.22, 1.5], trans: 'garamondLight', on: 'write', scale: 1.3, space: 0.24 },
  didone: { faces: ['didone', 'didoneBold', 'didoneBold'], sizes: [1, 1.2, 1.45], trans: 'garamondLight', on: 'write', scale: 1.12, space: 0.26 },
};

/**
 * The faces of a song's voice for the other carriers (LyricRig's `faces`, LyricOrbit's and LyricGates' `face` and
 * `transFace`), so the whole MV is set in one voice.
 */
export function voiceFaces(look: string, seed = 0): { main: Face; trans: Face } {
  const v = VOICES[voiceFor(look, seed)];
  return { main: v.faces[0], trans: v.trans };
}

/** The same as options for LyricOrbit and LyricGates. */
export function voiceOpts(look: string, seed = 0): { face: Face; transFace: Face } {
  const f = voiceFaces(look, seed);
  return { face: f.main, transFace: f.trans };
}

/** A song's voice: by its style's look, the ballad's picked by the play's seed between the two that suit it. */
export function voiceFor(look: string, seed = 0): VoiceId {
  const pick = (a: VoiceId[]) => a[(Math.abs(Math.floor(seed)) >>> 3) % a.length];
  if (look === 'ballad') return pick(['garamond', 'didone']);
  if (look === 'ink') return 'garamond';
  return 'condensed';
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BlockOptions {
  voice: VoiceId;
  /** Em height of a plain word, world units (the block is posed and scaled by the plate). */
  em: number;
  /** Widest a row may get, in ems. */
  maxW: number;
  /** The translation's em, in ems of the words. */
  trans?: number;
  /** A soft dark bed behind the block (light covers, busy frames); a number: how dark on a dark cover (0.36). */
  scrim?: boolean | number;
  /** Dark type with a paper glow, for a paper-coloured frame. */
  onLight?: boolean;
  /** The plate's surfaces may stand in front of the words. */
  depthTest?: boolean;
  /**
   * A line that has been sung crumbles into dust that drifts off this way (world units a second, in ems of the
   * block as posed); none without.
   */
  dust?: [number, number, number];
}

interface Glyph { mesh: TextMesh; word: number; x: number; y: number; w: number; px: number; wipe?: { value: number }; pen?: { value: THREE.Vector4 } }
interface Block {
  index: number;
  root: THREE.Group;
  glyphs: Glyph[];
  trans: Array<{ mesh: TextMesh; x: number; y: number }>;
  /** The block's size, world units at scale 1. */
  size: [number, number];
  scrim?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Crumbled into dust (once, as it starts to leave). */
  dusted: boolean;
  /** Each row's first word and how far above the block's last row its bottom is (the translation follows the rows sung). */
  rowUp: Array<{ word: number; up: number }>;
}

// ── Written in ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A word written in from left to right: `wipe` 0..1 across its advance (`span`, the advance's u range in its
 * texture), a soft edge with a pen of light just behind it (`pen`: colour and strength).
 */
function writable(m: TextMesh): { wipe: { value: number }; pen: { value: THREE.Vector4 } } {
  const g = m.geometry.parameters, adv = m.userData.width as number;
  const pad = (g.width - adv) / 2 / g.width;
  const wipe = { value: 0 }, pen = { value: new THREE.Vector4() }, span = { value: new THREE.Vector2(pad, 1 - pad) };
  m.material.onBeforeCompile = shader => {
    shader.uniforms.uWipe = wipe;
    shader.uniforms.uPen = pen;
    shader.uniforms.uSpan = span;
    shader.fragmentShader = 'uniform float uWipe; uniform vec4 uPen; uniform vec2 uSpan;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        // 0..soft behind the edge: the pen; further: written.
        float soft = 0.16;
        float e = uWipe * (1.0 + soft) - (vMapUv.x - uSpan.x) / max(1e-4, uSpan.y - uSpan.x);
        diffuseColor.a *= smoothstep(0.0, soft, e);
        float nib = exp(-pow((e - soft * 0.45) / (soft * 0.5), 2.0));
        diffuseColor.rgb += uPen.rgb * (uPen.a * nib) * sampledDiffuseColor.r;
      }`);
  };
  return { wipe, pen };
}

// ── Dust ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const DUST_VERT = /* glsl */ `
  attribute vec3 aVel; attribute float aSeed;
  uniform float uAge; uniform float uSize; uniform float uLife; uniform float uHalfH;
  varying float vA; varying float vMix;
  void main() {
    float a = uAge * (0.75 + 0.5 * aSeed);
    // Drifts off, slowing (air), with a little wander.
    vec3 p = position + aVel * (1.0 - exp(-a * 1.6)) / 1.6 + vec3(sin(a * 2.3 + aSeed * 40.0), cos(a * 1.7 + aSeed * 23.0), 0.0) * length(aVel) * 0.08 * a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = clamp(a / uLife, 0.0, 1.0);
    vA = (1.0 - life) * (1.0 - life) * smoothstep(0.0, 0.06, a);
    vMix = aSeed;
    gl_PointSize = uSize * (0.6 + 0.8 * aSeed) * (1.0 - 0.5 * life) * projectionMatrix[1][1] * uHalfH / max(0.001, -mv.z);
  }`;
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uGlow; varying float vA; varying float vMix;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    float k = (1.0 - r) * (1.0 - r);
    gl_FragColor = vec4(mix(uColor, uGlow, step(0.8, vMix)) * k * vA, k * vA);
  }`;

interface Dust { points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>; born: number }

/** Where the glyph pixels of a texture are (light, not the halo): a few hundred of them, in 0..1 of its box. */
const inkCache = new WeakMap<THREE.Texture, Float32Array>();
function inkOf(tex: THREE.Texture): Float32Array {
  let ink = inkCache.get(tex) ?? inkPoints(tex);
  if (ink) { inkCache.set(tex, ink); return ink; }
  // (A texture textTexture didn't draw: read back.)
  const c = tex.image as HTMLCanvasElement, w = c.width, h = c.height;
  const px = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 9000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (px[(y * w + x) * 4] > 150) out.push(x / w, y / h);
  ink = Float32Array.from(out);
  inkCache.set(tex, ink);
  return ink;
}

/**
 * How readily a row may end after word i: 0 at a mark or a breath before the next word (the phrase ends there),
 * 1 at a plain space between Latin words, 2 inside a run of CJK characters with nothing to break at.
 */
function breaks(line: LyricLine): number[] {
  let at = 0;
  return line.words.map((w, i) => {
    const found = line.text.indexOf(w.text, at);
    let cost = hasCjk(w.text) ? 2 : 1;
    if (found >= 0) {
      at = found + w.text.length;
      if (/\p{P}$/u.test(w.text) || /^\p{P}/u.test(line.text.slice(at))) cost = 0;
      else if (cost === 2 && /^\s/.test(line.text.slice(at))) cost = 0;
    }
    const next = line.words[i + 1];
    if (next && next.start - w.end > 0.3) cost = 0;
    return cost;
  });
}

/**
 * Rows for words of widths w (gap between words), at most `maxW` each where it can, as even as can be: the fewest
 * rows that fit, then the split that keeps them nearest the same width, preferring to break where a phrase ends
 * (`cost`, see breaks).
 */
function rows(w: number[], gap: number, maxW: number, cost: number[]): number[][] {
  const n = w.length;
  const span = (a: number, b: number) => w.slice(a, b).reduce((s, x) => s + x, 0) + gap * (b - a - 1);
  const total = span(0, n);
  // (No more rows than words: one or two words wider than a row asked for more, found no split, and the way back
  // through `from` gave words that aren't there — the MV of 《GODS》 failed to build.)
  const count = Math.max(1, Math.min(3, n, Math.ceil(total / maxW - 0.04)));
  if (count === 1) return [Array.from({ length: n }, (_, i) => i)];
  const target = total / count;
  // cost[k][i]: the first i words in k rows.
  const best = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(-1));
  const brk = [0, 0.3, 0.45];
  best[0][0] = 0;
  for (let k = 1; k <= count; k++) for (let i = 1; i <= n; i++) for (let j = k - 1; j < i; j++) {
    if (!isFinite(best[k - 1][j])) continue;
    const s = span(j, i), over = Math.max(0, s - maxW);
    const c = best[k - 1][j] + (s - target) ** 2 + over * over * 40 + (i < n ? (brk[cost[i - 1]] * target) ** 2 : 0);
    if (c < best[k][i]) { best[k][i] = c; from[k][i] = j; }
  }
  const out: number[][] = [];
  for (let k = count, i = n; k > 0; i = from[k][i], k--) out.unshift(Array.from({ length: i - from[k][i] }, (_, x) => from[k][i] + x));
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────────────────────────────────────────

function dispose(root: THREE.Object3D): void {
  root.parent?.remove(root);
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.Points).isPoints) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
}

const caps = (s: string) => (hasCjk(s) ? s : s.toUpperCase());

/**
 * The lines on screen as blocks; the plate poses each (`place` sets the block's root — centred on the block, unturned,
 * at scale 1 — and returns its fade, 0 gone). `leave` is when the line starts to go (the next line is up).
 */
export class LyricBlocks {
  readonly group = new THREE.Group();
  private blocks = new Map<number, Block>();
  private dust: Dust[] = [];
  private color = new THREE.Color();
  private voice: Voice;
  /**
   * The frame's width to height: a narrow window (a phone-shaped one) sets the rows narrower, so a block fits across
   * it; when it changes the lines on screen are set again.
   */
  private aspect = 16 / 9;
  setAspect(aspect: number): void {
    if (Math.abs(aspect - this.aspect) < this.aspect * 0.03) return;
    this.aspect = aspect;
    for (const b of this.blocks.values()) dispose(b.root);
    this.blocks.clear();
  }

  constructor(private palette: Palette, private music: Music | null, private opts: BlockOptions) {
    this.group.userData.lyrics = true;
    this.voice = VOICES[opts.voice];
    // Hidden stand-ins for what is made as lines come and go (a word written in, a line's dust), so the warm-up
    // compiles their programs before the first line (see textPrimer).
    const word = this.dress(textPrimer());
    if (this.voice.on === 'write') writable(word);
    this.group.add(word);
    if (opts.dust) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      geo.setAttribute('aVel', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute([0], 1));
      this.group.add(primer(new THREE.Points(geo, this.dustMaterial(opts.em))));
    }
  }

  private dustMaterial(em: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, depthTest: !!this.opts.depthTest,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uAge: { value: 0 }, uLife: { value: 1.5 }, uSize: { value: em * 0.085 }, uHalfH: { value: 540 },
        uColor: { value: this.palette.paper.clone().multiplyScalar(0.8) }, uGlow: { value: this.palette.signal.clone() },
      },
    });
  }

  private get halo(): string { return this.opts.onLight ? this.palette.css.ink : 'dark'; }

  private dress<T extends THREE.Mesh>(m: T): T {
    const mat = m.material as THREE.Material;
    mat.depthWrite = false;
    mat.depthTest = !!this.opts.depthTest;
    m.renderOrder = 20;
    return m;
  }

  private build(st: LineState): Block {
    const o = this.opts, v = this.voice, line = st.line, em = o.em * v.scale;
    const cjk = hasCjk(line.text);
    const level = stress(line, this.music), sizes = v.sizes;
    const root = new THREE.Group();
    const gap = cjk ? em * 0.06 : em * v.space;
    const meshes = line.words.map((w, i) => {
      const size = em * sizes[level[i]];
      return this.dress(textMesh(v.caps ? caps(w.text) : w.text, v.faces[level[i]], size, { px: Math.round(Math.min(300, 190 * sizes[level[i]])), halo: this.halo }));
    });
    let widths = meshes.map(m => m.userData.width as number);
    // Too long for three rows: the whole line a size down.
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    const maxW = o.maxW * Math.min(1, Math.max(0.42, this.aspect / (16 / 9)));
    const fit = Math.min(1, (maxW * em * 3) / Math.max(1e-3, total));
    if (fit < 1) { meshes.forEach(m => m.scale.setScalar(fit)); widths = widths.map(w => w * fit); }
    const laid = rows(widths, gap * fit, maxW * em * fit, breaks(line));
    const glyphs: Glyph[] = [];
    // Rows down from y = 0, each word on its row's baseline (a glyph's middle sits about 0.35 em above it). Written
    // voices set flush left, like a verse; neon ones centred, like a sign.
    let cursor = 0, left = Infinity, right = -Infinity;
    const lefty = v.on === 'write';
    const rowBottom: Array<{ word: number; y: number }> = [];
    laid.forEach((row, r) => {
      const big = Math.max(...row.map(i => sizes[level[i]])) * em * fit;
      const baseline = cursor - big * (cjk ? 0.9 : 0.8);
      const rowW = row.reduce((s, i) => s + widths[i], 0) + gap * fit * (row.length - 1);
      let x = lefty ? 0 : -rowW / 2;
      for (const i of row) {
        const size = sizes[level[i]] * em * fit;
        const g: Glyph = { mesh: meshes[i], word: i, x, y: baseline + size * (cjk ? 0.36 : 0.34), w: widths[i], px: size };
        if (v.on === 'write') Object.assign(g, writable(meshes[i]));
        glyphs.push(g);
        root.add(meshes[i]);
        x += widths[i] + gap * fit;
      }
      left = Math.min(left, lefty ? 0 : -rowW / 2);
      right = Math.max(right, lefty ? rowW : rowW / 2);
      rowBottom.push({ word: row[0], y: baseline - big * (cjk ? 0.18 : 0.26) });
      cursor = baseline - big * (cjk ? 0.18 : 0.26) - (r < laid.length - 1 ? em * fit * 0.14 : 0);
    });
    const top = 0;
    let bottom = cursor;
    const rowUp = rowBottom.map(rb => ({ word: rb.word, up: rb.y - rowBottom[rowBottom.length - 1].y }));

    // The translation under the block, one or two rows as wide as the block at most.
    const trans: Block['trans'] = [];
    if (o.trans && line.translation) {
      const th = o.em * o.trans, text = line.translation.trim();
      const parts = hasCjk(text) ? Array.from(text) : tokenize(text);
      const tm = parts.map(p => (p.trim() ? this.dress(textMesh(p, v.trans, th, { px: 120, halo: this.halo })) : null));
      const tw = tm.map((m, i) => (m ? (m.userData.width as number) + (hasCjk(parts[i]) ? 0 : th * 0.3) : th * 0.35));
      const room = Math.max(right - left, th * 12);
      const lines: number[][] = [[]];
      let acc = 0;
      tw.forEach((w, i) => { if (acc > 0 && acc + w > room && lines.length < 2) { lines.push([]); acc = 0; } lines[lines.length - 1].push(i); acc += w; });
      let y = bottom - th * 1.25;
      for (const row of lines) {
        const rowW = row.reduce((s, i) => s + tw[i], 0);
        let x = lefty ? left : -rowW / 2;
        for (const i of row) {
          const m = tm[i];
          if (m) { root.add(m); trans.push({ mesh: m, x, y }); left = Math.min(left, x); right = Math.max(right, x + tw[i]); }
          x += tw[i];
        }
        y -= th * 1.35;
      }
      bottom = y + th * 0.6;
    }

    // Centre it on the root.
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    for (const g of glyphs) { g.x -= cx; g.y -= cy; }
    for (const g of trans) { g.x -= cx; g.y -= cy; }
    const size: [number, number] = [right - left, top - bottom];
    let scrim: Block['scrim'];
    if (o.scrim) {
      scrim = this.dress(new THREE.Mesh(new THREE.PlaneGeometry(size[0] + em * 2.6, size[1] + em * 1.8), new THREE.ShaderMaterial({
        vertexShader: scrimVertex, fragmentShader: scrimFragment, transparent: true,
        uniforms: { uAlpha: { value: 0 }, uColor: { value: this.palette.ink.clone().multiplyScalar(0.5) } },
      })));
      scrim.renderOrder = 19;
      scrim.position.z = -em * 0.05;
      root.add(scrim);
    }
    this.group.add(root);
    return { index: st.index, root, glyphs, trans, size, scrim, dusted: false, rowUp };
  }

  /**
   * The block's words crumbling into dust where they stand now: points over the lit pixels of each word shown, set
   * drifting the plate's way (`dust`), a little apart, in the paper colour with a few sparks of the signal colour.
   */
  private crumble(b: Block, t: number): void {
    const drift = this.opts.dust;
    if (!drift) return;
    b.root.updateMatrixWorld(true);
    const pos: number[] = [], vel: number[] = [], seed: number[] = [];
    const scale = b.root.scale.x, em = this.opts.em * scale;
    const world = new THREE.Vector3(), centre = new THREE.Vector3().setFromMatrixPosition(b.root.matrixWorld);
    let rnd = (b.index * 9301 + 49297) % 233280;
    const random = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    for (const g of b.glyphs) {
      if (!g.mesh.visible || g.mesh.material.opacity < 0.05) continue;
      const ink = inkOf(g.mesh.material.map!), n = ink.length / 2;
      if (!n) continue;
      const geo = g.mesh.geometry.parameters, shift = (g.mesh.userData.width as number) / 2;
      const count = Math.min(n, Math.round(100 * (g.w / (this.opts.em * this.voice.scale)) + 24));
      for (let k = 0; k < count; k++) {
        const j = Math.floor(random() * n);
        world.set((ink[j * 2] - 0.5) * geo.width + shift, (0.5 - ink[j * 2 + 1]) * geo.height, 0).applyMatrix4(g.mesh.matrixWorld);
        pos.push(world.x, world.y, world.z);
        const out = world.clone().sub(centre).multiplyScalar(0.25 / Math.max(1e-3, b.size[0] * scale));
        const r = 0.35 + random() * 0.9;
        vel.push((drift[0] * r + out.x + (random() - 0.5) * 0.9) * em, (drift[1] * r + out.y + (random() - 0.5) * 0.9) * em, (drift[2] * r + out.z + (random() - 0.5) * 0.9) * em);
        seed.push(random());
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.Float32BufferAttribute(vel, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    const mat = this.dustMaterial(em);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 21;
    // (Point sizes are in pixels: half the height of whatever it is drawn into.)
    const buffer = new THREE.Vector2();
    points.onBeforeRender = renderer => {
      const target = renderer.getRenderTarget();
      mat.uniforms.uHalfH.value = (target ? target.height : renderer.getDrawingBufferSize(buffer).y) / 2;
    };
    this.group.add(points);
    this.dust.push({ points, born: t });
  }

  update(lyrics: LyricTrack, t: number, energy: number, place: (st: LineState, t: number, root: THREE.Object3D, leave: number, size: [number, number]) => number): void {
    const states = lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const [k, b] of this.blocks) if (!keep.has(k)) { dispose(b.root); this.blocks.delete(k); }
    // The dust of lines gone; a jump back in time (a seek, a new shot drawn from earlier) clears it.
    this.dust = this.dust.filter(d => {
      const age = t - d.born;
      if (age < 0 || age > 2.6) { dispose(d.points); return false; }
      d.points.material.uniforms.uAge.value = age;
      return true;
    });
    const o = this.opts, v = this.voice, neon = v.on === 'neon', paper = this.palette.paper, signal = this.palette.signal;
    for (const st of states) {
      const b = this.blocks.get(st.index) ?? this.blocks.set(st.index, this.build(st)).get(st.index)!;
      b.root.position.set(0, 0, 0);
      b.root.quaternion.identity();
      b.root.scale.setScalar(1);
      const shown = place(st, t, b.root, lyrics.leaveAt(st.index), b.size);
      // Crumbling, the words go at once and the dust carries on; otherwise a leaving line lifts out of the way of the
      // next, by about its own height (a slow camera doesn't carry it off, and two blocks in one place read as neither).
      const crumbles = !!o.dust;
      if (crumbles && st.exit > 0 && !b.dusted && shown > 0.05) { b.dusted = true; this.crumble(b, t); }
      const fade = shown * (crumbles ? 1 - smooth(st.exit / 0.35) : 1 - st.exit);
      b.root.visible = fade > 0.002;
      if (!b.root.visible) continue;
      const lift = crumbles ? 0 : snap(st.exit) * (b.size[1] * 0.6 + o.em * 0.5);
      for (const g of b.glyphs) {
        const ws = st.words[g.word];
        const held = ws.word.end - ws.word.start;
        let s = 1, z = 0, opacity: number;
        if (neon) {
          const look = paintWord(ws, g.word, 'hook', this.palette, energy, 0, this.color, o.onLight);
          g.mesh.visible = !!look;
          if (!look) continue;
          // Comes on a touch big and near and settles.
          s = 1 + (1 - look.k) * 0.16;
          z = (1 - look.k) * g.px * 0.9;
          opacity = look.opacity;
        } else {
          // Written in while it is sung, as fast as the voice goes (a held note slowly), with a pen of light at the
          // edge; warm while sung, settling to paper after.
          if (ws.age < -0.06) { g.mesh.visible = false; continue; }
          g.mesh.visible = true;
          const dur = Math.min(1.2, Math.max(0.2, held));
          const w = clamp01((ws.age + 0.06) / dur);
          const glow = ws.age < held ? 1 : Math.exp(-(ws.age - held) / 0.5);
          g.wipe!.value = 1 - Math.pow(1 - w, 1.4);
          g.pen!.value.set(signal.r, signal.g, signal.b, 1.6 * (1 - w) * (o.onLight ? 0 : 1));
          if (o.onLight) this.color.setRGB(1, 1, 1);
          else this.color.copy(paper).multiplyScalar(0.94).lerp(signal, glow * 0.3);
          opacity = 1;
        }
        // A held note swells a little while it is held.
        const swell = held > 0.5 ? 0.06 * smooth(ws.age / held) * (1 - smooth((ws.age - held) / 0.5)) : 0;
        s *= 1 + swell;
        const base = g.mesh.userData.baseScale ?? (g.mesh.userData.baseScale = g.mesh.scale.x);
        g.mesh.scale.setScalar(s * base);
        g.mesh.position.set(g.x - ((s - 1) * g.w) / 2, g.y + lift, z);
        g.mesh.material.color.copy(this.color);
        g.mesh.material.opacity = opacity * fade;
      }
      // The translation sits under the rows sung so far, easing down as each new row comes up (not under rows still
      // to come, with a gap where they will be).
      let up = b.rowUp.length ? b.rowUp[0].up : 0;
      for (let r = 1; r < b.rowUp.length; r++) up += (b.rowUp[r].up - b.rowUp[r - 1].up) * snap((st.words[b.rowUp[r].word].age + 0.1) / 0.35);
      const n = b.trans.length;
      b.trans.forEach((g, i) => {
        const k = outExpo(clamp01((st.translationProgress - (i + 1) / n + 1 / n) * n * 1.5));
        g.mesh.visible = k > 0;
        if (!k) return;
        g.mesh.position.set(g.x, g.y + up - (1 - k) * o.em * 0.12 + lift, 0);
        if (o.onLight) g.mesh.material.color.setRGB(1, 1, 1);
        else g.mesh.material.color.copy(paper).multiplyScalar(0.85);
        g.mesh.material.opacity = k * fade * 0.92;
      });
      if (b.scrim) {
        const first = st.words[0];
        const up = first ? clamp01((first.age + 0.1) / 0.3) : 1;
        b.scrim.material.uniforms.uAlpha.value = (this.palette.light ? 0.7 : typeof o.scrim === 'number' ? o.scrim : 0.36) * up * fade;
      }
    }
  }
}

// ── Standing a block where the camera will see it ──────────────────────────────────────────────────────────────────

/** A plate's camera at time t (a pure function of time within a shot). */
export type PoseFn = (t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => void;

export interface StandOptions {
  /** How far ahead of the camera the block stands as the line ends: the camera comes up to it there. */
  reach: number;
  /** The furthest it stands while sung: a long line on a fast camera is carried ahead until it is within this. */
  far: number;
  /** Offset in the view's right and up, in shares of the view's height at `reach`. */
  lane: [number, number];
  /** The camera's vertical field of view (degrees) and aspect. */
  fov: number;
  aspect: number;
  /** A plain word's height on screen at `reach`, share of the view's height. */
  em: number;
  /**
   * Ride with the camera instead of standing in the world (a plate whose world is re-scaled as it is flown into, where
   * nothing can stay put), `lag` seconds behind it, so the block trails its turns.
   */
  follow?: boolean;
  lag?: number;
  /** Standing in the world but turned to face the camera as it is now (a camera that rolls: the words stay level). */
  level?: boolean;
}

const V = () => new THREE.Vector3();
const tmpP = V(), tmpF = V(), tmpR = V(), tmpU = V(), tmpQ = new THREE.Quaternion(), tmpB = V();

/** A smooth max(0, x): zero below −w, x above w, a parabola between (no kink, so nothing it drives jolts). */
const softPos = (x: number, w: number) => (x <= -w ? 0 : x >= w ? x : ((x + w) * (x + w)) / (4 * w));

/**
 * Where a line's block stands for one shot: an anchor in front of where the camera will be (at a reference time
 * picked so the whole line stays in frame while it is sung), facing that view. While the camera is still further
 * than `far` from it, the block is carried ahead along that view (smoothly), so a long line on a fast flight isn't
 * a speck at first; once in reach it stays put, and after the line the camera flies at it and past it.
 * When no anchor keeps the line in frame (a camera swinging round), the block rides `reach` ahead of the camera,
 * eased behind its turns (`follow`).
 */
export class Stand {
  readonly anchor = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly ahead = new THREE.Vector3();
  follow = false;
  /** Scale for a block built at `em` world units a word. */
  scale = 1;

  /** Where the camera it was set for is at `from`, and which way it looks (sameCamera). */
  private camFrom = V();
  private dirFrom = V();

  constructor(private pose: PoseFn, private from: number, to: number, private o: StandOptions, em: number, size: [number, number] = [0, 0]) {
    pose(from, this.camFrom, tmpQ);
    this.dirFrom.set(0, 0, -1).applyQuaternion(tmpQ);
    const tan = Math.tan(THREE.MathUtils.degToRad(o.fov) / 2), vh = 2 * o.reach * tan;
    // A word's height on screen (a little smaller in a narrow frame), and never wider than the frame or taller than
    // half of it where the camera comes up to it.
    const narrow = Math.min(1, Math.max(0.62, o.aspect / (16 / 9)));
    this.scale = Math.min((o.em * narrow * vh) / em, (0.86 * vh * o.aspect) / Math.max(1e-3, size[0]), (0.5 * vh) / Math.max(1e-3, size[1]));
    const hw = (size[0] * this.scale) / 2, hh = (size[1] * this.scale) / 2;
    let best = -Infinity;
    const bestA = V(), bestF = V(), bestQ = new THREE.Quaternion();
    for (const k of o.follow ? [] : [1, 0.6, 0.3, 0]) {
      const ref = from + (to - from) * k;
      pose(ref, tmpP, tmpQ);
      tmpF.set(0, 0, -1).applyQuaternion(tmpQ);
      tmpR.set(1, 0, 0).applyQuaternion(tmpQ);
      tmpU.set(0, 1, 0).applyQuaternion(tmpQ);
      const a = V().copy(tmpP).addScaledVector(tmpF, o.reach).addScaledVector(tmpR, o.lane[0] * vh).addScaledVector(tmpU, o.lane[1] * vh);
      const f = tmpF.clone(), q = tmpQ.clone();
      // The worst margin over the line: the whole block inside the frame (a hair in from its edges), and not too near.
      let worst = Infinity;
      for (let i = 0; i <= 6; i++) {
        const tt = from + ((to - from) * i) / 6;
        this.anchor.copy(a); this.ahead.copy(f);
        const b = this.place(tt, tmpB);
        pose(tt, tmpP, tmpQ);
        const d = b.sub(tmpP);
        const z = d.dot(tmpF.set(0, 0, -1).applyQuaternion(tmpQ));
        if (z < o.reach * 0.35) { worst = -1; break; }
        const x = (Math.abs(d.dot(tmpR.set(1, 0, 0).applyQuaternion(tmpQ))) + hw) / (z * tan * o.aspect);
        const y = (Math.abs(d.dot(tmpU.set(0, 1, 0).applyQuaternion(tmpQ))) + hh) / (z * tan);
        worst = Math.min(worst, 1 - Math.max(x / 0.95, y / 0.9));
      }
      if (worst > best + 0.05) { best = worst; bestA.copy(a); bestF.copy(f); bestQ.copy(q); }
    }
    this.anchor.copy(bestA); this.ahead.copy(bestF); this.quat.copy(bestQ);
    this.follow = !!o.follow || best < 0;
  }

  /** Whether `pose` is still the camera this stand was set for (the same place and way of looking at its start). */
  sameCamera(pose: PoseFn): boolean {
    pose(this.from, tmpP, tmpQ);
    return tmpP.distanceTo(this.camFrom) < this.o.reach * 0.05 && tmpF.set(0, 0, -1).applyQuaternion(tmpQ).dot(this.dirFrom) > 0.996;
  }

  /** The block's middle at t. */
  place(t: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.follow) {
      this.pose(t - (this.o.lag ?? 0), tmpP, tmpQ);
      const vh = 2 * this.o.reach * Math.tan(THREE.MathUtils.degToRad(this.o.fov) / 2);
      return out.copy(tmpP).addScaledVector(tmpF.set(0, 0, -1).applyQuaternion(tmpQ), this.o.reach)
        .addScaledVector(tmpR.set(1, 0, 0).applyQuaternion(tmpQ), this.o.lane[0] * vh)
        .addScaledVector(tmpU.set(0, 1, 0).applyQuaternion(tmpQ), this.o.lane[1] * vh);
    }
    this.pose(t, tmpP, tmpQ);
    const dist = tmpB.copy(this.anchor).sub(tmpP).dot(this.ahead);
    return out.copy(this.anchor).addScaledVector(this.ahead, -softPos(dist - this.o.far, this.o.far * 0.2));
  }

  /** Poses a block's root at t (facing the view it was set for; following, facing the camera). */
  apply(t: number, root: THREE.Object3D): void {
    this.place(t, root.position);
    if (this.follow || this.o.level) { this.pose(t - (this.follow ? this.o.lag ?? 0 : 0), tmpP, tmpQ); root.quaternion.copy(tmpQ); } else root.quaternion.copy(this.quat);
    root.scale.setScalar(this.scale);
  }

  /** Distance from the camera at t to the block, along the camera's view. */
  depth(t: number): number {
    this.place(t, tmpB);
    this.pose(t, tmpP, tmpQ);
    return tmpB.sub(tmpP).dot(tmpF.set(0, 0, -1).applyQuaternion(tmpQ));
  }
}

/**
 * The stands of the lines a plate shows, one per line per shot (a cut puts the line in another camera's path);
 * consecutive lines take the `lanes` in turn. `pose` is the shot's camera, `em` the blocks' em (world units).
 */
export class Stands {
  private map = new Map<string, Stand>();
  constructor(private lanes: Array<[number, number]>) {}

  get(shotStart: number, st: LineState, leave: number, pose: PoseFn, em: number, o: Omit<StandOptions, 'lane'>, size?: [number, number]): Stand {
    const key = shotStart.toFixed(3) + ':' + st.index + ':' + o.aspect.toFixed(2);
    let s = this.map.get(key);
    // A run of short shots reaches the plate as one shot (Shot.run: the same start, the same key), but a cut inside it
    // may put the camera somewhere else (the city draws a new camera at each): the stand is kept only while the camera
    // is the one it was set for. (Kept for the whole run, the line stood in the first camera's view and the city's
    // last seconds before a chorus went without words — the user: “有时歌词会消失”.)
    if (s && !s.sameCamera(pose)) s = undefined;
    if (!s) {
      if (this.map.size > 64) this.map.clear();
      const from = Math.max(shotStart, st.line.start - 0.15);
      // (A narrow frame keeps the lanes nearer the middle.)
      const [lx, ly] = this.lanes[st.index % this.lanes.length];
      s = new Stand(pose, from, Math.max(from + 0.5, leave), { ...o, lane: [lx * Math.min(1, o.aspect / (16 / 9)), ly] }, em, size);
      this.map.set(key, s);
    }
    return s;
  }
}
