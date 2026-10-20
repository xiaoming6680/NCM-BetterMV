// Lyrics in the world (the user: "能不能把歌词做进空间，现在固定在屏幕上的歌词不高级", "可读性不是第一要求，
// 效果是第一要求"; docs/TREATMENT.md, 歌词在空间里). Each plate gives the words a place of their own instead of a card
// riding the lens:
//   LyricGates — the sung words, a few at a time, as signs down a tunnel that the camera flies through
//   LyricOrbit — the line set round a circle: flat on the rings, or a band standing round the armillary; it turns a
//                notch as each word is sung, so the word being sung is where the camera looks
//   LyricRing  — the line round a ring about the middle, like a badge: the words over the top, the translation
//                along the bottom; it comes up out of the middle and leaves outwards (the kaleidoscope)
//   LyricLayer — the line drawn into a texture that the plate's own shader prints on its surface (the triangle
//                wall: the words flip with the triangles and burst apart with them)
// LyricRig's world mode (`place`) leaves whole cards in the scene. All of them draw a word the same way (paintWord).
import * as THREE from 'three';
import { textMesh, hasCjk, type Face } from '../render/text.ts';
import { lastIndex } from '../director/music.ts';
import type { LyricTrack, LineState } from '../director/lyrics.ts';
import type { LyricLine } from '../types.ts';
import type { Palette } from '../render/palette.ts';
import { tokenize } from '../lyrics/parse.ts';
import { LyricRig, paintWord, type RigStyle } from './lyricRig.ts';
import { clamp01, freeGraph, outExpo, smooth, snap } from './types.ts';

type TextMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

function dispose(root: THREE.Object3D): void {
  root.parent?.remove(root);
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
}

/** Translation characters, revealed in order as the line goes by (it has no word times). */
function revealAt(state: LineState, i: number, n: number, rate = 1.5): number {
  return outExpo(clamp01((state.translationProgress - (i + 1) / n + 1 / n) * n * rate));
}

// ── Chunks ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A few words of a line that travel together (one sign down a tunnel). */
export interface Chunk {
  line: number;
  /** Indices into the line's words. */
  words: number[];
  start: number;
  end: number;
  /** Its place among all the song's chunks (plates alternate sides by it). */
  ordinal: number;
  /** When the song's next chunk begins (Infinity after the last). */
  next: number;
}

const MARK_END = /\p{P}$/u;
const isChar = (s: string) => hasCjk(s) && Array.from(s.replace(/[\p{P}\s]/gu, '')).length <= 1;

/**
 * A line in chunks, at its phrases: Chinese (Japanese, Korean) in runs of two to four characters, broken where the
 * text has a space or a mark or the singer pauses; Latin one or two words at a time (a long word alone).
 */
