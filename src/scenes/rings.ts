// Rings: concentric hairline arcs like a dial, each ring cut into a different number of segments and turning
// its own way — in pulse they hold, then tick one segment on every beat; an outer ring of 16 steps lights up
// across the bar like a sequencer; the cover sits in the middle as a disc and swells on the kicks.
// The words run round a ring of their own between the dial and the sequencer, the word being sung at the top: the
// ring turns a notch as each word begins and the sung words trail away round it; the translation round the bottom.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, fitFov, inOutCubic, lerp, outExpo, rng, snap } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { voiceOpts } from './lyricBlock.ts';
import { COLS, Spectrogram } from './viz.ts';

const SEGMENTS = [3, 6, 8, 12, 16, 24, 32, 48, 64];
const NB = 64;
const discVertex = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const discFragment = /* glsl */ `
  uniform sampler2D uCover; uniform float uGlow; varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(texture2D(uCover, vUv).rgb * (0.9 + uGlow), smoothstep(1.0, 0.97, r));
  }`;

export class Rings implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  private lines = new LineBatch(6000);
  private disc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private orbit: LyricOrbit;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private colors: Array<[number, number, number]>;
  private spec: Spectrogram;
  private level = new Float32Array(NB);

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.spec = Spectrogram.of(init.stereo, init.music.duration + 8, NB, 30);
    this.scene.background = palette.ink.clone();
    const c = (x: THREE.Color): [number, number, number] => [x.r, x.g, x.b];
    this.colors = [c(palette.paper), c(palette.accent), c(palette.signal)];
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: discVertex, fragmentShader: discFragment, transparent: true,
      uniforms: { uCover: { value: init.cover }, uGlow: { value: 0 } },
    }));
    this.scene.add(this.disc, this.lines.mesh);
    this.orbit = new LyricOrbit(palette, { style: look === 'ballad' ? 'poem' : 'hook', em: 0.55, radius: 3.2, mode: 'flat', trans: { em: 0.26, radius: 2.3 }, ...voiceOpts(look, init.seed) });
    this.orbit.group.position.z = 0.15;
    this.scene.add(this.orbit.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // (A portrait frame: the dial across it, so the words round it stay in.)
    this.camera.fov = fitFov(42, aspect);
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  keepUp(t: number): void {
    this.spec.prefetch(t, 0.8);
  }

  /** Each band's peak of the last 0.15 s, falling away over it (a pure function of t), stretched to 0..1. */
  private levels(t: number): Float32Array {
    const c0 = Math.floor(t * COLS), out = this.level;
    if (!this.init.stereo) return out.fill(0.5);
    out.fill(0);
    for (let k = 0; k < 9; k++) {
      const col = this.spec.column(c0 - k);
      for (let b = 0; b < NB; b++) out[b] = Math.max(out[b], col[b] - k * 0.03);
    }
    for (let b = 0; b < NB; b++) out[b] = clamp01((out[b] - 0.35) / 0.6);
    return out;
  }

  private arc(r: number, z: number, a0: number, a1: number, w: number, rgb: [number, number, number], I: number): void {
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.08));
    let px = r * Math.cos(a0), py = r * Math.sin(a0);
    for (let s = 1; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps, x = r * Math.cos(a), y = r * Math.sin(a);
      this.lines.seg(px, py, z, x, y, z, w, rgb[0] * I, rgb[1] * I, rgb[2] * I);
      px = x; py = y;
    }
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const info = music.at(t);
    const soft = this.look === 'ballad';
    const energy = shot.section.energy;
    const kick = soft ? 0 : music.pulse('kick', t, 0.12);
    const hat = music.pulse('hat', t, 0.06);
    const random = rng(shot.seed);
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const L = this.lines;
    L.clear();
    const beatI = Math.floor(info.pos), ph = info.pos - beatI;
    // The dial is an equaliser too: the rings run from the bass inside to the treble outside, and each segment is its
    // own slice of its ring's bands (mirrored round, so the dial stays symmetrical): as bright, as thick and as far
    // out as that slice is loud.
    const lv = this.levels(t);
    for (let ring = 0; ring < 9; ring++) {
      const n = SEGMENTS[(ring + Math.floor(random() * 3)) % SEGMENTS.length];
      const r = 1.05 + ring * 0.33, z = -ring * 0.12;
      const dir = ring % 2 ? 1 : -1;
      const step = (2 * Math.PI) / n;
      // Pulse: one segment per beat, snapping; ballad: a slow steady turn.
      const turn = soft ? t * 0.08 * dir * (1 + ring * 0.1) : dir * step * (beatI + snap(ph / 0.25));
      const rgb = this.colors[ring % 3 === 2 ? 2 : ring % 3 === 1 ? 1 : 0];
      const I = (0.35 + 0.08 * ring) * (1 + (ring < 3 ? kick * 1.2 : 0)) * (0.8 + energy * 0.4);
      const fill = 0.62 + 0.25 * Math.sin(ring * 1.7 + random() * 6);
      const b0 = Math.floor((ring / 9) * NB), bw = NB / 9;
      for (let s = 0; s < n; s++) {
        const m = Math.abs(((s + 0.5) / n) * 2 - 1); // 0 at one side of the ring, 1 at the other, mirrored
        const v = lv[Math.min(NB - 1, Math.floor(b0 + m * (bw - 1)))];
        this.arc(r + v * 0.14, z, turn + s * step, turn + s * step + step * fill, (ring === 0 ? 2.2 : 1.2) * (0.7 + 1.6 * v), rgb, I * (0.3 + 2.2 * v * v));
      }
    }
    // Sequencer: 16 steps round the outside; the current step and the downbeats glow.
    const R = 4.35, step16 = Math.floor(info.barPhase * 16);
    for (let s = 0; s < 16; s++) {
      const a = Math.PI / 2 - (s / 16) * Math.PI * 2;
      const on = s === step16 ? 2.4 : s < step16 ? 0.6 : 0.18;
      const len = s % 4 === 0 ? 0.32 : 0.16;
      const I = on * (1 + hat * 0.8);
      const rgb = s === step16 ? this.colors[2] : this.colors[0];
      L.seg(R * Math.cos(a), R * Math.sin(a), -1.2, (R + len) * Math.cos(a), (R + len) * Math.sin(a), -1.2, 2, rgb[0] * I, rgb[1] * I, rgb[2] * I);
    }
    L.commit(this.resolution, this.pixelRatio);

    // The cover disc swells on kicks.
    const s = 1.7 * (1 + kick * 0.06);
    this.disc.scale.set(s, s, 1);
    this.disc.material.uniforms.uGlow.value = kick * 0.3;

    const cam = this.camera;
    const sign = random() < 0.5 ? -1 : 1;
    if (shot.variant === 'tilt') {
      const a = sign * lerp(0.5, 0.2, inOutCubic(k)), e = lerp(0.35, 0.15, k);
      cam.position.set(Math.sin(a) * 11 * Math.cos(e), Math.sin(e) * 11, Math.cos(a) * 11 * Math.cos(e));
    } else {
      cam.position.set(0, 0, lerp(12.5, 10, inOutCubic(k)));
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, -0.5);
    cam.rotateZ(soft ? 0 : Math.sin(t * 0.3) * 0.04);
    cam.updateMatrixWorld();

    ctx.fx.bloom = soft ? 0.45 : 0.5 + kick * 0.3;
    this.orbit.update(ctx.lyrics, t, energy);
  }
}
