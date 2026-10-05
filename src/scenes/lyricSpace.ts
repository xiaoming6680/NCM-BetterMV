// Lyrics in the world (the user: "能不能把歌词做进空间，现在固定在屏幕上的歌词不高级", "可读性不是第一要求，
// 效果是第一要求"; docs/TREATMENT.md, 歌词在空间里). Each plate gives the words a place of their own instead of a card
// riding the lens:
//   LyricGates — the sung words, a few at a time, as signs down a tunnel that the camera flies through
//   LyricOrbit — the line set round a circle: flat on the rings, or a band standing round the crystal; it turns a
//                notch as each word is sung, so the word being sung is where the camera looks
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
import { clamp01, outExpo, smooth } from './types.ts';

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
export function chunksOf(lyrics: LyricTrack): Chunk[] {
  let c = chunkCache.get(lyrics);
  if (!c) {
    let n = 0;
    const all = lyrics.lines.flatMap((l, i) => chunkLine(l, i));
    c = all.map((x, i) => ({ ...x, ordinal: n++, next: all[i + 1]?.start ?? Infinity }));
    chunkCache.set(lyrics, c);
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

  constructor(private palette: Palette, private opts: GateOptions) {
    this.group.userData.lyrics = true;
  }

  private material(m: TextMesh): TextMesh {
    m.material.depthWrite = false;
    m.material.depthTest = false;
    m.renderOrder = 20;
    return m;
  }

  private buildSign(c: Chunk, line: LyricLine): Sign {
    const o = this.opts, face = o.face ?? (o.style === 'poem' ? 'serif' : 'display');
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
          const mesh = this.material(textMesh(ch, face, o.em, { center: true, px: 160 })), adv = mesh.userData.width as number;
          chars.push({ mesh, word: wi, s: len + adv / 2 });
          len += adv;
        }
      });
      for (const ch of chars) {
        const th = Math.PI / 2 + (len / 2 - ch.s) / o.arc;
        ch.mesh.userData.baseScale = 1;
        root.add(ch.mesh);
        glyphs.push({ mesh: ch.mesh, word: ch.word, x: o.arc * Math.cos(th), y: o.arc * Math.sin(th), rot: th - Math.PI / 2, w: 0, centred: true });
      }
    } else {
      const meshes = c.words.map(i => this.material(textMesh(line.words[i].text, face, o.em, { px: 180 })));
      const widths = meshes.map(m => m.userData.width as number);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (meshes.length - 1);
      const s = Math.min(1, o.maxW / Math.max(1e-3, total));
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
        const mesh = this.material(textMesh(ch, 'bold', o.em, { center: true, px: 112 })), adv = mesh.userData.width as number;
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
        const mesh = this.material(textMesh(ch, 'bold', o.em, { center: true, px: 112 }));
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
      const meshes = parts.map(p => (p.trim() ? this.material(textMesh(p, 'bold', o.em, { px: 112 })) : null));
      const widths = meshes.map(m => (m ? (m.userData.width as number) + (hasCjk(text) ? 0 : o.em * 0.3) : o.em * 0.35));
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -total / 2;
      meshes.forEach((mesh, i) => { if (mesh) { root.add(mesh); chars.push({ mesh, x, y: 0 }); } x += widths[i]; });
      root.userData.size = [total, o.em * 1.2];
    }
    this.group.add(root);
    return { root, chars };
  }

  update(lyrics: LyricTrack, t: number, energy: number,
    gate: (c: Chunk, t: number, root: THREE.Object3D) => number,
    banner?: (state: LineState, t: number, root: THREE.Object3D) => number): void {
    const chunks = chunksOf(lyrics);
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
        const look = paintWord(st.words[g.word], g.word, this.opts.style, this.palette, energy, 0, this.color);
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
          g.mesh.material.color.copy(paper).multiplyScalar(0.85);
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
}

interface OrbitGlyph { mesh: TextMesh; s: number }
interface OrbitLine { root: THREE.Group; glyphs: OrbitGlyph[]; word: number[]; wordS: number[]; trans: OrbitGlyph[]; transLen: number }

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

  private glyph(ch: string, em: number, face: Face, px: number): TextMesh {
    const m = textMesh(ch, face, em, { center: true, px });
    m.material.depthWrite = false;
    m.material.depthTest = false;
    m.material.side = THREE.FrontSide;
    m.renderOrder = 20;
    return m;
  }

  private build(state: LineState): OrbitLine {
    const o = this.opts, face = o.face ?? (o.style === 'poem' ? 'serif' : 'display');
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
    if (o.trans && state.line.translation) {
      const text = state.line.translation;
      for (const ch of Array.from(text)) {
        if (!ch.trim()) { transLen += o.trans.em * 0.35; continue; }
        const mesh = this.glyph(ch, o.trans.em, 'bold', 96), adv = mesh.userData.width as number;
        root.add(mesh);
        trans.push({ mesh, s: transLen + adv / 2 });
        transLen += adv;
      }
    }
    this.group.add(root);
    return { root, glyphs, word, wordS, trans, transLen };
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
   * `anchorAt(t)`: for a band, the angle round its y axis (from +z towards +x) facing the camera at time t, so each
   * word is set where the camera looked when it was sung (and the band can fade what is turned away now).
   */
  update(lyrics: LyricTrack, t: number, energy: number, anchorAt: (t: number) => number = () => 0): void {
    const o = this.opts, r = o.radius, flat = o.mode === 'flat', states = lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const [k, b] of this.lines) if (!keep.has(k)) { dispose(b.root); this.lines.delete(k); }
    const paper = this.palette.paper, now = anchorAt(t);
    for (const st of states) {
      const b = this.lines.get(st.index) ?? this.lines.set(st.index, this.build(st)).get(st.index)!;
      // A leaving line turns on, the way the sung words went, by a quarter circle as it fades.
      const away = outExpo(st.exit) * Math.PI * 0.5;
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
        } else {
          const th = turn + g.s / r, rr = r + lift;
          g.mesh.position.set(rr * Math.sin(th), 0, rr * Math.cos(th));
          g.mesh.rotation.set(0, th, 0);
          vis = smooth((Math.cos(th - now) + 0.15) / 0.5);
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
        } else {
          const th = base + (g.s - b.transLen / 2) / tr.radius;
          g.mesh.position.set(tr.radius * Math.sin(th), -o.em * 1.25, tr.radius * Math.cos(th));
          g.mesh.rotation.set(0, th, 0);
          g.mesh.material.opacity *= smooth((Math.cos(th - now) + 0.15) / 0.5);
        }
      });
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
  }

  /**
   * Lays out the lines on screen at t in a frame vw × vh (the surface's units), over a region rw × rh of the surface
   * (the frame's size unless given), drawn at most `px` pixels across.
   */
  update(lyrics: LyricTrack, t: number, energy: number, vw: number, vh: number, rw = vw, rh = vh, px = 2048): void {
    this.rig.frame = { vw, vh };
    this.rig.update(this.lens, lyrics, t, vw / vh, energy);
    const c = this.camera;
    c.left = -rw / 2; c.right = rw / 2; c.top = rh / 2; c.bottom = -rh / 2;
    c.position.set(0, 0, 0);
    c.updateProjectionMatrix();
    const w = Math.round(rw >= rh ? px : (px * rw) / rh), h = Math.round(rw >= rh ? (px * rh) / rw : px);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
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