function chunkLine(line: LyricLine, index: number): Omit<Chunk, 'ordinal' | 'next'>[] {
  const ws = line.words;
  const brk = ws.map(() => false);
  let at = 0;
  ws.forEach((w, i) => {
    const found = line.text.indexOf(w.text, at);
    if (found >= 0) { at = found + w.text.length; if (hasCjk(w.text) && /\s/.test(line.text[at] ?? ' ')) brk[i] = true; }
    if (MARK_END.test(w.text)) brk[i] = true;
    const next = ws[i + 1];
    if (next && next.start - w.end > 0.3) brk[i] = true;
  });
  const out: Omit<Chunk, 'ordinal' | 'next'>[] = [];
  const push = (idx: number[]) => { if (idx.length) out.push({ line: index, words: idx, start: ws[idx[0]].start, end: ws[idx[idx.length - 1]].end }); };
  let phrase: number[] = [];
  const flush = () => {
    if (!phrase.length) return;
    if (phrase.every(i => isChar(ws[i].text))) {
      for (const run of runs(phrase.map(i => ws[i].text))) push(run.map(j => phrase[j]));
    } else {
      let cur: number[] = [], chars = 0;
      for (const i of phrase) {
        const len = ws[i].text.length;
        if (cur.length && (cur.length >= 2 || chars + len > 10)) { push(cur); cur = []; chars = 0; }
        cur.push(i);
        chars += len;
      }
      push(cur);
    }
    phrase = [];
  };
  ws.forEach((_, i) => { phrase.push(i); if (brk[i]) flush(); });
  flush();
  return out;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

/**
 * Splits a phrase of single characters into runs of up to four, never inside a word (the browser's dictionary
 * segmenter finds them: 进入 / 温暖的你, not 进入温 / 暖的你), as near three characters each as it can.
 */
function runs(chars: string[]): number[][] {
  const text = chars.join('');
  // Word boundaries as character indices (a segmenter that is missing leaves every character a word).
  const cuts = new Set<number>([0, chars.length]);
  if (segmenter) {
    let at = 0;
    for (const seg of segmenter.segment(text)) {
      // Map the segment's end (UTF-16 offset) back to a character index.
      const end = seg.index + seg.segment.length;
      while (at < chars.length && chars.slice(0, at + 1).join('').length <= end) at++;
      cuts.add(at);
    }
  } else for (let i = 1; i < chars.length; i++) cuts.add(i);
  const b = Array.from(cuts).sort((x, y) => x - y);
  // Cheapest way to the k-th boundary: runs of at most four characters (a longer word alone), near three each.
  const cost = b.map(() => Infinity), from = b.map(() => -1);
  cost[0] = 0;
  for (let i = 1; i < b.length; i++) for (let j = i - 1; j >= 0; j--) {
    const n = b[i] - b[j];
    if (n > 4 && j < i - 1) break;
    const c = cost[j] + (n - 3) * (n - 3) + 1;
    if (c < cost[i]) { cost[i] = c; from[i] = j; }
  }
  const out: number[][] = [];
  for (let i = b.length - 1; i > 0; i = from[i]) out.unshift(Array.from({ length: b[i] - b[from[i]] }, (_, k) => b[from[i]] + k));
  return out;
}

const chunkCache = new WeakMap<LyricTrack, Chunk[]>();
const lineCache = new WeakMap<LyricTrack, Chunk[]>();
/** The song's chunks; `whole`: one per line, all its words (GateOptions.whole). */
export function chunksOf(lyrics: LyricTrack, whole = false): Chunk[] {
  const cache = whole ? lineCache : chunkCache;
  let c = cache.get(lyrics);
  if (!c) {
    let n = 0;
    const all = whole
      ? lyrics.lines.flatMap((l, i) => (l.words.length ? [{ line: i, words: l.words.map((_, j) => j), start: l.words[0].start, end: l.words[l.words.length - 1].end }] : []))
      : lyrics.lines.flatMap((l, i) => chunkLine(l, i));
    c = all.map((x, i) => ({ ...x, ordinal: n++, next: all[i + 1]?.start ?? Infinity }));
    cache.set(lyrics, c);
  }
  return c;
}

// ── Tubes ──────────────────────────────────────────────────────────────────────────────────────────────────────

const tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3(), tM = new THREE.Matrix4();
/**
 * Poses a sign in a tube's cross-section (centre c; r right, u up, t ahead): offset (x, y) in the section turned by
 * `twist`, facing back down the tube; a sign on a wall turns towards the axis by `yaw` (positive: towards −x).
 */
export function poseInTube(root: THREE.Object3D, c: THREE.Vector3, r: THREE.Vector3, u: THREE.Vector3, t: THREE.Vector3, x: number, y: number, twist = 0, yaw = 0): void {
  const ct = Math.cos(twist), st = Math.sin(twist);
  tX.copy(r).multiplyScalar(ct).addScaledVector(u, st);
  tY.copy(u).multiplyScalar(ct).addScaledVector(r, -st);
  root.position.copy(c).addScaledVector(tX, x).addScaledVector(tY, y);
  tZ.copy(t).multiplyScalar(-Math.cos(yaw)).addScaledVector(tX, -Math.sin(yaw)).normalize();
  tX.crossVectors(tY, tZ).normalize();
  tY.crossVectors(tZ, tX);
  root.quaternion.setFromRotationMatrix(tM.makeBasis(tX, tY, tZ));
}

// ── Gates ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GateOptions {
  style: RigStyle;
  /** Em height of the words, world units. */
  em: number;
  /** A sign never gets wider than this (it shrinks to fit). */
  maxW: number;
  face?: Face;
  /**
   * Set round the top of a circle of this radius (centred on the sign's origin, read clockwise) instead of in a row.
   */
  arc?: number;
  /** The translation as a banner: its em height, and whether Chinese runs down a column (or, with `arc`, round the
   * bottom of a circle of that radius, read upright). */
  trans?: { em: number; vertical: boolean; arc?: number };
  /** How long after its last word a chunk may still be about (the plate's `gate` says when it has gone). */
  linger?: number;
  /** The frame behind is light (the ink plates' paper): dark type, in the cover's ink, on a white glow. */
  onLight?: boolean;
  /**
   * One sign per line, all its words, instead of a few words each (a plate where signs pile up rather than fly past:
   * the kaleidoscope's slow push held eight arcs at once). An arc then never runs round more than 150°: a long line
   * is set smaller.
   */
  whole?: boolean;
  /** The translation banner's face (the song's lyric voice), bold sans when not given. */
  transFace?: Face;
  /**
   * Hidden behind what is nearer, like the plate's own things, instead of drawn over everything: signs on boards that
   * stand in front of one another (the neon street's), where a far sign's words lay over a near board.
   */
  depth?: boolean;
}

/** A glyph of a sign: a whole word in a row (pivot at its left), or one character on an arc (pivot at its middle). */
interface SignGlyph { mesh: TextMesh; word: number; x: number; y: number; rot: number; w: number; centred: boolean }
interface Sign { root: THREE.Group; glyphs: SignGlyph[] }
/** A translation banner; its root's userData has `vertical` (a column) and `size` ([width, height], world units). */
interface Banner { root: THREE.Group; chars: Array<{ mesh: TextMesh; x: number; y: number }> }

/**
 * The words as signs down a tunnel. Each chunk is a sign the plate poses (`gate` sets its root and returns its fade;
 * 0 once it has gone): typically it strikes on some way ahead when its first word is sung, holds there while it is
 * sung, and is left behind for the camera to fly through. The translation is a banner per line (`banner`).
 */
export class LyricGates {
  readonly group = new THREE.Group();
  private signs = new Map<number, Sign>();
  private banners = new Map<number, Banner>();
  private starts: Float64Array | null = null;
  private color = new THREE.Color();
  /** What the frame has room for, when narrower than the plate's `maxW` (setWidth). */
  private width: { sign: number; banner: number } | null = null;

  constructor(private palette: Palette, private opts: GateOptions) {
    this.group.userData.lyrics = true;
  }

  /**
   * The widest a sign and a row of the translation may be (world units, at scale 1) on this frame: a portrait one sees
   * a third as much across where the signs strike (issue #4). A sign wider shrinks to fit, a banner breaks into two
   * rows. When it changes, the signs and banners about are set again.
   */
  setWidth(sign: number, banner: number): void {
    const w = this.width;
    if (w && Math.abs(w.sign - sign) <= sign * 0.02 && Math.abs(w.banner - banner) <= banner * 0.02) return;
    this.width = { sign, banner };
    for (const s of this.signs.values()) dispose(s.root);
    this.signs.clear();
    for (const b of this.banners.values()) dispose(b.root);
    this.banners.clear();
  }

