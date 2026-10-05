// The first pass of the post chain: the shot on screen — or, across a cut, the outgoing and the incoming shot rendered
// live side by side and joined by a transition — then the motion-graphics overlay on top. Plus the echo pass (light
// trails from feedback of the previous frame).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Ways from one shot to the next. */
export const TransitionKind = {
  /** The new shot grows out of a circle. */
  iris: 1,
  /** …out of a triangle, apex up (the user's △ motif). */
  triangle: 2,
  /** Horizontal bars slide in one after another. */
  slices: 3,
  /** A straight edge sweeps across at an angle, a hairline on its front. */
  wipe: 4,
  /** The new shot shows through the cover's own light-to-dark shapes. */
  matte: 5,
  /**
   * Push-through: the lens flies on into the old shot's centre and out into the new one, which keeps growing
   * towards us as it settles; radial blur with the speed, fastest on the cut.
   */
  zoom: 6,
  /** Whip: the two shots side by side on one strip, flung across the frame in one direction, blurred with speed. */
  whip: 7,
  /** A grid of blocks flips over at random. */
  blocks: 8,
  /** Red, green and blue cross over one after another. */
  chroma: 9,
  /** Vertical slats (a blind) open onto the new shot. */
  blinds: 10,
  /** The new shot seeps in like ink into rice paper, from a blot along a ragged, feathered front with a dark wet rim. */
  ink: 11,
  /** Spin: the old shot turns away and the new one turns in the same way, round the centre, with rotational blur. */
  spin: 12,
} as const;
/** Transitions that carry motion through the cut: they start before it and move fastest on it. */
export const THROUGH_CUT: ReadonlySet<number> = new Set([TransitionKind.zoom, TransitionKind.whip, TransitionKind.spin]);
export type TransitionKind = (typeof TransitionKind)[keyof typeof TransitionKind];

