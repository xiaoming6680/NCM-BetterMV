// Black hole (黑洞), after the BGA of BOF:NT's 《Ж》 that issue #3 pointed to: a black hole and its accretion disk,
// the light bent round it — the far side of the disk arches over the top and under the bottom of the shadow, a thin
// ring of light hugs the shadow's edge, the stars behind are smeared round it.
// The sound is the disk: its light flows out from the edge of the shadow, the level of the last two and a half seconds
// laid out by radius (what is heard now just leaving the inner edge, what was heard before further out), so every
// note leaves the hole as a ring and spreads across the disk; the bass warms it towards the cover's signal colour,
// the treble whitens the inner edge. A kick throws a sharp ring out fast over the top of it. The disk turns (faster
// inside), its gas streaked into spirals; the side coming towards the camera is brighter.
// Marched per pixel at a share of the canvas (as the fractal plates are): each ray is bent towards the hole as it goes
// (the photon-orbit acceleration, 1.5·h²/r⁴ with the horizon at r = 1), picking up the disk where it crosses its plane.
// Cameras: almost edge on (the classic view, the disk's far side lifted into an arch), tilted, from high above.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, fitFov, rng, smooth } from './types.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { voiceOpts } from './lyricBlock.ts';
import { hue, v3 } from './fractal.ts';
import { passMesh } from '../render/engine.ts';
import { lastIndex } from '../director/music.ts';

/** Samples of the flow (inner edge = now), and the seconds it spans. */
const FLOW = 128, SPAN = 2.5;
const RIN = 2.6, ROUT = 11;
const SHOCKS = 4;

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BACK_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const BACK = /* glsl */ `uniform sampler2D tMarch; varying vec2 vUv; void main() { gl_FragColor = texture2D(tMarch, vUv); }`;

type Pal = { ink: THREE.Color; paper: THREE.Color; signal: THREE.Color; accent: THREE.Color };