  private material(m: TextMesh): TextMesh {
    m.material.depthWrite = false;
    m.material.depthTest = !!this.opts.depth;
    m.renderOrder = 20;
    return m;
  }

  /** The baked halo: dark round light type, or white round dark type on a light frame. */
  private get halo(): string { return this.opts.onLight ? this.palette.css.ink : 'dark'; }

  private buildSign(c: Chunk, line: LyricLine): Sign {
    const o = this.opts, face = o.face ?? (o.style === 'poem' ? 'serif' : 'condensed'), halo = this.halo;
    const root = new THREE.Group();
    const cjk = hasCjk(line.text);
    const gap = cjk ? o.em * 0.08 : o.em * 0.32;
    const glyphs: SignGlyph[] = [];
    if (o.arc) {
      // Character by character round the top of the circle, centred on it.
      let len = 0;
      const chars: Array<{ mesh: TextMesh; word: number; s: number }> = [];
      c.words.forEach((wi, j) => {
        if (j) len += gap;
        for (const ch of Array.from(line.words[wi].text)) {
          const mesh = this.material(textMesh(ch, face, o.em, { center: true, px: 160, halo })), adv = mesh.userData.width as number;
          chars.push({ mesh, word: wi, s: len + adv / 2 });
          len += adv;
        }
      });
      const fit = o.whole ? Math.min(1, (o.arc * THREE.MathUtils.degToRad(150)) / Math.max(1e-3, len)) : 1;
      for (const ch of chars) {
        const th = Math.PI / 2 + ((len / 2 - ch.s) * fit) / o.arc;
        ch.mesh.userData.baseScale = fit;
        root.add(ch.mesh);
        glyphs.push({ mesh: ch.mesh, word: ch.word, x: o.arc * Math.cos(th), y: o.arc * Math.sin(th), rot: th - Math.PI / 2, w: 0, centred: true });
      }
    } else {
      const meshes = c.words.map(i => this.material(textMesh(line.words[i].text, face, o.em, { px: 180, halo })));
      const widths = meshes.map(m => m.userData.width as number);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (meshes.length - 1);
      const s = Math.min(1, Math.min(o.maxW, this.width?.sign ?? Infinity) / Math.max(1e-3, total));
      let x = (-total * s) / 2;
      meshes.forEach((m, j) => {
        m.userData.baseScale = s;
        root.add(m);
        glyphs.push({ mesh: m, word: c.words[j], x, y: 0, rot: 0, w: widths[j] * s, centred: false });
        x += (widths[j] + gap) * s;
      });
    }
    this.group.add(root);
    return { root, glyphs };
  }

  private buildBanner(text: string): Banner {
    const o = this.opts.trans!, root = new THREE.Group(), chars: Banner['chars'] = [];
    if (o.arc) {
      // Round the bottom of the circle, read left to right, standing upright (heads towards the centre).
      const laid: Array<{ mesh: TextMesh; s: number }> = [];
      let len = 0;
      for (const ch of Array.from(text)) {
        if (!ch.trim()) { len += o.em * 0.35; continue; }
        const mesh = this.material(textMesh(ch, this.opts.transFace ?? 'bold', o.em, { center: true, px: 112, halo: this.halo })), adv = mesh.userData.width as number;
        laid.push({ mesh, s: len + adv / 2 });
        len += adv;
      }
      for (const ch of laid) {
        const th = -Math.PI / 2 + (ch.s - len / 2) / o.arc;
        ch.mesh.rotation.z = th + Math.PI / 2;
        root.add(ch.mesh);
        chars.push({ mesh: ch.mesh, x: o.arc * Math.cos(th), y: o.arc * Math.sin(th) });
      }
      root.userData.size = [o.arc * 2, o.arc * 2];
    } else if (o.vertical && hasCjk(text)) {
      // Down a column, top to bottom; a mark or a space leaves half a cell.
      let y = 0;
      for (const ch of Array.from(text.trim())) {
        if (/[\s\p{P}]/u.test(ch)) { y -= o.em * 0.55; continue; }
        const mesh = this.material(textMesh(ch, this.opts.transFace ?? 'bold', o.em, { center: true, px: 112, halo: this.halo }));
        root.add(mesh);
        chars.push({ mesh, x: 0, y });
        y -= o.em * 1.14;
      }
      const mid = (y + o.em * 1.14) / 2;
      for (const g of chars) g.y -= mid;
      root.userData.vertical = true;
      root.userData.size = [o.em * 1.2, -y];
    } else {
      const parts = hasCjk(text) ? Array.from(text) : tokenize(text);
      const meshes = parts.map(p => (p.trim() ? this.material(textMesh(p, this.opts.transFace ?? 'bold', o.em, { px: 112, halo: this.halo })) : null));
      const widths = meshes.map(m => (m ? (m.userData.width as number) + (hasCjk(text) ? 0 : o.em * 0.3) : o.em * 0.35));
      // One row; two, as even as they break, where the frame has no room for it (setWidth).
      const total = widths.reduce((a, b) => a + b, 0), room = this.width?.banner ?? Infinity;
      const rows: number[][] = [[]], half = total > room ? total / 2 : Infinity;
      let acc = 0;
      widths.forEach((w, i) => {
        if (acc > 0 && rows.length < 2 && acc + w / 2 > half) { rows.push([]); acc = 0; }
        if (!rows[rows.length - 1].length && !meshes[i]) return;
        rows[rows.length - 1].push(i);
        acc += w;
      });
      const lead = o.em * 1.3, top = ((rows.length - 1) * lead) / 2;
      let widest = 0;
      rows.forEach((row, r) => {
        const rowW = row.reduce((a, i) => a + widths[i], 0);
        widest = Math.max(widest, rowW);
        let x = -rowW / 2;
        for (const i of row) { const mesh = meshes[i]; if (mesh) { root.add(mesh); chars.push({ mesh, x, y: top - r * lead }); } x += widths[i]; }
      });
      root.userData.size = [widest, o.em * 1.2 + (rows.length - 1) * lead];
    }
    this.group.add(root);
    return { root, chars };
  }

