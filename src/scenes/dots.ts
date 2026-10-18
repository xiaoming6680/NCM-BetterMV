// Dot matrix (点阵), after the BGA of 無人区 -Vacuum Track#ADD8E6- (BOFU2017, team DSSQ) that issue #3 pointed to:
// the frame is one screen of LED dots (160 × 90), and what plays on it is a BGA — a new composition on each bar's
// drum, all of it drawn in the dots:
//   word     the word being sung, huge, slid in from the side, with dim copies of it drifting above and below
//   tunnel   squares open out of the middle, a new one on each drum (the reference's square tunnel)
//   arrows   rows of ▶ marching across, a step on each drum
//   cover    the cover in the screen's three colours, scanned on, slowly closing in
//   rain     the line's characters falling in columns
//   spectrum the spectrum as bars mirrored about the middle
// While a line is sung, every other composition is its word, and the line so far runs along the bottom rows. A new
// composition doesn't cut in: each dot turns over to it on a sweep from the top left, with a little scatter, a bright
// front running ahead of the new picture (a screen refreshing). Colours: the cover's paper, signal and accent on black.
// The screen takes the frame's shape (as many dots, 90 × 160 on a portrait frame — issue #4): a 16:9 screen in a
// portrait frame showed a third of each composition, the word cut down to one character. Upright, a word of three or
// more CJK characters stands in two rows, its copies stacked to the top and bottom, the line so far in two rows.
// Cameras: square on (flat); the screen turned a little away (tilt).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, punch, rng, snap } from './types.ts';
import { COLS, Spectrogram } from './viz.ts';
import { Accents } from './hits.ts';
import { lastIndex } from '../director/music.ts';
import { hue, v3 } from './fractal.ts';
import { hasCjk } from '../render/text.ts';
import { sung, unitsOf, whole, type Unit } from './kinetic.ts';

/** Dots on the screen (160 × 90 on a 16:9 frame), and world units between them (that screen 28 wide). */
const DOTS = 160 * 90, PITCH = 28 / 160;
const NB = 28;
/** Seconds a composition change takes to sweep the screen. */
const SWEEP = 0.24;
const FONT = '"BMV Archivo Condensed Black", "BMV Smiley", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

type Kind = 'word' | 'tunnel' | 'arrows' | 'cover' | 'rain' | 'spectrum';
/** A composition from `start`; `seed` varies it. */
interface Comp { kind: Kind; start: number; seed: number }

/** The screen for a frame of this aspect: its shape, as many dots (16:9 and wider, 160 × 90). */
function gridFor(aspect: number): [number, number] {
  const a = Math.min(16 / 9, Math.max(0.4, aspect));
  const gx = Math.round(Math.sqrt(DOTS * a));
  return [gx, Math.round(DOTS / gx)];
}

