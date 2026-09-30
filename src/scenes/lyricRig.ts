// Lyrics that ride in front of the camera. Words appear one at a time as they are sung (never a whole line at
// once) and the translation types itself out underneath. Three looks:
//   hook    — big centred display type that slams in; the sung word glows in the signal colour
//   caption — small type low in the frame
//   poem    — serif in a narrow column to one side, each word fading up slowly; for ballads
import * as THREE from 'three';
import { textMesh, hasCjk, VERTICAL_STEP, type Face } from '../render/text.ts';
import { norm, type LyricTrack, type LineState } from '../director/lyrics.ts';
import { tokenize } from '../lyrics/parse.ts';
import type { Palette } from '../render/palette.ts';
import { clamp01, outBack, outExpo, rng } from './types.ts';

export type RigStyle = 'hook' | 'caption' | 'poem';
export type Align = 'left' | 'center' | 'right';

interface Glyph {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  x: number;
  y: number;
  spin: number;
}

interface Built {
  index: number;
  aspect: number;
  root: THREE.Group;
  words: Glyph[];
  trans: Glyph[];
  /** Hook and caption: the words sharing the last word's row, the width the row may still grow by, the em height. */
  lastRow?: { words: Set<number>; room: number; h: number };
  /** Hook and caption: a soft dark bed behind the line, so it reads on a bright picture. */
  scrim?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}

const scrimVertex = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** Darkest in the middle, fading out well before the edges (no box to see). */
const scrimFragment = /* glsl */ `
  uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
  void main() {
    vec2 d = abs(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, d.x)) * (1.0 - smoothstep(0.35, 1.0, d.y));
    gl_FragColor = vec4(uColor, a * uAlpha);
  }`;

const DISTANCE = 10;
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

/**
 * A neon tube striking (after the lit words of the user's 《游戏是你的解药吗？》): at `age` seconds since the word
 * appeared, a strike, dark, a weaker flicker, dark, then on — overshooting, and settling. All over in an eighth of
 * a second, so it reads as light coming on, not as the word being late. `n` staggers the flicker's strength.
 */
function neon(age: number, n: number): number {
  if (age < 0) return 0;
  if (age < 0.03) return 0.95;
  if (age < 0.055) return 0.12;
  if (age < 0.085) return 0.55 + 0.25 * ((n * 0.618) % 1);
  if (age < 0.11) return 0.08;
  return 1 + 0.45 * Math.exp(-(age - 0.11) / 0.14);
}

interface Look {
  face: Face;
  transFace: Face;
  /** Em height as a share of the visible height, CJK / Latin. */
  size: [number, number];
  transSize: number;
  /** Widest a row may get, share of the visible width. */
  maxW: number;
  px: number;
}

const LOOKS: Record<RigStyle, Look> = {
  hook: { face: 'display', transFace: 'bold', size: [0.078, 0.072], transSize: 0.028, maxW: 0.84, px: 200 },
  caption: { face: 'bold', transFace: 'light', size: [0.036, 0.036], transSize: 0.03, maxW: 0.8, px: 128 },
  poem: { face: 'serif', transFace: 'serifLight', size: [0.05, 0.044], transSize: 0.026, maxW: 0.46, px: 160 },
};

export class LyricRig {
  readonly group = new THREE.Group();
  /** Poem only: where the next line is set. Lines keep the alignment they were built with. */
  align: Align = 'left';
  /** Poem only: the frame behind the type is light, so set dark type on a white glow. */
  onLight = false;
  /** Lay lines out for this field of view instead of the camera's (for scenes that punch the lens on the beat). */
  layoutFov: number | null = null;
  private built = new Map<number, Built>();
  private hooks: Set<string> | null = null;

  constructor(private palette: Palette, private style: RigStyle, private show = { main: true, translation: true }) {
    this.group.renderOrder = 10;
    this.group.userData.lyrics = true;
  }

