// Ridges: the cover as a range of ridgelines, after Joy Division's 《Unknown Pleasures》 — each row of the cover a
// hairline whose height is that row's brightness (peaking in the middle, as on the record), the rows standing one
// behind another, each hiding the ones behind it. The level lifts the whole range; every kick sends a wave from the
// front row to the back that lifts and lights the ridges it passes in the signal colour; the lines shimmer a little
// all the time. Cameras: the classic three-quarter view from above, low over the front ridge, a slow drift across.
// The words stand in the range, halfway back: each line rises from behind the ridges in front of it like the sun
// from behind hills, and the nearer ridges keep hiding its foot (ballad lines stand to one side).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';

const ROWS = 48;
const COLS = 150;
const WIDTH = 8.4;
const DEPTH = 6.5;
const FLOOR = -1.2;

export class Ridges implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  private lines = new LineBatch(ROWS * COLS + 64);
  private fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private fillPos: Float32Array;
  private profile: Float32Array;
  private kicks: Float64Array;
  private rig: LyricRig;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private ys = new Float32Array(COLS);
  private tint = new THREE.Color();
  private low = false;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    // Each row's brightness across the cover (front row = bottom of the cover), smoothed over a few columns.
    const S = init.coverSize, px = init.coverPixels;
    this.profile = new Float32Array(ROWS * COLS);
    for (let j = 0; j < ROWS; j++) {
      const sy = Math.min(S - 1, Math.floor((1 - (j + 0.5) / ROWS) * S));
      const raw = new Float32Array(COLS);
      for (let i = 0; i < COLS; i++) {
        const sx = Math.min(S - 1, Math.floor(((i + 0.5) / COLS) * S)), o = (sy * S + sx) * 4;
        raw[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
      }
      for (let i = 0; i < COLS; i++) {
        let s = 0, n = 0;
        for (let d = -2; d <= 2; d++) { const q = i + d; if (q >= 0 && q < COLS) { s += raw[q]; n++; } }
        this.profile[j * COLS + i] = s / n;
      }
    }
    // The fill under every ridge (a strip down to the floor) hides the rows behind it.
    this.fillPos = new Float32Array(ROWS * COLS * 2 * 3);
    const index: number[] = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i + 1 < COLS; i++) {
      const a = (j * COLS + i) * 2, b = a + 2;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.fillPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(index);
    this.fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: palette.ink, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    this.fill.frustumCulled = false;
    // Lines test against the fills (front ridges hide the ones behind) but add their light.
    this.lines.mesh.material.depthTest = true;
    this.lines.mesh.renderOrder = 2;
    this.scene.add(this.fill, this.lines.mesh);
    this.kicks = Float64Array.from(init.music.a.hits.kick.filter(h => h[1] > 0.35), h => h[0]);
    this.rig = new LyricRig(palette, look === 'ballad' ? 'poem' : 'hook');
    this.rig.frame = { vh: 6.5, vw: 8.4 };
    this.rig.depthTest = true;
    this.rig.place = (root, st) => {
      const up = outExpo(clamp01((st.age + 0.5) / 1.1)), x = look === 'ballad' ? (st.index % 2 ? 1 : -1) * 2.2 : 0;
      // Low over the front ridge only that ridge is in front of the words, so they rise from right behind it, smaller.
      if (this.low) { root.position.set(x * 0.3, 0.95 - (1 - up) * 0.7, -0.4); root.scale.setScalar(0.42); }
      else root.position.set(x, 0.75 - (1 - up) * 1.6, -DEPTH * 0.5);
    };
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const soft = this.look === 'ballad';
    const energy = shot.section.energy;
    const rms = music.env('rms', t);
    const random = rng(shot.seed);
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    // The kick wave: from the front row to the back in half a second.
    const ki = lastIndex(this.kicks, t), kAge = ki >= 0 ? t - this.kicks[ki] : 99;
    const wave = soft ? -1 : kAge / 0.5, waveA = soft ? 0 : Math.pow(0.5, kAge / 0.3);
    const amp = (soft ? 0.55 : 0.7) * (0.55 + rms * 0.7 + energy * 0.35);
    const L = this.lines;
    L.clear();
    const paper = palette.paper, sig = palette.signal;
    for (let j = 0; j < ROWS; j++) {
      const f = j / (ROWS - 1), z = -f * DEPTH, base = f * 0.25;
      const w = waveA * Math.exp(-Math.pow((f - wave) * 7, 2));
      const bright = (0.35 + 0.65 * (1 - f)) * (soft ? 0.7 : 1);
      for (let i = 0; i < COLS; i++) {
        const u = i / (COLS - 1), x = (u - 0.5) * WIDTH;
        // Peaks in the middle, flat at the edges, as on the record; a living shimmer on top.
        const win = Math.exp(-Math.pow((u - 0.5) * 3.2, 2));
        const shimmer = Math.sin(u * 37 + t * 2.3 + j * 1.7) * Math.sin(u * 13 - t * 1.1 + j) * 0.06;
        const h = (this.profile[j * COLS + i] * amp + shimmer) * win * (1 + w * 1.6) + base;
        this.ys[i] = h;
        const o = (j * COLS + i) * 6;
        this.fillPos[o] = x; this.fillPos[o + 1] = h; this.fillPos[o + 2] = z;
        this.fillPos[o + 3] = x; this.fillPos[o + 4] = FLOOR; this.fillPos[o + 5] = z;
      }
      // Near ridges paper, far ones the accent; the ones the kick wave lifts, the signal colour.
      this.tint.copy(paper).lerp(palette.accent, f * 0.75).lerp(sig, clamp01(w * 3));
      const c = this.tint, I = bright * (1 + w * 2.5);
      for (let i = 0; i + 1 < COLS; i++) {
        const x0 = ((i / (COLS - 1)) - 0.5) * WIDTH, x1 = (((i + 1) / (COLS - 1)) - 0.5) * WIDTH;
        L.seg(x0, this.ys[i], z, x1, this.ys[i + 1], z, j < 4 ? 1.6 : 1.1, c.r * I, c.g * I, c.b * I);
      }
    }
    this.fill.geometry.attributes.position.needsUpdate = true;
    L.commit(this.resolution, this.pixelRatio);

    const cam = this.camera;
    const side = random() < 0.5 ? -1 : 1;
    this.low = shot.variant === 'low';
    if (shot.variant === 'low') {
      cam.position.set(side * lerp(0.6, -0.6, inOutCubic(k)), 0.55, 2.2);
      cam.lookAt(0, 0.35, -DEPTH * 0.6);
    } else if (shot.variant === 'drift') {
      cam.position.set(side * lerp(-2.6, 2.6, k), 2.3, 3.4);
      cam.lookAt(side * lerp(-0.8, 0.8, k), 0, -DEPTH * 0.45);
    } else {
      cam.position.set(side * lerp(0.35, -0.35, k), lerp(3.2, 2.7, inOutCubic(k)), lerp(4.6, 3.9, inOutCubic(k)));
      cam.lookAt(0, 0.1, -DEPTH * 0.42);
    }
    cam.updateMatrixWorld();

    ctx.fx.bloom = soft ? 0.35 : 0.45 + waveA * 0.25;
    ctx.fx.vignette = 0.55;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, energy);
  }
}