  update(lyrics: LyricTrack, t: number, energy: number,
    gate: (c: Chunk, t: number, root: THREE.Object3D) => number,
    banner?: (state: LineState, t: number, root: THREE.Object3D) => number): void {
    const chunks = chunksOf(lyrics, this.opts.whole);
    const starts = this.starts ??= Float64Array.from(chunks, c => c.start);
    const linger = this.opts.linger ?? 2;
    const live = new Set<number>(), states = new Map<number, LineState>();
    const hook = this.opts.style === 'hook';
    for (let i = lastIndex(starts, t + 0.1); i >= 0; i--) {
      const c = chunks[i];
      if (c.start < t - linger - 12) break;
      if (c.end + linger < t) continue;
      const line = lyrics.lines[c.line];
      const sign = this.signs.get(c.ordinal) ?? this.signs.set(c.ordinal, this.buildSign(c, line)).get(c.ordinal)!;
      live.add(c.ordinal);
      sign.root.position.set(0, 0, 0);
      sign.root.quaternion.identity();
      sign.root.scale.setScalar(1);
      const fade = gate(c, t, sign.root);
      sign.root.visible = fade > 0.002;
      if (!sign.root.visible) continue;
      const st = states.get(c.line) ?? states.set(c.line, lyrics.state(c.line, t)).get(c.line)!;
      for (const g of sign.glyphs) {
        const look = paintWord(st.words[g.word], g.word, this.opts.style, this.palette, energy, 0, this.color, this.opts.onLight);
        g.mesh.visible = !!look;
        if (!look) continue;
        // Hook words slam in from a little bigger and nearer, growing about their middle.
        const sc = hook ? 1 + (1 - look.k) * 0.4 : 1;
        g.mesh.scale.setScalar(sc * g.mesh.userData.baseScale);
        g.mesh.position.set(g.x - (g.centred ? 0 : ((sc - 1) * g.w) / 2), g.y, (1 - look.k) * this.opts.em * (hook ? 1.4 : 0.2));
        g.mesh.rotation.z = g.rot;
        g.mesh.material.color.copy(this.color);
        g.mesh.material.opacity = look.opacity * fade;
      }
    }
    for (const [k, s] of this.signs) if (!live.has(k)) { dispose(s.root); this.signs.delete(k); }

    const keep = new Set<number>();
    if (banner && this.opts.trans) {
      const paper = this.palette.paper;
      for (const s of lyrics.visible(t)) {
        if (!s.line.translation) continue;
        keep.add(s.index);
        const b = this.banners.get(s.index) ?? this.banners.set(s.index, this.buildBanner(s.line.translation)).get(s.index)!;
        b.root.position.set(0, 0, 0);
        b.root.quaternion.identity();
        b.root.scale.setScalar(1);
        const fade = banner(s, t, b.root) * (1 - s.exit);
        b.root.visible = fade > 0.002;
        if (!b.root.visible) continue;
        const n = b.chars.length;
        b.chars.forEach((g, i) => {
          const k = revealAt(s, i, n);
          g.mesh.visible = k > 0;
          g.mesh.position.set(g.x, g.y - (1 - k) * this.opts.trans!.em * 0.4, 0);
          if (this.opts.onLight) g.mesh.material.color.setRGB(1, 1, 1);
          else g.mesh.material.color.copy(paper).multiplyScalar(0.85);
          g.mesh.material.opacity = k * fade * 0.92;
        });
      }
    }
    for (const [k, b] of this.banners) if (!keep.has(k)) { dispose(b.root); this.banners.delete(k); }
  }
}

// ── Orbit ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OrbitOptions {
  style: RigStyle;
  em: number;
  radius: number;
  /**
   * flat: lying in the group's xy plane, each letter standing out from the centre, read clockwise over the top.
   * band: standing round the group's y axis, facing out, read left to right from outside.
   */
  mode: 'flat' | 'band';
  face?: Face;
  /** Translation: flat, round the bottom of a circle of this radius, read upright; band, a row under the words. */
  trans?: { em: number; radius: number };
  /** The translation's face (the song's lyric voice), bold sans when not given. */
  transFace?: Face;
}

/** A glyph at arc length `s` along its row (`row`: the translation's row on a band, 0 elsewhere). */
interface OrbitGlyph { mesh: TextMesh; s: number; row?: number }
const edgeP = new THREE.Vector3();
/** `transRows`: each translation row's length (one row unless setWidth broke it). */
interface OrbitLine { root: THREE.Group; glyphs: OrbitGlyph[]; word: number[]; wordS: number[]; trans: OrbitGlyph[]; transLen: number; transRows: number[] }

/**
 * The line set round a circle. The circle turns a notch as each word begins (eased over a fifth of a second). Flat,
 * what has been sung so far stays centred over the top and grows out both ways; on a band the word being sung arrives
 * at the side the camera was facing when it began, and the words already sung trail away round it. A leaving line
 * keeps turning away as it fades.
 */
export class LyricOrbit {
  readonly group = new THREE.Group();
  private lines = new Map<number, OrbitLine>();
  private color = new THREE.Color();

  constructor(private palette: Palette, private opts: OrbitOptions) {
    this.group.userData.lyrics = true;
  }