  private visible(camera: THREE.PerspectiveCamera, aspect: number) {
    const vh = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.layoutFov ?? camera.fov) / 2);
    return { vh, vw: vh * aspect };
  }

  /** Lay out rows of meshes; returns glyphs with their x/y. */
  private rows(meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[], gap: number, maxW: number, lineH: number, top: number, align: Align, anchorX: number, random: () => number): Glyph[] {
    const widths = meshes.map(m => m.userData.width as number);
    const rows: number[][] = [[]];
    let acc = 0;
    widths.forEach((w, i) => {
      if (acc > 0 && acc + w > maxW) { rows.push([]); acc = 0; }
      rows[rows.length - 1].push(i);
      acc += w + gap;
    });
    const out: Glyph[] = [];
    rows.forEach((row, r) => {
      const rowW = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
      let x = align === 'left' ? anchorX : align === 'right' ? anchorX - rowW : anchorX - rowW / 2;
      for (const i of row) {
        out[i] = { mesh: meshes[i], x, y: top - r * lineH, spin: (random() - 0.5) * 0.6 };
        x += widths[i] + gap;
      }
    });
    return out;
  }

  /**
   * Poem layout: set in the margin beside a centred picture. Chinese runs vertically, top to bottom, columns
   * right to left; Latin sets as a narrow ragged column.
   */
  private buildPoem(state: LineState, vh: number, vw: number): Built {
    const line = state.line;
    const root = new THREE.Group();
    const cjk = hasCjk(line.text);
    const halo = this.onLight ? this.palette.css.ink : 'dark';
    const left = this.align !== 'right';
    const words: Glyph[] = [];
    const trans: Glyph[] = [];
    const place = (g: Glyph) => { g.mesh.material.depthTest = false; g.mesh.renderOrder = 20; root.add(g.mesh); };
    if (cjk) {
      // Long lines shrink so they never need more than two columns (a Latin letter, turned, takes about half a cell).
      const cells = line.words.reduce((n, w) => n + Array.from(w.text).length * (hasCjk(w.text) ? 1 : 0.5), 0);
      const fit = Math.min(1, Math.sqrt((2 * vh * 0.62) / Math.max(1, cells * vh * 0.05 * VERTICAL_STEP)));
      const h = vh * 0.05 * fit, step = h * VERTICAL_STEP, maxH = vh * 0.62, colGap = h * 1.7;
      const x0 = left ? -vw * 0.4 : vw * 0.44;
      // y: the top of the next cell (the first cell is centred at 0.3 vh); a word may reach down to `floor`.
      const top = vh * 0.3 + step / 2, floor = vh * 0.3 - maxH - step / 2;
      let col = 0, y = top;
      line.words.forEach((w, i) => {
        const text = w.text.replace(/[，。、！？；：,.!?;:"“”'‘’（）()]/g, '');
        if (!text) return;
        // A word of several characters stacks down the column in one piece; a Latin word lies on its side, reading
        // downwards, as in vertical Chinese. Either way it takes its own length of the column, so nothing overlaps.
        const latin = !hasCjk(text);
        const mesh = latin
          ? textMesh(text, 'serif', h * 0.86, { center: true, px: 160, halo })
          : textMesh(text, 'serif', h, { center: true, px: 160, halo, vertical: Array.from(text).length > 1 });
        if (latin) mesh.rotation.z = -Math.PI / 2;
        const len = latin ? (mesh.userData.width as number) + step * 0.3 : step * Array.from(text).length;
        if (y < top && y - len < floor) { col++; y = top; }
        const g = { mesh, x: x0 - col * colGap, y: y - len / 2, spin: 0 };
        place(g);
        words[i] = g;
        y -= len;
      });
      // A translation (Japanese lyrics → Chinese) runs as a smaller column beside the last one.
      if (this.show.translation && line.translation) {
        const th = h * 0.52, tx = x0 - col * colGap - colGap * 0.85;
        let ty = vh * 0.3;
        for (const ch of Array.from(line.translation.replace(/\s+/g, ''))) {
          if (/[，。、！？；：,.!?;:"“”'‘’（）()]/.test(ch)) { ty -= th * 0.5; continue; }
          const mesh = textMesh(ch, 'serifLight', th, { center: true, px: 96, halo });
          const g = { mesh, x: tx, y: ty, spin: 0 };
          place(g);
          trans.push(g);
          ty -= th * 1.12;
        }
      }
    } else {
      // Latin: a narrow column; long lines shrink so they stay within four rows.
      const maxW = vw * 0.24;
      const approx = line.text.length * vh * 0.04 * 0.5;
      const h = vh * 0.04 * Math.min(1, Math.sqrt((4 * maxW) / Math.max(1e-3, approx))), gap = h * 0.28, lineH = h * 1.3;
      const meshes = line.words.map(w => textMesh(w.text, 'serif', h, { px: 160, halo }));
      const anchor = left ? -vw * 0.47 : vw * 0.47;
      this.rows(meshes, gap, maxW, lineH, vh * 0.14, left ? 'left' : 'right', anchor, () => 0.5).forEach((g, i) => { words[i] = g; place(g); });
      if (this.show.translation && line.translation) {
        const th = vh * 0.026;
        const bottom = Math.min(...words.filter(Boolean).map(w => w.y));
        const chars = hasCjk(line.translation) ? Array.from(line.translation) : tokenize(line.translation);
        const tm = chars.map(c => (c.trim() ? textMesh(c, 'serifLight', th, { px: 96, halo }) : null));
        const widths = tm.map(m => (m ? (m.userData.width as number) : th * 0.35));
        const rowW = widths.reduce((a, b) => a + b, 0);
        let x = left ? anchor : anchor - rowW;
        tm.forEach((mesh, i) => {
          if (mesh) { const g = { mesh, x, y: bottom - h * 0.9 - th, spin: 0 }; place(g); trans.push(g); }
          x += widths[i];
        });
      }
    }
    this.group.add(root);
    return { index: state.index, aspect: vw / vh, root, words, trans };
  }

  private build(state: LineState, camera: THREE.PerspectiveCamera, aspect: number): Built {
    const { vh, vw } = this.visible(camera, aspect);
    if (this.style === 'poem') return this.buildPoem(state, vh, vw);
    const look = LOOKS[this.style];
    const line = state.line;
    const root = new THREE.Group();
    const cjk = hasCjk(line.text);
    const random = rng(state.index * 977 + 13);
    const align: Align = 'center';
    const anchorX = 0; // hook and caption lines are centred
    let h = vh * look.size[cjk ? 0 : 1];
    const place = (g: Glyph) => { g.mesh.material.depthTest = false; g.mesh.renderOrder = 20; root.add(g.mesh); };

    let words: Glyph[] = [];
    let lastRow: Built['lastRow'];
    if (this.show.main) {
      // Fit: shrink the type if the line would need more than three rows.
      const probe = line.words.map(w => textMesh(w.text, look.face, h, { px: look.px }));
      const gapOf = (hh: number) => (cjk ? hh * 0.06 : hh * 0.3);
      const total = probe.reduce((a, m) => a + (m.userData.width as number), 0) + gapOf(h) * (probe.length - 1);
      const maxW = vw * look.maxW;
      if (total > maxW * 3) {
        const s = (maxW * 3) / total;
        h *= s;
        probe.forEach(m => { m.scale.setScalar(s); m.userData.width = (m.userData.width as number) * s; m.userData.baseScale = s; });
      }
      const lineH = h * (cjk ? 1.34 : 1.16);
      const rowsNeeded = Math.max(1, Math.ceil(Math.min(total, maxW * 3) / maxW));
      const top = this.style === 'hook' ? (lineH * (rowsNeeded - 1)) / 2 : -vh * 0.3 + lineH * (rowsNeeded - 1);
      words = this.rows(probe, gapOf(h), maxW, lineH, top, align, anchorX, random);
      words.forEach(place);
      const last = words[words.length - 1];
      if (last) {
        const row = new Set<number>();
        words.forEach((g, i) => { if (Math.abs(g.y - last.y) < 1e-6) row.add(i); });
        const first = words[Math.min(...row)];
        const rowW = last.x + (last.mesh.userData.width as number) - first.x;
        lastRow = { words: row, room: Math.max(0, vw * 0.94 - rowW), h };
      }
    }

    const trans: Glyph[] = [];
    if (this.show.translation && line.translation) {
      const th = vh * look.transSize;
      const chars = hasCjk(line.translation) ? Array.from(line.translation) : tokenize(line.translation);
      const meshes = chars.map(c => (c.trim() ? textMesh(c, look.transFace, th, { px: 96 }) : null));
      const widths = meshes.map(m => (m ? (m.userData.width as number) * 0.98 : th * 0.35));
      const rowW = widths.reduce((a, b) => a + b, 0);
      let x = anchorX - rowW / 2;
      const mainBottom = words.length ? Math.min(...words.filter(Boolean).map(w => w.y)) : 0;
      const y = this.show.main ? mainBottom - h * 0.78 - th * 1.05 : (this.style === 'hook' ? 0 : -vh * 0.36);
      meshes.forEach((mesh, i) => {
        if (mesh) { const g = { mesh, x, y, spin: 0 }; place(g); trans.push(g); }
        x += widths[i];
      });
    }
    // The bed behind the line: the words' extent plus a margin, darker when the cover (and so the picture) is light.
    let scrim: Built['scrim'];
    const all = [...words, ...trans].filter(Boolean);
    if (all.length) {
      const x0 = Math.min(...all.map(g => g.x)), x1 = Math.max(...all.map(g => g.x + (g.mesh.userData.width as number)));
      const y0 = Math.min(...all.map(g => g.y)) - h * 0.6, y1 = Math.max(...all.map(g => g.y)) + h * 0.6;
      const w = x1 - x0 + h * 2.4, hh = y1 - y0 + h * 1.6;
      scrim = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.ShaderMaterial({
        vertexShader: scrimVertex, fragmentShader: scrimFragment, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { uAlpha: { value: 0 }, uColor: { value: this.palette.ink.clone().multiplyScalar(0.5) } },
      }));
      scrim.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.01);
      scrim.renderOrder = 19;
      root.add(scrim);
    }
    this.group.add(root);
    return { index: state.index, aspect, root, words, trans, lastRow, scrim };
  }

  private drop(b: Built): void {
    this.group.remove(b.root);
    b.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    this.built.delete(b.index);
  }

  update(camera: THREE.PerspectiveCamera, lyrics: LyricTrack, t: number, aspect: number, energy = 0.5): void {
    // Ride in front of the camera.
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    this.group.updateMatrixWorld();

    // The leaving line and the entering one can both be on screen: they cross-fade.
    const states = lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const b of Array.from(this.built.values())) if (!keep.has(b.index) || Math.abs(b.aspect - aspect) > 0.02) this.drop(b);
    this.hooks ??= lyrics.hooks();
    for (const state of states) this.updateLine(state, camera, aspect, energy);
  }

  private updateLine(state: LineState, camera: THREE.PerspectiveCamera, aspect: number, energy: number): void {
    const b = this.built.get(state.index) ?? this.built.set(state.index, this.build(state, camera, aspect)).get(state.index)!;
    b.root.position.set(0, 0, -DISTANCE);

    const { signal, paper } = this.palette;
    const style = this.style;
    const exit = state.exit;
    // In a hook line (one that repeats), the last word gets its moment: it swells when it is sung.
    const hookLine = style === 'hook' && !!this.hooks && this.hooks.has(norm(state.line.text));
    // How far a leaving line moves up: about the height of the block it occupies.
    const ys = b.words.filter(Boolean).map(w => w.y);
    const rise = ys.length ? Math.max(...ys) - Math.min(...ys) + (b.words.find(Boolean)?.mesh.userData.width ? 1.2 : 1) * 1.1 : 1;
    const lastWord = state.words.length - 1;
    // The last word of a hook line swells as it is sung. It grows rightwards while its row slides left by half as
    // much, so the row stays centred and the word never runs over the one before it; a long word swells less.
    let lastSwell = 0, push = 0;
    const lastState = state.words[lastWord], lastGlyph = b.words[lastWord];
    if (hookLine && b.lastRow && lastState && lastGlyph) {
      const w = lastGlyph.mesh.userData.width as number;
      const most = Math.min(0.32, b.lastRow.room / w, (b.lastRow.h * 2.4) / w);
      lastSwell = most * outBack(clamp01(lastState.age / 0.28));
      push = (w * lastSwell) / 2;
    }
    state.words.forEach((ws, i) => {
      const g = b.words[i];
      if (!g) return;
      const lead = style === 'poem' ? 0.12 : 0.04;
      const appear = clamp01((ws.age + lead) / (style === 'hook' ? 0.16 : style === 'poem' ? 0.6 : 0.2));
      g.mesh.visible = ws.age > -lead && exit < 1;
      if (!g.mesh.visible) return;
      const k = style === 'poem' ? outCubic(appear) : outExpo(appear);
      const swell = i === lastWord ? lastSwell : 0;
      const s = (style === 'hook' ? 1 + (1 - k) * 0.4 : style === 'poem' ? 1 + (1 - k) * 0.05 : 1) * (1 + swell);
      const base = g.mesh.userData.baseScale ?? (g.mesh.userData.baseScale = g.mesh.scale.x);
      g.mesh.scale.setScalar(s * base);
      const singing = ws.progress > 0 && ws.progress < 1;
      const glow = singing ? 1 : Math.exp(-Math.max(0, ws.age - (ws.word.end - ws.word.start)) / 0.25);
      const c = g.mesh.material.color;
      // A leaving line rises out of the way of the entering one.
      const away = outExpo(exit) * rise;
      if (style === 'poem') {
        // Quiet: settles in from a touch above and warms slightly while sung; leaves by fading upwards.
        g.mesh.position.set(g.x, g.y + (1 - k) * 0.1 + away, 0);
        if (this.onLight) c.setRGB(1, 1, 1);
        else c.copy(paper).multiplyScalar(0.93).lerp(signal, glow * 0.28);
        g.mesh.material.opacity = k * (1 - exit);
        return;
      }
      const lift = style === 'hook' ? 0 : (1 - k) * 0.25;
      const slide = b.lastRow?.words.has(i) ? push : 0;
      g.mesh.position.set(g.x - slide + exit * g.spin * 2, g.y - lift + away, (1 - k) * (style === 'hook' ? 1.2 : 0) + exit * 1.5);
      g.mesh.rotation.z = exit * g.spin;
      c.copy(paper).multiplyScalar(0.92).lerp(signal, glow * (style === 'hook' ? 1 : 0.85));
      // Display type comes on like a neon tube.
      const lit = style === 'hook' ? neon(ws.age + lead, i) : 1;
      if (style === 'hook') c.multiplyScalar((1 + glow * (0.25 + energy * 0.25)) * Math.max(0.35, lit));
      g.mesh.material.opacity = k * (1 - exit) * Math.min(1, lit);
    });
    // The bed comes up with the first word and goes with the line.
    if (b.scrim) {
      const first = state.words[0];
      const up = first ? clamp01((first.age + 0.1) / 0.25) : 1;
      b.scrim.material.uniforms.uAlpha.value = (this.palette.light ? 0.72 : 0.38) * up * (1 - exit);
    }
    const n = b.trans.length;
    const fadeLen = style === 'poem' ? 3 : 1.5;
    b.trans.forEach((g, i) => {
      const at = (i + 1) / Math.max(1, n);
      const k = clamp01((state.translationProgress - at + 1 / Math.max(1, n)) * n * (style === 'poem' ? 0.8 : fadeLen));
      g.mesh.visible = k > 0 && exit < 1;
      if (!g.mesh.visible) return;
      g.mesh.position.set(g.x, g.y - (1 - outExpo(k)) * 0.15 + outExpo(exit) * rise, style === 'poem' ? 0 : exit * 1.5);
      if (style === 'poem' && this.onLight) g.mesh.material.color.setRGB(1, 1, 1);
      else g.mesh.material.color.copy(paper).multiplyScalar(style === 'poem' ? 0.72 : 0.8);
      g.mesh.material.opacity = outExpo(k) * (1 - exit) * 0.9;
    });
  }
}