function marchShader(p: Pal): string {
  const hot = hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.45));
  return /* glsl */ `
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uT;
uniform sampler2D tFlow;
uniform vec4 uShock, uShockK;
varying vec2 vUv;
const vec3 HOT = ${v3(hot)}, MID = ${v3(hue(p.signal))}, COOL = ${v3(hue(p.accent))}, SKY = ${v3(p.ink, 0.05)};
const float RIN = ${RIN.toFixed(2)}, ROUT = ${ROUT.toFixed(2)};

float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// The gas: log-polar noise turned at each radius's own speed. The shear grows with time, so two clocks a half period
// apart are cross-faded (each restarts when it is faded out): the streaks stay spirals instead of winding ever finer.
float gas(float r, float phi) {
  float w = 1.1 * pow(r / RIN, -1.5), P = 18.0;
  float a = mod(uT, P), b = mod(uT + 0.5 * P, P), m = abs(a / P * 2.0 - 1.0);
  float u = log(r) * 7.0;
  // (phi wraps at ±pi: the noise is read on a circle of the angle so there is no seam.)
  vec2 ca = vec2(cos(phi - w * a), sin(phi - w * a)) * 3.0, cb = vec2(cos(phi - w * b), sin(phi - w * b)) * 3.0;
  float na = fbm(vec2(u, 0.0) + ca), nb = fbm(vec2(u, 9.0) + cb);
  return mix(na, nb, smoothstep(0.25, 0.75, m));
}

vec4 disk(vec3 p, vec3 rd) {
  float r = length(p.xz);
  if (r < RIN || r > ROUT) return vec4(0.0);
  float x = (r - RIN) / (ROUT - RIN);
  vec3 f = texture2D(tFlow, vec2(x, 0.5)).rgb;
  float turb = gas(r, atan(p.z, p.x));
  float shock = 0.0;
  for (int i = 0; i < 4; i++) { float d = (r - uShock[i]) / 0.22; shock += uShockK[i] * exp(-d * d); }
  // Hot and dense inside, thinning out; the level of the moment this ring left the hole lights it.
  float prof = smoothstep(0.0, 0.03, x) * pow(1.0 - x, 1.4) / (0.3 + 3.0 * x);
  // (Streaks: the gas squared and a finer layer of it, so the disk is lanes of light, not a smooth glow.)
  float lanes = turb * turb * (0.6 + 0.8 * fbm(vec2(log(r) * 26.0, turb * 4.0)));
  float lit = prof * (0.06 + 1.05 * f.r) * (0.25 + 1.3 * lanes) + shock * (0.7 - 0.4 * x);
  // Near white only at the inner rim; the cover's signal colour through the body, its accent outside.
  vec3 col = mix(HOT, MID, smoothstep(0.0, 0.1, x));
  col = mix(col, COOL, smoothstep(0.3, 0.85, x));
  col = mix(col, MID, clamp(f.g, 0.0, 1.0) * 0.3 * smoothstep(0.25, 0.6, x));
  col = mix(col, HOT, clamp(f.b, 0.0, 1.0) * 0.3 * (1.0 - smoothstep(0.0, 0.12, x)));
  // The side turning towards the camera is brighter (beaming), the other dimmer.
  vec3 v = normalize(vec3(-p.z, 0.0, p.x));
  float dop = clamp(1.0 + 0.5 * dot(v, -rd), 0.3, 1.6);
  lit *= dop * dop * dop;
  float alpha = clamp(lit * 1.4, 0.0, 0.92) * smoothstep(1.0, 0.85, x);
  return vec4(col * lit * 0.95, alpha);
}

vec3 sky(vec3 d) {
  vec3 q = d * 160.0, c = floor(q);
  float h = hash3(c), s = smoothstep(0.988, 1.0, h) * smoothstep(0.42, 0.0, length(fract(q) - 0.5));
  float band = fbm(vec2(atan(d.z, d.x) * 2.0, d.y * 6.0)) * smoothstep(0.5, 0.0, abs(d.y + 0.15));
  return SKY + COOL * band * 0.035 + vec3(s) * (0.4 + 0.6 * hash3(c + 7.0));
}

void main() {
  vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uCam), pos = uCam;
  vec3 hcr = cross(pos, dir);
  float h2 = dot(hcr, hcr);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  // (Only a ray that gets away sees the sky: one still circling near the photon sphere when the steps run out is
  // as good as captured — taken for escaped it drew a dotted ring of stars inside the shadow.)
  bool away = false;
  for (int i = 0; i < 150; i++) {
    float r = length(pos);
    float dt = clamp(0.07 * r, 0.025, 1.6);
    // (Kept unit length — light's speed: left to grow, a ray grazing the horizon was flung off to infinity, and one
    // NaN pixel, spread by the bloom, blacked out the whole frame.)
    dir = normalize(dir - 1.5 * h2 * pos / (r * r * r * r * r) * dt);
    vec3 np = pos + dir * dt;
    if (pos.y * np.y < 0.0) {
      vec3 hit = mix(pos, np, pos.y / (pos.y - np.y));
      vec4 d = disk(hit, normalize(dir));
      col += trans * d.rgb;
      trans *= 1.0 - d.a;
      if (trans < 0.02) break;
    }
    pos = np;
    if (dot(pos, pos) < 1.0) break;
    if (r > 80.0 && dot(pos, dir) > 0.0) { away = true; break; }
  }
  if (away) col += trans * sky(dir);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(40.0)), 1.0);
}`;
}