  /**
   * The arc a band's translation row may take (the group's units) before it breaks into more rows: what the frame
   * shows across where the words stand. A portrait frame sees a third of a wide one's width, and a translation in one
   * row ran off both sides (issue #4). Lines on screen are set again when it changes.
   */
  private width = Infinity;
  setWidth(width: number): void {
    if (Math.abs(width - this.width) < this.width * 0.03) return;
    this.width = width;
    for (const b of this.lines.values()) dispose(b.root);
    this.lines.clear();
  }

  private glyph(ch: string, em: number, face: Face, px: number): TextMesh {
    const m = textMesh(ch, face, em, { center: true, px });
    m.material.depthWrite = false;
    m.material.depthTest = false;
    m.material.side = THREE.FrontSide;
    m.renderOrder = 20;
    return m;
  }

  private build(state: LineState): OrbitLine {
    const o = this.opts, face = o.face ?? (o.style === 'poem' ? 'serif' : 'condensed');
    const root = new THREE.Group();
    const glyphs: OrbitGlyph[] = [], word: number[] = [], wordS: number[] = [];
    let s = 0;
    state.line.words.forEach((w, wi) => {
      const cjk = hasCjk(w.text);
      const from = s;
      for (const ch of Array.from(w.text)) {
        const mesh = this.glyph(ch, o.em, face, 128), adv = (mesh.userData.width as number) * (cjk ? 1.04 : 1);
        root.add(mesh);
        glyphs.push({ mesh, s: s + adv / 2 });
        word.push(wi);
        s += adv;
      }
      wordS[wi] = (from + s) / 2;
      s += cjk ? o.em * 0.06 : o.em * 0.34;
    });
    const trans: OrbitGlyph[] = [];
    let transLen = 0;
    const transRows: number[] = [];
    if (o.trans && state.line.translation) {
      const text = state.line.translation;
      for (const ch of Array.from(text)) {
        if (!ch.trim()) { transLen += o.trans.em * 0.35; continue; }
        const mesh = this.glyph(ch, o.trans.em, o.transFace ?? 'bold', 96), adv = mesh.userData.width as number;
        root.add(mesh);
        trans.push({ mesh, s: transLen + adv / 2, row: 0 });
        transLen += adv;
      }
      transRows.push(transLen);
      // On a band wider than the frame: rows of about equal length, broken between characters (at a space in Latin
      // text, after a mark in CJK when one is near).
      if (o.mode === 'band' && transLen > this.width && trans.length > 1) {
        const n = Math.ceil(transLen / this.width), target = transLen / n, chars = Array.from(text).filter(c => c.trim());
        const latin = !hasCjk(text);
        let row = 0, from = 0, start = trans[0].s - (trans[0].mesh.userData.width as number) / 2;
        transRows.length = 0;
        for (let i = 0; i < trans.length; i++) {
          const g = trans[i], half = (g.mesh.userData.width as number) / 2, at = g.s + half - start;
          const next = trans[i + 1];
          const gapAfter = next ? next.s - (next.mesh.userData.width as number) / 2 - (g.s + half) > 1e-4 : false;
          const mark = /[，。、！？；：,.!?;:]/.test(chars[i] ?? '');
          const breakable = !next ? false : latin ? gapAfter : true;
          const due = at >= target * (mark ? 0.8 : 1) && row < n - 1;
          g.row = row;
          if (breakable && due) {
            transRows.push(at);
            for (let k = from; k <= i; k++) trans[k].s -= start;
            row++; from = i + 1; start = next.s - (next.mesh.userData.width as number) / 2;
          }
        }
        for (let k = from; k < trans.length; k++) trans[k].s -= start;
        const last = trans[trans.length - 1];
        transRows.push(last.s + (last.mesh.userData.width as number) / 2);
      }
    }
    this.group.add(root);
    return { root, glyphs, word, wordS, trans, transLen, transRows };
  }

  /**
   * The circle's turn for a line at t (glyph at arc length s sits at angle turn − s/r on a flat circle, turn + s/r on
   * a band). As each word begins the circle turns a notch, eased over a fifth of a second, to bring that word to the
   * anchor as it was at the word's start; in between it holds still in the world.
   */
  private turn(b: OrbitLine, st: LineState, anchorAt: (t: number) => number): number {
    const r = this.opts.radius, flat = this.opts.mode === 'flat';
    // Flat: the middle of what has been sung sits at the top, so the sung words stay over it, upright enough to read,
    // and the line grows out both ways. Band: the word itself, where the camera looked when it began.
    const first = b.wordS.findIndex(x => x !== undefined);
    const at = (i: number) => flat
      ? Math.PI / 2 + ((b.wordS[first] + b.wordS[i]) / 2) / r
      : anchorAt(st.line.words[i].start - 0.04) - b.wordS[i] / r;
    let cur = -1;
    st.words.forEach((ws, i) => { if (ws.age >= -0.04 && b.wordS[i] !== undefined) cur = i; });
    if (cur < 0) return first >= 0 ? at(first) : flat ? Math.PI / 2 : anchorAt(st.line.start);
    let prev = cur - 1;
    while (prev >= 0 && b.wordS[prev] === undefined) prev--;
    const to = at(cur);
    if (prev < 0) return to;
    // The short way round from the last notch.
    const from = at(prev), d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return to - d + d * outExpo(clamp01((st.words[cur].age + 0.04) / 0.22));
  }

