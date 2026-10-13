// Ridges: the cover as a range of ridgelines, after Joy Division's 《Unknown Pleasures》 — each row of the cover a
// hairline whose height is that row's brightness (peaking in the middle, as on the record), the rows standing one
// behind another, each hiding the ones behind it. The level lifts the whole range; every kick sends a wave from the
// front row to the back that lifts and lights the ridges it passes in the signal colour; the lines shimmer a little
// all the time. Cameras: the classic three-quarter view from above, low over the front ridge, a slow drift across.
// The words stand in the range, halfway back: each line rises from behind the ridges in front of it like the sun
// from behind hills, and the nearer ridges keep hiding its foot (ballad lines stand to one side).
// 墨 (ink): the same rows of the cover become ranges of mountains on rice paper, one behind another as in a 平远
// landscape — the near ones in thick ink, the far ones a pale wash in the cover's colour, each crest dark and its
// foot lost in drifting mist, a dry-brush grain down the slopes. They breathe with the level; the bar is a breath of
// the ink. The view moves slowly across them like an unrolled scroll; the words are written in columns in the sky.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { INK_BLACK, ricePaper } from './ink.ts';

const ROWS = 48;
const COLS = 150;
const WIDTH = 8.4;
const DEPTH = 6.5;
const FLOOR = -1.2;

/** Ink: ranges, columns per range, the camera's distance to the nearest and how much further each next one is. */
const RANGES = 13;
const HCOLS = 180;
const NEAR = 7, STEP = 1.25, EYE_Z = 8;

