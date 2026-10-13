// Channel: flying down a tube built of the song's spectrum. Each ring of light round the tube is the spectrum at one
// moment, mirrored four ways (the bass on the side walls, the treble over the top and the floor), its loud bands
// reaching in from the wall; the rings ahead are the sound still to come, dim, and each flares as it crosses "now" —
// a ring just ahead of the camera — then glows on behind it. So the tube narrows round every kick and every bass
// note before it arrives, and a drop is a wall of light rushing in. Every strong kick is also a bright hoop coming
// down the tube to meet the camera. The flight's speed is the music's (fractal.ts, Flight: calm sections drift,
// builds accelerate, a drop goes flat out, kicks surge); the tube turns slowly into a helix as it goes.
// Cameras: down the middle (axis), close to one wall, the rings streaming past (wall), rolling (roll). The words are
// signs ahead in the tube.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, rng, smooth } from './types.ts';
import { LyricBlocks, Stands, voiceFor } from './lyricBlock.ts';
import { COLS, SpecRing, Spectrogram } from './viz.ts';
import { Flight, hue, v3 } from './fractal.ts';
import { lastIndex } from '../director/music.ts';

const NB = 64;
const RING = 1024;
/** The tube's radius; points round each ring; rings a second; seconds of them behind and ahead of now. */
const R = 3;
const AROUND = 168;
const RATE = 30;
const BACK = 1;
const AHEAD = 6;
const ROWS = (BACK + AHEAD) * RATE;
/** How far ahead of the camera "now" is, seconds. */
const LEAD = 1.0;
const HOOPS = 12;

type Pal = { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color };

function vert(p: Pal): string {
  return /* glsl */ `
uniform sampler2D tSpec;
uniform sampler2D tRowZ;
uniform float uC0, uNow, uScale, uGain, uTwist;
attribute vec2 cell;
varying vec3 vCol;
const float PI = 3.14159265;
const vec3 LOW = ${v3(hue(p.accent))}, MID = ${v3(hue(p.signal))}, HIGH = ${v3(hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.3)))};
void main() {
  float a = cell.x, row = cell.y;
  float col = uC0 + row * ${(COLS / RATE).toFixed(1)};
  float band = abs(sin(a)) * ${(NB - 1).toFixed(1)};
  float v = texture2D(tSpec, vec2((band + 0.5) / ${NB.toFixed(1)}, (mod(col, ${RING.toFixed(1)}) + 0.5) / ${RING.toFixed(1)})).r;
  float z = texture2D(tRowZ, vec2((row + 0.5) / ${ROWS.toFixed(1)}, 0.5)).r;
  float r = ${R.toFixed(2)} * (1.0 - 0.55 * pow(v, 1.4));
  float aa = a + z * uTwist;
  vec3 pos = vec3(cos(aa) * r, sin(aa) * r, z);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Ahead: dim; crossing now: a flare; behind: glowing on, fading.
  float age = (uNow - col) / ${COLS.toFixed(1)};
  float lit = age < 0.0 ? 0.3 + 0.7 * exp(age * 2.5) : 1.0;
  lit *= 1.0 + 2.2 * exp(-pow(age / 0.06, 2.0));
  float k = band / ${(NB - 1).toFixed(1)};
  vec3 tone = k < 0.5 ? mix(LOW, MID, smoothstep(0.05, 0.5, k)) : mix(MID, HIGH, smoothstep(0.55, 1.0, k));
  vCol = tone * (0.06 + 1.7 * v * v) * lit * uGain;
  gl_PointSize = uScale * (0.035 + 0.05 * v) / -mv.z;
}`;
}

const DOT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol * (1.0 - d) * (1.0 - d), 1.0);
}`;

/** The hoops: a ring of light per strong kick, at its place down the tube (per hoop: z, strength, flare). */
function hoopFrag(p: Pal): string {
  return /* glsl */ `