  /**
   * How far a glyph at `p` (its line's root's frame) is from the frame's edge, as `camera` sees it: 1 well inside,
   * falling to 0 as it reaches an edge. A band seen whole in a wide frame shows its sides; a narrow one (a portrait
   * frame, issue #4) sees only its front, and a close camera has the words pass right by it — they fade there rather
   * than run off the frame cut in two.
   */
  private edge(p: THREE.Vector3, root: THREE.Object3D, camera: THREE.Camera): number {
    edgeP.copy(p).applyMatrix4(root.matrixWorld).project(camera);
    if (edgeP.z > 1) return 0;
    return (1 - smooth((Math.abs(edgeP.x) - 0.8) / 0.18)) * (1 - smooth((Math.abs(edgeP.y) - 0.84) / 0.14));
  }

  /**
   * `anchorAt(t)`: for a band, the angle round its y axis (from +z towards +x) facing the camera at time t, so each
   * word is set where the camera looked when it was sung (and the band can fade what is turned away now). `camera`:
   * the plate's, its matrices up to date — the words fade at the frame's edges (see `edge`; a flat circle seen close,
   * the record's low view, runs off a narrow frame too).
   */
  update(lyrics: LyricTrack, t: number, energy: number, anchorAt: (t: number) => number = () => 0, camera?: THREE.Camera): void {
    const o = this.opts, r = o.radius, flat = o.mode === 'flat', states = lyrics.visible(t);
    const view = camera ?? null;
    if (view) this.group.updateMatrixWorld(true);
    const keep = new Set(states.map(s => s.index));
    for (const [k, b] of this.lines) if (!keep.has(k)) { dispose(b.root); this.lines.delete(k); }
    const paper = this.palette.paper, now = anchorAt(t);
    for (const st of states) {
      const b = this.lines.get(st.index) ?? this.lines.set(st.index, this.build(st)).get(st.index)!;
      // A leaving line turns on, the way the sung words went, by a quarter circle as it fades.
      const away = snap(st.exit) * Math.PI * 0.5;
      const turn = this.turn(b, st, anchorAt) + (flat ? away : -away);
      b.glyphs.forEach((g, gi) => {
        const wi = b.word[gi];
        const look = paintWord(st.words[wi], wi, o.style, this.palette, energy, st.exit, this.color);
        g.mesh.visible = !!look;
        if (!look) return;
        const lift = (1 - look.k) * o.em * (o.style === 'hook' ? 0.8 : 0.15);
        let vis = 1;
        if (flat) {
          const th = turn - g.s / r, rr = r + lift;
          g.mesh.position.set(rr * Math.cos(th), rr * Math.sin(th), 0);
          g.mesh.rotation.set(0, 0, th - Math.PI / 2);
          // Far round from the top (a long line), it fades rather than run upside down into the other end.
          vis = 1 - smooth((Math.abs(th - Math.PI / 2) - 2.3) / 0.6);
          if (view && vis > 0) vis *= this.edge(g.mesh.position, b.root, view);
        } else {
          const th = turn + g.s / r, rr = r + lift;
          g.mesh.position.set(rr * Math.sin(th), 0, rr * Math.cos(th));
          g.mesh.rotation.set(0, th, 0);
          vis = smooth((Math.cos(th - now) + 0.15) / 0.5);
          if (view && vis > 0) vis *= this.edge(g.mesh.position, b.root, view);
        }
        g.mesh.scale.setScalar(o.style === 'hook' ? 1 + (1 - look.k) * 0.4 : 1);
        g.mesh.material.color.copy(this.color);
        g.mesh.material.opacity = look.opacity * vis;
      });
      const tr = o.trans, n = b.trans.length;
      if (!tr) continue;
      // The translation stays where the line began: round the bottom of a flat circle (read upright), or under the
      // words on a band, centred on where the camera looked as the line began.
      const base = flat ? 0 : anchorAt(st.line.start) - away;
      b.trans.forEach((g, i) => {
        const k = revealAt(st, i, n) * (1 - st.exit);
        g.mesh.visible = k > 0;
        if (!k) return;
        g.mesh.material.color.copy(paper).multiplyScalar(0.85);
        g.mesh.material.opacity = k * 0.92;
        if (flat) {
          const th = -Math.PI / 2 + (g.s - b.transLen / 2) / tr.radius + away;
          g.mesh.position.set(tr.radius * Math.cos(th), tr.radius * Math.sin(th), 0);
          g.mesh.rotation.set(0, 0, th + Math.PI / 2);
          if (view) g.mesh.material.opacity *= this.edge(g.mesh.position, b.root, view);
        } else {
          const row = g.row ?? 0;
          const th = base + (g.s - b.transRows[row] / 2) / tr.radius;
          g.mesh.position.set(tr.radius * Math.sin(th), -o.em * 1.25 - row * tr.em * 1.3, tr.radius * Math.cos(th));
          g.mesh.rotation.set(0, th, 0);
          g.mesh.material.opacity *= smooth((Math.cos(th - now) + 0.15) / 0.5) * (view ? this.edge(g.mesh.position, b.root, view) : 1);
        }
      });
    }
  }
}

// ── Ring ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RingOptions {
  style: RigStyle;
  em: number;
  face?: Face;
  /** The translation's em and face (the song's lyric voice; bold sans when not given). */
  transEm: number;
  transFace?: Face;
}

/** A glyph `x` along its row from the row's start, in `row` (0: the outer one), of word `word` (−1: translation). */
interface RingGlyph { mesh: TextMesh; x: number; row: number; word: number }
/**
 * `rows`: each row's length (the line's units at full size); `scale`: the line's type scale (a long line is set
 * smaller to stay within the arc); `transScale` the translation's.
 */
interface RingLine { root: THREE.Group; glyphs: RingGlyph[]; rows: number[]; scale: number; trans: RingGlyph[]; transLen: number; transScale: number }

/** A stretch of the ring the words take up (the plate's units, round the middle): kaleido.ts calms its pattern there. */
export interface RingBand { rIn: number; rOut: number; angle: number; span: number; k: number }

