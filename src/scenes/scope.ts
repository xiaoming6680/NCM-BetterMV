// Scope: an oscilloscope (after pdoom's “stable training run”: a fixed scope, a glowing trace behind glass), drawing
// this song's real signal at this instant with a phosphor beam (src/render/beam.ts: bright where it lingers, faint
// where it jumps, a short afterglow). A graticule of ten by eight divisions, small readouts along the bottom.
// Variant `wave`: the time base, triggered on a rising zero crossing so it stands still on a steady tone and dances on
// a busy one, its last few sweeps fading behind it. Variant `xy`: left channel across, right channel up, as a scope
// in XY mode shows a stereo signal — a diagonal for a mono mix, a tangle for a wide one, and for oscilloscope music
// the pictures it was written to draw. (It used to plot the mono mix against itself 4 ms later, which can't show them;
// the user: "你的示波器效果不真实啊", "Oscillofun 这首歌是示波器音乐，应该在示波器效果里有图案的".) For oscilloscope music the
// whole MV is this scope in phosphor green; `xy-near` and `xy-angle` frame it closer or from the side.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, rng } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { BeamBatch } from '../render/beam.ts';
import { LyricRig } from './lyricRig.ts';
import { textMesh } from '../render/text.ts';

const W = 7.2, H = 4.5; // the screen, world units (16:10), at the origin facing +z
const SWEEP = 0.04; // seconds across the screen
const AFTER = 6; // after-images of the time base
const SIGMA = 0.011; // the beam's spot (standard deviation), world units
/** P31, the usual oscilloscope phosphor (linear RGB). */
const PHOSPHOR = new THREE.Color(0.16, 1.0, 0.26);
/** The light the camera catches: one video frame of the beam in full, then the phosphor's afterglow. */
const FRAME = 1 / 60, GLOW = 0.012;
/** A beam slower than this (path per step, × SIGMA) saturates the phosphor: its light no longer grows. */
const SATURATE = 0.25;

type Text = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

