// Pillars: a disc of thin light pillars packed edge to edge on a gentle dome, dim until the song strikes it. Every
// sound lands somewhere on it as a ring that runs outwards: its front lifts the pillars and burns them white, it
// widens and cools as it goes, and the ground it has crossed stays warm a while, so rings that overlap heat the
// disc from the cover's second colour up through its main colour towards white, and it cools again in the quiet.
// Kicks are the big rings (the harder, the wider), snares small white pops, each sung word a small ring stepping
// on from the last across the disc, a jump in loudness a wide one, and the first beat of a chorus or a drop one
// from the middle over the whole disc; where nothing sounds for a while, the downbeats.
// Cameras: an oblique view slowly circling the disc (orbit), low across it with the pillars large in front (low),
// from above, turning (top).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { rng, smooth } from './types.ts';
import { LyricGates } from './lyricSpace.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { LyricLine, SectionLabel } from '../types.ts';

/** Pillars per side of the grid (the disc takes the circle inside it). */
const N = 256;
/** Disc radius. */
const R = 60;
const SP = (2 * R) / N;
/** How much the dome rises at its middle. */
const DOME = 6;
const RINGS = 32;
const LOUD = new Set<SectionLabel>(['chorus', 'drop']);

const v3 = (c: THREE.Color, k = 1) => `vec3(${(c.r * k).toFixed(5)},${(c.g * k).toFixed(5)},${(c.b * k).toFixed(5)})`;
/** A light's colour: the hue of c at full strength. */
const hue = (c: THREE.Color) => { const m = Math.max(c.r, c.g, c.b, 1e-4); return c.clone().multiplyScalar(1 / m); };

interface Ring {
  t: number;
  x: number; z: number;
  /** How far it runs. */
  size: number;
  amp: number;
  /** How fast it gets there (seconds to cover ~63%). */
  tau: number;
  /** How white its front burns at first. */
  white: number;
}

