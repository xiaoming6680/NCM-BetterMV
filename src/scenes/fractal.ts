// The fractal plates' shared machinery: flying through a mathematical fractal, marched per pixel at a share of the
// canvas and drawn as the plate's backdrop, with the words as signs ahead on the flight line.
// What every fractal plate shares, besides the march: scale and speed.
// - Scale: the fractal is built at many sizes at once, so the halls ahead are hundreds of times the size of the detail
//   streaming past the lens; haze in the cover's colours (aerial perspective) puts the far structures miles away, and a
//   light at the end of the line draws the eye down it.
// - Speed: how fast the camera flies is the music's. Calm sections drift, builds accelerate the whole way through,
//   a chorus cruises fast and a drop goes flat out; in the pulse look every kick is a surge forward. The speed is
//   integrated once over the whole song (a table), so any time has its distance and cuts keep the travel; it widens
//   the lens and streaks the frame (zoom blur) at the top end.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, rng, smooth } from './types.ts';
import { LyricBlocks, Stands, voiceFor } from './lyricBlock.ts';
import { passMesh } from '../render/engine.ts';
import type { Music } from '../director/music.ts';
import type { Section } from '../types.ts';

/** GLSL for a colour (a constant). */
export const v3 = (c: THREE.Color, k = 1) => `vec3(${(c.r * k).toFixed(5)},${(c.g * k).toFixed(5)},${(c.b * k).toFixed(5)})`;
/** A light's colour: the hue of c at full strength. */
export const hue = (c: THREE.Color) => { const m = Math.max(c.r, c.g, c.b, 1e-4); return c.clone().multiplyScalar(1 / m); };

const BANDS = 4;
const RATE = 60;

export interface FractalOptions {
  /**
   * GLSL defining `float DE(vec3 p)` (the fractal's distance; it may set the global `vec4 gTrap`, an orbit trap),
   * `vec3 shade(vec3 p, vec3 n, vec3 rd, float t, float ao)` (the lit surface, before haze) and
   * `vec3 haze(vec3 rd)` (the air's colour looking along rd). Uniforms it may read: uT, uKick, uFold (vec4, the
   * plate's own), uCam, uFwd; and `float bands(vec3 p)`, the kick bands of light running along the flight line.
   */
  glsl: string;
  /** The flight line: x and y sway (world units) and how fast it winds (radians per unit of z). */
  path: { ax: number; ay: number; f: number; x0?: number; y0?: number };
  /** Carve a tube of this radius round the flight line out of the fractal (0: the line runs through free space). */
  tunnel: number;
  /** World units a second at cruising speed (scaled by the tempo). */
  cruise: number;
  /** Surface hit threshold per unit of distance (cone of a pixel), march steps, far clip, haze distance. */
  steps: number;
  far: number;
  fog: number;
  /** Hit threshold per unit of ray length. */
  eps?: number;
  /** Words: how far ahead the sign holds, its em and widest line. */
  sign: { ahead: number; em: number; maxW: number; lift: number };
  fov?: number;
  /** Kick bands down the line (default on; a plate that isn't a flight along z turns them off). */
  bands?: boolean;
  /**
   * A fisheye (stereographic) lens of this vertical field of view (degrees) instead of a flat one: walls bow round
   * the frame and far more of the space is in view at once. It widens further with the speed.
   */
  fisheye?: number;
  /**
   * Motes of dust in the air (a drilling route's: in cells of the current stretch's frame, crossfaded into the next
   * one's through the stretch, so they carry on across the join).
   */
  dust?: boolean;
  /**
   * The words ride with the camera, fading where they are, instead of being left behind to be flown through (a dive
   * drawn a stretch at a time: a sign left in one stretch's frame would jump when the next begins).
   */
  ride?: boolean;
}

/** How fast, relative to cruising, a section flies (pulse look; the ballad look is calmer). */
function sectionSpeed(s: Section, k: number, soft: boolean): number {
  const e = 0.75 + 0.5 * clamp01(s.energy ?? 0.5);
  let v: number;
  switch (s.label) {
    case 'intro': v = 0.55; break;
    case 'outro': v = 0.45; break;
    case 'break': case 'bridge': v = 0.5; break;
    // Builds accelerate the whole way, steeper at the end.
    case 'build': case 'pre': v = 0.8 + 1.6 * k * k; break;
    case 'chorus': v = 1.7; break;
    case 'drop': v = 2.6; break;
    default: v = 0.85;
  }
  if (soft) v = 0.45 + (v - 0.45) * 0.45;
  return v * e;
}