export class ScopeScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private grid = new LineBatch(200);
  private beam: BeamBatch;
  private rig: LyricRig;
  private readout: Text;
  private readoutXy: Text;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  /** Light per beam step, XY: set so the song's typical stroke glows about evenly (a scope's intensity knob). */
  private xyEnergy = 1;
  private readonly xyMusic: boolean;

  constructor(private init: SceneInit) {
    this.scene.background = init.palette.ink.clone();
    this.xyMusic = !!init.xyMusic;
    this.beam = new BeamBatch(24000, this.xyMusic ? PHOSPHOR : init.palette.signal, SIGMA);
    const text = (s: string) => {
      const m = textMesh(s, 'light', 0.13, { px: 72, halo: 'none' });
      m.material.toneMapped = false;
      m.position.set(-W / 2, -H / 2 - 0.28, 0);
      return m;
    };
    this.readout = text(`CH1  0.2 V/div   ${Math.round((SWEEP / 10) * 1000)} ms/div   TRIG ↑ 0.00 V   ${Math.round(init.music.a.bpm)} BPM`);
    this.readoutXy = text('X  CH1 L  0.5 V/div      Y  CH2 R  0.5 V/div      XY');
    // The words are on the scope's screen, on the glass over the trace.
    this.rig = new LyricRig(init.palette, 'hook');
    this.rig.frame = { vh: H * 1.1, vw: W * 0.95 };
    this.rig.place = root => { root.position.set(0, 0, 0.05); };
    this.scene.add(this.grid.mesh, this.beam.mesh, this.readout, this.readoutXy, this.rig.group);
    this.xyEnergy = this.calibrate();
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

  private get rate(): number { return this.init.stereo?.rate ?? 22050; }
  private get up(): number { return this.rate >= 44100 ? 4 : 2; }

  private at(c: Int16Array, i: number): number { return i >= 0 && i < c.length ? c[i] / 32767 : 0; }

  /** A channel between samples (Catmull-Rom: the smooth path a scope's input would see, not straight jumps). */
  private smooth(c: Int16Array, f: number): number {
    const i = Math.floor(f), u = f - i;
    const p0 = this.at(c, i - 1), p1 = this.at(c, i), p2 = this.at(c, i + 1), p3 = this.at(c, i + 2);
    return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  }

  private mono(i: number): number {
    const st = this.init.stereo;
    return st ? (this.at(st.left, i) + this.at(st.right, i)) / 2 : 0;
  }

  /** XY light per step: the median step of the song's path (where it sounds) gives a stroke of about 0.8. */
  private calibrate(): number {
    const st = this.init.stereo;
    if (!st) return 1;
    const S = (H / 2) * 0.95, random = rng(0x5c09e), steps: number[] = [];
    for (let k = 0; k < 4000; k++) {
      const i = 1 + Math.floor(random() * (st.left.length - 2));
      const d = Math.hypot(this.at(st.left, i + 1) - this.at(st.left, i), this.at(st.right, i + 1) - this.at(st.right, i));
      if (d > 1e-4) steps.push((d * S) / this.up);
    }
    steps.sort((a, b) => a - b);
    const typical = steps.length ? steps[steps.length >> 1] : SIGMA;
    return (0.8 * Math.max(typical, SATURATE * SIGMA)) / SIGMA;
  }

  /** One step of the beam: its light, less when it is too slow for the phosphor to take more. */
  private step(ax: number, ay: number, bx: number, by: number, energy: number): void {
    const len = Math.hypot(bx - ax, by - ay);
    this.beam.add(ax, ay, bx, by, energy * Math.min(1, Math.max(0.001, len / (SATURATE * SIGMA))));
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const st = this.init.stereo;
    const xy = shot.variant.startsWith('xy');
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;

    // The graticule: ten by eight divisions, faint; the centre lines ticked.
    const G = this.grid, gc = this.xyMusic ? PHOSPHOR : palette.paper, g = this.xyMusic ? 0.07 : 0.18;
    G.clear();
    const line = (ax: number, ay: number, bx: number, by: number, w: number, k: number) => G.seg(ax, ay, 0, bx, by, 0, w, gc.r * g * k, gc.g * g * k, gc.b * g * k);
    for (let i = 0; i <= 10; i++) { const x = -W / 2 + (i / 10) * W; line(x, -H / 2, x, H / 2, i % 5 === 0 ? 1.1 : 0.8, 1); }
    for (let j = 0; j <= 8; j++) { const y = -H / 2 + (j / 8) * H; line(-W / 2, y, W / 2, y, j % 4 === 0 ? 1.1 : 0.8, 1); }
    for (let k = 0; k <= 50; k++) {
      const x = -W / 2 + (k / 50) * W, y = -H / 2 + (k / 50) * H, tk = k % 5 === 0 ? 0.09 : 0.05;
      line(x, -tk, x, tk, 0.8, 1.6);
      line(-tk, y, tk, y, 0.8, 1.6);
    }
    G.commit(this.resolution, this.pixelRatio);

    const B = this.beam;
    B.clear();
    if (st && xy) {
      // XY: the path of the last frame and its afterglow, left channel across, right channel up.
      const S = (H / 2) * 0.95, rate = this.rate, up = this.up;
      const end = t * rate, start = end - (FRAME + 4 * GLOW) * rate;
      let px = 0, py = 0;
      for (let f = Math.floor(start * up); f <= end * up; f++) {
        const fi = f / up, x = this.smooth(st.left, fi) * S, y = this.smooth(st.right, fi) * S;
        if (f > Math.floor(start * up)) {
          const age = (end - fi) / rate, w = age <= FRAME ? 1 : Math.exp(-(age - FRAME) / GLOW);
          this.step(px, py, x, y, this.xyEnergy * w);
        }
        px = x; py = y;
      }
    } else if (st) {
      // The time base: the sweeps at the last few frames' times, fainter each, auto-ranged.
      const rate = this.rate, n = Math.round(SWEEP * rate), dx = W / n;
      const e = (0.9 * Math.max(dx, SATURATE * SIGMA)) / SIGMA;
      const trigger = (i: number) => { for (let k = i; k > i - rate / 50; k--) if (this.mono(k - 1) < 0 && this.mono(k) >= 0) return k; return i; };
      for (let a = AFTER; a >= 0; a--) {
        const i0 = trigger(Math.floor((t - a / 45) * rate) - n);
        let m = 0.05;
        for (let k = 0; k < n; k += 4) m = Math.max(m, Math.abs(this.mono(i0 + k)));
        const gain = Math.min(4, 0.9 / m) * (H / 2) * 0.9;
        const I = (a === 0 ? 1 : 0.5 * Math.pow(0.55, a)) * (1 + 0.4 * music.pulse('kick', t, 0.1));
        let px = -W / 2, py = this.mono(i0) * gain;
        for (let k = 1; k <= n; k++) {
          const x = -W / 2 + k * dx, y = this.mono(i0 + k) * gain;
          this.step(px, py, x, y, e * I);
          px = x; py = y;
        }
      }
    }
    B.commit();
    this.readout.visible = !xy;
    this.readoutXy.visible = xy;
    for (const r of [this.readout, this.readoutXy]) r.material.color.copy(this.xyMusic ? PHOSPHOR : palette.paper).multiplyScalar(this.xyMusic ? 0.35 : 0.6);

    // A fixed camera on the scope, drifting in a little; closer, or from the side, for oscilloscope music.
    const cam = this.camera, k = clamp01(ctx.shotT / Math.max(0.2, shot.end - shot.start));
    if (shot.variant === 'xy-near') {
      cam.position.set(0.12 * side * (1 - k), 0.05, 5.2 - 0.4 * k);
      cam.lookAt(0, 0, 0);
    } else if (shot.variant === 'xy-angle') {
      const a = side * (0.42 - 0.12 * k);
      cam.position.set(Math.sin(a) * 8.4, 0.9, Math.cos(a) * 8.4);
      cam.lookAt(0, -0.1, 0);
    } else {
      // (Oscilloscope music: the screen is the whole picture, so a little closer.)
      const z = this.xyMusic ? 7.4 - 0.6 * k : 9.2 - 0.9 * k;
      cam.position.set(0.25 * side * (1 - k), 0.1, z);
      cam.lookAt(0, -0.1, 0);
    }
    cam.updateMatrixWorld();
    // A vector screen: glow, a little curvature, no scanlines.
    ctx.fx.bloom = this.xyMusic ? 0.45 : 0.6;
    ctx.fx.barrel = this.xyMusic ? 0.06 : 0.1;
    ctx.fx.vignette = 0.6;
    ctx.fx.grain = 0.04;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