const VERT = /* glsl */ `
attribute vec2 aCell;
uniform sampler2D tDots;
uniform vec2 uGrid;
uniform float uPx, uDot;
varying vec3 vCol;
varying float vLit;
const vec3 PAPER = __PAPER__, SIG = __SIG__, ACC = __ACC__, OFF = __OFF__;
void main() {
  vec4 d = texture2D(tDots, (aCell + 0.5) / uGrid);
  vec3 c = d.g < 0.25 ? PAPER : d.g < 0.75 ? SIG : ACC;
  vLit = d.r;
  vCol = OFF + c * d.r * 1.25;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uDot * uPx / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vLit;
void main() {
  // A rounded square LED, its light spilling a little round it when lit.
  vec2 q = abs(gl_PointCoord - 0.5);
  float box = max(q.x, q.y) * 0.6 + length(q) * 0.4;
  float a = smoothstep(0.42, 0.34, box) + vLit * 0.35 * smoothstep(0.5, 0.3, length(q));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

/** A small canvas the size of the screen, drawn into and read back as dots. */
class Layer {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  constructor(readonly w: number, readonly h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }
  clear(): void { this.g.clearRect(0, 0, this.w, this.h); }
  /** Per dot: brightness from the drawing's alpha, colour from its red/green/blue (paper / signal / accent). */
  read(lum: Float32Array, col: Uint8Array): void {
    const { w, h } = this, px = this.g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = (h - 1 - y) * w + x;
      lum[o] = px[i + 3] / 255;
      col[o] = px[i] >= px[i + 1] && px[i] >= px[i + 2] ? 0 : px[i + 1] >= px[i + 2] ? 1 : 2;
    }
  }
}
/** Fill styles that say which of the screen's colours a dot takes (read back by Layer.read). */
const PAPER_INK = 'rgba(255,0,0,', SIG_INK = 'rgba(0,255,0,', ACC_INK = 'rgba(0,0,255,';

/** The screen at one shape: its dots, the canvases drawn into and the cover in its colours. */
interface Grid {
  gx: number; gy: number;
  /** Sizes drawn in dots were set on a 112 × 63 screen: this scales them (by the screen's short side). */
  k: number;
  data: Uint8Array; tex: THREE.DataTexture; points: THREE.Points;
  a: Layer; b: Layer;
  lumA: Float32Array; lumB: Float32Array; colA: Uint8Array; colB: Uint8Array;
  coverLum: Float32Array; coverCol: Uint8Array;
}

export class DotMatrix implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  private spec: Spectrogram;
  private hits: Accents;
  private u: Record<string, THREE.IUniform>;
  private grid!: Grid;
  private material: THREE.ShaderMaterial;
  private units: Unit[] = [];
  private unitT: Float64Array;
  private bars: Float64Array;
  private wall = new THREE.Group();
  private height = 1080;
  private readonly soft: boolean;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music, lyrics } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.2);
    this.spec = Spectrogram.of(init.stereo, music.duration + 8, NB, 40);
    this.hits = Accents.of(music);
    // (Compositions change on the bars' drums; a song with hardly any, on its downbeats.)
    const bars = this.hits.barHits();
    this.bars = bars.length > 8 ? bars : Float64Array.from(music.downbeats);
    lyrics.lines.forEach((line, i) => { if (!line.backing) this.units.push(...unitsOf(line, i)); });
    this.units.sort((x, y) => x.start - y.start);
    this.unitT = Float64Array.from(this.units, u => u.start);

    this.u = { tDots: { value: null }, uGrid: { value: new THREE.Vector2(160, 90) }, uPx: { value: 1000 }, uDot: { value: PITCH * 0.95 } };
    const paper = palette.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.2);
    const vert = VERT.replace('__PAPER__', v3(paper)).replace('__SIG__', v3(hue(palette.signal))).replace('__ACC__', v3(hue(palette.accent)))
      .replace('__OFF__', v3(hue(palette.signal), 0.035));
    this.material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: FRAG, uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.scene.add(this.wall);
    this.resize(init.aspect);
  }

  /** The screen for `gx` × `gy` dots (made again when the frame changes shape). */
  private build(gx: number, gy: number): Grid {
    const { palette } = this.init;
    const data = new Uint8Array(gx * gy * 4);
    const tex = new THREE.DataTexture(data, gx, gy, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    const cells = new Float32Array(gx * gy * 2), pos = new Float32Array(gx * gy * 3);
    for (let y = 0, i = 0; y < gy; y++) for (let x = 0; x < gx; x++, i++) {
      cells.set([x, y], i * 2);
      pos.set([(x - (gx - 1) / 2) * PITCH, (y - (gy - 1) / 2) * PITCH, 0], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCell', new THREE.BufferAttribute(cells, 2));
    const points = new THREE.Points(geo, this.material);
    points.frustumCulled = false;

    // The cover in the screen's three colours: brightness its lightness, colour the nearest of paper, signal, accent.
    // (A square cover across the screen: cropped along its longer side.)
    const n = this.init.coverSize, src = this.init.coverPixels;
    const paper = palette.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.2);
    const ref = [paper, palette.signal, palette.accent].map(c => [c.r, c.g, c.b]);
    const coverLum = new Float32Array(gx * gy), coverCol = new Uint8Array(gx * gy);
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
      const u = gx >= gy ? x / gx : 0.5 + (x / gx - 0.5) * (gx / gy), v = gx >= gy ? 0.5 + (y / gy - 0.5) * (gy / gx) : y / gy;
      const i = (Math.min(n - 1, Math.floor((1 - v) * n)) * n + Math.min(n - 1, Math.floor(u * n))) * 4;
      const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
      const o = y * gx + x;
      coverLum[o] = Math.pow(0.2126 * r + 0.7152 * g + 0.0722 * b, 0.9);
      let best = 0, bd = Infinity;
      ref.forEach((c, k) => { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = k; } });
      coverCol[o] = best;
    }
    return {
      gx, gy, k: Math.min(gx, gy) / 63, data, tex, points, a: new Layer(gx, gy), b: new Layer(gx, gy),
      lumA: new Float32Array(gx * gy), lumB: new Float32Array(gx * gy), colA: new Uint8Array(gx * gy), colB: new Uint8Array(gx * gy),
      coverLum, coverCol,
    };
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const [gx, gy] = gridFor(aspect);
    if (this.grid && this.grid.gx === gx && this.grid.gy === gy) return;
    if (this.grid) { this.wall.remove(this.grid.points); this.grid.points.geometry.dispose(); this.grid.tex.dispose(); }
    this.grid = this.build(gx, gy);
    this.wall.add(this.grid.points);
    this.u.tDots.value = this.grid.tex;
    (this.u.uGrid.value as THREE.Vector2).set(gx, gy);
  }

  setViewport(_width: number, height: number): void {
    this.height = height;
  }

  dispose(): void {
    this.grid.tex.dispose();
    this.grid.points.geometry.dispose();
    this.material.dispose();
  }

  keepUp(t: number): void {
    this.spec.prefetch(t, 0.6);
  }

  /** The unit being sung at t (its line still up), or null. */
  private unitAt(ctx: FrameCtx, t: number): Unit | null {
    const i = lastIndex(this.unitT, t);
    if (i < 0) return null;
    const u = this.units[i];
    const st = ctx.lyrics.visible(t).find(s => s.index === u.line);
    return st && st.exit < 0.5 ? u : null;
  }

  /** A bar's own pick of the non-word compositions (so the bar after can ask what it was). */
  private pick(i: number): { kind: Kind; seed: number } {
    const random = rng(((this.init.seed ?? 1) * 7919 + i * 2654435761) >>> 0);
    const pool: Kind[] = ['tunnel', 'arrows', 'cover', 'rain', 'spectrum'];
    return { kind: pool[Math.floor(random() * pool.length)], seed: Math.floor(random() * 1e9) };
  }

  /** The composition on screen from the bar with the drum at index i (−1: before the first). */
  private compAt(ctx: FrameCtx, i: number): Comp {
    const start = i >= 0 ? this.bars[i] : 0;
    const own = this.pick(i);
    const singing = !!this.unitAt(ctx, start + 0.3) || !!this.unitAt(ctx, start + 1.2);
    if (singing && i % 2 === 0) return { kind: 'word', start, seed: own.seed };
    // Never the same as the bar before.
    let kind = own.kind;
    if (i > 0 && this.pick(i - 1).kind === kind) {
      const pool: Kind[] = ['tunnel', 'arrows', 'cover', 'rain', 'spectrum'];
      kind = pool[(pool.indexOf(kind) + 1 + (own.seed % (pool.length - 1))) % pool.length];
    }
    return { kind, start, seed: own.seed };
  }

  /** Indices of the hits in (from, to]. */
  private hitsIn(from: number, to: number): number[] {
    const T = this.hits.times, out: number[] = [];
    for (let i = Math.max(0, lastIndex(T, from)); i < T.length && T[i] <= to; i++) if (T[i] > from) out.push(i);
    return out;
  }

  /** An upright screen (taller than wide by a fifth or more). */
  private get upright(): boolean {
    return this.grid.gy > this.grid.gx * 1.2;
  }

  private draw(layer: Layer, comp: Comp, ctx: FrameCtx, t: number): void {
    const g = layer.g, random = rng(comp.seed), age = t - comp.start;
    const { gx: GX, gy: GY, k: K } = this.grid;
    layer.clear();
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    switch (comp.kind) {
      case 'word': {
        const u = this.unitAt(ctx, t) ?? this.unitAt(ctx, comp.start + 0.3);
        if (!u) break;
        const text = sung(u, t), full = whole(u);
        // Upright, three or more CJK characters stand in two rows (the sung part split where the whole is).
        const chars = Array.from(full), split = this.upright && u.cjk && chars.length >= 3 ? Math.ceil(chars.length / 2) : 0;
        const rows = split ? [chars.slice(0, split).join(''), chars.slice(split).join('')] : [full];
        const sungChars = Array.from(text);
        const shown = split ? [sungChars.slice(0, split).join(''), sungChars.slice(split).join('')] : [text];
        let px = Math.round(40 * K);
        g.font = `${px}px ${FONT}`;
        const widest = () => Math.max(...rows.map(r => g.measureText(r).width));
        // (Upright, a little narrower: the turned screen's near side runs off a narrow frame first.)
        const room = GX * (this.upright ? 0.84 : 0.94);
        while (px > 14 * K && widest() > room) { px -= 2; g.font = `${px}px ${FONT}`; }
        const lineH = px * 1.02, half = (rows.length * lineH) / 2;
        // Dim copies above and below, drifting opposite ways (cut by the edges), a step further on each drum; upright,
        // rows of them up to the top and bottom.
        const echo = Math.round(px * 0.48);
        g.font = `${echo}px ${FONT}`;
        const span = g.measureText(full).width + 10 * K;
        const drift = (age * 9 * K + this.hitsIn(comp.start, t).reduce((s, i) => s + 3 * K * snap((t - this.hits.times[i]) / 0.16), 0)) % span;
        const deep = this.upright ? Math.max(1, Math.floor((GY / 2 - half) / (echo * 1.3))) : 1;
        g.fillStyle = SIG_INK + '0.35)';
        for (let r = 0; r < deep; r++) {
          const dy = half + px * 0.11 + r * echo * 1.3, way = r % 2 ? -1 : 1;
          for (let k = -2; k <= 2; k++) {
            g.fillText(full, GX / 2 + way * drift + k * span, GY * 0.5 - dy);
            g.fillText(full, GX / 2 - way * drift + k * span, GY * 0.5 + dy);
          }
        }
        // The word, slid in from the side as it is sung.
        const since = t - u.start, dir = random() < 0.5 ? -1 : 1;
        const x = GX / 2 + dir * GX * (1 - snap(since / 0.2));
        g.font = `${px}px ${FONT}`;
        g.fillStyle = PAPER_INK + '1)';
        shown.forEach((row, r) => { if (row) g.fillText(row, x, GY * 0.5 + 1 - half + lineH * (r + 0.5)); });
        break;
      }
      case 'tunnel': {
        // A square for each beat of the last 1.4 s, dim, and a bright one for each drum, opening out of the middle; a
        // small one turning at the heart. (The screen's shape.)
        const r = GY / GX;
        g.lineWidth = 1.2 * K;
        const B = this.init.music.beats;
        for (let j = lastIndex(B, t); j >= 0 && t - B[j] < 1.4; j--) {
          const a = t - B[j], s = 4 * K + GX * 1.3 * Math.pow(a / 1.4, 1.5);
          g.strokeStyle = ACC_INK + ((1 - a / 1.4) * 0.45).toFixed(3) + ')';
          g.strokeRect(GX / 2 - s, GY / 2 - s * r, s * 2, s * 2 * r);
        }
        g.lineWidth = 1.6 * K;
        const T = this.hits.times;
        for (const i of this.hitsIn(t - 1.4, t)) {
          const a = t - T[i], s = 4 * K + GX * 1.3 * Math.pow(a / 1.4, 1.5);
          const k = (1 - a / 1.4) * (0.5 + 0.5 * this.hits.strength[i]);
          g.strokeStyle = (i % 2 ? SIG_INK : PAPER_INK) + k.toFixed(3) + ')';
          g.strokeRect(GX / 2 - s, GY / 2 - s * r, s * 2, s * 2 * r);
        }
        g.save();
        g.translate(GX / 2, GY / 2);
        g.rotate(t * 0.6);
        g.strokeStyle = ACC_INK + '0.8)';
        g.strokeRect(-4 * K, -4 * K, 8 * K, 8 * K);
        g.restore();
        break;
      }
      case 'arrows': {
        // Rows of ▶ (three, five on an upright screen), every other one the other way, a step on each drum.
        const steps = this.hitsIn(comp.start - 0.05, t).reduce((s, i) => s + snap((t - this.hits.times[i]) / 0.14), 0);
        const h = 7 * K, gap = h * 1.9, n = this.upright ? 5 : 3;
        for (let r = 0; r < n; r++) {
          const y = (GY * (r + 1)) / (n + 1), dir = r % 2 ? -1 : 1, off = ((steps * gap) % gap) * dir;
          const lit = r === (n - 1) / 2;
          g.fillStyle = (lit ? SIG_INK : PAPER_INK) + (lit ? '1)' : '0.75)');
          for (let x = -gap * 2; x < GX + gap * 2; x += gap) {
            const cx = x + off + (r % 2) * gap * 0.5;
            g.beginPath();
            g.moveTo(cx - dir * h * 0.55, y - h * 0.62);
            g.lineTo(cx + dir * h * 0.55, y);
            g.lineTo(cx - dir * h * 0.55, y + h * 0.62);
            g.closePath();
            g.fill();
          }
        }
        break;
      }
      case 'rain': {
        // The line's characters (or the title's) falling in columns, each column its own speed.
        const st = ctx.lyrics.current(t);
        const chars = Array.from((st?.line.text ?? this.init.title ?? '♪').replace(/\s+/g, ''));
        const cjk = hasCjk(chars.join('')), size = Math.round((cjk ? 9 : 10) * K);
        g.font = `${size}px ${FONT}`;
        for (let c = 0; c < GX / (size + 1); c++) {
          const sp = (9 + 14 * random()) * K, x = c * (size + 1) + size / 2, phase = random() * GY;
          for (let k = 0; k < 6; k++) {
            const y = ((t * sp + phase + k * (size + 2)) % (GY + 30 * K)) - 15 * K;
            const ch = chars[(c * 7 + k + Math.floor((t * sp) / (size + 2))) % chars.length];
            g.fillStyle = (k === 5 ? PAPER_INK : SIG_INK) + (0.25 + 0.15 * k).toFixed(2) + ')';
            g.fillText(cjk ? ch : ch.toUpperCase(), x, y);
          }
        }
        break;
      }
      case 'spectrum': {
        // Bars about the middle, a band each, quick up and down at 2 a second.
        const c0 = Math.floor(t * COLS), w = GX / NB;
        for (let b = 0; b < NB; b++) {
          let lv = 0;
          for (let k = 0; k <= 12; k++) lv = Math.max(lv, this.spec.column(c0 - k)[b] - (k / COLS) * 2);
          // (Measured from well up the range: a loud passage sits near 0.7 in every band and filled the screen white.)
          const h = clamp01((lv - 0.4) / 0.6) * GY * 0.42;
          const x = Math.round(b * w) + 0.5, bw = Math.max(1, w - 1.5);
          g.fillStyle = (b % 2 ? ACC_INK : SIG_INK) + '0.6)';
          g.fillRect(x, GY / 2 - h, bw, h * 2);
          // The tips in paper.
          g.fillStyle = PAPER_INK + '0.9)';
          g.fillRect(x, GY / 2 - h - 1, bw, 1);
          g.fillRect(x, GY / 2 + h, bw, 1);
        }
        break;
      }
      case 'cover':
        // (Straight into the dots: see cover().)
        break;
    }
  }

  /** The cover composition, straight into the dots: scanned on top to bottom, closing in slowly, a lift on drums. */
  private cover(comp: Comp, t: number, lum: Float32Array, col: Uint8Array): void {
    const { gx: GX, gy: GY, coverLum, coverCol } = this.grid;
    const age = t - comp.start, zoom = 1 + age * 0.04, scan = (age / 0.5) * GY;
    const i = lastIndex(this.hits.times, t), kick = i >= 0 ? this.hits.strength[i] * punch(t - this.hits.times[i], 0.15) : 0;
    for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
      const sx = Math.round(GX / 2 + (x - GX / 2) / zoom), sy = Math.round(GY / 2 + (y - GY / 2) / zoom);
      const o = y * GX + x, s = sy * GX + sx;
      const shown = GY - 1 - y < scan ? 1 : 0;
      lum[o] = shown * coverLum[s] * (0.85 + 0.25 * kick);
      col[o] = coverCol[s];
    }
  }

  private render(comp: Comp, ctx: FrameCtx, t: number, layer: Layer, lum: Float32Array, col: Uint8Array): void {
    if (comp.kind === 'cover') { this.cover(comp, t, lum, col); return; }
    this.draw(layer, comp, ctx, t);
    layer.read(lum, col);
  }

  /**
   * The line so far along the bottom rows, over a dark band (over any composition but the word); upright, in two
   * rows, the newest words below.
   */
  private ticker(ctx: FrameCtx, t: number, lum: Float32Array, col: Uint8Array): void {
    const st = ctx.lyrics.current(t);
    if (!st || st.exit >= 1) return;
    const done = st.words.filter(w => w.age >= 0).map(w => w.word.text.trim()).filter(Boolean);
    if (!done.length) return;
    const { gx: GX, gy: GY, k: K, b } = this.grid;
    const cjk = hasCjk(st.line.text), px = Math.round((cjk ? 10 : 9) * K), g = b.g;
    b.clear();
    g.font = `${px}px ${FONT}`;
    const join = (w: string[]) => { const s = w.join(cjk ? '' : ' '); return cjk ? s : s.toUpperCase(); };
    const fit = (s: string) => { while (g.measureText(s).width > GX - 4 && s.length > 1) s = Array.from(s).slice(1).join(''); return s; };
    // The newest words that fit a row; upright, the ones before them in a row above.
    let from = done.length - 1;
    while (from > 0 && g.measureText(join(done.slice(from - 1))).width <= GX - 4) from--;
    const rows = this.upright && from > 0 ? [fit(join(done.slice(0, from))), fit(join(done.slice(from)))] : [fit(join(done))];
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = PAPER_INK + (0.8 * (1 - st.exit)).toFixed(2) + ')';
    const lineH = px * 1.1, band = Math.ceil(px + (rows.length - 1) * lineH) + 3;
    rows.forEach((row, r) => g.fillText(row, GX / 2, GY - px * 0.62 - (rows.length - 1 - r) * lineH));
    const data = g.getImageData(0, GY - band, GX, band).data;
    for (let y = 0; y < band; y++) for (let x = 0; x < GX; x++) {
      const a = data[(y * GX + x) * 4 + 3] / 255, o = (band - 1 - y) * GX + x;
      lum[o] = Math.max(lum[o] * 0.2, a);
      if (a > 0.2) col[o] = 0;
    }
  }

  private pose(t: number, shot: Shot, aspect: number): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const cam = this.camera;
    // Far enough that the screen fills the frame (its own shape), pushing in a little over the shot.
    const W = this.grid.gx * PITCH, H = this.grid.gy * PITCH, half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const fill = (Math.min(H / 2, W / 2 / aspect) / half) * 0.96;
    if (shot.variant === 'tilt') {
      this.wall.rotation.set(0, side * 0.16, side * 0.03);
      // (Aimed a little low and not too close, so the turned screen's bottom rows, where the line runs, stay in.)
      cam.position.set(0, -H * 0.05, fill * ((this.upright ? 0.97 : 0.92) - 0.03 * k));
      cam.lookAt(0, -H * 0.05, 0);
    } else {
      this.wall.rotation.set(0, 0, 0);
      cam.position.set(0, 0, fill * (1 - 0.035 * k));
      cam.lookAt(0, 0, 0);
    }
    cam.updateMatrixWorld();
  }

  update(ctx: FrameCtx): void {
    const { t, shot } = ctx;
    this.pose(t, shot, ctx.aspect);
    this.u.uPx.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const G = this.grid, n = G.gx * G.gy;

    // This bar's composition, and while it sweeps on, the one before.
    const bi = lastIndex(this.bars, t);
    const now = this.compAt(ctx, bi);
    this.render(now, ctx, t, G.a, G.lumA, G.colA);
    const age = t - now.start;
    const lum = G.lumA, col = G.colA;
    if (bi >= 0 && age < SWEEP + 0.08) {
      const before = this.compAt(ctx, bi - 1);
      this.render(before, ctx, t, G.b, G.lumB, G.colB);
      for (let y = 0; y < G.gy; y++) for (let x = 0; x < G.gx; x++) {
        const o = y * G.gx + x;
        // Each dot turns over when the sweep (top left first) reaches it, a little scattered; a bright front leads.
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const at = SWEEP * ((x / G.gx + (G.gy - 1 - y) / G.gy) / 2) * 0.85 + 0.04 * ((h % 1000) / 1000);
        if (age < at) { lum[o] = G.lumB[o]; col[o] = G.colB[o]; }
        else if (age < at + 0.04) lum[o] = Math.max(lum[o], 0.7);
      }
    }
    if (now.kind !== 'word') this.ticker(ctx, t, lum, col);

    // A drum lifts what is lit a little.
    const i = lastIndex(this.hits.times, t);
    const kick = i >= 0 ? this.hits.strength[i] * punch(t - this.hits.times[i], 0.14) * (this.soft ? 0.5 : 1) : 0;
    for (let o = 0; o < n; o++) {
      G.data[o * 4] = Math.round(255 * clamp01(lum[o] * (0.88 + 0.22 * kick)));
      G.data[o * 4 + 1] = col[o] * 127;
      G.data[o * 4 + 3] = 255;
    }
    G.tex.needsUpdate = true;

    ctx.fx.bloom = this.soft ? 0.45 : 0.38;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.035;
  }
}
