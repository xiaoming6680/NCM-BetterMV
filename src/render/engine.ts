// Renderer + post chain: shots (one, or two joined by a transition, plus the motion-graphics overlay) → memory (a frame
// kept for flashbacks) → echo trails → bloom → grade (mirror, pixelate, glitch, barrel, zoom blur, smear, chromatic
// aberration, exposure, duotone, invert, flashback, vignette, scanlines, grain, fade, flash) → output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setAnisotropy } from './text.ts';
import { EchoPass, MemoryPass, ShotPass, type Transition } from './shots.ts';

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
}

export const defaultFx = (): Fx => ({
  bloom: 0.35, ca: 0, flash: 0, fade: 0, grain: 0.04, vignette: 0.5, glitch: 0, zoom: 0, barrel: 0,
  echo: 0, duotone: 0, invert: 0, mirror: 0, smearX: 0, smearY: 0, pixel: 0, scan: 0, exposure: 1,
  remember: false, memory: 0,
});

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
    uniform sampler2D tDiffuse, tMemory;
    uniform float uTime, uCA, uFlash, uFade, uGrain, uVignette, uAspect, uGlitch, uZoom, uBarrel;
    uniform float uDuotone, uInvert, uMirror, uPixel, uScan, uExposure, uMemory;
    uniform vec2 uSmear, uResolution;
    uniform vec3 uInk, uSignal;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    vec3 split(vec2 uv, vec2 off) {
      return vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
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
        vec3 m = texture2D(tMemory, vUv).rgb * uExposure;
        float l = clamp(dot(m, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
        vec3 mem = mix(mix(uInk, uSignal, smoothstep(0.0, 0.45, l)), mix(uSignal, vec3(1.0), 0.4), smoothstep(0.45, 1.0, l));
        col = mix(col, max(col, mem), uMemory);
      }
      float r = length(c * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
      col *= mix(1.0, smoothstep(1.25, 0.2, r), uVignette);
      if (uScan > 0.001) col *= 1.0 - uScan * 0.4 * (0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.4));
      col += (hash(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5) * uGrain;
      col = mix(col, uInk, uFade);
      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private shots: ShotPass;
  private warmTarget: THREE.WebGLRenderTarget | null = null;
  private echo: EchoPass;
  private memory: MemoryPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
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

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
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
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get aspect(): number { return this.width / this.height; }

  /** Palette colours the post chain uses (fade-to ink, duotone ramp). */
  setPalette(ink: THREE.Color, signal: THREE.Color): void {
    (this.grade.uniforms.uInk.value as THREE.Color).copy(ink);
    (this.grade.uniforms.uSignal.value as THREE.Color).copy(signal);
  }

  /** The cover, for transitions that wipe through its shapes. */
  setCover(cover: THREE.Texture | null): void { this.shots.setCover(cover); }

  /**
   * Draws a scene once off screen with every object in it shown, so its shaders are compiled and its buffers and
   * textures uploaded before it is first cut to (otherwise that cut stalls for 20–100 ms, longer in NetEase's
   * Chromium). With no scene, warms the transition quad.
   */
  warm(scene?: THREE.Object3D, camera?: THREE.Camera): void {
    const r = this.renderer, prev = r.getRenderTarget();
    this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 4 });
    if (scene && camera) {
      const hidden: THREE.Object3D[] = [];
      scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      r.setRenderTarget(this.warmTarget);
      r.render(scene, camera);
      for (const o of hidden) o.visible = false;
    } else this.shots.warm(r, this.warmTarget);
    r.setRenderTarget(prev);
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
  }

  render(scene: THREE.Scene, camera: THREE.Camera, fx: Fx, t: number, transition: Transition | null = null, overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null): void {
    this.shots.scene = scene;
    this.shots.camera = camera;
    this.shots.transition = transition;
    this.shots.overlay = overlay;
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
    this.composer.render();
  }
}
