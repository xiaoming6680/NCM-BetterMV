// Cubes (条纹方块), after the BGA of Aoi's c.s.q.n. (BOFXV, BGA by 出前) that issue #3 pointed to: a swarm of
// flat-shaded cubes tumbling at the camera over a field of diagonal stripes in two of the cover's colours.
// - The stripes: drawn on the frame itself (whatever way the camera looks), drifting along; each drum steps them on a
//   stripe, a strong one half a stripe — the colours trade places. A row of arrows (▶) grows across them in loud
//   sections, one more on each drum, a new row each bar.
// - The cubes: a few thousand, in a tube round the flight line (the middle stays clear for the words), lit flat in
//   three tones like the reference's — a face to the light, a side, a face in shadow. Each cube is a band of the
//   spectrum: it is as big and as bright as that band is loud now, so the swarm shimmers with the sound. A kick swells
//   them all and throws the swarm outwards a little. Their speed is the section's (the fractal plates' Flight).
// Cameras: down the flight line (flow), the same rolling (roll), across it, the swarm streaming sideways (side).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, punch, rng, smooth, snap } from './types.ts';
import { LyricBlocks, voiceFor } from './lyricBlock.ts';
import { COLS, Spectrogram } from './viz.ts';
import { Flight, hue, v3 } from './fractal.ts';
import { Accents } from './hits.ts';
import { lastIndex } from '../director/music.ts';

const N = 1600, NB = 16, DEPTH = 64, NEAR = 2, SPREAD = 26, CLEAR = 4.6;
/** World units a cruising second (scaled by the tempo). */
const CRUISE = 9;
const ARROWS = 8;

const BACK_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