/** Half the arc a row may take (radians): beyond about 50° the words at its ends lean too far to read easily. */
const RING_ARC = 0.9;
/** Smallest type scale before a line breaks into two rows, and the smallest at all. */
const RING_SHRINK = 0.72, RING_MIN = 0.6;
const ringP = new THREE.Vector3();

/**
 * The line set round a ring about the middle of the frame, the way type runs round a badge: the words along the top,
 * read left to right, each glyph turned along the ring; a line too long for the top third of the ring is set smaller,
 * then broken in two at a word, the second half on a ring just inside the first. The translation runs along the
 * bottom of the ring, upright, appearing as the line is sung. Words still to come wait dim, so the whole line reads;
 * the word being sung strikes on. The ring comes up out of the middle as the line begins, swells a little while it
 * is sung, and goes on out past the edges as it leaves, as the plate's zoom carries everything outwards. (A spiral
 * arm reaching into the middle stacked the words to come one under another, down onto the pattern's brightest ring.)
 */
export class LyricRing {
  readonly group = new THREE.Group();
  private lines = new Map<number, RingLine>();
  private color = new THREE.Color();
  /** Radius of the ring (the plate's units): set from the frame (resize). */
  radius = 2.8;
  /** Where the words are this frame (at most the leaving line's and the entering one's, top and bottom). */
  readonly bands: RingBand[] = [];

  constructor(private palette: Palette, private opts: RingOptions) {
    this.group.userData.lyrics = true;
  }

  private glyph(ch: string, em: number, face: Face, px: number): TextMesh {
    const m = textMesh(ch, face, em, { center: true, px });
    m.material.depthWrite = false;
    m.material.depthTest = false;
    m.renderOrder = 20;
    return m;
  }

  private build(state: LineState): RingLine {
    const o = this.opts, face = o.face ?? (o.style === 'poem' ? 'serif' : 'condensed');
    const root = new THREE.Group();
    // The words laid out in one run first: each glyph's place along it, each word's span.
    const run: Array<{ mesh: TextMesh; x: number; word: number }> = [], words: Array<[number, number]> = [];
    let s = 0;
    state.line.words.forEach((w, wi) => {
      const cjk = hasCjk(w.text), from = s;
      for (const ch of Array.from(w.text)) {
        if (!ch.trim()) { s += o.em * 0.3; continue; }
        const mesh = this.glyph(ch, o.em, face, 128), adv = (mesh.userData.width as number) * (cjk ? 1.04 : 1);
        root.add(mesh);
        run.push({ mesh, x: s + adv / 2, word: wi });
        s += adv;
      }
      words[wi] = [from, s];
      s += cjk ? o.em * 0.08 : o.em * 0.36;
    });
    const len = words.length ? words[words.length - 1][1] : 0;
    const R = this.radius, arc = 2 * RING_ARC;
    let rows = [len], scale = Math.min(1, (arc * R) / Math.max(1e-3, len)), cut = Infinity, cutX = 0;
    if (scale < RING_SHRINK && words.length > 1) {
      // Two rows, broken at the word end nearest the middle; the inner ring is a row's height smaller.
      let best = Infinity;
      for (let k = 0; k + 1 < words.length; k++) {
        const d = Math.abs(words[k][1] - len / 2);
        if (d < best) { best = d; cut = k; }
      }
      cutX = words[cut + 1][0];
      rows = [words[cut][1], len - cutX];
      const inner = R - 1.3 * o.em;
      scale = Math.min(1, (arc * R) / rows[0], (arc * inner) / rows[1]);
    }
    scale = Math.max(RING_MIN, scale);
    const glyphs = run.map(g => (g.word > cut ? { mesh: g.mesh, x: g.x - cutX, row: 1, word: g.word } : { mesh: g.mesh, x: g.x, row: 0, word: g.word }));
    const trans: RingGlyph[] = [];
    let transLen = 0;
    for (const ch of Array.from(state.line.translation ?? '')) {
      if (!ch.trim()) { transLen += o.transEm * 0.35; continue; }
      const mesh = this.glyph(ch, o.transEm, o.transFace ?? 'bold', 96), adv = (mesh.userData.width as number) * (hasCjk(ch) ? 1.04 : 1);
      root.add(mesh);
      trans.push({ mesh, x: transLen + adv / 2, row: 0, word: -1 });
      transLen += adv;
    }
    const transScale = Math.max(RING_MIN, Math.min(1, (arc * R) / Math.max(1e-3, transLen)));
    this.group.add(root);
    return { root, glyphs, rows, scale, trans, transLen, transScale };
  }

  /** 1 well inside the frame, falling to 0 at its edges (projected by `camera`). */
  private edge(mesh: TextMesh, camera: THREE.Camera): number {
    ringP.setFromMatrixPosition(mesh.matrixWorld).project(camera);
    if (ringP.z > 1 || ringP.z < -1) return 0;
    return (1 - smooth((Math.abs(ringP.x) - 0.86) / 0.12)) * (1 - smooth((Math.abs(ringP.y) - 0.88) / 0.1));
  }