uniform vec3 uHoop[${HOOPS}];
varying vec3 vPos;
const vec3 WHITE = ${v3(hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.5)))}, SIG = ${v3(hue(p.signal))};
void main() {
  float c = 0.0, f = 0.0;
  for (int i = 0; i < ${HOOPS}; i++) {
    vec3 h = uHoop[i];
    if (h.y <= 0.0) continue;
    float e = (vPos.z - h.x) / 0.18;
    float g = exp(-e * e) * h.y;
    c += g;
    f += g * h.z;
  }
  gl_FragColor = vec4(mix(SIG, WHITE, clamp(f / max(c, 1e-4), 0.0, 1.0)) * c, 1.0);
}`;
}

const POS_VERT = /* glsl */ `varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export class Channel implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400);
  private ring: SpecRing;
  private flight: Flight;
  private cruise: number;
  private rowZ = new Float32Array(ROWS);
  private rowTex: THREE.DataTexture;
  private u: Record<string, THREE.IUniform>;
  private hoopU = Array.from({ length: HOOPS }, () => new THREE.Vector3());
  private hoopTube: THREE.Mesh;
  private kicks: Float64Array;
  private kickV: Float64Array;
  private blocks: LyricBlocks;
  /** Lines stand down the tube a little above its axis, left and right by turns. */
  private stands = new Stands([[-0.1, 0.08], [0.1, 0]]);
  private readonly soft: boolean;
  private height = 1080;
  private baseFov = 70;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.06);
    this.ring = new SpecRing(Spectrogram.of(init.stereo, music.duration + 8, NB, 30), RING);
    this.flight = new Flight(music, this.soft);
    this.cruise = 7 * (clamp01(((music.a.bpm || 120) - 60) / 120) * 0.5 + 0.75);
    this.rowTex = new THREE.DataTexture(this.rowZ, ROWS, 1, THREE.RedFormat, THREE.FloatType);
    this.rowTex.minFilter = this.rowTex.magFilter = THREE.NearestFilter;
    this.rowTex.needsUpdate = true;
    this.u = { tSpec: { value: this.ring.texture }, tRowZ: { value: this.rowTex }, uC0: { value: 0 }, uNow: { value: 0 }, uScale: { value: 1000 }, uGain: { value: 1 }, uTwist: { value: 0.02 }, uHoop: { value: this.hoopU } };

    const cells = new Float32Array(AROUND * ROWS * 2);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < AROUND; i++) {
      const o = (j * AROUND + i) * 2;
      cells[o] = ((i + 0.5 * (j % 2)) / AROUND) * Math.PI * 2;
      cells[o + 1] = j;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('cell', new THREE.BufferAttribute(cells, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AROUND * ROWS * 3), 3));
    const points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vert(palette), fragmentShader: DOT_FRAG, uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    points.frustumCulled = false;

    // The hoops: an open cylinder just inside the tube's wall, lit only where a hoop is.
    this.hoopTube = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 1, 96, 1, true).rotateX(Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: POS_VERT, fragmentShader: hoopFrag(palette), uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.hoopTube.frustumCulled = false;
    this.scene.add(points, this.hoopTube);

    const ev = music.a.hits.kick.filter(h => h[1] > 0.45);
    this.kicks = Float64Array.from(ev, h => h[0]);
    this.kickV = Float64Array.from(ev, h => h[1]);

    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 0.95, maxW: this.soft ? 11 : 13, trans: 0.48, dust: [0, 1.2, 0] });
    this.scene.add(this.blocks.group);
    this.scene.onBeforeRender = renderer => { this.height = renderer.getDrawingBufferSize(new THREE.Vector2()).y; };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  keepUp(t: number): void {
    this.ring.spec.prefetch(t, 0.8);
  }

  /** World z at song time t (flying towards −z). */
  private z(t: number): number { return -this.flight.at(t) * this.cruise; }

  private pose(t: number, shot: Shot): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const cam = this.camera, z = this.z(t - LEAD);
    let x = Math.sin(t * 0.37 + phase) * 0.25, y = Math.sin(t * 0.29 + phase * 2) * 0.2, roll = 0;
    if (shot.variant === 'wall') { x = side * R * 0.5; y = -R * 0.12; }
    else if (shot.variant === 'roll') roll = side * this.flight.at(t) * 0.05;
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(x * 0.3, y * 0.3, z - 20);
    cam.rotateZ(roll + 0.08 * Math.sin(t * 0.21 + phase));
    cam.updateMatrixWorld();
  }

  update(ctx: FrameCtx): void {
    const { t, shot } = ctx;
    this.pose(t, shot);
    const now = t * COLS, step = COLS / RATE;
    const c0 = Math.floor(now / step) * step - BACK * COLS;
    this.ring.sync(c0 - 2, c0 + ROWS * step + 2);
    for (let j = 0; j < ROWS; j++) this.rowZ[j] = this.z((c0 + j * step) / COLS);
    this.rowTex.needsUpdate = true;
    this.u.uC0.value = c0;
    this.u.uNow.value = now;
    this.u.uScale.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const sec = shot.section, loud = sec.label === 'chorus' || sec.label === 'drop';
    this.u.uGain.value = (0.7 + 0.5 * clamp01(sec.energy ?? 0.5)) * (loud ? 1.15 : 1);
    this.u.uTwist.value = (loud ? 0.03 : 0.015) * (this.soft ? 0.5 : 1);
    this.hoopTube.position.z = this.z(t);
    this.hoopTube.scale.set(1, 1, 400);

    // Hoops: the strong kicks of the next few seconds and the last one, white as they cross now.
    let m = 0;
    for (let i = Math.max(0, lastIndex(this.kicks, t - 0.6)); i < this.kicks.length && m < HOOPS; i++) {
      const dt = this.kicks[i] - t;
      if (dt > AHEAD - 0.5) break;
      const k = this.kickV[i] * (loud ? 1.2 : 0.7) * (this.soft ? 0.5 : 1);
      const flare = Math.exp(-Math.pow(dt / 0.08, 2));
      const strength = k * (dt > 0 ? 0.35 + 0.65 * Math.exp(-dt * 1.2) : Math.exp(dt / 0.25)) * (1 + 1.5 * flare);
      this.hoopU[m++].set(this.z(this.kicks[i]), strength, flare);
    }
    for (let i = m; i < HOOPS; i++) this.hoopU[i].set(0, 0, 0);

    // Speed widens the lens and streaks the frame at the top end.
    const sp = this.flight.speedAt(t);
    const fov = this.baseFov + 18 * smooth((sp - 1.2) / 2);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // The words: each line one block standing down the tube, where the flight has it in view while it is sung, turned
    // to the camera as it rolls so it reads level (lyricBlock.ts); the camera flies through it as the next comes up.
    // (pose() moves the camera itself: it is borrowed for the times asked about, and put back.)
    const keepP = this.camera.position.clone(), keepQ = this.camera.quaternion.clone();
    const at = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => { this.pose(time, shot); pp.copy(this.camera.position); qq.copy(this.camera.quaternion); };
    const view = { reach: 9, far: 17, fov: this.camera.fov, aspect: this.camera.aspect, em: this.soft ? 0.064 : 0.068, level: true };
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root, leave, size) => {
      const s = this.stands.get(shot.start, st, leave, at, 0.95, view, size);
      s.apply(time, root);
      return smooth((s.depth(time) - 1.5) / 3);
    });
    this.camera.position.copy(keepP);
    this.camera.quaternion.copy(keepQ);
    this.camera.updateMatrixWorld();

    ctx.fx.bloom = this.soft ? 0.5 : loud ? 0.55 : 0.6;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.03;
    ctx.fx.zoom = Math.max(ctx.fx.zoom, 0.2 * smooth((sp - 1.6) / 2.2));
  }
}