function backFrag(ink: THREE.Color, sig: THREE.Color, paper: THREE.Color): string {
  return /* glsl */ `
uniform float uAspect, uAngle, uPhase, uPeriod, uTone, uArrows, uArrowY, uArrowDir, uArrowSize;
varying vec2 vUv;
const vec3 INK = ${v3(ink)}, SIG = ${v3(sig)}, PAPER = ${v3(paper)};
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float s = (p.x * cos(uAngle) + p.y * sin(uAngle)) / uPeriod + uPhase;
  float f = fract(s), aa = fwidth(s) * 1.2;
  float stripe = smoothstep(0.5 - aa, 0.5 + aa, f) * (1.0 - smoothstep(1.0 - aa, 1.0, f)) + (1.0 - smoothstep(0.0, aa, f));
  // Lighter in the middle, darker to the corners (the reference's gradient), all of it held down under the cubes.
  float r = length(p);
  vec3 col = mix(INK, SIG * (1.05 - 0.6 * r), clamp(stripe, 0.0, 1.0)) * uTone;
  // The arrows: a row of ▶ along y = uArrowY, pointing uArrowDir, the last one growing.
  if (uArrows > 0.0) {
    float h = uArrowSize, gap = h * 2.3, x0 = -uArrowDir * gap * 3.5;
    for (int i = 0; i < ${ARROWS}; i++) {
      float k = clamp(uArrows - float(i), 0.0, 1.0);
      if (k <= 0.0) break;
      vec2 q = vec2((p.x - (x0 + uArrowDir * gap * float(i))) * uArrowDir, p.y - uArrowY) / max(k, 0.05);
      float tri = step(-h, q.x) * step(q.x, h) * step(abs(q.y), (h - q.x) * 0.62);
      col = mix(col, PAPER * 0.92, tri);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;
}

const CUBE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aRot;
attribute vec3 aMeta;
uniform float uTravel, uT, uKick, uBurst;
uniform float uBand[${NB}];
varying vec3 vN;
varying float vTint, vFog, vLev;
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
void main() {
  float d = mod(aPos.z - uTravel, ${DEPTH.toFixed(1)});
  float lev = uBand[int(aMeta.y)];
  float size = aMeta.x * (0.3 + 1.0 * lev) * (1.0 + 0.2 * uKick) * smoothstep(0.0, 3.0, d);
  vec3 axis = normalize(aRot.xyz);
  float ang = uT * aRot.w + aPos.z * 3.1;
  vec3 c = vec3(aPos.xy * (1.0 + 0.22 * uBurst), -${NEAR.toFixed(1)} - d);
  vec4 mv = modelViewMatrix * vec4(c + turn(position * size, axis, ang), 1.0);
  vN = turn(normal, axis, ang);
  vTint = aMeta.z;
  vLev = lev;
  vFog = smoothstep(${(DEPTH * 0.85).toFixed(1)}, ${(DEPTH * 0.3).toFixed(1)}, d);
  gl_Position = projectionMatrix * mv;
}`;

function cubeFrag(ink: THREE.Color, sig: THREE.Color, acc: THREE.Color, paper: THREE.Color): string {
  return /* glsl */ `
varying vec3 vN;
varying float vTint, vFog, vLev;
const vec3 INK = ${v3(ink)}, SIG = ${v3(sig)}, ACC = ${v3(acc)}, PAPER = ${v3(paper)};
void main() {
  // Three flat tones: the face to the light, a side, the face in shadow.
  float l = dot(normalize(vN), normalize(vec3(-0.45, 0.8, 0.4)));
  float tone = l > 0.5 ? 1.0 : l > -0.15 ? 0.45 : 0.15;
  vec3 base = vTint < 0.72 ? SIG : vTint < 0.94 ? ACC : PAPER;
  // (Capped below white: brighter, the lit face and the side both clipped to one flat colour.)
  vec3 col = base * tone * (0.3 + 0.75 * vLev);
  gl_FragColor = vec4(mix(INK, col, vFog), 1.0);
}`;
}

export class Cubes implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 300);
  private spec: Spectrogram;
  private flight: Flight;
  private hits: Accents;
  private backU: Record<string, THREE.IUniform>;
  private cubeU: Record<string, THREE.IUniform>;
  private lev = new Float32Array(NB);
  private blocks: LyricBlocks;
  private readonly soft: boolean;
  private readonly tempo: number;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    const ink = palette.ink.clone().multiplyScalar(0.6);
    this.scene.background = ink.clone();
    this.spec = Spectrogram.of(init.stereo, music.duration + 8, NB, 40);
    this.flight = new Flight(music, this.soft);
    this.hits = Accents.of(music);
    this.tempo = clamp01(((music.a.bpm || 120) - 60) / 120) * 0.5 + 0.75;

    // The stripes, on the frame.
    this.backU = {
      uAspect: { value: 16 / 9 }, uAngle: { value: 0.6 }, uPhase: { value: 0 }, uPeriod: { value: 0.16 }, uTone: { value: 0.4 },
      uArrows: { value: 0 }, uArrowY: { value: 0 }, uArrowDir: { value: 1 }, uArrowSize: { value: 0.05 },
    };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: BACK_VERT, fragmentShader: backFrag(ink, hue(palette.signal), palette.paper), uniforms: this.backU, depthTest: false, depthWrite: false,
    }));
    back.frustumCulled = false;
    back.renderOrder = -10;
    this.scene.add(back);

    // The cubes: one instanced box, its place, spin and band per instance; a tube round the line kept clear.
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    const pos = new Float32Array(N * 3), rot = new Float32Array(N * 4), meta = new Float32Array(N * 3);
    const random = rng(0xc5a7);
    for (let i = 0; i < N; i++) {
      const a = random() * Math.PI * 2, r = CLEAR + (SPREAD - CLEAR) * Math.pow(random(), 1.6);
      pos.set([Math.cos(a) * r, Math.sin(a) * r * 0.75, random() * DEPTH], i * 3);
      rot.set([random() - 0.5, random() - 0.5, random() - 0.5, (random() < 0.5 ? -1 : 1) * (0.4 + 1.6 * random())], i * 4);
      // Mostly small, a few big; the bass bands nearer the line, the treble further out.
      const size = 0.2 + 1.1 * Math.pow(random(), 4);
      const band = Math.min(NB - 1, Math.floor(((r - CLEAR) / (SPREAD - CLEAR)) * NB * 0.7 + random() * NB * 0.3));
      meta.set([size, band, random()], i * 3);
    }
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(rot, 4));
    geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 3));
    geo.instanceCount = N;
    this.cubeU = { uTravel: { value: 0 }, uT: { value: 0 }, uKick: { value: 0 }, uBurst: { value: 0 }, uBand: { value: Array.from(this.lev) } };
    const cubes = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: CUBE_VERT, fragmentShader: cubeFrag(ink, hue(palette.signal), hue(palette.accent), palette.paper), uniforms: this.cubeU,
    }));
    cubes.frustumCulled = false;
    this.scene.add(cubes);

    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 1.45, maxW: this.soft ? 11 : 13, trans: 0.48, scrim: 0.62, dust: [0, 1.2, 0] });
    this.scene.add(this.blocks.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.backU.uAspect.value = aspect;
    this.blocks.setAspect(aspect);
  }

  keepUp(t: number): void {
    this.spec.prefetch(t, 0.6);
  }

  private pose(t: number, shot: Shot): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const cam = this.camera;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    if (shot.variant === 'side') {
      // Across the flight, a little ahead, the swarm streaming past.
      cam.position.set(side * 1.5, 0.4, -10);
      cam.lookAt(-side * 30, -1.5, -24);
    } else {
      cam.lookAt(0.6 * Math.sin(t * 0.21 + random() * 6), 0.4 * Math.sin(t * 0.17 + random() * 6), -30);
      if (shot.variant === 'roll') cam.rotateZ(side * t * 0.3);
    }
    cam.updateMatrixWorld();
  }

  update(ctx: FrameCtx): void {
    const { t, shot, music } = ctx;
    const sec = shot.section, loud = sec.label === 'chorus' || sec.label === 'drop';
    this.pose(t, shot);
    const random = rng(shot.seed ^ 0x77);

    // The spectrum now, held a little (quick up, down at 2 a second).
    const c = Math.floor(t * COLS);
    this.lev.fill(0);
    for (let k = 0; k <= 12; k++) {
      const col = this.spec.column(c - k), age = k / COLS;
      for (let b = 0; b < NB; b++) this.lev[b] = Math.max(this.lev[b], col[b] - age * 2);
    }
    const band = this.cubeU.uBand.value as number[];
    for (let b = 0; b < NB; b++) band[b] = clamp01((this.lev[b] - 0.15) / 0.85);

    const kick = music.pulse('kick', t, 0.14) * (this.soft ? 0.5 : 1);
    // The swarm's throw out on a hit: from the hits (≤ 4 a second), up in a few hundredths, back over a few tenths.
    const T = this.hits.times, i = lastIndex(T, t);
    const burst = i >= 0 ? this.hits.strength[i] * punch(t - T[i], 0.22, 0.04) : 0;
    this.cubeU.uKick.value = kick;
    this.cubeU.uBurst.value = burst * (this.soft ? 0.4 : 1);
    this.cubeU.uT.value = t;
    const travel = this.flight.at(t) * CRUISE * this.tempo;
    this.cubeU.uTravel.value = travel;

    // The stripes: drifting, a stripe on each hit since the shot began, half a stripe on the strong ones.
    let steps = 0;
    for (let j = i; j >= 0 && T[j] >= shot.start; j--) steps += snap((t - T[j]) / 0.13) * (this.hits.strength[j] >= 0.7 ? 0.5 : 1);
    const b = this.backU;
    b.uAngle.value = [0.6, -0.6, 0.35, 1.0][Math.floor(random() * 4)];
    b.uPeriod.value = loud ? 0.13 : 0.18;
    b.uPhase.value = t * (this.soft ? 0.12 : 0.3) + steps;
    b.uTone.value = (loud ? 0.38 : 0.28) * (this.init.palette.light ? 0.75 : 1);
    // The arrows: in loud sections, one more on each hit of the bar (eight at most), the newest growing in.
    const bar = music.at(t).bar, d0 = music.downbeats[bar] ?? 0;
    let arrows = 0;
    if (loud && !this.soft) {
      for (let j = i; j >= 0 && T[j] >= d0 - 0.05; j--) arrows += snap((t - T[j]) / 0.12);
      const r = rng((shot.seed ^ (bar * 2654435761)) >>> 0);
      b.uArrowY.value = (r() - 0.5) * 0.6;
      b.uArrowDir.value = r() < 0.5 ? -1 : 1;
      b.uArrowSize.value = 0.035 + 0.03 * r();
    }
    b.uArrows.value = Math.min(ARROWS, arrows);

    // The words: each line comes in with the swarm from deep in the flight line, slowing to a stop 14 units ahead as
    // it is sung (its speed falling to nothing), square to the camera; the next line's coming breaks it into dust.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root) => {
      const x = clamp01((time - (st.line.start - 0.7)) / 0.7);
      const depth = 14 + 34 * (1 - x) * (1 - x);
      root.position.copy(this.camera.position).addScaledVector(fwd, depth);
      root.quaternion.copy(this.camera.quaternion);
      return smooth(x / 0.4);
    });

    const speed = this.flight.speedAt(t) * CRUISE * this.tempo;
    ctx.fx.travel = shot.variant === 'side' ? 0 : speed;
    ctx.fx.bloom = this.soft ? 0.4 : 0.32;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.03;
    ctx.fx.zoom = Math.max(ctx.fx.zoom, 0.1 * smooth((speed - 14) / 20));
  }
}