/**
 * The song's flight: speed (relative to cruising) and distance travelled, sampled 60 times a second. The speed is the
 * sections' alone, each easing into the next over about a second (a drop too): nothing on the beat (a surge on each
 * kick, or the loudness, which rises and falls with the drums, read as the picture jolting on every beat, and with
 * the turns of a drilling route, as sickness).
 */
export class Flight {
  readonly speed: Float32Array;
  readonly dist: Float64Array;

  constructor(music: Music, soft: boolean) {
    const n = Math.ceil((music.duration + 8) * RATE) + 2;
    this.speed = new Float32Array(n);
    this.dist = new Float64Array(n);
    const sections = music.a.sections;
    const tempo = clamp01(((music.a.bpm || 120) - 60) / 120) * 0.6 + 0.7;
    const target = (t: number) => {
      const s = sections[Math.min(sections.length - 1, music.sectionIndex(t))];
      return (s ? sectionSpeed(s, clamp01((t - s.start) / Math.max(1, s.end - s.start)), soft) : 0.6) * tempo;
    };
    let v = target(0), d = 0;
    for (let i = 0; i < n; i++) {
      v += (target(i / RATE) - v) * (1 - Math.exp(-1 / RATE / 0.6));
      this.speed[i] = v;
      this.dist[i] = d;
      d += v / RATE;
    }
  }

