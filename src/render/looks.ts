// Looks: a whole section redrawn in another medium, over whatever plate is on screen (after the grade and the tone
// mapping, on display colours). The plates all share one language — dark ground, the cover's colours, hairlines —
// and a look is what makes a section feel like another world (the reference films switch medium per section):
//   riso   a Riso print: the picture separated into two or three spot inks, each a halftone screen at its own angle,
//          mis-registered a little, on cream paper. Dark plates print light-on-paper: their dark ground stays paper,
//          what glows takes the ink (the brighter, the heavier), so a black frame becomes a printed page.
//   hibit  a Hi-bit pixel picture: big blocks, a few colour levels per channel with ordered dither, dark gaps
//          between the blocks like a dot-matrix screen.
//   ascii  the picture made of characters — the song's own (the lyrics' characters sorted by how much ink they take),
//          or a Latin ramp for songs without them — each cell's glyph picked by its brightness, in its colour.
//   crt    the picture on a curved tube: scanlines, an RGB grille, a black bezel with rounded corners.
// With ascii or riso on, the lyrics and the motion-graphics layer are drawn apart (ShotPass.split) so the sung line
// stays readable: over characters they lie flat and clean, off the glass (the engine's rule: subtitles stay outside
// the tube); on a print they are printed solid in the set's deepest ink, with the next ink a touch off register
// (type on a Riso is solid, never screened).
// Methods after the base engine's post.ts / ascii.ts (riso ink fit, bayer dither, CRT surface, measured glyph ramp).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { Palette } from './palette.ts';
import { hasCjk } from './text.ts';

/** Riso ink sets (sRGB hex): the paper, then the inks. The song's set is the one nearest its signal colour. */
const RISO_INKS: Array<{ paper: string; inks: string[] }> = [
  { paper: '#F4EFE6', inks: ['#FF48B0', '#0078BF', '#FFE800'] }, // fluorescent pink, blue, yellow
  { paper: '#F2ECE0', inks: ['#F15060', '#00838A', '#FFE800'] }, // bright red, teal, yellow
  { paper: '#F4EFE6', inks: ['#765BA7', '#FF48B0'] }, // purple, fluorescent pink
  { paper: '#F3EEE4', inks: ['#0078BF', '#FF6C2F'] }, // blue, orange
  { paper: '#F2EDE2', inks: ['#00A95C', '#3D5588', '#FFE800'] }, // green, federal blue, yellow
];

const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
const hex3 = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * A set's uniforms: paper, inks, and the matrix that turns a colour's optical density over the paper
 * (log(colour / paper) per channel) into each ink's coverage (least squares).
 */
function risoSet(k: number) {
  const set = RISO_INKS[k];
  const paper = hex3(set.paper), inks = set.inks.map(hex3);
  const A = inks.map(c => c.map((v, ch) => Math.log(Math.max(v, 0.02) / paper[ch])));
  const n = A.length;
  const ata = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A[i].reduce((s, v, ch) => s + v * A[j][ch], 0)));
  const inv = invert(ata);
  const M = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, ch) => (i < n ? inv[i].reduce((s, v, j) => s + v * A[j][ch], 0) : 0)));
  const m3 = new THREE.Matrix3().set(...(M.flat() as [number, number, number, number, number, number, number, number, number]));
  const ink = (i: number) => new THREE.Vector3(...(inks[i] ?? paper));
  return { paper: new THREE.Vector3(...paper), ink0: ink(0), ink1: ink(1), ink2: ink(2), m: m3, n };
}

function invert(a: number[][]): number[][] {
  const n = a.length, m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c] || 1e-9;
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]; }
  }
  return m.map(r => r.slice(n));
}

