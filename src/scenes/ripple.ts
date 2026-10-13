// Ripple: the song's sound spreading out from its cover. The cover lies at the centre as a disc; round it a ring of
// light bars is the spectrum at this instant (mirrored left and right, the bass nearest the camera); and the spectrum
// keeps flowing outwards from the ring, so the field of light all round is the last few seconds of the song — each
// band a spoke, each moment a circle travelling out, the louder the taller and brighter. A kick is a white shock ring
// running out over the field and a bump of the cover; a chorus or a drop widens the field and brightens it.
// Cameras: tilted over the field, circling (tilt), from above, the cover square in the middle as on a wallpaper
// (face), low across the field towards the cover (low). The words run round the ring.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, rng, surge } from './types.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { voiceOpts } from './lyricBlock.ts';
import { COLS, SpecRing, Spectrogram } from './viz.ts';
import { hue, v3 } from './fractal.ts';
import { lastIndex } from '../director/music.ts';

const NB = 64;
const RING = 512;
/** The cover's radius, where the field starts and ends, how fast it flows out (units a second). */
const R0 = 1;
const R1 = 1.22;
const R2 = 7.5;
const FLOW = 1.9;
/** The field: spokes round, circles out. */
const SPOKES = 360;
const CIRCLES = 150;
const BARS = 180;
const SHOCKS = 5;

type Pal = { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color };

const COMMON = /* glsl */ `
uniform sampler2D tSpec;
uniform float uNow;
const float PI = 3.14159265;
/** The band at angle a (0 at the far side, turning clockwise; mirrored: the bass at the near side). */
float bandAt(float a) {
  float s = abs(mod(a / PI + 1.0, 2.0) - 1.0);
  return s * ${(NB - 1).toFixed(1)};
}
float spec(float band, float col) {
  return texture2D(tSpec, vec2((band + 0.5) / ${NB.toFixed(1)}, (mod(col, ${RING.toFixed(1)}) + 0.5) / ${RING.toFixed(1)})).r;
}`;

function tones(p: Pal): string {
  return /* glsl */ `
const vec3 LOW = ${v3(hue(p.accent))}, MID = ${v3(hue(p.signal))}, HIGH = ${v3(hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.3)))};
vec3 toneOf(float band) {
  float k = band / ${(NB - 1).toFixed(1)};
  return k < 0.5 ? mix(LOW, MID, smoothstep(0.1, 0.5, k)) : mix(MID, HIGH, smoothstep(0.55, 1.0, k));
}`;
}

/** The field: a point per spoke and circle, lifted and lit by the level the band had when the circle left the ring. */
function fieldVert(p: Pal): string {
  return /* glsl */ `
${COMMON}
${tones(p)}
uniform float uScale, uGain, uReach, uTwist, uSpin;
attribute vec2 polar;
varying vec3 vCol;
varying float vA;
void main() {
  float a = polar.x, r = mix(${R1.toFixed(3)}, ${R2.toFixed(3)}, polar.y);
  float band = bandAt(a);
  float lag = (r - ${R1.toFixed(3)}) / ${FLOW.toFixed(3)};
  float v = spec(band, uNow - lag * ${COLS.toFixed(1)});
  float fade = exp(-(r - ${R1.toFixed(3)}) / uReach);
  float h = pow(v, 1.6) * (0.25 + 1.6 * exp(-(r - ${R1.toFixed(3)}) / 3.0));
  // The field turns as it flows out: each circle a little further round than the one inside it (spiral arms).
  float pa = a + uSpin + uTwist * lag;
  vec3 pos = vec3(sin(pa) * r, h, -cos(pa) * r);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float lit = 0.03 + 1.6 * v * v * v;
  gl_PointSize = uScale * (0.012 + 0.03 * v) / -mv.z;
  vCol = toneOf(band) * lit * fade * uGain;
  vA = 1.0;
}`;
}

const DOT_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol * (1.0 - d) * (1.0 - d), 1.0);
}`;

/** The bars: this instant's spectrum, a bar per slot round the ring, standing out from it. */
function barVert(p: Pal): string {
  return /* glsl */ `