function ringsOf(music: Music, lines: LyricLine[], seed: number, soft: boolean): Ring[] {
  const random = rng(seed ^ 0x7a31);
  const out: Ring[] = [];
  const spot = (maxR: number): [number, number] => { const a = random() * Math.PI * 2, r = Math.sqrt(random()) * maxR; return [Math.cos(a) * r, Math.sin(a) * r]; };
  const loud = (t: number) => LOUD.has(music.section(Math.min(t, music.duration - 0.01)).label);
  for (const [t, s] of music.a.hits.kick) {
    if (s < 0.3) continue;
    const big = loud(t);
    const [x, z] = spot(R * (big ? 0.55 : 0.7));
    out.push({ t, x, z, size: R * (0.16 + 0.26 * s) * (big ? 1.3 : 1) * (soft ? 0.9 : 1), amp: 0.55 + 0.5 * s, tau: 0.55, white: 0.8 });
  }
  for (const [t, s] of music.a.hits.snare) {
    if (s < 0.45) continue;
    const [x, z] = spot(R * 0.75);
    out.push({ t, x, z, size: R * (0.05 + 0.05 * s), amp: 0.9, tau: 0.22, white: 1 });
  }
  // Sung words step across the disc, a line at a time from somewhere new.
  for (const l of lines) {
    let [x, z] = spot(R * 0.6);
    for (const w of l.words) {
      const d = Math.min(1.5, Math.max(0.1, w.end - w.start));
      out.push({ t: w.start, x, z, size: R * (0.07 + 0.08 * d) * (l.backing ? 0.7 : 1), amp: (0.35 + 0.2 * d) * (l.backing ? 0.6 : 1), tau: 0.45, white: 0.5 });
      const a = random() * Math.PI * 2;
      x += Math.cos(a) * R * 0.1; z += Math.sin(a) * R * 0.1;
      const r = Math.hypot(x, z);
      if (r > R * 0.75) { x *= (R * 0.75) / r; z *= (R * 0.75) / r; }
    }
  }
  for (const [t, s] of music.a.hits.accent) {
    if (s < 0.5) continue;
    const [x, z] = spot(R * 0.3);
    out.push({ t, x, z, size: R * (0.4 + 0.3 * s), amp: 0.9, tau: 0.8, white: 0.6 });
  }
  for (const s of music.a.sections) if (LOUD.has(s.label)) out.push({ t: s.start, x: 0, z: 0, size: R * 1.25, amp: 1.2, tau: 1.1, white: 0.9 });
  // Where the drums are sparse (a ballad, a piano intro), the notes: peaks of the onset strength.
  const env = music.a.env, on = env.onset, gap = Math.round(env.fps * 0.3);
  const kicks = Float64Array.from(music.a.hits.kick, h => h[0]);
  const dense = (t: number) => { const i = lastIndex(kicks, t + 2), j = lastIndex(kicks, t - 2); return i - j > 3; };
  let lastOn = -1e9;
  for (let k = gap; k < on.length - gap; k++) {
    const v = on[k];
    if (v < 0.35 || k - lastOn < gap) continue;
    let peak = true;
    for (let j = k - 15; j <= k + 15 && peak; j++) if (j !== k && on[Math.max(0, Math.min(on.length - 1, j))] > v) peak = false;
    if (!peak) continue;
    const t = k / env.fps;
    if (dense(t)) continue;
    lastOn = k;
    const [x, z] = spot(R * 0.7);
    out.push({ t, x, z, size: R * (0.06 + 0.12 * Math.min(1, v)), amp: 0.3 + 0.3 * Math.min(1, v), tau: 0.5, white: 0.5 });
  }
  out.sort((a, b) => a.t - b.t);
  // Quiet stretches: the downbeats.
  const times = Float64Array.from(out, r => r.t);
  for (const d of Array.from(music.downbeats)) {
    const i = lastIndex(times, d + 0.2);
    if (i >= 0 && d - times[i] < 1.2) continue;
    const [x, z] = spot(R * 0.65);
    out.push({ t: d, x, z, size: R * 0.15, amp: 0.35, tau: 0.6, white: 0.4 });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ── Shaders ──────────────────────────────────────────────────────────────────────────────────────────────────────

const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}`;

const STATE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Each pillar's lift (r), heat (g) and white-hot (b) from the rings now running. */
const STATE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform vec4 uA[${RINGS}]; // x, z, age, amp
uniform vec4 uB[${RINGS}]; // size, tau, white
uniform float uWarm, uT;
out vec4 fragColor;
${NOISE}
void main() {
  vec2 xz = (vUv - 0.5) * ${(2 * R).toFixed(1)};
  float lift = 0.3 * n2(xz * 0.07 - uT * 0.15), heat = uWarm * (0.6 + 0.8 * n2(xz * 0.05 + uT * 0.07)), white = 0.0;
  for (int i = 0; i < ${RINGS}; i++) {
    vec4 a = uA[i], b = uB[i];
    if (a.w <= 0.0) continue;
    float age = a.z;
    float rad = b.x * (1.0 - exp(-age / b.y));
    float w = 0.45 + 0.085 * rad;
    float d = length(xz - a.xy);
    float front = exp(-pow((d - rad) / w, 2.0));
    float inside = smoothstep(rad + w, rad - w, d);
    float fade = exp(-age / (0.9 + b.y * 1.6));
    lift += a.w * fade * (front * 2.6 + inside * 0.35);
    heat += a.w * (fade * (front * 0.7 + inside * 0.15) + 0.05 * inside * exp(-age / 2.0));
    white += a.w * front * b.z * exp(-age / 0.45);
  }
  fragColor = vec4(lift, heat, white, 1.0);
}`;

interface Look { ink: THREE.Color; paper: THREE.Color; signal: THREE.Color; accent: THREE.Color }

function ramp(p: Look): string {
  const cold = p.ink.clone().multiplyScalar(0.5).add(hue(p.accent).multiplyScalar(0.06));
  const warm = hue(p.accent).multiplyScalar(0.5);
  const hot = hue(p.signal).multiplyScalar(0.9);
  const white = hue(p.paper);
  return /* glsl */ `
const vec3 COLD = ${v3(cold)}, WARM = ${v3(warm)}, HOT = ${v3(hot)}, WHITE = ${v3(white)};
vec3 ramp(float h, float w) {
  vec3 c = h < 0.5 ? mix(COLD, WARM, h / 0.5) : h < 1.3 ? mix(WARM, HOT, (h - 0.5) / 0.8) : mix(HOT, WHITE, min(1.0, (h - 1.3) / 1.2) * 0.7);
  return mix(c, WHITE, clamp(w, 0.0, 1.0) * 0.8);
}`;
}

function pillarVert(p: Look): string {
  return /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 projectionMatrix, viewMatrix;
uniform sampler2D uState;
uniform vec3 uCam;
// (Centroid: seen from above the pillars' sides are slivers, and with multisampling a colour taken off the
// triangle ran away to hundreds — one such pixel, kept by the light trails, spread over the whole frame as white.)
centroid out vec3 vColor;
centroid out float vFog;
${NOISE}
${ramp(p)}
void main() {
  ivec2 g = ivec2(gl_InstanceID % ${N}, gl_InstanceID / ${N});
  vec2 xz = (vec2(g) - ${(N / 2).toFixed(1)} + 0.5) * ${SP.toFixed(5)};
  float r = length(xz) / ${R.toFixed(1)};
  if (r > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 st = texelFetch(uState, g, 0);
  float rnd = hash12(vec2(g) * 1.37);
  // At rest: low, uneven, the odd tall one with a bright tip.
  float rest = 0.15 + 0.5 * n2(xz * 0.09 + 3.1) + 0.15 * rnd;
  float lone = step(0.999, hash12(vec2(g) * 0.71 + 9.0));
  float edge = 1.0 - smoothstep(0.8, 1.0, r);
  float h = ((rest + lone * 1.6) * mix(0.4, 1.0, edge) + st.r) * edge + 0.03;
  float y0 = ${DOME.toFixed(1)} * (1.0 - r * r);
  float wide = ${(SP * 0.62).toFixed(4)} * (1.0 - lone * 0.55);
  vec3 p = vec3(xz.x + position.x * wide, y0 + position.y * h, xz.y + position.z * wide);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // Brighter up the pillar; its top brightest; the lone ones' tips white.
  float up = position.y;
  // (Cold pillars are dim: the disc lights where the rings have been.)
  float lit = 0.45 + 0.55 * smoothstep(0.0, 0.7, st.g + st.b);
  vec3 c = ramp(st.g, st.b) * (0.12 + 0.88 * pow(up, 1.8)) * lit;
  if (normal.y > 0.5) c *= 1.4;
  c = mix(c * (1.0 - lone * 0.5), WHITE * 0.9, lone * smoothstep(0.88, 1.0, up) * 0.85);
  c *= mix(0.25, 1.0, edge);
  vColor = c;
  vFog = length(uCam - p);
}`;
}

function pillarFrag(p: Look): string {
  return /* glsl */ `
precision highp float;
centroid in vec3 vColor;
centroid in float vFog;
out vec4 fragColor;
const vec3 FOG = ${v3(p.ink.clone().lerp(p.accent, 0.15).multiplyScalar(0.12))};
void main() { fragColor = vec4(clamp(mix(FOG, vColor, exp(-vFog * 0.004)), 0.0, 4.0), 1.0); }`;
}

/** The dome under the pillars, glowing with their colour (between them the light reads as one field). */
function groundFrag(p: Look): string {
  return /* glsl */ `
precision highp float;
in vec3 vWorld;
uniform sampler2D uState;
uniform vec3 uCam;
out vec4 fragColor;
${ramp(p)}
const vec3 FOG = ${v3(p.ink.clone().lerp(p.accent, 0.15).multiplyScalar(0.12))};
void main() {
  float r = length(vWorld.xz) / ${R.toFixed(1)};
  if (r > 1.0) discard;
  vec4 st = texture(uState, vWorld.xz / ${(2 * R).toFixed(1)} + 0.5);
  vec3 c = ramp(st.g, st.b * 0.5) * (0.1 + 0.18 * min(st.r, 2.0)) * smoothstep(0.0, 0.6, st.g + 0.15) * (1.0 - smoothstep(0.75, 1.0, r));
  fragColor = vec4(mix(FOG, c, exp(-length(uCam - vWorld) * 0.004)), 1.0);
}`;
}

const GROUND_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 projectionMatrix, viewMatrix;
out vec3 vWorld;
void main() {
  float r = length(position.xz) / ${R.toFixed(1)};
  vWorld = vec3(position.x, ${DOME.toFixed(1)} * (1.0 - r * r) + 0.02, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const SKY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

function skyFrag(p: Look): string {
  const horizon = p.ink.clone().lerp(p.accent, 0.25).multiplyScalar(0.22).add(new THREE.Color(0.006, 0.008, 0.016));
  const zenith = p.ink.clone().lerp(p.accent, 0.1).multiplyScalar(0.1).add(new THREE.Color(0.002, 0.003, 0.007));
  return /* glsl */ `
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCam;
out vec4 fragColor;
const vec3 HORIZON = ${v3(horizon)}, ZENITH = ${v3(zenith)};
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(w.xyz / w.w - uCam);
  fragColor = vec4(mix(HORIZON, ZENITH, smoothstep(-0.3, 0.8, rd.y)), 1.0);
}`;
}

// ── The scene ────────────────────────────────────────────────────────────────────────────────────────────────────

export class Pillars implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 2000);
  private rings: Ring[];
  private ringT: Float64Array;
  private stateRT = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  private stateScene = new THREE.Scene();
  private stateCam = new THREE.Camera();
  private A = Array.from({ length: RINGS }, () => new THREE.Vector4());
  private B = Array.from({ length: RINGS }, () => new THREE.Vector4());
  private stateU: Record<string, THREE.IUniform>;
  private u: Record<string, THREE.IUniform>;
  private skyU: Record<string, THREE.IUniform>;
  private gates: LyricGates;
  private soft: boolean;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse', seed = 1) {
    const { palette, music } = init;
    this.soft = look === 'ballad';
    this.scene.background = palette.ink.clone().multiplyScalar(0.1);
    this.rings = ringsOf(music, init.lyrics.lines, seed, this.soft);
    this.ringT = Float64Array.from(this.rings, r => r.t);

    this.stateU = { uA: { value: this.A }, uB: { value: this.B }, uWarm: { value: 0 }, uT: { value: 0 } };
    const tri = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      return g;
    };
    const quad = new THREE.Mesh(tri(), new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: STATE_VERT, fragmentShader: STATE_FRAG, uniforms: this.stateU, depthTest: false, depthWrite: false }));
    quad.frustumCulled = false;
    this.stateScene.add(quad);

    this.u = { uState: { value: this.stateRT.texture }, uCam: { value: new THREE.Vector3() } };
    // A unit pillar: four sides and a top, x and z in ±0.5, y 0..1.
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const keep: number[] = [];
    const idx = box.getIndex()!;
    const nrm = box.getAttribute('normal');
    for (let i = 0; i < idx.count; i += 3) if (nrm.getY(idx.getX(i)) > -0.5) keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', nrm);
    geo.setIndex(keep);
    geo.instanceCount = N * N;
    const pillars = new THREE.Mesh(geo, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: pillarVert(palette), fragmentShader: pillarFrag(palette), uniforms: this.u }));
    pillars.frustumCulled = false;
    this.scene.add(pillars);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R, 96, 96).rotateX(-Math.PI / 2), new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: GROUND_VERT, fragmentShader: groundFrag(palette), uniforms: this.u }));
    ground.frustumCulled = false;
    this.scene.add(ground);

    this.skyU = { uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() } };
    const sky = new THREE.Mesh(tri(), new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SKY_VERT, fragmentShader: skyFrag(palette), uniforms: this.skyU, depthTest: false, depthWrite: false }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      (this.skyU.uInvVP.value as THREE.Matrix4).multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
      (this.skyU.uCam.value as THREE.Vector3).copy(camera.position);
    };
    this.scene.add(sky);

    this.gates = new LyricGates(palette, { style: this.soft ? 'poem' : 'hook', em: 2.6, maxW: 34, trans: { em: 1.05, vertical: false }, linger: 6 });
    this.scene.add(this.gates.group);

    this.scene.onBeforeRender = renderer => {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.stateRT);
      renderer.render(this.stateScene, this.stateCam);
      renderer.setRenderTarget(prev);
    };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** orbit: oblique, slowly circling; low: across the disc, the pillars large in front; top: from above, turning. */
  private pose(t: number, shot: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const random = rng(shot.seed);
    const th0 = random() * Math.PI * 2, dir = random() < 0.5 ? -1 : 1;
    const k = t - shot.start;
    const target = new THREE.Vector3(0, DOME * 0.5, 0);
    if (shot.variant === 'low') {
      const th = th0 + dir * k * 0.07;
      pos.set(Math.sin(th) * R * 1.05, R * 0.26 + Math.sin(k * 0.3) * 0.8, Math.cos(th) * R * 1.05);
      target.set(-Math.sin(th) * R * 0.2, 0, -Math.cos(th) * R * 0.2);
    } else if (shot.variant === 'top') {
      const th = th0 + dir * k * 0.05;
      pos.set(Math.sin(th) * R * 0.35, R * 1.55, Math.cos(th) * R * 0.35);
      target.set(-Math.sin(th) * R * 0.08, 0, -Math.cos(th) * R * 0.08);
    } else {
      const th = th0 + dir * k * 0.045;
      const d = R * (1.75 - Math.min(1, k / 20) * 0.12);
      pos.set(Math.sin(th) * d, R * 0.72, Math.cos(th) * d);
    }
    const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
    quat.setFromRotationMatrix(m);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const cam = this.camera;
    this.pose(t, shot, cam.position, cam.quaternion);
    cam.updateMatrixWorld();
    (this.u.uCam.value as THREE.Vector3).copy(cam.position);
    const sec = shot.section;
    const loud = LOUD.has(sec.label);

    // The rings now running, newest first.
    let m = 0;
    for (let i = lastIndex(this.ringT, t); i >= 0 && m < RINGS; i--) {
      const r = this.rings[i], age = t - r.t;
      if (age > 7) break;
      if (r.amp * Math.exp(-age / (0.9 + r.tau * 1.6)) < 0.02 && age > 3) continue;
      this.A[m].set(r.x, r.z, age, r.amp * (this.soft ? 0.75 : 1));
      this.B[m].set(r.size, r.tau, r.white, 0);
      m++;
    }
    for (let i = m; i < RINGS; i++) this.A[i].set(0, 0, 0, 0);
    this.stateU.uWarm.value = (loud ? 0.08 : 0.02) + 0.08 * music.env('rms', t) * (this.soft ? 0.7 : 1);
    this.stateU.uT.value = t;

    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    const at = (time: number, lift: number, root: THREE.Object3D) => {
      this.pose(time, shot, p, q);
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      root.position.copy(p).addScaledVector(fw, 30).addScaledVector(up, lift);
      root.quaternion.copy(q);
    };
    this.gates.update(ctx.lyrics, t, sec.energy, (c, time, root) => {
      at(Math.min(time, c.end), c.ordinal % 2 ? 3.6 : 6.4, root);
      return smooth((time - c.start + 0.12) / 0.25) * (1 - smooth((time - Math.min(c.next - 0.05, c.end + 4)) / 0.25));
    }, (state, time, root) => {
      at(Math.min(time, state.line.end), 1.6, root);
      return 1 - smooth((time - state.line.end - 0.3) / 0.5);
    });

    ctx.fx.bloom = 0.45;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.03;
  }
}