  private sample(arr: Float32Array | Float64Array, t: number): number {
    const x = Math.max(0, t * RATE), i = Math.min(arr.length - 2, Math.floor(x)), f = Math.min(1, x - i);
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  speedAt(t: number): number { return this.sample(this.speed, t); }
  /** Distance in cruising-seconds (multiply by the plate's cruise speed). */
  at(t: number): number { return this.sample(this.dist, t); }
}

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BACK_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BACK = /* glsl */ `
  uniform sampler2D tMarch;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(tMarch, vUv).rgb, 1.0); }`;

function marchShader(o: FractalOptions): string {
  const p = o.path;
  const f = (x: number) => x.toFixed(6);
  return /* glsl */ `
precision highp float;
uniform mat4 uInvVP;
uniform vec3 uCam, uFwd, uRight, uUp, uLight;
// A drilling route (drill.ts): the map from this stretch's frame to an ancestor's (xyz + w·p), the map from the
// next stretch's frame to this one's, and how far through the stretch the camera is.
uniform vec4 uOuter, uNext;
uniform float uPhase;
// The fisheye: tan of a quarter of its vertical field of view (0: the flat lens, uInvVP), and the frame's aspect.
uniform float uFish, uAspect;
uniform float uT, uKick, uPix;
// The scene's local scale (1 for a flight at one size; a dive into a self-similar fractal shrinks it with each level,
// so the haze and the far clip shrink with the structure and the loop has no seam).
uniform float uScale;
// 0 at run time, unknown to the compiler: keeps the normal's loop a loop (D3D inlines every call of DE otherwise).
uniform int uZero;
uniform vec4 uFold;
uniform vec4 uBand[${BANDS}];
varying vec2 vUv;
vec4 gTrap;

vec2 path(float z) {
  return vec2(${f(p.x0 ?? 0)} + ${f(p.ax)} * sin(z * ${f(p.f)}) + ${f(p.ax * 0.45)} * sin(z * ${f(p.f * 2.3)} + 1.0),
              ${f(p.y0 ?? 0)} + ${f(p.ay)} * sin(z * ${f(p.f * 0.71)} + 0.7));
}

/** The kick bands: rings of light running down the flight line (x: z, y: width, z: strength). */
float bands(vec3 p) {
  float b = 0.0;
  for (int i = 0; i < ${BANDS}; i++) {
    vec4 u = uBand[i];
    if (u.z <= 0.0) continue;
    float e = (p.z - u.x) / u.y;
    b += u.z * exp(-e * e);
  }
  return b;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

// (Declared ahead: a plate's shading may march the scene again, for shadows and occlusion.)
float map(vec3 p);

${o.glsl}
${o.dust ? `#ifndef GLOW_DUST
#define GLOW_DUST vec3(1.0, 0.85, 0.7)
#endif` : ''}

float map(vec3 p) {
  float d = DE(p);
  ${o.tunnel > 0 ? `d = max(d, ${f(o.tunnel)} - length(p.xy - path(p.z)));` : ''}
  return d;
}

/** The normal (tetrahedron of samples) and, last, the hit itself again so gTrap is the surface's. */
vec3 normalAt(vec3 p, float e) {
  vec3 n = vec3(0.0);
  for (int i = uZero; i < 5; i++) {
    vec3 k = i < 4 ? 0.5773 * (2.0 * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0) : vec3(0.0);
    float d = map(p + k * e);
    n += k * d;
  }
  return normalize(n);
}

void main() {
  vec3 ro = uCam, rd;
  if (uFish > 0.0) {
    // Stereographic: the distance from the centre is 2 tan(θ/2), scaled so the top edge is half the field of view.
    vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
    float r = length(q), th = 2.0 * atan(r * uFish);
    vec2 a = r > 1e-6 ? q / r : vec2(0.0);
    rd = normalize(uFwd * cos(th) + (uRight * a.x + uUp * a.y) * sin(th));
  } else {
    vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    rd = normalize(w.xyz / w.w - uCam);
  }
  float t = 0.0, d = 1.0;
  int i;
  float eps = ${f(o.eps ?? 0.0012)} * uPix;
  for (i = 0; i < ${o.steps}; i++) {
    d = map(ro + rd * t);
    if (d < eps * t || t > ${f(o.far)} * uScale) break;
    t += d * 0.9;
  }
  vec3 col;
  vec3 air = haze(rd);
  if (t < ${f(o.far)} * uScale) {
    // Settle onto the surface (the march stops anywhere inside its threshold, which grows with distance: shading
    // read off that shell bands flat walls into rings round the middle of the frame).
    for (int j = uZero; j < 3; j++) t += map(ro + rd * t);
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p, max(1e-5, eps * t * 0.5));
    float ao = 1.0 - float(i) / ${o.steps}.0;
    col = shade(p, n, rd, t, ao);
    col = mix(col, air, 1.0 - exp(-t / (${f(o.fog)} * uScale)));
  } else col = air;
  ${o.dust ? `
  // Dust: a mote or none in each cell of a few layers of space at growing distances, in the cells of this
  // stretch's frame fading out and the next one's (that much smaller) fading in, so they carry on across the join.
  for (int k = 0; k < 3; k++) {
    float dk = uScale * 0.06 * pow(2.4, float(k));
    if (dk > t) break;
    vec3 p = ro + rd * dk;
    for (int j = 0; j < 2; j++) {
      vec3 q = (j == 0 ? p : (p - uNext.xyz) / uNext.w) / (0.02 * pow(2.4, float(k)));
      vec3 c = floor(q), h = hash33(c + float(k) * 17.0);
      if (h.z > 0.35) continue;
      float m = smoothstep(0.16, 0.0, length(fract(q) - (0.25 + 0.5 * h)));
      col += mix(GLOW_DUST, vec3(1.0), h.x) * m * (0.2 + 0.3 * h.y) * (j == 0 ? 1.0 - uPhase : uPhase) * exp(-dk / (${f(o.fog)} * uScale));
    }
  }` : ''}
#ifdef LENS_EDGE
  // The lens's own colour towards the corners (a plate's grade: the frame darkens into its haze's hue).
  float er = length((vUv - 0.5) * vec2(uAspect, 1.0)) * 1.25;
  col = mix(col, LENS_EDGE * (0.3 + 0.7 * dot(col, vec3(0.3333))), smoothstep(0.35, 1.15, er) * 0.65);
#endif
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(8.0)), 1.0);
}`;
}

export interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion }

/**
 * A fractal plate: the march into a half-size target before each draw of the scene, the target drawn as the backdrop,
 * the camera on the flight line, kick bands, the words. Subclasses set the fractal (options) and its live
 * parameters (`tune`).
 */
export abstract class FractalPlate implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly offscreen: THREE.Object3D[];
  protected readonly soft: boolean;
  protected readonly flight: Flight;
  protected u: Record<string, THREE.IUniform>;
  private rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  private quad: FullScreenQuad;
  private invVP = new THREE.Matrix4();
  private scale = 0.6;
  private bandU = Array.from({ length: BANDS }, () => new THREE.Vector4());
  private bandT: Float64Array;
  private bandV: Float64Array;
  private blocks: LyricBlocks;
  private stands: Stands;
  private baseFov: number;

  constructor(protected init: SceneInit, look: 'pulse' | 'ballad', protected o: FractalOptions) {
    this.soft = look === 'ballad';
    this.baseFov = o.fov ?? 66;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.001, 1000);
    this.flight = new Flight(init.music, this.soft);
    this.scene.background = init.palette.ink.clone();
    this.u = {
      uInvVP: { value: this.invVP }, uCam: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: new THREE.Vector3() },
      uOuter: { value: new THREE.Vector4(0, 0, 0, 1) }, uNext: { value: new THREE.Vector4(0, 0, 0, 1) }, uPhase: { value: 0 },
      uFish: { value: 0 }, uAspect: { value: 16 / 9 },
      uT: { value: 0 }, uKick: { value: 0 }, uPix: { value: 1 }, uZero: { value: 0 }, uScale: { value: 1 }, uFold: { value: new THREE.Vector4() }, uBand: { value: this.bandU },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: marchShader(o), uniforms: this.u, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(mat);
    this.offscreen = [passMesh(mat)];
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: BACK_VERT, fragmentShader: BACK, uniforms: { tMarch: { value: this.rt.texture } }, depthTest: false, depthWrite: false,
    }));
    back.frustumCulled = false;
    back.renderOrder = -10;
    this.scene.add(back);
    this.scene.onBeforeRender = (renderer, _s, camera) => this.march(renderer, camera as THREE.PerspectiveCamera);

    // Bands of light: on the kicks of loud sections, on downbeats elsewhere (none in the ballad look's calm sections).
    const music = init.music, sections = music.a.sections;
    const loud = (t: number) => { const s = sections[music.sectionIndex(t)]; return !!s && (s.label === 'chorus' || s.label === 'drop'); };
    const ev: Array<[number, number]> = [];
    for (const d of Array.from(music.downbeats)) if (!loud(d) && !this.soft) ev.push([d, 0.45]);
    for (const [t, v] of music.a.hits.kick) if (loud(t) && v > 0.4) ev.push([t, this.soft ? 0.45 : 0.6 + 0.5 * v]);
    ev.sort((a, b) => a[0] - b[0]);
    const kept: Array<[number, number]> = [];
    for (const e of ev) if (!kept.length || e[0] - kept[kept.length - 1][0] > 0.2) kept.push(e);
    this.bandT = Float64Array.from(kept, e => e[0]);
    this.bandV = Float64Array.from(kept, e => e[1]);

    // The words: whole lines (lyricBlock.ts). A plate that rides its words (a dive whose world is re-scaled as it goes)
    // keeps them with the camera and lets them go without dust (it would jump with the world); the others leave them
    // standing on the line ahead. Lanes: the sign's lift, above and below by turns, in shares of the view at `ahead`.
    const vh = 2 * o.sign.ahead * Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2);
    this.stands = new Stands([[-0.1, (o.sign.lift + 0.9 * o.sign.em) / vh], [0.1, (o.sign.lift - 0.9 * o.sign.em) / vh]]);
    this.blocks = new LyricBlocks(init.palette, init.music, { voice: voiceFor(look, init.seed), em: o.sign.em, maxW: this.soft ? 11 : 13, trans: 0.48, dust: o.ride ? undefined : [0, 1.5, 0] });
    this.scene.add(this.blocks.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  /** The march's resolution: a share of the canvas. */
  setViewport(width: number, height: number, pixelRatio: number): void {
    this.scale = pixelRatio >= 1 ? 0.6 : 0.7;
    this.rt.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
    // The hit threshold is a pixel's cone: coarser targets stop sooner.
    this.u.uPix.value = 1080 / Math.max(200, height * this.scale);
  }

  private march(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld(true);
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    const pos = camera.getWorldPosition(new THREE.Vector3());
    (this.u.uCam.value as THREE.Vector3).copy(pos);
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    (this.u.uFwd.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(q);
    (this.u.uRight.value as THREE.Vector3).set(1, 0, 0).applyQuaternion(q);
    (this.u.uUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(q);
    this.u.uAspect.value = camera.aspect;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }

  /** The flight line's centre at z (the same curve as the shader's `path`). */
  protected path(z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.o.path;
    return out.set(
      (p.x0 ?? 0) + p.ax * Math.sin(z * p.f) + p.ax * 0.45 * Math.sin(z * p.f * 2.3 + 1.0),
      (p.y0 ?? 0) + p.ay * Math.sin(z * p.f * 0.71 + 0.7),
      z,
    );
  }

  /** z of the camera at time t (flying towards −z). */
  protected zAt(t: number): number { return -this.flight.at(t) * this.o.cruise * this.tempo; }
  private get tempo(): number { return clamp01(((this.init.music.a.bpm || 120) - 60) / 120) * 0.5 + 0.75; }

  /**
   * The camera for a shot at time t. On the line, looking down it (a little ahead on its curve) and banking into its
   * turns; variants: glide (straight down the line), look (turned towards one side, sweeping), roll (rolling slowly
   * round the line, faster with the speed), high (lifted off the line and looking down it — wider, more of the hall).
   */
  protected pose(t: number, shot: Shot, out: Pose): Pose {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const z = this.zAt(t);
    const c = this.path(z), ahead = this.path(z - this.o.sign.ahead * 1.5);
    const off = this.offset(shot.variant, t, side, phase);
    out.pos.copy(c).add(off);
    const m = new THREE.Matrix4().lookAt(out.pos, ahead.add(off.multiplyScalar(0.6)), new THREE.Vector3(0, 1, 0));
    out.quat.setFromRotationMatrix(m);
    // Bank into the turn (the line's sideways acceleration).
    const e = 0.5, x0 = this.path(z + e).x, x1 = this.path(z - e).x, curv = (x0 - 2 * c.x + x1) / (e * e);
    let roll = THREE.MathUtils.clamp(curv * this.o.cruise * 0.9, -0.5, 0.5);
    let yaw = 0, pitch = 0;
    if (shot.variant === 'look') yaw = side * (0.45 + 0.15 * Math.sin(t * 0.25 + phase));
    else if (shot.variant === 'roll') roll += side * this.flight.at(t) * 0.12;
    else if (shot.variant === 'high') pitch = -0.18;
    out.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')));
    return out;
  }

  /** The camera's offset from the line for a variant (world units). */
  protected offset(variant: string, t: number, side: number, phase: number): THREE.Vector3 {
    const r = this.o.tunnel > 0 ? this.o.tunnel : this.o.sign.ahead * 0.3;
    if (variant === 'high') return new THREE.Vector3(side * r * 0.25, r * 0.45, 0);
    return new THREE.Vector3(Math.sin(t * 0.31 + phase) * r * 0.15, Math.sin(t * 0.23 + phase * 2) * r * 0.1, 0);
  }

  /** The plate's live parameters for this frame (uFold, uKick, …). */
  protected abstract tune(ctx: FrameCtx): void;

  update(ctx: FrameCtx): void {
    const { t, shot } = ctx;
    const pose = this.pose(t, shot, { pos: this.camera.position, quat: this.camera.quaternion });
    void pose;
    this.camera.updateMatrixWorld();
    const sp = this.flight.speedAt(t);
    // Speed widens the lens (up to ~20° at full tilt).
    // (The lens stays as it is: widened with the speed it breathes, which in the turns of a drilling route sickens.)
    // The fisheye widens likewise (up to 30° more).
    this.u.uFish.value = this.o.fisheye ? Math.tan(THREE.MathUtils.degToRad(this.o.fisheye) / 4) : 0;
    this.u.uT.value = t;

    // Bands launched at the camera, running ahead down the line faster than it flies.
    let m = 0;
    const camZ = this.zAt(t);
    for (let i = this.o.bands === false ? -1 : lastLE(this.bandT, t); i >= 0 && m < BANDS; i--) {
      const age = t - this.bandT[i];
      if (age > 2.5) break;
      const z0 = this.zAt(this.bandT[i]);
      const run = this.o.sign.ahead * 2 + age * this.o.cruise * 9;
      this.bandU[m++].set(Math.min(z0, camZ) - run, this.o.sign.ahead * (0.25 + age * 0.6), this.bandV[i] * Math.exp(-age / 0.8) * smooth(age / 0.05), 0);
    }
    for (let i = m; i < BANDS; i++) this.bandU[i].set(0, 1, 0, 0);

    this.tune(ctx);

    // The words: each line one block on the line ahead (lyricBlock.ts): standing there for the camera to come up to,
    // or, on a plate that rides them, carried with the camera.
    const s = this.o.sign;
    const view = { reach: s.ahead, far: s.ahead * 1.9, fov: this.baseFov, aspect: this.camera.aspect, em: this.soft ? 0.064 : 0.068, follow: !!this.o.ride };
    const posed: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const at = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => { this.pose(time, shot, posed); pp.copy(posed.pos); qq.copy(posed.quat); };
    this.blocks.update(ctx.lyrics, t, shot.section.energy, (st, time, root, leave, size) => {
      const stand = this.stands.get(shot.start, st, leave, at, s.em, view, size);
      stand.apply(time, root);
      return smooth((stand.depth(time) - s.ahead * 0.15) / (s.ahead * 0.35));
    });

    ctx.fx.bloom = this.soft ? 0.45 : 0.4;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.035;
    ctx.fx.risoPositive = 1;
    // Streaks at speed (a little, from well above cruising).
    ctx.fx.zoom = Math.max(ctx.fx.zoom, 0.12 * smooth((sp - 1.6) / 2.2));
  }
}

function lastLE(a: Float64Array, t: number): number {
  let lo = 0, hi = a.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}