export interface Transition {
  /** The outgoing shot, still moving. */
  from: { scene: THREE.Scene; camera: THREE.Camera };
  kind: TransitionKind;
  /** 0..1 through the transition (the cut itself at 0.5 for the ones that carry motion through it). */
  progress: number;
  /** Where shapes grow from, in uv. */
  center: [number, number];
  /** Wipe angle (rad) for `wipe`, direction (rad) for `whip`, turn direction (sign) for `spin`. */
  angle: number;
  /** How far the motion goes: 1 = the full pulse push / spin, less for soft styles. */
  amount: number;
  /** Which side's lyrics to hide: the outgoing shot's after the cut, the incoming one's before it. */
  hide: 'from' | 'to';
  /** Hairline colour on the moving edge. */
  edge: THREE.Color;
  seed: number;
}

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tA, tB, tCover;
  uniform float uP, uKind, uAspect, uSeed, uAngle, uAmt;
  uniform vec2 uCenter;
  uniform vec3 uEdge;
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
  // Mirrored edges: a frame pulled smaller or turned shows its own reflection past its borders, not black.
  // The reflection is darkened, so the frame itself reads as a window rushing in rather than a tiled wallpaper.
  vec2 mirror(vec2 uv) { vec2 m = mod(uv, 2.0); return mix(m, 2.0 - m, step(1.0, m)); }
  float past(vec2 uv) { vec2 o = max(-uv, uv - 1.0); return 1.0 - 0.65 * smoothstep(0.0, 0.12, max(o.x, o.y)); }
  vec3 texA(vec2 uv) { return texture2D(tA, mirror(uv)).rgb * past(uv); }
  vec3 texB(vec2 uv) { return texture2D(tB, mirror(uv)).rgb * past(uv); }
  // Scale (and turn) a uv about the centre in screen-shaped space.
  vec2 about(vec2 uv, vec2 c, float scale, float turn) {
    vec2 d = (uv - c) * vec2(uAspect, 1.0) / scale;
    float cs = cos(turn), sn = sin(turn);
    d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    return c + d / vec2(uAspect, 1.0);
  }
  float outQuad(float x) { return 1.0 - (1.0 - x) * (1.0 - x); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
  float inOut(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
  // Signed distance to an equilateral triangle of circumradius r, apex up.
  float sdTri(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r * 0.8660254; p.y = p.y + r * 0.5;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r * 0.8660254, 0.0);
    return -length(p) * sign(p.y);
  }
  // A band of light on a moving edge at signed distance d (in screen heights), fading as the transition ends.
  float edgeAt(float d, float p) { return exp(-pow(d * 90.0, 2.0)) * (1.0 - smoothstep(0.7, 1.0, p)); }
  void main() {
    vec2 uv = vUv;
    float p = clamp(uP, 0.0, 1.0);
    int k = int(uKind + 0.5);
    vec2 q = (uv - uCenter) * vec2(uAspect, 1.0);
    vec3 a = texture2D(tA, uv).rgb, b = texture2D(tB, uv).rgb;
    float m = 0.0, e = 0.0;
    float reach = length(vec2(max(uCenter.x, 1.0 - uCenter.x) * uAspect, max(uCenter.y, 1.0 - uCenter.y)));
    // The shape reveals and the cover matte move too: the old shot keeps pushing in, the new one settles from a
    // little closer — the cut reads as one move forward, not a swap.
    if (k == 1 || k == 2 || k == 5) {
      float s = inOut(p);
      a = texA(about(uv, uCenter, 1.0 + 0.18 * uAmt * s, 0.0));
      b = texB(about(uv, uCenter, 1.0 + 0.12 * uAmt * (1.0 - s), 0.0));
    }
    if (k == 1) {
      float r = outQuad(p) * reach * 1.02, d = length(q) - r;
      m = step(d, 0.0); e = edgeAt(d, p);
    } else if (k == 2) {
      float r = outQuad(p) * reach * 2.05, d = sdTri(q, r);
      m = step(d, 0.0); e = edgeAt(d, p);
    } else if (k == 3) {
      float n = 7.0, i = floor(uv.y * n);
      float lag = hash(vec2(i, uSeed)) * 0.45;
      float s = inOut(clamp((p - lag) / 0.55, 0.0, 1.0));
      float x = mod(i, 2.0) < 1.0 ? uv.x : 1.0 - uv.x;
      m = step(x, s); e = edgeAt((x - s) / uAspect, p);
    } else if (k == 4) {
      vec2 dir = vec2(cos(uAngle), sin(uAngle));
      float span = abs(dir.x) * uAspect + abs(dir.y);
      float d = dot(q, dir) / span + 0.5 - inOut(p) * 1.04 + 0.02;
      m = step(d, 0.0); e = edgeAt(d, p);
    } else if (k == 5) {
      float l = dot(texture2D(tCover, (uv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0) + 0.5).rgb, vec3(0.2126, 0.7152, 0.0722));
      float th = p * 1.2 - 0.1;
      m = smoothstep(th + 0.04, th - 0.04, l); e = exp(-pow((l - th) * 22.0, 2.0)) * (1.0 - smoothstep(0.7, 1.0, p)) * 0.8;
    } else if (k == 6 || k == 12) {
      // One continuous move through the cut (p = 0.5): the old shot flies (or turns) away, the new one arrives
      // already moving the same way and eases to rest. Speed, and so the blur, peak on the cut.
      float s = inOut(p), vel = pow(sin(p * 3.14159), 2.0);
      float z = k == 6 ? 1.0 + 0.6 * uAmt : 1.0 + 0.25 * uAmt;
      float turn = k == 12 ? (uAngle < 0.0 ? -1.0 : 1.0) * 1.2 * uAmt : 0.0;
      // Across the whole move the picture grows by z² (turns by 2·turn): the old shot takes the first half, the
      // new one the second. The spin also pushes in a little so its corners stay filled.
      float punch = k == 12 ? 1.0 + 0.3 * sin(p * 3.14159) * uAmt : 1.0;
      float sa = pow(z, 2.0 * s) * punch, sb = pow(z, 2.0 * s - 2.0) * punch;
      float ta = turn * 2.0 * s, tb = turn * (2.0 * s - 2.0);
      vec3 accA = vec3(0.0), accB = vec3(0.0);
      for (int j = 0; j < 12; j++) {
        float f = float(j) / 11.0;
        // Radial smear for the push, arc smear for the spin, both trailing the motion.
        float ds = k == 6 ? 1.0 - 0.22 * vel * f * uAmt : 1.0;
        float dt = k == 12 ? -0.35 * vel * f * sign(turn) * uAmt : 0.0;
        accA += texA(about(uv, uCenter, sa * ds, ta + dt));
        accB += texB(about(uv, uCenter, sb * ds, tb + dt));
      }
      a = accA / 12.0; b = accB / 12.0;
      m = smoothstep(0.42, 0.58, p);
      gl_FragColor = vec4(mix(a, b, m) * (1.0 + 0.18 * vel * uAmt), 1.0);
      return;
    } else if (k == 7) {
      // Both shots on one strip, the new one a screen behind the old along the direction of travel.
      float s = inOut(p), vel = pow(sin(p * 3.14159), 2.0);
      vec2 dir = vec2(cos(uAngle), sin(uAngle));
      dir = abs(dir.x) > abs(dir.y) ? vec2(sign(dir.x), 0.0) : vec2(0.0, sign(dir.y));
      vec3 acc = vec3(0.0);
      for (int j = 0; j < 12; j++) {
        vec2 w = uv + dir * (s - (float(j) / 11.0) * 0.16 * vel * uAmt);
        float onA = step(0.0, w.x) * step(w.x, 1.0) * step(0.0, w.y) * step(w.y, 1.0);
        acc += mix(texture2D(tB, w - dir).rgb, texture2D(tA, clamp(w, 0.0, 1.0)).rgb, onA);
      }
      gl_FragColor = vec4(acc / 12.0 * (1.0 + 0.12 * vel * uAmt), 1.0);
      return;
    } else if (k == 8) {
      vec2 grid = vec2(floor(12.0 * uAspect), 12.0);
      vec2 cell = floor(uv * grid), f = fract(uv * grid);
      float r = hash(cell + uSeed * 0.13);
      m = step(r, p * 1.1 - 0.05);
      float border = step(min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)), 0.04);
      e = border * step(abs(r - p), 0.12) * 0.7;
    } else if (k == 9) {
      vec3 w = vec3(smoothstep(0.0, 0.6, p), smoothstep(0.2, 0.8, p), smoothstep(0.4, 1.0, p));
      vec2 off = vec2(0.012 * sin(p * 3.14159), 0.0);
      a = vec3(texture2D(tA, uv + off).r, texture2D(tA, uv).g, texture2D(tA, uv - off).b);
      b = vec3(texture2D(tB, uv - off).r, texture2D(tB, uv).g, texture2D(tB, uv + off).b);
      gl_FragColor = vec4(mix(a, b, w), 1.0);
      return;
    } else if (k == 10) {
      float n = floor(10.0 * uAspect), i = floor(uv.x * n), f = fract(uv.x * n);
      float s = inOut(clamp((p - i / n * 0.35) / 0.65, 0.0, 1.0));
      m = step(abs(f - 0.5) * 2.0, s); e = edgeAt((abs(f - 0.5) * 2.0 - s) / n * uAspect, p) * 0.6;
    } else if (k == 11) {
      vec2 o = vec2(uSeed * 0.731, uSeed * 0.379);
      float d = length(q) * 0.8 + (fbm(q * 2.6 + o) - 0.5) * 0.7 + (fbm(q * 16.0 - o) - 0.5) * 0.08;
      float r = inOut(p) * (reach * 0.8 + 0.5) - 0.08;
      m = smoothstep(r + 0.015, r - 0.05, d);
      float rim = exp(-pow((d - r) * 16.0, 2.0)) * (1.0 - smoothstep(0.55, 1.0, p));
      gl_FragColor = vec4(mix(a, b, m) * (1.0 - rim * 0.55), 1.0);
      return;
    } else {
      m = step(0.5, p);
    }
    gl_FragColor = vec4(mix(a, b, m) + uEdge * e * 2.2, 1.0);
  }`;

/** Objects flagged `userData.lyrics` (lyric rigs, banners, poster lines) are hidden in an outgoing shot. */
function withoutLyrics(scene: THREE.Scene, draw: () => void): void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse(o => { if (o.userData.lyrics && o.visible) { o.visible = false; hidden.push(o); } });
  draw();
  for (const o of hidden) o.visible = true;
}

export class ShotPass extends Pass {
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.Camera = new THREE.PerspectiveCamera();
  transition: Transition | null = null;
  overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private material: THREE.ShaderMaterial;

  constructor(cover?: THREE.Texture) {
    super();
    this.needsSwap = false;
    const opts = { type: THREE.HalfFloatType, samples: 4 };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        tA: { value: this.rtA.texture }, tB: { value: this.rtB.texture }, tCover: { value: cover ?? null },
        uP: { value: 0 }, uKind: { value: 0 }, uAspect: { value: 16 / 9 }, uSeed: { value: 0 }, uAngle: { value: 0 }, uAmt: { value: 1 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uEdge: { value: new THREE.Color() },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setCover(cover: THREE.Texture | null): void { this.material.uniforms.tCover.value = cover; }

  /** Draws the transition quad once into `target`, so the first cut doesn't stall on compiling it. */
  warm(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    this.rtA.setSize(width, height);
    this.rtB.setSize(width, height);
    this.material.uniforms.uAspect.value = width / Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const target = this.renderToScreen ? null : read;
    const tr = this.transition;
    if (!tr) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    } else {
      const drawA = () => { renderer.setRenderTarget(this.rtA); renderer.clear(); renderer.render(tr.from.scene, tr.from.camera); };
      const drawB = () => { renderer.setRenderTarget(this.rtB); renderer.clear(); renderer.render(this.scene, this.camera); };
      if (tr.hide === 'from') { withoutLyrics(tr.from.scene, drawA); drawB(); }
      else { drawA(); withoutLyrics(this.scene, drawB); }
      const u = this.material.uniforms;
      u.uP.value = tr.progress;
      u.uKind.value = tr.kind;
      u.uSeed.value = tr.seed % 997;
      u.uAngle.value = tr.angle;
      u.uAmt.value = tr.amount;
      u.uCenter.value.set(tr.center[0], tr.center[1]);
      u.uEdge.value.copy(tr.edge);
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    }
    if (this.overlay) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.render(this.overlay.scene, this.overlay.camera);
      renderer.autoClear = auto;
    }
  }

  override dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const echoShader = /* glsl */ `
  uniform sampler2D tNew, tOld;
  uniform float uDecay, uDrift;
  varying vec2 vUv;
  void main() {
    vec3 now = texture2D(tNew, vUv).rgb;
    // The old frame drifts outward a touch each frame, so trails stream away from the centre.
    vec3 old = texture2D(tOld, (vUv - 0.5) * (1.0 - uDrift) + 0.5).rgb * uDecay;
    gl_FragColor = vec4(max(now, old), 1.0);
  }`;

/**
 * Light trails: each frame keeps the brighter of itself and the last frame faded. The engine disables the pass when
 * there are no trails (so it costs nothing) and calls reset() when it comes back, so no stale frame flashes up.
 */
export class EchoPass extends Pass {
  decay = 0;
  drift = 0.004;
  private rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private quad: FullScreenQuad;
  private material: THREE.ShaderMaterial;
  private copy: FullScreenQuad;
  private fresh = true;

  reset(): void { this.fresh = true; }

  constructor() {
    super();
    const opts = { type: THREE.HalfFloatType };
    this.rt = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader: echoShader, depthTest: false, depthWrite: false,
      uniforms: { tNew: { value: null }, tOld: { value: null }, uDecay: { value: 0 }, uDrift: { value: 0 } },
    });
    this.quad = new FullScreenQuad(this.material);
    this.copy = new FullScreenQuad(new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
  }

  override setSize(width: number, height: number): void {
    for (const r of this.rt) r.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const [cur, old] = this.rt;
    if (this.fresh) {
      renderer.setRenderTarget(old);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      this.fresh = false;
    }
    const u = this.material.uniforms;
    u.tNew.value = read.texture;
    u.tOld.value = old.texture;
    u.uDecay.value = this.decay;
    u.uDrift.value = this.drift;
    renderer.setRenderTarget(cur);
    this.quad.render(renderer);
    (this.copy.material as THREE.MeshBasicMaterial).map = cur.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.copy.render(renderer);
    this.rt = [old, cur];
  }

  override dispose(): void {
    for (const r of this.rt) r.dispose();
    this.material.dispose();
    this.quad.dispose();
    this.copy.dispose();
  }
}

/**
 * Keeps one frame for a flashback: when armed, copies the shot as drawn (before trails, glow and grade) aside, and
 * passes the picture on untouched. The grade lays it back over later frames (Fx.memory).
 */
export class MemoryPass extends Pass {
  armed = false;
  readonly rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private copy = new FullScreenQuad(new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));

  constructor() {
    super();
    this.needsSwap = false;
  }

  override setSize(width: number, height: number): void { this.rt.setSize(width, height); }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    if (!this.armed) return;
    this.armed = false;
    (this.copy.material as THREE.MeshBasicMaterial).map = read.texture;
    renderer.setRenderTarget(this.rt);
    this.copy.render(renderer);
  }

  override dispose(): void {
    this.rt.dispose();
    this.copy.dispose();
  }
}