const HILL_VERT = /* glsl */ `
  attribute float aCrest, aLayer, aAmp;
  varying vec3 vW;
  varying float vCrest, vLayer, vAmp;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    vCrest = aCrest; vLayer = aLayer; vAmp = aAmp;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;
const HILL_FRAG = /* glsl */ `
  uniform vec3 uPaper, uInk, uWash;
  uniform float uTime, uMist, uBreath;
  varying vec3 vW;
  varying float vCrest, vLayer, vAmp;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    // Measured in the range's own height: 0 at the crest, 1 a whole range lower.
    vec2 q = vec2(vW.x, vW.y) / vAmp;
    float below = max(vCrest - vW.y, 0.0) / vAmp;
    // The foot of each range is lost in mist that drifts along it (the far ones sooner).
    float drift = fbm(vec2(q.x * 0.6 + uTime * 0.05 + vLayer * 7.0, q.y * 1.4 - uTime * 0.02));
    float foot = mix(0.35, 1.25, drift) * mix(1.0, 0.55, vLayer) * (1.0 - 0.3 * uMist);
    float body = 1.0 - smoothstep(0.0, foot, below);
    body *= body;
    // 皴 and the wash: blotches of heavier ink, and a fainter dry-brush grain down the slopes.
    float wash = fbm(vec2(q.x * 3.0, q.y * 2.2 + vLayer * 3.0));
    float grainS = fbm(vec2(q.x * 14.0, q.y * 2.5 + vLayer * 5.0));
    float tex = 0.7 + 0.45 * wash + 0.18 * (grainS - 0.5);
    // The crest is drawn (勾), darker on the near ranges.
    float rim = 1.0 - smoothstep(0.0, 0.025 + 0.02 * vLayer, below);
    float depth = mix(1.0, 0.16, pow(vLayer, 0.65));
    float tone = depth * body * tex + rim * 0.25 * (1.0 - vLayer) * body;
    tone = clamp(tone * (1.0 + 0.06 * uBreath), 0.0, 1.0);
    // Near ranges in ink; further back the wash carries more of the cover's colour (淡彩).
    vec3 ink = mix(uInk, uWash, 0.2 + 0.6 * vLayer);
    float grain = fbm(gl_FragCoord.xy * 0.4);
    gl_FragColor = vec4(mix(uPaper * (0.95 + 0.05 * grain), ink, tone), 1.0);
  }`;

/** A little 1D value noise (for the crags along a crest). */
function crag(x: number, seed: number): number {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    const p = x * f + seed * 17.3 + o * 5.1, i = Math.floor(p), u = p - i, s = u * u * (3 - 2 * u);
    const h = (n: number) => { const r = Math.sin(n * 127.1 + seed * 31.7) * 43758.5453; return r - Math.floor(r); };
    v += a * lerp(h(i), h(i + 1), s);
    a *= 0.5; f *= 2.1;
  }
  return v;
}

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
  /** Ink: the ranges (crest heights at rest, the mesh, its crest attribute) and the shot being drawn. */
  private hills: { rest: Float32Array; amp: Float32Array; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> } | null = null;
  private shot: Shot | null = null;
  private level = 0;
  private levelT = -1;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' | 'ink' = 'pulse') {
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
    if (look === 'ink') this.buildHills();
  }

  /**
   * The ink ranges: each a strip from its crest down below the frame. A range's crest is a row of the cover (the
   * near ones from its bottom, the far ones from its top), smoothed into slopes, with one or two peaks of its own and
   * crags along it; its height grows with its distance, so the far ones stand up behind the near.
   */
  private buildHills(): void {
    const { palette, coverPixels: px, coverSize: S } = this.init;
    const paper = ricePaper(palette);
    this.scene.background = paper.clone();
    this.scene.remove(this.fill, this.lines.mesh, this.rig.group);
    const random = rng(Math.round(this.init.music.duration * 977) ^ 0x5eed);
    const n = RANGES * HCOLS * 2;
    const pos = new Float32Array(n * 3), crest = new Float32Array(n), layer = new Float32Array(n), ampA = new Float32Array(n);
    const rest = new Float32Array(RANGES * HCOLS), amp = new Float32Array(RANGES);
    const raw = new Float32Array(HCOLS), index: number[] = [];
    for (let j = 0; j < RANGES; j++) {
      const f = j / (RANGES - 1), dist = NEAR * Math.pow(STEP, j), z = EYE_Z - dist, width = dist * 1.9 + 26;
      amp[j] = dist * (0.15 + 0.06 * random());
      const sy = Math.min(S - 1, Math.floor((1 - (0.08 + 0.84 * f)) * S));
      for (let i = 0; i < HCOLS; i++) {
        const sx = Math.min(S - 1, Math.floor((0.04 + 0.92 * (i / (HCOLS - 1))) * S)), o = (sy * S + sx) * 4;
        raw[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
      }
      // Peaks with pointed summits (a range or two of the middle distance gets the tall main peak, 主峰).
      const main = j >= 4 && j <= 7 && random() < 0.55;
      const peaks = [0, 1, 2].map(n => ({ c: 0.1 + 0.8 * random(), w: 0.035 + 0.09 * random(), h: (0.45 + 0.55 * random()) * (main && n === 0 ? 1.9 : 1) }));
      const seed = random() * 100;
      for (let i = 0; i < HCOLS; i++) {
        let s = 0, c = 0;
        for (let d = -7; d <= 7; d++) { const q = i + d; if (q >= 0 && q < HCOLS) { s += raw[q]; c++; } }
        const u = i / (HCOLS - 1);
        const peak = Math.max(...peaks.map(p => p.h * Math.exp(-Math.abs(u - p.c) / p.w)));
        const rock = 0.3 * (crag(u * 14, seed) - 0.5) + 0.1 * (crag(u * 45, seed + 3) - 0.5);
        const h = (0.1 + 0.28 * (s / c) + 0.85 * peak + rock * (0.4 + peak)) * amp[j];
        rest[j * HCOLS + i] = h;
        const v = (j * HCOLS + i) * 2, x = (u - 0.5) * width;
        pos.set([x, h, z, x, -amp[j] * 1.6 - 3, z], v * 3);
        crest[v] = crest[v + 1] = h;
        layer[v] = layer[v + 1] = f;
        ampA[v] = ampA[v + 1] = amp[j];
        if (i + 1 < HCOLS) index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCrest', new THREE.BufferAttribute(crest, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    g.setAttribute('aAmp', new THREE.BufferAttribute(ampA, 1));
    g.setIndex(index);
    const wash = INK_BLACK.clone().lerp(palette.accent, 0.55).lerp(palette.signal, 0.15);
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: HILL_VERT, fragmentShader: HILL_FRAG, side: THREE.DoubleSide,
      uniforms: { uPaper: { value: paper }, uInk: { value: INK_BLACK.clone() }, uWash: { value: wash }, uTime: { value: 0 }, uMist: { value: 0 }, uBreath: { value: 0 } },
    }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.hills = { rest, amp, mesh };
    // The words: brush-written columns in the sky, over the ranges.
    this.rig = new LyricRig(palette, 'poem');
    this.rig.onLight = true;
    this.rig.frame = { vh: 6.5, vw: 8.4 };
    this.rig.place = (root, st) => {
      const shot = this.shot;
      if (!shot) return 0;
      const eye = new THREE.Vector3(), target = new THREE.Vector3();
      this.hillPose(shot, Math.max(st.line.start, shot.start), eye, target);
      const fw = target.sub(eye).normalize(), right = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fw);
      const d = 20, vh = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2), vw = vh * this.camera.aspect;
      root.position.copy(eye).addScaledVector(fw, d).addScaledVector(right, (st.index % 2 ? 1 : -1) * vw * 0.3).addScaledVector(up, vh * 0.04);
      root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fw.clone().negate()));
      root.scale.setScalar(d * 0.1);
    };
    this.scene.add(this.rig.group);
    this.resize(this.init.aspect);
  }

  /** The ink camera: low over the near ranges, looking out across them, moving slowly sideways like a scroll. */
  private hillPose(shot: Shot, t: number, eye: THREE.Vector3, target: THREE.Vector3): void {
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start)), e = inOutCubic(k);
    const side = rng(shot.seed)() < 0.5 ? -1 : 1;
    if (shot.variant === 'low') {
      const x = side * lerp(1.6, -1.6, e);
      eye.set(x, 1.15, EYE_Z - 1.5);
      target.set(x * 0.6, 3.2, -60);
    } else if (shot.variant === 'drift') {
      const x = side * lerp(-7, 7, k);
      eye.set(x, 2.7, EYE_Z);
      target.set(x + side * 3, 1.2, -60);
    } else {
      // A slow push in over the near ranges, drifting across: the near ones slide past the far (one still view of
      // the ranges for twelve seconds read as a still).
      const x = side * lerp(2.6, -2.6, e);
      eye.set(x, lerp(3.2, 2.4, e), lerp(EYE_Z, EYE_Z - 3.5, e));
      target.set(x * 0.4, 1.4, -60);
    }
  }

  private updateHills(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const hills = this.hills!;
    this.shot = shot;
    // The level, followed slowly (a range doesn't jump): the ranges stand a little taller when the song is fuller.
    const rms = music.env('rms', t);
    this.level = this.levelT < 0 || Math.abs(t - this.levelT) > 0.5 ? rms : this.level + (rms - this.level) * Math.min(1, (t - this.levelT) * 1.5);
    this.levelT = t;
    const lift = 0.9 + 0.16 * this.level + 0.06 * shot.section.energy;
    const g = hills.mesh.geometry, pos = g.attributes.position as THREE.BufferAttribute, crest = g.attributes.aCrest as THREE.BufferAttribute;
    for (let k = 0; k < hills.rest.length; k++) {
      const h = hills.rest[k] * lift;
      pos.setY(k * 2, h);
      crest.setX(k * 2, h);
      crest.setX(k * 2 + 1, h);
    }
    pos.needsUpdate = crest.needsUpdate = true;
    const u = hills.mesh.material.uniforms, info = music.at(t);
    u.uTime.value = t;
    u.uMist.value = 0.3 + 0.5 * this.level;
    u.uBreath.value = Math.exp(-(info.inBar % music.meter) * 1.5);
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    this.hillPose(shot, t, eye, target);
    this.camera.position.copy(eye);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    ctx.fx.bloom = 0.04;
    ctx.fx.vignette = 0.25;
    ctx.fx.grain = 0.035;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy);
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
    if (this.hills) { this.updateHills(ctx); return; }
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
