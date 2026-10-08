// Halftone: the cover printed as screens of dots, like a poster off an offset press — an ink screen (the cover's
// darks), a signal screen and an accent screen (where the cover has those colours), each at its own angle, each dot
// sized by how much of its colour is there. The print breathes with the music: dots swell on kicks, the colour
// screens slip out of register on snares, the ruling steps coarser or finer on each downbeat, and the view drifts and
// zooms slowly over the cover. Pulse: glowing dots on ink, metered per shot so they cover about a third of the frame
// whatever the cover (a shot over a light part of it prints as a negative, its darks glowing), or a bright or
// one-colour cover would white the frame out under the words. Ballad: ink on paper, the lyrics set dark.
// The words are printed too, as a finer screen of their own (a LyricLayer laid on the cover, so the slow move carries
// them with the picture): light dots on ink, ink dots on paper; the cover's dots thin out round them.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricLayer } from './lyricSpace.ts';
import { lastIndex } from '../director/music.ts';

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec2 uRes, uPan, uMisreg, uLevels;
  uniform float uZoom, uCell, uKick, uNeon, uAngle, uNegative, uGain;
  uniform vec3 uPaper, uInk, uSig, uAcc;
  uniform sampler2D uLyric;
  uniform vec4 uLyricRect; // where the words lie on the cover: centre and size in cover uv
  uniform float uLyricOn;
  varying vec2 vUv;
  vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  // Screen pixel → cover uv: the cover fills the frame (cropped), zoomed and panned.
  vec2 coverUv(vec2 px) {
    vec2 q = (px - 0.5 * uRes) / max(uRes.x, uRes.y);
    return 0.5 + q / uZoom + uPan;
  }
  vec4 lyricAt(vec2 cuv) {
    vec2 q = (cuv - uLyricRect.xy) / uLyricRect.zw + 0.5;
    if (uLyricOn < 0.5 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    return texture2D(uLyric, q);
  }
  // Coverage of one screen at this pixel: rotate into the screen, find the cell's centre, read the cover there.
  float screenAt(vec2 px, float angle, int which) {
    vec2 r = rot(px, angle) / uCell;
    vec2 centre = (floor(r) + 0.5) * uCell;
    vec3 c = texture2D(uCover, coverUv(rot(centre, -angle))).rgb;
    // Levels: the shot's own darkest to lightest, so a dim or flat stretch of cover still shows its picture.
    float l = clamp((dot(c, vec3(0.2126, 0.7152, 0.0722)) - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0);
    float v;
    // The colour screens carry the cover's colour only where it is as vivid as that colour: on a cover that is one
    // colour all over they would otherwise print everywhere and bury the picture in rosettes.
    float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    float sig = clamp(1.0 - length(c - uSig) * 1.5, 0.0, 1.0) * clamp(chroma / max(0.04, max(uSig.r, max(uSig.g, uSig.b)) - min(uSig.r, min(uSig.g, uSig.b))), 0.0, 1.0);
    float acc = clamp(1.0 - length(c - uAcc) * 1.5, 0.0, 1.0) * clamp(chroma / max(0.04, max(uAcc.r, max(uAcc.g, uAcc.b)) - min(uAcc.r, min(uAcc.g, uAcc.b))), 0.0, 1.0);
    float lit = uNegative > 0.5 ? pow(1.0 - l, 1.2) : pow(l, 1.6);
    if (which == 0) v = uNeon > 0.5 ? lit * (1.0 - 0.6 * max(sig, acc)) : (1.0 - l) * (1.0 - 0.6 * max(sig, acc));
    else if (which == 1) v = sig;
    else v = acc;
    v *= uGain;
    // On ink the dots stay apart so the dark shows between them; on paper they may close up in the shadows.
    float radius = sqrt(clamp(v, 0.0, 1.0)) * (uNeon > 0.5 ? 0.56 : 0.72) * uCell * (1.0 + uKick * 0.28) * (1.0 - 0.92 * lyricAt(coverUv(rot(centre, -angle))).a);
    float d = length(rot(px, angle) - centre);
    return smoothstep(radius + 0.9, radius - 0.9, d);
  }
  // The words' own screen: finer, square to the frame; dot size from how much type is there, the dot in its colour.
  // On paper the type is printed solid instead (screened type there broke into dots and could not be read).
  float wordsAt(vec2 px, out vec3 tint) {
    if (uNeon < 0.5) {
      vec4 w = lyricAt(coverUv(px));
      float lum = dot(w.rgb, vec3(0.2126, 0.7152, 0.0722));
      tint = w.rgb / max(w.a, 1e-3);
      return clamp((w.a - lum) * 1.6, 0.0, 1.0);
    }
    float cell = max(3.0, uCell * 0.36);
    vec2 centre = (floor(px / cell) + 0.5) * cell;
    vec4 w = lyricAt(coverUv(centre));
    float lum = dot(w.rgb, vec3(0.2126, 0.7152, 0.0722));
    float v = uNeon > 0.5 ? lum : max(0.0, w.a - lum);
    tint = w.rgb / max(w.a, 1e-3);
    float radius = sqrt(clamp(v, 0.0, 1.0)) * 0.64 * cell * (1.0 + uKick * 0.15);
    return smoothstep(radius + 0.8, radius - 0.8, length(px - centre));
  }
  void main() {
    vec2 px = vUv * uRes;
    vec3 tint;
    float w = wordsAt(px, tint);
    float k = screenAt(px, uAngle + 0.7854, 0);
    float s = screenAt(px + uMisreg, uAngle + 0.2618, 1);
    float a = screenAt(px - uMisreg, uAngle + 1.309, 2);
    vec3 col;
    if (uNeon > 0.5) {
      // Light on ink: the screens add up like glowing phosphor.
      col = uInk + uPaper * k * 0.5 + uSig * s * 1.1 + uAcc * a * 0.85 + tint * w;
    } else {
      // Ink on paper: each screen multiplies over the paper, overprinting where they meet.
      col = uPaper;
      col = mix(col, col * uAcc, a * 0.9);
      col = mix(col, col * uSig, s * 0.9);
      col = mix(col, uInk, k * 0.92);
      col = mix(col, uInk, w * 0.95);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Halftone implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private layer: LyricLayer;
  private snares: Float64Array;
  private res = new THREE.Vector2(1920, 1080);
  private readonly neon: boolean;
  private meter: { shot: Shot | null; negative: boolean; gain: number; levels: [number, number] } = { shot: null, negative: false, gain: 1, levels: [0, 1] };

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.neon = look !== 'ballad';
    this.scene.background = (this.neon ? palette.ink : palette.paper).clone();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uRes: { value: this.res }, uPan: { value: new THREE.Vector2() }, uMisreg: { value: new THREE.Vector2() },
        uZoom: { value: 1 }, uCell: { value: 12 }, uKick: { value: 0 }, uNeon: { value: this.neon ? 1 : 0 }, uAngle: { value: 0 },
        uNegative: { value: 0 }, uGain: { value: 1 }, uLevels: { value: new THREE.Vector2(0, 1) },
        uPaper: { value: palette.paper.clone() }, uInk: { value: palette.ink.clone() }, uSig: { value: palette.signal.clone() }, uAcc: { value: palette.accent.clone() },
        uLyric: { value: null }, uLyricRect: { value: new THREE.Vector4(0.5, 0.5, 1, 1) }, uLyricOn: { value: 0 },
      },
    }));
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -10;
    this.scene.add(this.quad);
    this.snares = Float64Array.from(init.music.a.hits.snare.filter(h => h[1] > 0.4), h => h[0]);
    this.layer = new LyricLayer(palette, this.neon ? 'hook' : 'poem');
    this.layer.rig.onLight = !this.neon;
    this.quad.material.uniforms.uLyric.value = this.layer.target.texture;
    this.scene.add(this.layer.token);
    this.scene.onBeforeRender = renderer => {
      this.layer.render(renderer);
      this.quad.material.uniforms.uLyricOn.value = this.layer.on ? 1 : 0;
    };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The view over the cover at e (0..1 through the shot): sets the pan, returns the zoom. */
  private move(variant: string, e: number, sx: number, pan: THREE.Vector2): number {
    if (variant === 'pan') { pan.set(sx * lerp(-0.18, 0.18, e), lerp(0.08, -0.08, e)); return 1.8; }
    if (variant === 'out') { pan.set(0, 0); return lerp(2.4, 1.05, e); }
    pan.set(sx * 0.06 * e, -0.05 * e);
    return lerp(1.05, 1.9, e);
  }

  /**
   * Metering for a view of the cover. Neon: print it as a negative when that part of the cover is light (mean sRGB
   * luminance over 0.55), and shrink the dots so that on average they cover no more than about a third of the frame.
   * Print: shrink the ink so a dark cover still reads as a print on paper (under half the paper inked). Mirrors the
   * shader's dot sizes.
   */
  private meterView(zoom: number, pan: THREE.Vector2, aspect: number): { negative: boolean; gain: number; levels: [number, number] } {
    const S = this.init.coverSize, px = this.init.coverPixels, { signal, accent } = this.init.palette;
    const hw = (0.5 / zoom) * Math.min(1, aspect), hh = (0.5 / zoom) * Math.min(1, 1 / aspect);
    const samples: Array<[number, number, number]> = [];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const cu = 0.5 + pan.x + (i / 15 - 0.5) * 2 * hw, cv = 0.5 + pan.y + (j / 15 - 0.5) * 2 * hh;
      if (cu < 0 || cu > 1 || cv < 0 || cv > 1) continue;
      const o = (Math.min(S - 1, Math.floor((1 - cv) * S)) * S + Math.min(S - 1, Math.floor(cu * S))) * 4;
      samples.push([px[o] / 255, px[o + 1] / 255, px[o + 2] / 255]);
    }
    if (!samples.length) return { negative: false, gain: 1, levels: [0, 1] };
    const srgbLum = samples.reduce((a, c) => a + 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 0) / samples.length;
    const negative = this.neon && srgbLum > 0.55;
    const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    // Levels from the 4th to the 96th percentile of (linear) luminance, at least 0.2 apart.
    const lums = samples.map(c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])).sort((a, b) => a - b);
    let lo = lums[Math.floor(lums.length * 0.04)], hi = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.96))];
    if (hi - lo < 0.2) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 0.1); hi = Math.min(1, lo + 0.2); lo = hi - 0.2; }
    let cover = 0;
    for (const c of samples) {
      const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
      const l = Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b - lo) / (hi - lo)));
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const near = (k: THREE.Color) => Math.min(1, Math.max(0, 1 - Math.hypot(r - k.r, g - k.g, b - k.b) * 1.5)) *
        Math.min(1, chroma / Math.max(0.04, Math.max(k.r, k.g, k.b) - Math.min(k.r, k.g, k.b)));
      const sig = near(signal), acc = near(accent);
      const lit = !this.neon ? 1 - l : negative ? Math.pow(1 - l, 1.2) : Math.pow(l, 1.6);
      // Dot area goes with v; the three screens overlap, so they don't simply add up.
      const area = this.neon ? 1 : 1.6; // print dots grow to 0.72 of a cell, neon ones to 0.56
      cover += 1 - (1 - Math.min(1, lit * (1 - 0.6 * Math.max(sig, acc)) * area)) * (1 - sig * 0.9) * (1 - acc * 0.9);
    }
    cover /= samples.length;
    // On paper, about a quarter of the frame inked: more, and a dark cover printed as a grey wall of dots that hid
    // the picture and the words (the user: “这个滤镜不好，看不清”).
    const target = this.neon ? 0.34 : 0.26;
    return { negative, gain: Math.min(1, Math.max(this.neon ? 0.35 : 0.15, target / Math.max(1e-3, cover))), levels: [lo, hi] };
  }

  /** Drawing-buffer size: the dot screen is ruled in device pixels. */
  setViewport(width: number, height: number): void { this.res.set(width, height); }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.quad.material.uniforms;
    const info = music.at(t);
    const random = rng(shot.seed);
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const kick = this.neon ? music.pulse('kick', t, 0.12) : music.pulse('kick', t, 0.3) * 0.4;
    // Ruling: one of three per bar (a fixed number of cells down the frame, so it reads the same at any size).
    const rulings = [70, 52, 90];
    // (On paper a finer screen: the coarse one read as a pattern rather than a picture, and shimmered when moving.)
    const cells = rulings[(info.bar + Math.floor(random() * 3)) % 3] * (shot.variant === 'fine' ? 1.6 : 1) * (this.neon ? 1 : 1.45);
    u.uCell.value = this.res.y / cells;
    u.uKick.value = kick;
    // Snares knock the colour screens out of register; it settles back.
    const si = lastIndex(this.snares, t), sAge = si >= 0 ? t - this.snares[si] : 99;
    const slip = this.neon ? Math.exp(-sAge / 0.12) * u.uCell.value * 0.6 : 0;
    const dir = rng(si + 3)() * Math.PI * 2;
    u.uMisreg.value.set(Math.cos(dir) * slip, Math.sin(dir) * slip);
    // A slow move over the cover: in, out or across.
    const sx = random() < 0.5 ? -1 : 1;
    u.uZoom.value = this.move(shot.variant, inOutCubic(k), sx, u.uPan.value);
    // Meter the shot once, over the view halfway through it.
    if (this.meter.shot !== shot) {
      const pan = new THREE.Vector2(), zoom = this.move(shot.variant, 0.5, sx, pan);
      this.meter = { shot, ...this.meterView(zoom, pan, ctx.aspect) };
    }
    u.uNegative.value = this.meter.negative ? 1 : 0;
    u.uGain.value = this.meter.gain;
    u.uLevels.value.set(this.meter.levels[0], this.meter.levels[1]);
    u.uAngle.value = this.neon ? (info.bar % 4) * 0.02 : 0;
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    ctx.fx.bloom = this.neon ? 0.55 + kick * 0.3 : 0.05;
    ctx.fx.vignette = this.neon ? 0.45 : 0.15;
    ctx.fx.grain = this.neon ? 0.04 : 0.02;
    // Each line lies on the cover where the view was as it began (a ballad's column to one side), and the move carries
    // it on from there. The words are as big as the view is halfway through the shot; the layer covers all the cover
    // the shot travels over.
    const long = Math.max(this.res.x, this.res.y), at = new THREE.Vector2(), end = new THREE.Vector2();
    const zoom = this.move(shot.variant, 0.5, sx, at), w = this.res.x / long / zoom, h = this.res.y / long / zoom;
    const z0 = this.move(shot.variant, 0, sx, at), x0 = at.x, y0 = at.y, z1 = this.move(shot.variant, 1, sx, end);
    const rw = Math.abs(end.x - x0) + this.res.x / long / Math.min(z0, z1), rh = Math.abs(end.y - y0) + this.res.y / long / Math.min(z0, z1);
    const cx = 0.5 + (x0 + end.x) / 2, cy = 0.5 + (y0 + end.y) / 2;
    (u.uLyricRect.value as THREE.Vector4).set(cx, cy, rw, rh);
    const len = Math.max(0.5, shot.end - shot.start);
    this.layer.rig.place = (root, st) => {
      const zl = this.move(shot.variant, inOutCubic(clamp01((Math.max(st.line.start, shot.start) - shot.start) / len)), sx, at);
      root.position.set(0.5 + at.x - cx + (this.neon ? 0 : sx * 0.22 * (this.res.x / long / zl)), 0.5 + at.y - cy, -10);
    };
    // On paper the poem's thin serif over the dots read too small (its size follows the frame given): set twice as large.
    const big = this.neon ? 1 : 2;
    this.layer.update(ctx.lyrics, t, shot.section.energy, w * big, h * big, rw, rh);
  }
}