export class BlackHole implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 400);
  readonly offscreen: THREE.Object3D[];
  private rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  private quad: FullScreenQuad;
  private u: Record<string, THREE.IUniform>;
  private invVP = new THREE.Matrix4();
  private flow = new Uint8Array(FLOW * 4);
  private flowTex: THREE.DataTexture;
  private kicks: Float64Array;
  private kickV: Float64Array;
  private orbit: LyricOrbit;
  private readonly soft: boolean;
  private az = 0;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.05);
    this.flowTex = new THREE.DataTexture(this.flow, FLOW, 1, THREE.RGBAFormat);
    this.flowTex.magFilter = this.flowTex.minFilter = THREE.LinearFilter;
    this.flowTex.needsUpdate = true;
    this.u = {
      uInvVP: { value: this.invVP }, uCam: { value: new THREE.Vector3() }, uT: { value: 0 },
      tFlow: { value: this.flowTex }, uShock: { value: new THREE.Vector4(-9, -9, -9, -9) }, uShockK: { value: new THREE.Vector4() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: marchShader(palette), uniforms: this.u, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(mat);
    this.offscreen = [passMesh(mat)];
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: BACK_VERT, fragmentShader: BACK, uniforms: { tMarch: { value: this.rt.texture } }, depthTest: false, depthWrite: false,
    }));
    back.frustumCulled = false;
    back.renderOrder = -10;
    this.scene.add(back);
    this.scene.onBeforeRender = (renderer, _s, camera) => this.march(renderer, camera as THREE.PerspectiveCamera);

    // Kicks (ballads: downbeats, softer) throw the fast rings.
    const ev = this.soft ? Array.from(music.downbeats, d => [d, 0.4] as [number, number]) : music.a.hits.kick.filter(h => h[1] > 0.4);
    const kept: Array<[number, number]> = [];
    for (const e of ev) if (!kept.length || e[0] - kept[kept.length - 1][0] > 0.18) kept.push([e[0], e[1]]);
    this.kicks = Float64Array.from(kept, h => h[0]);
    this.kickV = Float64Array.from(kept, h => h[1]);

    // The words round the hole, outside the disk.
    this.orbit = new LyricOrbit(palette, { style: this.soft ? 'poem' : 'hook', em: 0.34, radius: 3.0, mode: 'band', trans: { em: 0.15, radius: 3.0 }, ...voiceOpts(look, init.seed) });
    this.orbit.group.scale.setScalar(3.6);
    // (Below the hole, clear of the shadow and the arch.)
    this.orbit.group.position.y = -3.3;
    this.scene.add(this.orbit.group);
    this.resize(init.aspect);
  }

  dispose(): void {
    this.rt.dispose();
    this.flowTex.dispose();
    this.quad.material.dispose();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = fitFov(34, aspect);
    this.camera.updateProjectionMatrix();
  }

  /** The march's resolution: a share of the canvas. */
  setViewport(width: number, height: number, pixelRatio: number): void {
    const scale = pixelRatio >= 1 ? 0.6 : 0.7;
    this.rt.setSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
  }

  private march(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld(true);
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    (this.u.uCam.value as THREE.Vector3).copy(camera.getWorldPosition(new THREE.Vector3()));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }

  private pose(t: number, shot: Shot): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    let r: number, el: number;
    if (shot.variant === 'top') { r = 34 - 3 * k; el = 1.05; }
    else if (shot.variant === 'tilt') { r = 27 - 2.5 * k; el = 0.32 + 0.04 * Math.sin(t * 0.2); }
    else { r = 25 - 2.5 * k; el = 0.075 + 0.02 * Math.sin(t * 0.17); }
    const az = phase + side * t * 0.035;
    const cam = this.camera;
    cam.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    // (Seen from the side, the hole sits in the upper part of the frame and the ring of words in the lower third.)
    cam.lookAt(0, shot.variant === 'top' ? 0 : -2.2, 0);
    // (Edge on, a slight roll: the disk a little off the horizontal, as the reference holds it.)
    if (shot.variant !== 'top') cam.rotateZ(side * 0.09);
    cam.updateMatrixWorld();
    this.az = az;
  }

  update(ctx: FrameCtx): void {
    const { t, shot, music } = ctx;
    this.pose(t, shot);
    this.u.uT.value = t;
    // The flow: what was heard SPAN seconds ago at the outer edge, now at the inner one.
    for (let i = 0; i < FLOW; i++) {
      const at = t - (i / (FLOW - 1)) * SPAN;
      this.flow[i * 4] = Math.round(255 * clamp01(music.env('rms', at)));
      this.flow[i * 4 + 1] = Math.round(255 * clamp01(music.env('low', at)));
      this.flow[i * 4 + 2] = Math.round(255 * clamp01(music.env('high', at)));
      this.flow[i * 4 + 3] = 255;
    }
    this.flowTex.needsUpdate = true;
    // The kicks' rings: out from the inner edge at 9 units a second, fading as they go.
    const sh = this.u.uShock.value as THREE.Vector4, shk = this.u.uShockK.value as THREE.Vector4;
    sh.set(-9, -9, -9, -9); shk.set(0, 0, 0, 0);
    let m = 0;
    for (let i = lastIndex(this.kicks, t); i >= 0 && m < SHOCKS; i--) {
      const age = t - this.kicks[i];
      if (age > 1.2) break;
      sh.setComponent(m, RIN + 9 * age * (1 - 0.25 * age));
      shk.setComponent(m, this.kickV[i] * (this.soft ? 0.5 : 1.1) * Math.exp(-age / 0.45) * smooth(age / 0.03));
      m++;
    }
    this.orbit.update(ctx.lyrics, t, shot.section.energy, () => this.az, this.camera);
    const loud = shot.section.label === 'chorus' || shot.section.label === 'drop';
    ctx.fx.bloom = this.soft ? 0.38 : loud ? 0.3 : 0.36;
    ctx.fx.vignette = 0.6;
    ctx.fx.grain = 0.03;
    ctx.fx.risoPositive = 1;
  }
}
