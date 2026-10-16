// Renderer + post chain: shots (one, or two joined by a transition, plus the motion-graphics overlay) → memory (a frame
// kept for flashbacks) → echo trails → bloom → grade (mirror, pixelate, glitch, barrel, zoom blur, smear, chromatic
// aberration, exposure, duotone, invert, flashback, vignette, scanlines, grain, fade, flash) → output → look (a section
// redrawn as a riso print, Hi-bit pixels, characters or on a tube; src/render/looks.ts).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { setAnisotropy } from './text.ts';
import { EchoPass, MemoryPass, ShotPass, WordsPass, type Transition } from './shots.ts';
import { LookPass } from './looks.ts';
import type { Palette } from './palette.ts';

/** The geometry and camera of three's FullScreenQuad (one big triangle, position and uv), for compiling a pass's material. */
const PASS_QUAD = new THREE.BufferGeometry();
PASS_QUAD.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
PASS_QUAD.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
const PASS_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
/** A material drawn with a FullScreenQuad, as an object for MvScene.offscreen (compiled with its plate). */
export const passMesh = (material: THREE.Material) => new THREE.Mesh(PASS_QUAD, material);

export interface Fx {
  bloom: number;
  /** Chromatic aberration, 0..1. */
  ca: number;
  /** White flash, 0..1. */
  flash: number;
  /** Fade to ink, 0..1. */
  fade: number;
  grain: number;
  vignette: number;
  /** Slice displacement + RGB split for a few frames after a cut, 0..1. */
  glitch: number;
  /** Radial zoom blur, 0..1. */
  zoom: number;
  /** Wide-lens barrel distortion (keeps the corners, swells the middle), 0 = none, ~0.2 = strong. */
  barrel: number;
  /** Light trails: how much of the last frame survives (0 = none, ~0.85 = long streaks). */
  echo: number;
  /** Map the picture onto the palette's ink → signal ramp, 0..1. */
  duotone: number;
  /** Negative, 0..1 (a snare's flash in a drop). */
  invert: number;
  /** Mirror the frame: 0 none, 1 left onto right, 2 top onto bottom, 3 both (a four-way mirror). */
  mirror: number;
  /** Directional smear (a whip pan), in screen widths / heights. */
  smearX: number;
  smearY: number;
  /** Pixelate into blocks this many device pixels wide (0 = off). */
  pixel: number;
  /** Scan lines, 0..1. */
  scan: number;
  /** Brightness multiplier (strobes). */
  exposure: number;
  /** Keep this frame for a flashback. */
  remember: boolean;
  /** The kept frame laid over the picture in the palette's duotone (where lighter), 0..1. */
  memory: number;
  /** Looks (src/render/looks.ts), 0..1: a riso print, Hi-bit pixels, characters (the words drawn apart), a tube. */
  riso: number;
  /** The riso print of a plate lit like a picture (sky, clouds): positive, its darks inked (else its lights are). */
  risoPositive: number;
  hibit: number;
  ascii: number;
  crt: number;
  /** The VHS look (looks.ts): the picture played off a tape, 0..1. */
  vhs: number;
  /** The finish (FinishShader: grade, halation, lens, sharpening, film grain), 0..1; 0 = the plain output. */
  film: number;
  /** The lens (src/render/lens.ts) on the shot on screen: depth of field and motion blur, −1 = the plate's own. */
  aperture: number;
  motion: number;
  /** Focus distance, 0 = the plate's own (PlateLens.focus). */
  focus: number;
  /** Which shot is on screen (its start): a new value is a cut, where the motion blur starts afresh. */
  cut: number;
  /** A plate that moves its world past a still camera: how fast it flies, world units per second along the view. */
  travel: number;
  /** Impact frame, 0..1: the frame cut to two flat colours, the cover's ink and signal colour (impactInvert 1: swapped). */
  impact: number;
  impactInvert: number;
  /** Letterbox, 0..1 of the bars of a 2.39:1 frame (drawn under the overlay). */
  letterbox: number;
}