/** The ink set for a palette: the one whose first ink is nearest the signal's hue (a grey cover gets the blue set). */
export function risoInksFor(palette: Palette): number {
  if (palette.mono) return 3;
  const hsl = { h: 0, s: 0, l: 0 };
  palette.signal.getHSL(hsl, THREE.SRGBColorSpace);
  let best = 0, bestD = Infinity;
  RISO_INKS.forEach((set, i) => {
    const ink = new THREE.Color(set.inks[0]), o = { h: 0, s: 0, l: 0 };
    ink.getHSL(o);
    const d = Math.min(Math.abs(o.h - hsl.h), 1 - Math.abs(o.h - hsl.h));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const MONO = '"Cascadia Mono", Consolas, "Courier New", monospace';
const CJK = '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const LATIN_RAMP = " .'`,:;-~=+*!?/|()[]{}<>il1tfjrxnuvczXYUJCLQ0OZmwqpdbkhao#MW&8%B@$";

/**
 * Glyphs sorted by measured ink coverage, white on transparent in one row of cells (64 px tall). From the song's
 * lyrics when it has enough distinct CJK characters (about 24 spread over the ink range, a few light marks under
 * them), else a Latin ramp.
 */
export class GlyphAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly n: number;
  /** Cell width / height. */
  readonly aspect: number;

  constructor(text: string) {
    const AH = 64;
    const cjk = [...new Set(Array.from(text).filter(ch => hasCjk(ch)))];
    const useCjk = cjk.length >= 24;
    const family = useCjk ? CJK : MONO;
    const weight = useCjk ? 500 : 600;
    const font = `${weight} ${Math.round(AH * (useCjk ? 0.8 : 0.86))}px ${family}`;
    const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    m.font = font;
    const cand = useCjk ? ['·', '、', '一', ...cjk.slice(0, 400)] : Array.from(LATIN_RAMP);
    const adv = useCjk ? AH * 0.92 : Math.max(...cand.map(ch => m.measureText(ch).width), AH * 0.4);
    const AW = Math.ceil(adv);
    this.aspect = AW / AH;
    const probe = document.createElement('canvas');
    probe.width = AW; probe.height = AH;
    const pc = probe.getContext('2d', { willReadFrequently: true })!;
    const cover = (ch: string) => {
      pc.clearRect(0, 0, AW, AH);
      pc.font = font; pc.fillStyle = '#fff'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.fillText(ch, AW / 2, AH * 0.54);
      const d = pc.getImageData(0, 0, AW, AH).data;
      let s = 0;
      for (let i = 3; i < d.length; i += 4) s += d[i];
      return s / (255 * AW * AH);
    };
    const measured = cand.map(ch => ({ ch, c: ch === ' ' ? 0 : cover(ch) })).filter(g => g.c > 0.002).sort((a, b) => a.c - b.c);
    let ramp: Array<{ ch: string; c: number }> = [];
    if (useCjk) {
      // Even steps over the measured range: the lightest marks, then ~24 characters spread across it.
      const lo = measured[0].c, hi = measured[measured.length - 1].c, steps = 26;
      for (let k = 0; k < steps; k++) {
        const want = lo + ((hi - lo) * k) / (steps - 1);
        let pick = measured[0];
        for (const g of measured) if (Math.abs(g.c - want) < Math.abs(pick.c - want)) pick = g;
        if (!ramp.includes(pick)) ramp.push(pick);
      }
    } else {
      for (const g of measured) if (!ramp.length || g.c - ramp[ramp.length - 1].c > 0.004) ramp.push(g);
    }
    ramp = [{ ch: ' ', c: 0 }, ...ramp];
    this.n = ramp.length;
    const atlas = document.createElement('canvas');
    atlas.width = AW * ramp.length; atlas.height = AH;
    const ac = atlas.getContext('2d')!;
    ac.font = font; ac.fillStyle = '#fff'; ac.textAlign = 'center'; ac.textBaseline = 'middle';
    ramp.forEach((g, i) => ac.fillText(g.ch, AW * i + AW / 2, AH * 0.54));
    this.texture = new THREE.CanvasTexture(atlas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  dispose(): void { this.texture.dispose(); }
}

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse, tLyr, tAtlas;
  uniform float uRiso, uRisoPos, uHibit, uAscii, uCrt, uSplit, uTime, uGlyphs, uGlyphAspect;
  uniform vec2 uRes;
  uniform vec3 risoPaper, risoInk0, risoInk1, risoInk2, risoDeep, risoSecond;
  uniform mat3 risoM;
  uniform float risoN;
  varying vec2 vUv;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  float bayer4(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    int i = q.x + q.y * 4;
    float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[i] + 0.5) / 16.0;
  }
  // The device-pixel size of the frame's height / 1080 (patterns keep their size at every resolution).
  float unit() { return uRes.y / 1080.0; }

  // ---- Hi-bit: the colour of the block a point falls in ----
  vec2 block(vec2 uv) { float b = max(3.0, floor(8.0 * unit() + 0.5)); vec2 cells = uRes / b; return (floor(uv * cells) + 0.5) / cells; }

  // ---- ASCII: the picture as glyphs ----
  vec3 ascii(vec2 uv) {
    float ch = max(10.0, floor(23.0 * unit() + 0.5));
    vec2 cell = vec2(ch * uGlyphAspect, ch);
    vec2 px = uv * uRes;
    vec2 cid = floor(px / cell), inC = fract(px / cell);
    // The cell's colour: the brightest of nine taps, mixed with their mean (a hairline through the cell still
    // gives a glyph, so line plates come out as lines of characters).
    vec3 c = vec3(0.0), avg = vec3(0.0);
    float best = -1.0;
    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
      vec3 s = texture2D(tDiffuse, (cid + vec2(0.17 + 0.33 * float(i), 0.17 + 0.33 * float(j))) * cell / uRes).rgb;
      avg += s;
      float l = luma(s);
      if (l > best) { best = l; c = s; }
    }
    c = mix(avg / 9.0, c, 0.7);
    float l = pow(clamp(luma(c) * 1.9, 0.0, 1.0), 0.7);
    l += (hash12(cid * 1.37 + 3.1) - 0.5) * 0.5 / max(uGlyphs - 1.0, 1.0);
    float gi = l < 0.05 ? 0.0 : clamp(floor(l * (uGlyphs - 1.0) + 0.5), 1.0, uGlyphs - 1.0);
    float cov = texture2D(tAtlas, vec2((gi + inC.x) / uGlyphs, inC.y)).a;
    float mx = max(max(c.r, c.g), c.b);
    vec3 gc = c / max(mx, 0.04) * (0.55 + 0.6 * clamp(mx * 1.6, 0.0, 1.0));
    // A faint trace of the picture under the glyphs keeps the shapes legible between them.
    return mix(c * 0.07, gc, cov);
  }

  // ---- Riso ----
  vec3 risoTarget(vec2 u) {
    vec3 c = texture2D(tDiffuse, u).rgb;
    float l = luma(c), mx = max(max(c.r, c.g), c.b);
    // A dark frame prints its light as ink on the paper: a coloured light as its own colour at full strength (one
    // or two inks), a white one (the words, a flash) as a deep overprint, so the brightest things read darkest.
    float mn = min(min(c.r, c.g), c.b);
    float sat = (mx - mn) / max(mx, 1e-3);
    vec3 hue = (c - mn) / max(mx - mn, 1e-3);
    vec3 ink = mix(vec3(0.16), mix(vec3(0.16), vec3(1.0), hue), smoothstep(0.12, 0.45, sat));
    vec3 dark = mix(risoPaper, ink, smoothstep(0.03, 0.55, l + 0.15 * mx));
    // A plate lit like a picture prints positive: its own colours, a touch more contrast, the paper as its white.
    vec3 positive = pow(clamp(c, 0.0, 1.0), vec3(0.55)) * risoPaper;
    return mix(dark, positive, uRisoPos);
  }
  vec3 risoCover(vec2 u) { return clamp(risoM * log(max(risoTarget(u), vec3(0.02)) / risoPaper), 0.0, 1.0); }
  float screen(vec2 px, float ang, float c, float dot) {
    vec2 q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * px / dot;
    float inv = step(0.5, c);
    vec2 f = fract(q + 0.5 * inv) - 0.5;
    float r = sqrt(mix(c, 1.0 - c, inv) / 3.14159);
    float d = length(f), aa = max(fwidth(d) * 0.8, 0.02);
    float m = 1.0 - smoothstep(r - aa, r + aa, d);
    return mix(m, 1.0 - m, inv);
  }
  vec3 riso(vec2 uv) {
    float u1 = unit();
    vec2 sh = vec2(2.5 * u1) / uRes;
    float c0 = risoCover(uv + sh * vec2(1.0, 0.4)).x, c1 = risoCover(uv + sh * vec2(-0.6, -0.8)).y, c2 = risoCover(uv + sh * vec2(0.2, 1.0)).z;
    vec2 px = uv * uRes;
    float dot = 6.5 * u1;
    // Uneven ink, fixed on the paper.
    float tx = 0.55 * (vnoise(px / (14.0 * u1)) - 0.5) + 0.25 * (vnoise(px / (3.0 * u1)) - 0.5);
    vec3 pr = risoPaper;
    pr *= mix(vec3(1.0), risoInk0 / risoPaper, screen(px, 0.2618, c0 * (1.0 + 0.3 * tx), dot));
    if (risoN > 1.5) pr *= mix(vec3(1.0), risoInk1 / risoPaper, screen(px + 1.7, 1.309, c1 * (1.0 - 0.3 * tx), dot));
    if (risoN > 2.5) pr *= mix(vec3(1.0), risoInk2 / risoPaper, screen(px + 3.1, 0.0, c2 * (1.0 + 0.25 * tx), dot));
    // Paper tooth.
    pr *= 1.0 - 0.035 * vnoise(px / (1.6 * u1));
    return pr;
  }

  void main() {
    // ---- the tube's glass: barrel curvature ----
    vec2 glass = vUv;
    if (uCrt > 0.0) {
      vec2 d = (vUv - 0.5) * 2.0;
      d *= 1.0 + 0.11 * uCrt * d.yx * d.yx;
      glass = d * 0.5 + 0.5;
    }
    vec2 uv = glass;
    if (uHibit > 0.0) uv = block(uv);
    vec3 col = texture2D(tDiffuse, uv).rgb;
    if (uAscii > 0.0) col = mix(col, ascii(uv), uAscii);
    if (uRiso > 0.0) col = mix(col, riso(glass), uRiso);
    if (uHibit > 0.0) {
      float b = max(3.0, floor(8.0 * unit() + 0.5));
      vec2 cellId = floor(glass * uRes / b);
      float L = 4.0;
      // A light dither (a full one turns glow haze into speckle), and the near-blacks held black.
      vec3 cc = clamp(col, 0.0, 1.0);
      cc *= smoothstep(0.02, 0.08, max(max(cc.r, cc.g), cc.b));
      vec3 q = floor(cc * L + 0.5 + (bayer4(cellId) - 0.5) * 0.65) / L;
      col = mix(col, q, uHibit);
      vec2 fp = fract(glass * uRes / b);
      float gw = 1.0 / b;
      col *= 1.0 - uHibit * 0.5 * max(step(1.0 - gw, fp.x), step(1.0 - gw, fp.y));
    }
    if (uCrt > 0.0) {
      vec2 gpx = glass * uRes;
      float L = luma(clamp(col, 0.0, 1.0));
      float ph = 0.5 - 0.5 * cos(6.2831853 * glass.y * 300.0);
      col *= 1.0 - uCrt * 0.5 * ph * (1.0 - 0.5 * L);
      int gx = int(mod(floor(gl_FragCoord.x / max(1.0, floor(unit() + 0.5))), 3.0));
      vec3 grille = gx == 0 ? vec3(1.16, 0.92, 0.92) : gx == 1 ? vec3(0.92, 1.16, 0.92) : vec3(0.92, 0.92, 1.16);
      col *= mix(vec3(1.0), grille, uCrt * 0.3);
      col *= 1.0 + (hash12(vec2(floor(uTime * 60.0), 7.0)) - 0.5) * 0.025 * uCrt;
      // The glass darkens toward its rim; outside it, a black bezel with rounded corners.
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      vec2 q = (glass - 0.5) * asp, hb = 0.5 * asp - 0.004;
      float rr = 0.055;
      float dB = length(max(abs(q) - (hb - rr), 0.0)) - rr;
      col *= mix(1.0, smoothstep(0.0, -0.09, dB) * 0.35 + 0.65, uCrt);
      col *= 1.0 - smoothstep(-0.002, 0.002, dB) * uCrt;
    }
    // The words and the motion graphics (linear, premultiplied): clean over characters, printed solid on paper.
    if (uSplit > 0.5) {
      vec4 w = texture2D(tLyr, vUv);
      if (uRiso > 0.0) {
        // Coverage from how bright the words are (their dark halos print nothing); the second ink off register.
        vec4 w2 = texture2D(tLyr, vUv + vec2(-2.0, 1.5) * unit() / uRes);
        float k = clamp(luma(w.rgb) * 1.6, 0.0, 1.0), k2 = clamp(luma(w2.rgb) * 1.6, 0.0, 1.0);
        float tooth = 1.0 - 0.12 * vnoise(vUv * uRes / (2.0 * unit()));
        col *= mix(vec3(1.0), risoSecond / risoPaper, k2 * 0.85 * uRiso);
        col *= mix(vec3(1.0), risoDeep / risoPaper, k * tooth * uRiso);
      } else if (w.a > 0.001) {
        vec3 lin = clamp(w.rgb / w.a, 0.0, 1.0);
        vec3 s = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
        col = mix(col, s, clamp(w.a, 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

/** The look settings a frame carries (Fx), 0..1 each; the riso inks and the glyphs are per song. */
export interface LookFx { riso: number; risoPositive: number; hibit: number; ascii: number; crt: number }

export class LookPass extends Pass {
  private quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;
  private atlas: GlyphAtlas | null = null;
  private inks = -1;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tLyr: { value: null }, tAtlas: { value: null },
        uRiso: { value: 0 }, uRisoPos: { value: 0 }, uHibit: { value: 0 }, uAscii: { value: 0 }, uCrt: { value: 0 }, uSplit: { value: 0 }, uTime: { value: 0 },
        uGlyphs: { value: 2 }, uGlyphAspect: { value: 1 }, uRes: { value: new THREE.Vector2(1920, 1080) },
        risoPaper: { value: new THREE.Vector3(1, 1, 1) }, risoDeep: { value: new THREE.Vector3() }, risoSecond: { value: new THREE.Vector3() }, risoInk0: { value: new THREE.Vector3() }, risoInk1: { value: new THREE.Vector3() }, risoInk2: { value: new THREE.Vector3() },
        risoM: { value: new THREE.Matrix3() }, risoN: { value: 0 },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Per song: the riso inks nearest its palette and the glyphs from its lyrics. */
  setSong(palette: Palette, lyricText: string): void {
    const k = risoInksFor(palette);
    if (k !== this.inks) {
      const r = risoSet(k), u = this.material.uniforms;
      this.inks = k;
      (u.risoPaper.value as THREE.Vector3).copy(r.paper);
      (u.risoInk0.value as THREE.Vector3).copy(r.ink0);
      (u.risoInk1.value as THREE.Vector3).copy(r.ink1);
      (u.risoInk2.value as THREE.Vector3).copy(r.ink2);
      (u.risoM.value as THREE.Matrix3).copy(r.m);
      u.risoN.value = r.n;
      // The words: the darkest ink, the next darkest off register under it.
      const inks = [r.ink0, r.ink1, r.ink2].slice(0, r.n).sort((a, b) => lum(a) - lum(b));
      (u.risoDeep.value as THREE.Vector3).copy(inks[0]);
      (u.risoSecond.value as THREE.Vector3).copy(inks[1] ?? inks[0]);
    }
    this.atlas?.dispose();
    this.atlas = new GlyphAtlas(lyricText);
    const u = this.material.uniforms;
    u.tAtlas.value = this.atlas.texture;
    u.uGlyphs.value = this.atlas.n;
    u.uGlyphAspect.value = this.atlas.aspect;
  }

  set(fx: LookFx, t: number, lyr: THREE.Texture | null): void {
    const u = this.material.uniforms;
    u.uRiso.value = fx.riso;
    u.uRisoPos.value = fx.risoPositive;
    u.uHibit.value = fx.hibit;
    u.uAscii.value = this.atlas ? fx.ascii : 0;
    u.uCrt.value = fx.crt;
    u.uTime.value = t;
    u.uSplit.value = lyr ? 1 : 0;
    u.tLyr.value = lyr;
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms.uRes.value as THREE.Vector2).set(width, height);
  }

  /** Draws once into `target` so the first section with a look doesn't stall on compiling it. */
  warm(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = read.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.atlas?.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