  update(lyrics: LyricTrack, t: number, energy: number, camera: THREE.Camera): void {
    const o = this.opts, states = lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const [k, b] of this.lines) if (!keep.has(k)) { dispose(b.root); this.lines.delete(k); }
    const paper = this.palette.paper, R = this.radius;
    this.bands.length = 0;
    for (const st of states) {
      const b = this.lines.get(st.index) ?? this.lines.set(st.index, this.build(st)).get(st.index)!;
      // Up out of the middle over the 0.45 s before the line (snap: it settles, it doesn't land), a slow swell while
      // it is sung, then on outwards, faster and faster, as it leaves.
      const come = snap((st.age + 0.45) / 0.45), shown = smooth((st.age + 0.5) / 0.15) * (1 - st.exit);
      const size = (0.35 + 0.65 * come) * (1 + Math.min(0.08, 0.02 * Math.max(0, st.age))) * (1 + 0.6 * st.exit * st.exit);
      b.root.scale.setScalar(size);
      b.root.updateMatrixWorld(true);
      const rowR = [R, R - 1.3 * o.em * b.scale];
      for (const g of b.glyphs) {
        const r = rowR[g.row], th = Math.PI / 2 - (g.x - b.rows[g.row] / 2) * b.scale / r;
        g.mesh.position.set(r * Math.cos(th), r * Math.sin(th), 0);
        g.mesh.rotation.set(0, 0, th - Math.PI / 2);
        const look = paintWord(st.words[g.word], g.word, o.style, this.palette, energy, st.exit, this.color);
        let opacity: number, pop = 1;
        if (look) {
          opacity = look.opacity;
          g.mesh.material.color.copy(this.color);
          if (o.style === 'hook') pop = 1 + (1 - look.k) * 0.25;
        } else {
          // Still to come: waiting dim in its place, so the line reads whole.
          opacity = 0.5 * (1 - st.exit);
          g.mesh.material.color.copy(paper).multiplyScalar(0.75);
        }
        g.mesh.scale.setScalar(b.scale * pop);
        g.mesh.updateMatrixWorld();
        opacity *= smooth((st.age + 0.5) / 0.15);
        if (opacity > 0.004) opacity *= this.edge(g.mesh, camera);
        g.mesh.material.opacity = opacity;
        g.mesh.visible = opacity > 0.004;
      }
      const span = Math.max(...b.rows.map((l, k) => (l * b.scale) / 2 / rowR[k])) + 0.08;
      this.bands.push({ rIn: (rowR[b.rows.length - 1] - 0.62 * o.em * b.scale) * size, rOut: (R + 0.62 * o.em * b.scale) * size, angle: Math.PI / 2, span, k: shown });
      if (!b.trans.length) continue;
      // The translation reads upright along the bottom (text bent round a circle would read upside down there).
      const n = b.trans.length;
      b.trans.forEach((g, i) => {
        const k = revealAt(st, i, n) * (1 - st.exit) * smooth((st.age + 0.5) / 0.15);
        const th = -Math.PI / 2 + (g.x - b.transLen / 2) * b.transScale / R;
        g.mesh.position.set(R * Math.cos(th), R * Math.sin(th), 0);
        g.mesh.rotation.set(0, 0, th + Math.PI / 2);
        g.mesh.scale.setScalar(b.transScale);
        g.mesh.updateMatrixWorld();
        let opacity = k * 0.92;
        if (opacity > 0.004) opacity *= this.edge(g.mesh, camera);
        g.mesh.material.color.copy(paper).multiplyScalar(0.88);
        g.mesh.material.opacity = opacity;
        g.mesh.visible = opacity > 0.004;
      });
      this.bands.push({ rIn: (R - 0.62 * o.transEm * b.transScale) * size, rOut: (R + 0.62 * o.transEm * b.transScale) * size, angle: -Math.PI / 2, span: (b.transLen * b.transScale) / 2 / R + 0.08, k: shown * smooth(st.translationProgress * 4) });
    }
  }
}

// ── Layer ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The lyric rig drawn flat into a texture each frame, for a plate's own shader to print on its surface. The plate
 * calls `update` with the frame (surface units) the lines are laid out in and the region of the surface the texture
 * covers (the frame, or more when the view travels over the surface: then the plate puts each line with
 * `rig.place`, at z = −10, in region units from its middle), and `render` from its scene's onBeforeRender; `token`
 * sits in the plate's scene, so when the transitions hide the lyrics of a shot the layer goes blank too (`on`).
 */
export class LyricLayer {
  readonly rig: LyricRig;
  readonly target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  readonly token = new THREE.Object3D();
  on = false;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private lens = new THREE.PerspectiveCamera();
  private clear = new THREE.Color();

  constructor(palette: Palette, style: RigStyle) {
    this.rig = new LyricRig(palette, style);
    this.scene.add(this.rig.group);
    this.token.userData.lyrics = true;
    // (Printed: drawing the plate apart from its words keeps these with it — src/render/shots.ts, withoutLyrics.)
    this.token.userData.printed = true;
  }

  /**
   * Lays out the lines on screen at t in a frame vw × vh (the surface's units), over a region rw × rh of the surface
   * (the frame's size unless given), drawn at most `px` pixels across. `aspect`: the screen's, when the frame isn't
   * its shape (the type is set smaller, in more rows, on a narrow screen; see LyricRig).
   */
  update(lyrics: LyricTrack, t: number, energy: number, vw: number, vh: number, rw = vw, rh = vh, px = 2048, aspect = vw / vh): void {
    this.rig.frame = { vw, vh };
    this.rig.update(this.lens, lyrics, t, aspect, energy);
    const c = this.camera;
    c.left = -rw / 2; c.right = rw / 2; c.top = rh / 2; c.bottom = -rh / 2;
    c.position.set(0, 0, 0);
    c.updateProjectionMatrix();
    const w = Math.round(rw >= rh ? px : (px * rw) / rh), h = Math.round(rw >= rh ? (px * rh) / rw : px);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
  }

  /** Its words and buffer (they hang off no plate's scene graph). */
  dispose(): void {
    freeGraph(this.scene);
    this.target.dispose();
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.on = this.token.visible;
    if (!this.on) return;
    const prev = renderer.getRenderTarget(), color = renderer.getClearColor(this.clear), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(color, alpha);
    renderer.setRenderTarget(prev);
  }
}