export const defaultFx = (): Fx => ({
  bloom: 0.35, ca: 0, flash: 0, fade: 0, grain: 0.04, vignette: 0.5, glitch: 0, zoom: 0, barrel: 0,
  echo: 0, duotone: 0, invert: 0, mirror: 0, smearX: 0, smearY: 0, pixel: 0, scan: 0, exposure: 1,
  remember: false, memory: 0, riso: 0, risoPositive: 0, hibit: 0, ascii: 0, crt: 0, vhs: 0, film: 1,
  aperture: -1, motion: -1, focus: 0, cut: 0, travel: 0,
  impact: 0, impactInvert: 0, letterbox: 0,
});

/** A style's finish (FinishShader), set per song with the palette. */
export interface Finish {
  /** Contrast about mid grey, in linear light (1 = none). */
  contrast: number;
  /** The warm glow film gives round bright lights, 0..1. */
  halation: number;
  /** Lateral chromatic aberration at the corners, in px at 1080p. */
  lens: number;
  /** Local contrast at edges, 0..1. */
  sharpen: number;
  /** How far the shadows lean to the cover's dark hues and the highlights to its paper, 0..1. */
  tone: number;
  /** Film grain on the display picture, times the plate's fx.grain. */
  grain: number;
  /** The shutter for the motion blur, seconds (1/48: a film camera's half-turn at 24 frames). */
  shutter: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uCA: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.55 },
    uGlitch: { value: 0 },
    uZoom: { value: 0 },
    uBarrel: { value: 0 },
    uDuotone: { value: 0 },
    uInvert: { value: 0 },
    uMirror: { value: 0 },
    uSmear: { value: new THREE.Vector2() },
    uPixel: { value: 0 },
    uScan: { value: 0 },
    uExposure: { value: 1 },
    uFilm: { value: 0 },
    tHalo: { value: null as THREE.Texture | null },
    uHalation: { value: 0 },
    tMemory: { value: null as THREE.Texture | null },
    uMemory: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uInk: { value: new THREE.Color(0x0a0a0b) },
    uSignal: { value: new THREE.Color(0xffffff) },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tMemory, tHalo;
    uniform float uHalation;
    uniform float uTime, uCA, uFlash, uFade, uGrain, uVignette, uAspect, uGlitch, uZoom, uBarrel;
    uniform float uDuotone, uInvert, uMirror, uPixel, uScan, uExposure, uMemory, uFilm;
    uniform vec2 uSmear, uResolution;
    uniform vec3 uInk, uSignal;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    vec3 split(vec2 uv, vec2 off) {
      return vec3(textureLod(tDiffuse, uv + off, 0.0).r, textureLod(tDiffuse, uv, 0.0).g, textureLod(tDiffuse, uv - off, 0.0).b);
    }
    void main() {
      vec2 uv = vUv;
      if (uMirror > 0.5) {
        if (uMirror < 1.5 || uMirror > 2.5) uv.x = 0.5 - abs(uv.x - 0.5);
        if (uMirror > 1.5) uv.y = 0.5 - abs(uv.y - 0.5);
      }
      if (uPixel > 0.5) { vec2 cells = uResolution / uPixel; uv = (floor(uv * cells) + 0.5) / cells; }
      if (uBarrel > 0.001) {
        vec2 d = uv - 0.5, dd = d * vec2(uAspect, 1.0);
        float rm = 0.25 * uAspect * uAspect + 0.25;
        uv = 0.5 + d * (1.0 + uBarrel * dot(dd, dd)) / (1.0 + uBarrel * rm);
      }
      if (uGlitch > 0.001) {
        float n = hash(vec2(floor(uv.y * 28.0), floor(uTime * 40.0)));
        uv.x += (n - 0.5) * 0.14 * uGlitch * step(0.55, n);
      }
      vec2 c = uv - 0.5;
      vec2 off = c * uCA * 0.018 + vec2(uGlitch * 0.012, 0.0);
      vec3 col = vec3(0.0);
      if (uZoom > 0.001) {
        for (int i = 0; i < 10; i++) col += split(uv - c * (float(i) / 9.0) * uZoom * 0.14, off);
        col /= 10.0;
      } else if (abs(uSmear.x) + abs(uSmear.y) > 0.0005) {
        for (int i = 0; i < 12; i++) col += split(uv + uSmear * (float(i) / 11.0 - 0.5), off);
        col /= 12.0;
      } else col = split(uv, off);
      if (uHalation > 0.001) {
        // Halation (the finish): light scattered back through the film base glows warm round bright lights, only
        // outside them; read where the picture is (after the mirror, pixels and lens), from the bloom's tightest blur.
        float h = dot(textureLod(tHalo, uv, 0.0).rgb, vec3(0.2126, 0.7152, 0.0722));
        col += vec3(1.0, 0.38, 0.18) * max(h - 0.4 * dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0) * uHalation;
      }
      col *= uExposure;
      if (uDuotone > 0.001) {
        float l = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
        // Ink in the shadows, the signal colour in the mids, lifted towards white in the highlights.
        vec3 duo = mix(mix(uInk, uSignal, smoothstep(0.02, 0.55, l)), mix(uSignal, vec3(1.0), 0.55), smoothstep(0.55, 1.0, l));
        col = mix(col, duo, uDuotone);
      }
      if (uInvert > 0.001) col = mix(col, vec3(1.0) - clamp(col, 0.0, 1.0), uInvert);
      if (uMemory > 0.001) {
        // A flashback: the kept frame in the ink → signal duotone, laid over the present where it is lighter (so the
        // words sung since stay readable and nothing goes darker; the word it held sits where it still is). The colour
        // says it is a memory; it is no brighter than the frame was.
        vec3 m = textureLod(tMemory, vUv, 0.0).rgb * uExposure;
        float l = clamp(dot(m, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
        vec3 mem = mix(mix(uInk, uSignal, smoothstep(0.0, 0.45, l)), mix(uSignal, vec3(1.0), 0.4), smoothstep(0.45, 1.0, l));
        col = mix(col, max(col, mem), uMemory);
      }
      float r = length(c * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
      col *= mix(1.0, smoothstep(1.25, 0.2, r), uVignette);
      if (uScan > 0.001) col *= 1.0 - uScan * 0.4 * (0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.4));
      // (With the finish on, the grain is laid on the display picture there instead.)
      col += (hash(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5) * uGrain * (1.0 - uFilm);
      col = mix(col, uInk, uFade);
      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * The finish, in place of three's OutputPass: what a camera and film add to every frame (after the base engine's
 * post, which the user's own films are finished with), in the cover's colours. Linear HDR in: lateral chromatic
 * aberration growing to the corners → local contrast at edges → a grade (contrast about mid grey; shadows towards the cover's dark hues,
 * highlights towards its paper) → the same Neutral tone mapping and sRGB encoding as before → film grain on the
 * display picture (monochrome, two sizes, strongest in the mid-tones, new 30 times a second) → dither. uFilm 0 gives
 * OutputPass's output exactly (plus the dither).
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uFilm: { value: 0 },
    uGrain: { value: 0.04 },
    uContrast: { value: 1 },
    uGrainScale: { value: 1 },
    uLens: { value: 0 },
    uSharpen: { value: 0 },
    uImpact: { value: 0 },
    uImpactInvert: { value: 0 },
    uInkD: { value: new THREE.Vector3() },
    uSignalD: { value: new THREE.Vector3(1, 1, 1) },
    uShadow: { value: new THREE.Vector3(1, 1, 1) },
    uHigh: { value: new THREE.Vector3(1, 1, 1) },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uPixelRatio: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFilm, uGrain, uGrainScale, uContrast, uLens, uSharpen, uPixelRatio;
    uniform vec3 uShadow, uHigh, uInkD, uSignalD;
    uniform float uImpact, uImpactInvert;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    // three's NeutralToneMapping (Khronos PBR Neutral), exposure 1.
    vec3 neutral(vec3 color) {
      const float StartCompression = 0.8 - 0.04;
      const float Desaturation = 0.15;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < StartCompression) return color;
      float d = 1. - StartCompression;
      float newPeak = 1. - d * d / (peak + d - StartCompression);
      color *= newPeak / peak;
      float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
      return mix(color, vec3(newPeak), g);
    }
    vec3 srgb(vec3 v) { return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308)))); }
    void main() {
      vec2 c = vUv - 0.5;
      float aspect = uResolution.x / uResolution.y;
      vec2 cc = c * vec2(aspect, 1.0);
      float r2 = dot(cc, cc) / (0.25 * aspect * aspect + 0.25);
      // Lateral chromatic aberration: red pushed out, blue pulled in, nothing in the middle, uLens px in the corners.
      vec2 off = cc / max(length(cc), 1e-4) * r2 * uLens * uFilm / 1080.0 * vec2(1.0 / aspect, 1.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      // Local contrast: the luminance against its four neighbours (a CSS px away), as a ratio (no dark rings, no hue).
      vec2 px = uPixelRatio / uResolution;
      float ln = 0.25 * luma(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb);
      float lc = luma(col);
      col *= clamp(pow((lc + 0.02) / (ln + 0.02), uSharpen * uFilm * 0.6), 0.8, 1.3);
      // Grade: contrast about mid grey — the darks pushed down, the lights only a little up (it fades out over the
      // stops above mid grey, so bright skies and suns keep their detail) — then the split tone.
      vec3 ev = log2(max(col, 1e-6) / 0.18);
      vec3 k = mix(vec3(uContrast), vec3(1.0), clamp(ev / 3.0, 0.0, 1.0));
      col = 0.18 * exp2(ev * mix(vec3(1.0), k, uFilm));
      col *= mix(vec3(1.0), mix(uShadow, uHigh, smoothstep(0.12, 0.7, sqrt(luma(col)))), uFilm);
      vec3 s = srgb(clamp(neutral(col), 0.0, 1.0));
      // Impact frame: the picture cut to two flat colours at a threshold, the cover's ink and its signal colour (not its
      // paper: a frame that is mostly light would be a white flash).
      if (uImpact > 0.001) {
        float on = step(0.36, luma(s));
        s = mix(s, mix(uInkD, uSignalD, abs(on - uImpactInvert)), uImpact);
      }
      // Film grain on what is seen.
      float lm = luma(s), tq = floor(uTime * 30.0);
      vec2 cell = floor(gl_FragCoord.xy / uPixelRatio);
      float g = 0.7 * (hash(cell + tq * 17.31) - 0.5) + 0.6 * (hash(floor(cell * 0.5) + tq * 7.13 + 91.7) - 0.5);
      s += g * uGrain * uGrainScale * uFilm * (0.6 + 1.2 * lm * (1.0 - lm));
      s += (hash(gl_FragCoord.xy + fract(uTime) * 311.0) + hash(gl_FragCoord.yx * 1.31 + 17.0) - 1.0) / 255.0;
      gl_FragColor = vec4(s, 1.0);
    }`,
};

/** Hue of a colour at luminance 1, its channels kept within 0.5..1.8 (a near-grey colour gives near 1). */
function hueOf(c: THREE.Color): THREE.Vector3 {
  const l = Math.max(1e-3, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  return new THREE.Vector3(c.r / l, c.g / l, c.b / l).clampScalar(0.5, 1.8);
}
/** A tint leaning `amount` of the way towards `hue`, at luminance 1. */
function tint(hue: THREE.Vector3, amount: number): THREE.Vector3 {
  const v = new THREE.Vector3(1, 1, 1).lerp(hue, amount);
  return v.divideScalar(v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722);
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private shots: ShotPass;
  private warmTarget: THREE.WebGLRenderTarget | null = null;
  private echo: EchoPass;
  private wordsOver: WordsPass;
  private memory: MemoryPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private finish: ShaderPass;
  private look: LookPass;
  /** Scales every frame's fx.film (the dev harness's ?film=0 shows the MV without the finish). */
  filmScale = 1;
  /** Scales the lens (depth of field, motion blur; the dev harness's ?lens=0). */
  get lensScale(): number { return this.shots.lensScale; }
  set lensScale(v: number) { this.shots.lensScale = v; }
  private halation = 0;
  width = 1;
  height = 1;

  constructor(readonly container: HTMLElement, pixelRatio = Math.min(window.devicePixelRatio || 1, 2)) {
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    setAnisotropy(renderer.capabilities.getMaxAnisotropy());

    // (Single-sampled, no depth: the plates are drawn with MSAA and depth in ShotPass's own buffers; every pass here is
    // full-screen. With 4× MSAA each pass also paid a resolve of colour and depth, and the pair took ~220 MB at 1080p.)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, target);
    this.shots = new ShotPass();
    this.memory = new MemoryPass();
    this.echo = new EchoPass();
    this.echo.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tMemory.value = this.memory.rt.texture;
    this.composer.addPass(this.shots);
    this.composer.addPass(this.memory);
    this.composer.addPass(this.echo);
    // (The words over the trails, under the glow: they still bloom, but don't smear.)
    this.wordsOver = new WordsPass(this.shots.words.texture);
    this.wordsOver.enabled = false;
    this.composer.addPass(this.wordsOver);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.finish = new ShaderPass(FinishShader);
    // Halation (part of the finish, drawn in the grade): the bloom's first, tightest blur of the lights above its
    // threshold; resized in place, so bound once.
    this.grade.uniforms.tHalo.value = this.bloom.renderTargetsVertical[0].texture;
    this.composer.addPass(this.finish);
    this.look = new LookPass();
    this.look.enabled = false;
    this.composer.addPass(this.look);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get aspect(): number { return this.width / this.height; }

  /** Palette colours the post chain uses (fade-to ink, duotone ramp). */
  setPalette(ink: THREE.Color, signal: THREE.Color): void {
    (this.grade.uniforms.uInk.value as THREE.Color).copy(ink);
    (this.grade.uniforms.uSignal.value as THREE.Color).copy(signal);
    // (Display colours for the impact frame, drawn after the tone mapping; the letterbox in the ink.)
    const d = (c: THREE.Color) => { const s = c.clone().convertLinearToSRGB(); return new THREE.Vector3(s.r, s.g, s.b); };
    (this.finish.uniforms.uInkD.value as THREE.Vector3).copy(d(ink));
    (this.finish.uniforms.uSignalD.value as THREE.Vector3).copy(d(signal));
    this.shots.setInk(ink);
  }

  /**
   * The style's finish for this song: shadows lean to the cover's ink and second colour, highlights to its paper
   * and a little of its signal colour (a grey cover gives no tint, only the contrast).
   */
  setFinish(palette: Palette, finish: Finish): void {
    this.halation = finish.halation;
    this.shots.shutter = finish.shutter;
    const u = this.finish.uniforms;
    const dark = hueOf(palette.ink).add(hueOf(palette.accent)).multiplyScalar(0.5);
    const light = hueOf(palette.paper).multiplyScalar(0.7).add(hueOf(palette.signal).multiplyScalar(0.3));
    (u.uShadow.value as THREE.Vector3).copy(tint(dark, 0.2 * finish.tone));
    (u.uHigh.value as THREE.Vector3).copy(tint(light, 0.15 * finish.tone));
    u.uContrast.value = finish.contrast;
    u.uLens.value = finish.lens;
    u.uGrainScale.value = finish.grain;
    u.uSharpen.value = finish.sharpen;
  }

  /** Per song: the riso inks for its palette, the glyphs from its lyrics. */
  setLooks(palette: Palette, lyricText: string): void { this.look.setSong(palette, lyricText); }

  /** setLooks in steps (the glyphs measured between yields). */
  settingLooks(palette: Palette, lyricText: string): Generator<void, void> { return this.look.settingSong(palette, lyricText); }

  /** The cover, for transitions that wipe through its shapes. */
  setCover(cover: THREE.Texture | null): void { this.shots.setCover(cover); }

  /**
   * Draws a scene once off screen with every object in it shown, so its shaders are compiled and its buffers and
   * textures uploaded before it is first cut to (otherwise that cut stalls for 20–100 ms, longer in NetEase's
   * Chromium). With no scene, warms the transition quad.
   */
  warm(scene?: THREE.Object3D, camera?: THREE.Camera): void {
    const r = this.renderer, prev = r.getRenderTarget();
    const target = this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 4 });
    if (scene && camera) {
      const hidden: THREE.Object3D[] = [];
      // (A program's first use reads its info log and uniforms, waiting until the GPU is done with what came before:
      // done for all of the scene's compiled programs first, before its draws give the GPU work — a texture to upload,
      // a variant of a shader to compile — that the next first use would wait behind, up to 80 ms.)
      scene.traverse(o => {
        if (!o.visible) { hidden.push(o); o.visible = true; }
        const m = (o as THREE.Mesh).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) {
          if (r.properties.has(x)) (r.properties.get(x) as { currentProgram?: THREE.WebGLProgram }).currentProgram?.getUniforms();
        }
      });
      r.setRenderTarget(target);
      r.render(scene, camera);
      for (const o of hidden) o.visible = false;
    } else {
      this.shots.warm(r, target);
      this.look.warm(r, target);
    }
    r.setRenderTarget(prev);
  }

  /**
   * Resolves after a `pause` once the GPU has done what it was given so far (a WebGL2 fence, looked at between pauses;
   * at most a second). Whatever next waits on it on the page's thread (a program's first use reads its info log, a
   * read-back) then finds it idle instead of holding the page up meanwhile.
   */
  async idle(pause: () => Promise<void>): Promise<void> {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const fence = gl.isContextLost() || this.fenceTimeouts >= 3 ? null : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const t0 = performance.now();
    try {
      do await pause();
      while (fence && !gl.isContextLost() && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - t0 < 1000);
      // (A browser whose fences never seem to signal: after a few of those, just the pause.)
      if (fence && performance.now() - t0 >= 1000) this.fenceTimeouts++;
    } finally {
      if (fence) gl.deleteSync(fence);
    }
  }
  private fenceTimeouts = 0;

  /**
   * Starts compiling a scene's shaders (hidden objects too) and resolves when they are ready, so warm() then only
   * uploads. With KHR_parallel_shader_compile the GPU process compiles them on its own threads: every plate at once,
   * the page free meanwhile. (Compiled in line on the first draw instead, one plate after another, the D3D compiler
   * behind Chromium took about five seconds for a song's plates.)
   */
  compile(scene: THREE.Object3D, camera: THREE.Camera, offscreen: readonly THREE.Object3D[] = []): Promise<unknown> {
    // (Set to an off-screen target like the one the plates are drawn into: the programs depend on it.)
    return this.compileFor(this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 4 }), [scene, ...offscreen], camera);
  }

  /**
   * Compiles the post chain's materials like compile(), for both an off-screen target and the screen (the last pass
   * draws to it, and a program differs by its target), so the MV's first frame doesn't compile them in line.
   */
  compilePost(): Promise<unknown> {
    const mats = new Set<THREE.Material>();
    const take = (v: unknown) => { if (v instanceof THREE.Material) mats.add(v); else if (Array.isArray(v)) v.forEach(take); };
    for (const pass of [...this.composer.passes, this.look]) for (const v of Object.values(pass)) take(v);
    const quads = [...mats].map(passMesh);
    return Promise.all([this.compileFor(this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 4 }), quads, PASS_CAMERA), this.compileFor(null, quads, PASS_CAMERA)]);
  }

  private compileFor(target: THREE.WebGLRenderTarget | null, objects: readonly THREE.Object3D[], camera: THREE.Camera): Promise<unknown> {
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target);
    const ready = Promise.all(objects.map(o => r.compileAsync(o, camera)));
    r.setRenderTarget(prev);
    return ready;
  }

  /**
   * The quality setting, applied live. The post chain's buffers keep the ratio they were created with unless told
   * (EffectComposer reads it once), so both change together; call resize() after.
   */
  setPixelRatio(pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
    (this.finish.uniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
    this.finish.uniforms.uPixelRatio.value = pr;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, fx: Fx, t: number, transition: Transition | null = null, overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null): void {
    this.shots.scene = scene;
    this.shots.camera = camera;
    this.shots.transition = transition;
    this.shots.overlay = overlay;
    this.shots.time = t;
    this.shots.shotKey = fx.cut;
    this.shots.lensFx.aperture = fx.aperture;
    this.shots.lensFx.motion = fx.motion;
    this.shots.lensFx.focus = fx.focus;
    this.shots.lensFx.travel = fx.travel;
    const echoOn = fx.echo > 0.01;
    if (echoOn && !this.echo.enabled) this.echo.reset();
    this.echo.enabled = echoOn;
    this.echo.decay = fx.echo;
    // Scenes set their glow on one scale; it is drawn at 0.6 of that, with a tighter halo, and the white flash at
    // 1× instead of 1.6× (the user, 2026-10-01: “闪光/辉光效果还是太强了，减小”).
    this.bloom.strength = fx.bloom * 0.6;
    const u = this.grade.uniforms;
    u.uTime.value = t;
    u.uCA.value = fx.ca;
    u.uFlash.value = fx.flash;
    u.uFade.value = fx.fade;
    u.uGrain.value = fx.grain;
    u.uVignette.value = fx.vignette;
    u.uGlitch.value = fx.glitch;
    u.uZoom.value = fx.zoom;
    u.uBarrel.value = fx.barrel;
    u.uDuotone.value = fx.duotone;
    u.uInvert.value = fx.invert;
    u.uMirror.value = fx.mirror;
    (u.uSmear.value as THREE.Vector2).set(fx.smearX, fx.smearY);
    u.uPixel.value = fx.pixel;
    u.uScan.value = fx.scan;
    u.uExposure.value = fx.exposure;
    if (fx.remember) this.memory.armed = true;
    u.uMemory.value = fx.memory;
    const film = Math.min(1, Math.max(0, fx.film * this.filmScale));
    u.uFilm.value = film;
    const f = this.finish.uniforms;
    f.uTime.value = t;
    f.uFilm.value = film;
    f.uGrain.value = fx.grain;
    f.uImpact.value = fx.impact;
    f.uImpactInvert.value = fx.impactInvert;
    this.shots.letterbox = fx.letterbox;
    // (Halation follows the glow a plate asks for: a light cover shown whole, with its glow cut, keeps its paper clean.)
    u.uHalation.value = this.halation * film * Math.min(1.25, fx.bloom / 0.4);
    const looking = fx.riso + fx.hibit + fx.ascii + fx.crt + fx.vhs > 0.001;
    this.look.enabled = looking;
    const lookSplit = looking && (fx.ascii > 0.001 || fx.riso > 0.001 || fx.hibit > 0.001);
    // Under light trails the words are drawn apart too and laid back over after the trails (WordsPass).
    this.shots.split = lookSplit || echoOn;
    this.wordsOver.enabled = echoOn && !lookSplit;
    if (looking) this.look.set(fx, t, lookSplit ? this.shots.words.texture : null);
    this.composer.render();
  }
}
