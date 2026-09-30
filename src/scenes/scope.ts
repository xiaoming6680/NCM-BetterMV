// Scope: the oscilloscope of pdoom's “stable training run” (a fixed scope, a glowing trace behind glass with fading
// after-images — the technique), drawing this song's real waveform at this instant. A graticule of ten by eight
// divisions; the trace triggered on a rising zero crossing so it stands still on a steady tone and dances on a busy
// one, its last few sweeps fading behind it; small readouts along the bottom. Variant `xy` plots the signal against
// itself a few milliseconds later: the sound's phase portrait, loops for a pure tone, a tangle for noise.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, rng } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { textMesh } from '../render/text.ts';

const RATE = 22050;
const W = 7.2, H = 4.5; // the screen, world units (16:10), at the origin facing +z
const SWEEP = 0.04; // seconds across the screen
const AFTER = 6; // after-images

export class ScopeScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private lines = new LineBatch(9000);
  private rig: LyricRig;
  private readout: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;

  constructor(private init: SceneInit) {
    this.scene.background = init.palette.ink.clone();
    this.readout = textMesh(`CH1  0.2 V/div   ${Math.round((SWEEP / 10) * 1000)} ms/div   TRIG ↑ 0.00 V   ${Math.round(init.music.a.bpm)} BPM`, 'light', 0.13, { px: 72, halo: 'none' });
    this.readout.material.toneMapped = false;
    this.readout.position.set(-W / 2, -H / 2 - 0.28, 0);
    this.rig = new LyricRig(init.palette, 'hook');
    this.scene.add(this.lines.mesh, this.readout, this.rig.group);
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

  private sample(i: number): number {
    const w = this.init.wave;
    return w && i >= 0 && i < w.length ? w[i] / 32767 : 0;
  }

  /** Index of a rising zero crossing at or before sample i (within 20 ms), so the sweep starts where it did before. */
  private trigger(i: number): number {
    for (let k = i; k > i - 441; k--) if (this.sample(k - 1) < 0 && this.sample(k) >= 0) return k;
    return i;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const L = this.lines, { paper, signal } = palette;
    L.clear();
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    // The graticule: ten by eight divisions, faint; the centre lines ticked.
    const g = 0.18;
    for (let i = 0; i <= 10; i++) { const x = -W / 2 + (i / 10) * W; L.seg(x, -H / 2, 0, x, H / 2, 0, i % 5 === 0 ? 1.1 : 0.8, paper.r * g, paper.g * g, paper.b * g); }
    for (let j = 0; j <= 8; j++) { const y = -H / 2 + (j / 8) * H; L.seg(-W / 2, y, 0, W / 2, y, 0, j % 4 === 0 ? 1.1 : 0.8, paper.r * g, paper.g * g, paper.b * g); }
    for (let k = 0; k <= 50; k++) {
      const x = -W / 2 + (k / 50) * W, y = -H / 2 + (k / 50) * H, tk = k % 5 === 0 ? 0.09 : 0.05;
      L.seg(x, -tk, 0, x, tk, 0, 0.8, paper.r * g * 1.6, paper.g * g * 1.6, paper.b * g * 1.6);
      if (k <= 50) L.seg(-tk, y, 0, tk, y, 0, 0.8, paper.r * g * 1.6, paper.g * g * 1.6, paper.b * g * 1.6);
    }
    // The trace and its after-images (the sweeps at the last few frames' times, fainter each).
    const n = Math.round(SWEEP * RATE), pts = 360;
    const gainOf = (i0: number) => { let m = 0.05; for (let k = 0; k < n; k += 4) m = Math.max(m, Math.abs(this.sample(i0 + k))); return Math.min(4, 0.9 / m); };
    for (let a = AFTER; a >= 0; a--) {
      const ta = t - a / 45, i0 = this.trigger(Math.floor(ta * RATE) - n);
      const gain = gainOf(i0), I = (a === 0 ? 2.2 : 0.9 * Math.pow(0.55, a)) * (1 + 0.6 * music.pulse('kick', t, 0.1));
      let px = 0, py = 0;
      for (let k = 0; k <= pts; k++) {
        const s = i0 + Math.round((k / pts) * n);
        let x: number, y: number;
        if (shot.variant === 'xy') {
          x = this.sample(s) * gain * (H / 2) * 0.95 * side;
          y = this.sample(s - 88) * gain * (H / 2) * 0.95; // four milliseconds behind
        } else {
          x = -W / 2 + (k / pts) * W;
          y = this.sample(s) * gain * (H / 2) * 0.9;
        }
        if (k > 0) L.seg(px, py, 0.01, x, y, 0.01, a === 0 ? 1.8 : 1.2, signal.r * I, signal.g * I, signal.b * I);
        px = x; py = y;
      }
    }
    L.commit(this.resolution, this.pixelRatio);
    this.readout.material.color.copy(paper).multiplyScalar(0.6);

    // A fixed camera on the scope, drifting in a little.
    const cam = this.camera, k = clamp01(ctx.shotT / Math.max(0.2, shot.end - shot.start));
    cam.position.set(0.25 * side * (1 - k), 0.1, 9.2 - 0.9 * k);
    cam.lookAt(0, -0.1, 0);
    cam.updateMatrixWorld();
    ctx.fx.bloom = 0.6;
    ctx.fx.barrel = 0.12;
    ctx.fx.vignette = 0.6;
    ctx.fx.scan = 0.25;
    ctx.fx.grain = 0.06;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
