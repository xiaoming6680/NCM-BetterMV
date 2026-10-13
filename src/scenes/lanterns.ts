// Lanterns (抒情): a lake at night, sky lanterns rising from it. The voice releases them: every sung word lets one go
// (in a chorus two), so a verse sends up a slow line of lights and a chorus fills the sky; between the words, and
// through a song without any, now and then one on its own. Each rises slowly, swaying in a breath of wind, lit from
// the flame at its foot (the light is the cover's warm colour), and is reflected in the water below, the reflection
// drawn out and trembling. The sky is the cover's darkest colour going to its own at the horizon, a far shore along
// it. Cameras: shore (low by the water, looking out and up, slowly pushing on), rise (craning up among the lanterns),
// wide (further back, drifting along the shore). The words hang in the sky in columns, a line to each side.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';

/** Lanterns drawn at once. */
const MAX = 480;
/** How long a lantern stays up before it fades (s). */
const LIFE = 40;

interface Lantern { t0: number; x: number; z: number; rise: number; wind: number; size: number; seed: number }

const SKY_VERT = /* glsl */ `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY_FRAG = /* glsl */ `
  uniform mat4 uInvVP;
  uniform vec3 uCam, uZenith, uHorizon, uShore, uGlow;
  uniform float uTime, uWarm;
  varying vec2 vNdc;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h21(vec2(i, 3.1)), h21(vec2(i + 1.0, 3.1)), f); }
  vec3 sky(vec3 d) {
    float e = max(d.y, 0.0);
    vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, e));
    // The lanterns' light warms the low sky a little as they gather.
    c += uGlow * uWarm * exp(-e * 6.0) * 0.5;
    // Stars, faint points.
    vec2 sp = vec2(atan(d.x, -d.z) * 700.0, e * 700.0);
    float st = step(0.9985, h21(floor(sp))) * (1.0 - smoothstep(0.1, 0.35, length(fract(sp) - 0.5))) * smoothstep(0.06, 0.3, e);
    c += vec3(0.6, 0.65, 0.8) * st * 0.3;
    // The far shore: low hills along the horizon.
    float az = atan(d.x, -d.z);
    float ridge = 0.012 + 0.02 * n1(az * 9.0) + 0.008 * n1(az * 31.0);
    if (d.y < ridge && d.y > -0.002) c = uShore;
    return c;
  }
  void main() {
    vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
    vec3 d = normalize(w.xyz / w.w - uCam);
    vec3 c;
    if (d.y >= 0.0) c = sky(d);
    else {
      // The lake: the sky mirrored, darker, broken by slow ripples.
      vec3 r = vec3(d.x, -d.y, d.z);
      float dist = uCam.y / max(-d.y, 1e-3);
      vec2 wp = uCam.xz + d.xz * dist;
      float rip = sin(wp.x * 0.7 + uTime * 0.6) * 0.5 + sin(wp.y * 1.3 - uTime * 0.4 + wp.x * 0.3) * 0.5;
      r.xz += rip * 0.01;
      c = sky(normalize(r)) * 0.45;
      // (Near the shore the reflection of the shore.)
      c = mix(c, uShore * 0.8, smoothstep(0.0, 0.004, 0.02 - r.y) * smoothstep(0.003, 0.0, -d.y));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

const LAMP_VERT = /* glsl */ `
  attribute vec4 aLamp;   // position, size
  attribute vec2 aState;  // light (0..1), seed
  uniform float uMirror, uTime;
  varying vec2 vQ;
  varying float vLight, vSeed, vMirror;
  void main() {
    vQ = position.xy;
    vLight = aState.x; vSeed = aState.y; vMirror = uMirror;
    vec3 p = aLamp.xyz;
    float s = aLamp.w;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec2 q = position.xy * vec2(1.0, 1.35);
    if (uMirror > 0.5) {
      // Reflected: below the water, drawn out downwards and trembling.
      p.y = -p.y;
      q.y *= 2.2;
      q.x += sin(p.y * 2.0 + q.y * 3.0 + uTime * 2.3 + aState.y * 6.0) * 0.12;
    }
    vec3 wp = p + right * q.x * s * 2.4 + up * q.y * s * 2.4;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const LAMP_FRAG = /* glsl */ `
  uniform vec3 uLamp, uCore;
  uniform float uBright;
  varying vec2 vQ;
  varying float vLight, vSeed, vMirror;
  void main() {
    // The quad spans 2.4 × 3.24 lantern sizes each way from its middle: the lantern is the middle, its glow the rest.
    vec2 q = vQ * vec2(2.4, 3.24);
    float y = q.y / 0.62;
    // A paper lantern: a rounded box (as tall as one and a quarter widths), a little wider at the top, open at the
    // foot where the flame is.
    float halfW = mix(0.36, 0.46, clamp(y * 0.5 + 0.5, 0.0, 1.0));
    float body = (1.0 - smoothstep(halfW - 0.05, halfW, abs(q.x))) * (1.0 - smoothstep(0.9, 1.0, abs(y)));
    // Lit from the foot: bright low down, the paper glowing through, brighter at its edges.
    float lit = mix(1.0, 0.45, smoothstep(-1.0, 1.0, y)) + 0.25 * smoothstep(halfW - 0.12, halfW, abs(q.x));
    float flame = exp(-pow(length(vec2(q.x, (y + 0.8) * 0.62) * vec2(3.0, 4.0)), 2.0));
    float glow = exp(-dot(q, q) * 1.1) * 0.3;
    float flick = 0.92 + 0.08 * sin(vSeed * 40.0 + vLight * 3.0);
    vec3 c = uLamp * (body * lit * 0.9 + glow) + uCore * flame * 0.8;
    float a = vLight * uBright * flick * (vMirror > 0.5 ? 0.35 * (1.0 - smoothstep(0.2, 1.0, abs(vQ.y))) : 1.0);
    gl_FragColor = vec4(c * a, 1.0);
  }`;

export class LanternScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
  private lanterns: Lantern[] = [];
  private skyU: Record<string, THREE.IUniform>;
  private lampU: Record<string, THREE.IUniform>;
  private mirrorU: Record<string, THREE.IUniform>;
  private aLamp: THREE.InstancedBufferAttribute;
  private aState: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private rig: LyricRig;
  private shot: Shot | null = null;

  constructor(private init: SceneInit) {
    const { palette, music, lyrics } = init;
    // The flame's colour: warm, pulled towards the cover's own signal colour.
    const lamp = new THREE.Color(1.0, 0.5, 0.18).lerp(palette.signal, 0.3);
    const core = new THREE.Color(1.0, 0.85, 0.6);
    const zenith = palette.ink.clone().lerp(palette.accent, 0.1).multiplyScalar(0.35).add(new THREE.Color(0.004, 0.006, 0.016));
    const horizon = palette.ink.clone().lerp(palette.accent, 0.35).multiplyScalar(0.5).add(new THREE.Color(0.012, 0.012, 0.02));
    const shore = palette.ink.clone().multiplyScalar(0.12);
    this.scene.background = zenith.clone();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyU = {
      uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uZenith: { value: zenith }, uHorizon: { value: horizon },
      uShore: { value: shore }, uGlow: { value: lamp.clone().multiplyScalar(0.25) }, uTime: { value: 0 }, uWarm: { value: 0 },
    };
    const sky = new THREE.Mesh(tri, new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, depthTest: false, depthWrite: false }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      (this.skyU.uInvVP.value as THREE.Matrix4).multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
      (this.skyU.uCam.value as THREE.Vector3).copy(camera.position);
    };
    this.scene.add(sky);

    // The lanterns and their reflections: one quad, instanced.
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aLamp = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aLamp', this.aLamp);
    this.geo.setAttribute('aState', this.aState);
    this.geo.instanceCount = 0;
    const make = (mirror: number, order: number) => {
      const u = { uLamp: { value: lamp }, uCore: { value: core }, uBright: { value: 1 }, uMirror: { value: mirror }, uTime: { value: 0 } };
      const m = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG, uniforms: u, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      m.frustumCulled = false;
      m.renderOrder = order;
      this.scene.add(m);
      return u;
    };
    this.mirrorU = make(1, 0);
    this.lampU = make(0, 1);

    // Every lantern of the song, from the words (and the beats between them).
    const random = rng(Math.round(music.duration * 997) ^ 0x1a7e);
    const release = (t0: number) => {
      const z = -(8 + Math.pow(random(), 1.4) * 70);
      this.lanterns.push({ t0, x: (random() - 0.5) * (Math.abs(z) * 1.3 + 8), z, rise: 0.35 + 0.35 * random(), wind: 0.04 + 0.1 * random(), size: 0.32 + 0.12 * random(), seed: random() });
    };
    for (const l of lyrics.lines) for (const w of l.words) {
      const sec = music.section(w.start);
      release(w.start);
      if (sec.label === 'chorus' || sec.label === 'drop') release(w.start + 0.12);
    }
    // Between the words: one a bar where nothing is sung (two in a full section).
    const sung = (t: number) => lyrics.lines.some(l => t >= l.start - 0.5 && t <= l.end + 0.5);
    const beats = music.beats, every = Math.max(1, music.meter);
    for (let i = 0; i < beats.length; i++) {
      const t = beats[i], sec = music.section(t);
      if (sung(t)) continue;
      if (i % (sec.energy > 0.6 ? Math.ceil(every / 2) : every) === 0) release(t);
    }
    this.lanterns.sort((a, b) => a.t0 - b.t0);

    this.rig = new LyricRig(palette, 'poem');
    this.rig.place = (root, st) => {
      const shot = this.shot;
      if (!shot) return 0;
      const eye = new THREE.Vector3(), target = new THREE.Vector3();
      this.pose(shot, Math.max(st.line.start, shot.start), eye, target);
      const fw = target.sub(eye).normalize(), right = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fw);
      const d = 30, vh = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2), vw = vh * this.camera.aspect;
      root.position.copy(eye).addScaledVector(fw, d).addScaledVector(right, (st.index % 2 ? 1 : -1) * vw * 0.3).addScaledVector(up, vh * 0.06);
      root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fw.clone().negate()));
    };
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const vh = 2 * 30 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.rig.frame = { vh, vw: vh * aspect };
  }

  /** The camera at t on a shot. */
  private pose(shot: Shot, t: number, eye: THREE.Vector3, target: THREE.Vector3): void {
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start)), e = inOutCubic(k);
    const side = rng(shot.seed)() < 0.5 ? -1 : 1;
    if (shot.variant === 'rise') {
      eye.set(side * 1.5, lerp(1.2, 9, e), lerp(5, 1, e));
      target.set(side * 0.5, lerp(5, 14, e), -40);
    } else if (shot.variant === 'wide') {
      eye.set(side * lerp(10, 3, k), 3.2, 14);
      target.set(side * lerp(2, -2, k), 7, -45);
    } else {
      eye.set(side * lerp(0.8, -0.8, e), 1.3, lerp(6, 1.5, e));
      target.set(side * lerp(-1, 1, e), 5.5, -40);
    }
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    this.shot = shot;
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    this.pose(shot, t, eye, target);
    this.camera.position.copy(eye);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    // The lanterns up at t.
    const L = this.lanterns, lamp = this.aLamp.array as Float32Array, state = this.aState.array as Float32Array;
    let n = 0;
    let lo = 0, hi = L.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (L[mid].t0 < t - LIFE - 6) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < L.length && n < MAX; i++) {
      const l = L[i], age = t - l.t0;
      if (age < 0) break;
      // It gets going slowly, then rises steadily, drifting with the wind and swaying.
      const y = 0.3 + l.rise * (age - 2 * (1 - Math.exp(-age / 2)));
      const x = l.x + l.wind * age + 0.25 * Math.sin(age * 0.7 + l.seed * 20) * smooth(age / 4);
      const light = smooth(age / 1.2) * (1 - smooth((age - LIFE) / 6)) * (1 - smooth((y - 40) / 8));
      if (light <= 0.002) continue;
      lamp.set([x, y, l.z - 0.04 * age, l.size], n * 4);
      state.set([light, l.seed], n * 2);
      n++;
    }
    this.geo.instanceCount = n;
    this.aLamp.needsUpdate = this.aState.needsUpdate = true;
    const bright = 1 + 0.15 * music.env('mid', t);
    this.lampU.uBright.value = bright;
    this.mirrorU.uBright.value = bright;
    this.lampU.uTime.value = this.mirrorU.uTime.value = t;
    this.skyU.uTime.value = t;
    this.skyU.uWarm.value = Math.min(1, n / 160);
    ctx.fx.bloom = 0.45;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.05;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