${COMMON}
${tones(p)}
uniform float uGain, uKick;
attribute float slot;
varying vec3 vCol;
varying float vY;
void main() {
  float a = (slot + 0.5) / ${BARS.toFixed(1)} * 2.0 * PI;
  float band = bandAt(a);
  float v = spec(band, uNow);
  float len = 0.04 + 1.25 * pow(v, 1.5) * (1.0 + 0.25 * uKick);
  // position.x across the bar (−0.5..0.5), position.y along it (0..1).
  float r = ${R0.toFixed(3)} + 0.05 + position.y * len;
  float w = 0.6 * 2.0 * PI / ${BARS.toFixed(1)};
  float aa = a + position.x * w * ${R0.toFixed(3)} / r * 1.05;
  vec3 pos = vec3(sin(aa) * r, 0.01 + position.y * len * 0.08, -cos(aa) * r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  vCol = mix(toneOf(band), vec3(1.0), 0.25 * position.y) * (0.25 + 1.8 * v) * uGain;
  vY = position.y;
}`;
}

const BAR_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vY;
void main() { gl_FragColor = vec4(vCol * (0.55 + 0.45 * vY), 1.0); }`;

/** Shock rings: a flat band of light at radius r, its width w, its strength k (per ring, x y z). */
function shockFrag(p: Pal): string {
  return /* glsl */ `
uniform vec3 uShock[${SHOCKS}];
varying vec3 vPos;
const vec3 WHITE = ${v3(hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.6)))};
void main() {
  float r = length(vPos.xz), c = 0.0;
  for (int i = 0; i < ${SHOCKS}; i++) {
    vec3 s = uShock[i];
    if (s.z <= 0.0) continue;
    float e = (r - s.x) / s.y;
    c += s.z * exp(-e * e);
  }
  gl_FragColor = vec4(WHITE * c, 1.0);
}`;
}

const POS_VERT = /* glsl */ `varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export class Ripple implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);
  private ring: SpecRing;
  private u: Record<string, THREE.IUniform>;
  private shockU = Array.from({ length: SHOCKS }, () => new THREE.Vector3());
  private kicks: Float64Array;
  private kickV: Float64Array;
  private cover: THREE.Mesh;
  private orbit: LyricOrbit;
  /** Low views: the words standing round the cover instead, facing out. */
  private band: LyricOrbit;
  private az = 0;
  private readonly soft: boolean;
  private height = 1080;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.07);
    this.ring = new SpecRing(Spectrogram.of(init.stereo, music.duration + 8, NB, 30), RING);
    this.u = { tSpec: { value: this.ring.texture }, uNow: { value: 0 }, uScale: { value: 1000 }, uGain: { value: 1 }, uReach: { value: 3 }, uTwist: { value: 0.3 }, uSpin: { value: 0 }, uKick: { value: 0 }, uShock: { value: this.shockU } };

    // The field.
    const polar = new Float32Array(SPOKES * CIRCLES * 2);
    for (let j = 0; j < CIRCLES; j++) for (let i = 0; i < SPOKES; i++) {
      const o = (j * SPOKES + i) * 2;
      polar[o] = ((i + 0.5 + (j % 2) * 0.5) / SPOKES) * Math.PI * 2;
      polar[o + 1] = j / (CIRCLES - 1);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('polar', new THREE.BufferAttribute(polar, 2));
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPOKES * CIRCLES * 3), 3));
    const field = new THREE.Points(fg, new THREE.ShaderMaterial({ vertexShader: fieldVert(palette), fragmentShader: DOT_FRAG, uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    field.frustumCulled = false;

    // The bars: one quad, instanced round the ring.
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const bg = new THREE.InstancedBufferGeometry();
    bg.index = quad.index;
    bg.setAttribute('position', quad.getAttribute('position'));
    bg.setAttribute('slot', new THREE.InstancedBufferAttribute(Float32Array.from({ length: BARS }, (_, i) => i), 1));
    bg.instanceCount = BARS;
    const bars = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: barVert(palette), fragmentShader: BAR_FRAG, uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    bars.frustumCulled = false;

    // The shock rings, on a disc over the field.
    const shocks = new THREE.Mesh(new THREE.RingGeometry(R0, R2 + 1, 256, 1).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      new THREE.ShaderMaterial({ vertexShader: POS_VERT, fragmentShader: shockFrag(palette), uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));

    // The cover, and a fine bright rim round it.
    this.cover = new THREE.Mesh(new THREE.CircleGeometry(R0, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: init.cover, color: new THREE.Color(0.9, 0.9, 0.9) }));
    this.cover.position.y = 0.03;
    const rim = new THREE.Mesh(new THREE.RingGeometry(R0, R0 + 0.025, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hue(palette.paper).multiplyScalar(1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = 0.001;
    this.cover.add(rim);

    this.scene.add(field, shocks, bars, this.cover);

    // The kicks that send shock rings: strong ones (and in the ballad look, downbeats instead).
    const ev = this.soft ? Array.from(music.downbeats, d => [d, 0.5] as [number, number]) : music.a.hits.kick.filter(h => h[1] > 0.35);
    this.kicks = Float64Array.from(ev, h => h[0]);
    this.kickV = Float64Array.from(ev, h => h[1]);

    // The words round the ring, lying on the field.
    this.orbit = new LyricOrbit(palette, { style: this.soft ? 'poem' : 'hook', em: 0.42, radius: 2.7, mode: 'flat', trans: { em: 0.2, radius: 2.15 }, ...voiceOpts(look, init.seed) });
    this.orbit.group.position.y = 0.05;
    this.band = new LyricOrbit(palette, { style: this.soft ? 'poem' : 'hook', em: 0.3, radius: 1.75, mode: 'band', trans: { em: 0.14, radius: 1.75 }, ...voiceOpts(look, init.seed) });
    this.band.group.position.y = 0.55;
    this.scene.add(this.orbit.group, this.band.group);
    this.scene.onBeforeRender = renderer => { this.height = renderer.getDrawingBufferSize(new THREE.Vector2()).y; };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  keepUp(t: number): void {
    this.ring.spec.prefetch(t, 0.8);
  }

  private pose(t: number, shot: Shot): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const cam = this.camera;
    cam.up.set(0, 1, 0);
    if (shot.variant === 'face') {
      // From above, the far side up: the cover square in the middle.
      const r = 9.5 - 0.8 * k, a = phase * 0.05;
      cam.position.set(Math.sin(a) * 1.2, r, 1.2 * Math.cos(a));
      cam.up.set(0, 0, -1);
      cam.lookAt(0, 0, 0);
      this.az = 0;
    } else if (shot.variant === 'low') {
      const az = (phase - 3.14) * 0.15 + side * 0.12 * k, r = 6.2 - 0.6 * k;
      cam.position.set(Math.sin(az) * r, 0.75, Math.cos(az) * r);
      cam.lookAt(0, 0.35, 0);
      this.az = az;
    } else {
      const az = phase * 0.3 - 0.45 + side * t * 0.05, el = 0.6, r = 8.8 - 0.8 * k;
      cam.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
      cam.lookAt(0, -0.4, 0);
      this.az = az;
    }
    cam.updateMatrixWorld();
  }

  update(ctx: FrameCtx): void {
    const { t, shot, music } = ctx;
    this.pose(t, shot);
    const now = t * COLS;
    this.ring.sync(Math.floor(now) - Math.ceil(((R2 - R1) / FLOW) * COLS) - 4, Math.floor(now) + 3);
    this.u.uNow.value = now;
    // Point size: pixels per unit at unit distance.
    this.u.uScale.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const sec = shot.section, loud = sec.label === 'chorus' || sec.label === 'drop';
    this.u.uGain.value = (0.75 + 0.45 * clamp01(sec.energy ?? 0.5)) * (loud ? 1.05 : 1);
    this.u.uReach.value = loud ? 4.5 : 3;
    const kick = this.soft ? 0 : music.pulse('kick', t, 0.12);
    this.u.uKick.value = kick;
    this.cover.scale.setScalar(1 + 0.06 * kick);
    this.cover.rotation.y = -t * 0.12;
    // Spiral arms: tighter in loud sections; the whole field turning slowly.
    this.u.uTwist.value = (this.soft ? 0.25 : 0.4) * (loud ? 1.5 : 1);
    this.u.uSpin.value = -t * 0.05;

    // Shock rings run out over the field at its own speed, a little faster at first.
    let m = 0;
    for (let i = lastIndex(this.kicks, t); i >= 0 && m < SHOCKS; i--) {
      const age = t - this.kicks[i];
      if (age > 3.5) break;
      const r = R1 + FLOW * age + 0.5 * surge(age, 0.06);
      this.shockU[m++].set(r, 0.03 + age * 0.05, this.kickV[i] * (loud ? 0.9 : 0.6) * Math.exp(-age / 0.8));
    }
    for (let i = m; i < SHOCKS; i++) this.shockU[i].set(0, 1, 0);

    // Flat round the ring, its top on the far side from the camera (so it never reads upside down); low views have
    // it standing round the cover.
    const low = shot.variant === 'low';
    this.orbit.group.visible = !low;
    this.band.group.visible = low;
    if (low) this.band.update(ctx.lyrics, t, sec.energy, () => this.az);
    else {
      this.orbit.group.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, this.az, 0, 'YXZ'));
      this.orbit.update(ctx.lyrics, t, sec.energy);
    }

    ctx.fx.bloom = this.soft ? 0.5 : loud ? 0.55 : 0.65;
    ctx.fx.vignette = 0.6;
    ctx.fx.grain = 0.03;
  }
}
