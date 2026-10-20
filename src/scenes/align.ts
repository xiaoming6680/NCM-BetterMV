// Align: the impossible triangle of the user's 《△ 三角》 (three beams that only close from one magic angle), made of
// this song's cover. The cover is cut into triangles, each moved to its own depth along the line of sight of one
// camera position and scaled to match — so from anywhere else they are shards scattered through space, and from
// exactly there they line up, pixel for pixel, into the cover. The camera drifts round the side, whips to the magic
// angle on a downbeat (the pieces close, a flash, a hairline frame round the cover), holds a beat, and drifts off
// again as it falls apart, on round until the shot ends.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, narrowness, outExpo, punch, rng, smooth, snap } from './types.ts';
import { Accents } from './hits.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { COLS as SPEC_COLS, Spectrogram } from './viz.ts';

const COLS = 14, ROWS = 14, HALF = 2; // the cover 4 × 4 units, 392 triangles
const EYE = 6; // the magic camera: (0, 0, EYE) looking at the origin
const NB = 64;

// The shards also play the song: across the cover, left to right, run the bands from the bass to the treble, and each
// shard slides along its own line of sight from the magic camera as its band comes in (an onset more than a level: in
// a loud passage every band sits high, and the shards stood out all together, hits or not), lighting up as it goes,
// and on every hit the whole cloud springs back along the lines of sight. A move along the line of sight changes
// nothing from the magic angle — there the cover still closes pixel for pixel — but from anywhere else the cloud of
// shards is a spectrum analyser in depth.
export class AlignScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 100);
  /** Each shard where it is now (from base and depth) and its triangle on the cover, depth and band. */
  private pieces: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  private bases: Array<{ tri: Array<[number, number]>; s: number; band: number }> = [];
  private geo: THREE.BufferGeometry;
  private spec: Spectrogram;
  private hits: Accents;
  private level = new Float32Array(NB);
  private past = new Float32Array(NB * 21);
  private lines = new LineBatch(3000);
  private rig: LyricRig;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  /** 0 → 1 as the camera whips onto the angle: the words' last stretch home. */
  private settled = 0;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    const random = rng(0x7a1e);
    this.spec = Spectrogram.of(init.stereo, init.music.duration + 8, NB, 30);
    this.hits = Accents.of(init.music);
    const uv: number[] = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const x0 = -HALF + (i / COLS) * 2 * HALF, x1 = -HALF + ((i + 1) / COLS) * 2 * HALF;
      const y0 = -HALF + (j / ROWS) * 2 * HALF, y1 = -HALF + ((j + 1) / ROWS) * 2 * HALF;
      const quads: Array<Array<[number, number]>> = (i + j) % 2
        ? [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]]
        : [[[x0, y0], [x1, y0], [x0, y1]], [[x1, y0], [x1, y1], [x0, y1]]];
      for (const tri of quads) {
        // Its depth: pulled towards the eye or pushed away, scaled so it covers the same part of the eye's view.
        const s = lerp(0.35, 1.75, random());
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        this.bases.push({ tri, s, band: Math.min(NB - 1, Math.floor(((cx + HALF) / (2 * HALF)) * NB)) });
        this.pieces.push([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
        for (let k = 0; k < 3; k++) uv.push((tri[k][0] + HALF) / (2 * HALF), (tri[k][1] + HALF) / (2 * HALF));
      }
    }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.bases.length * 9), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.bases.length * 9).fill(1), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.place(new Float32Array(NB));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: init.cover, side: THREE.DoubleSide, toneMapped: true, vertexColors: true }));
    mesh.frustumCulled = false;
    // The words are cut up like the cover: each word moved along the line of sight from the magic camera to a depth of
    // its own and scaled to match, so from that one angle it is where it belongs. A word comes in from deep off its
    // place and flies most of the way home as it is sung (readable from anywhere); the rest of the way it falls into
    // place with the cover when the camera whips onto the angle, and stays there as the camera drifts off (left
    // scattered, the line would read as jumbled words once the view leaves the angle).
    this.rig = new LyricRig(palette, 'hook');
    this.rig.faces = voiceFaces('pulse', init.seed);
    this.rig.place = root => { root.position.set(0, 0, 0.02); };
    this.rig.warp = (m, key, age) => {
      const off = (0.55 + 0.8 * rng(key * 7919 + 13)()) - 1;
      const s = 1 + off * (0.22 * (1 - this.settled) + 0.78 * (1 - smooth(age / 0.45)));
      m.position.set(m.position.x * s, m.position.y * s, EYE + (m.position.z - EYE) * s);
      m.scale.multiplyScalar(s);
    };
    this.scene.add(mesh, this.lines.mesh, this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // The words' frame, as wide as the view is at its height (a portrait frame: a third as wide; rows wrap sooner).
    const vh = 2 * EYE * Math.tan(THREE.MathUtils.degToRad(20));
    this.rig.frame = { vh, vw: vh * 1.6 * narrowness(aspect) };
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  keepUp(t: number): void {
    this.spec.prefetch(t, 0.8);
  }

  /**
   * Each band, 0..1: its onset (how far it is above the third of a second before), held and dying away over a quarter
   * second, plus a little of its level (the peak of the last 0.3 s, falling away). A pure function of t, falling
   * between columns too, so the shards don't step at 30 a second.
   */
  private levels(t: number): Float32Array {
    const x = t * SPEC_COLS, c0 = Math.floor(x), out = this.level.fill(0), past = this.past;
    if (!this.init.stereo) return out;
    // Columns c0 − 20 … c0, oldest first.
    for (let j = 0; j <= 20; j++) past.set(this.spec.column(c0 - 20 + j), j * NB);
    for (let b = 0; b < NB; b++) {
      let level = 0, onset = 0;
      for (let k = 0; k < 9; k++) {
        const j = 20 - k, v = past[j * NB + b], age = (x - (c0 - k)) / SPEC_COLS;
        // The third of a second before this column, leaving out the two just before it (the attack's own ramp).
        let base = 0;
        for (let i = j - 12; i <= j - 3; i++) base += past[i * NB + b];
        level = Math.max(level, v - 0.9 * age);
        onset = Math.max(onset, Math.max(0, v - base / 10 - 0.03) * Math.exp(-age / 0.12));
      }
      out[b] = clamp01(0.4 * clamp01((level - 0.4) / 0.55) + 2.2 * onset);
    }
    return out;
  }

  /**
   * Every shard slid along its line of sight from the magic eye by its band's level and lit by it, and all of them by
   * `knock` (the hits).
   */
  private place(level: Float32Array, knock = 0): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute, col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const on = this.init.stereo ? 1 : 0;
    this.bases.forEach((b, i) => {
      const v = level[b.band], s = b.s * (1 + 0.32 * v * on + 0.1 * knock), light = on ? 0.55 + 0.75 * v : 1;
      for (let k = 0; k < 3; k++) {
        const [x, y] = b.tri[k];
        this.pieces[i][k].set(x * s, y * s, EYE - EYE * s);
        pos.setXYZ(i * 3 + k, x * s, y * s, EYE - EYE * s);
        col.setXYZ(i * 3 + k, light, light, light);
      }
    });
    pos.needsUpdate = col.needsUpdate = true;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const beat = 60 / Math.max(40, music.at(t).bpm), bar = beat * music.meter;
    // The magic moment: the strongest hit round the downbeat about a bar into the shot, so the cover closes on a hit
    // the song really has (the grid's downbeat alone often had none: syncopated kicks fall between); else that
    // downbeat, or the shot's middle.
    let tm = music.downbeatAtOrAfter(shot.start + bar * 0.9);
    const hit = this.hits.strongest(tm - beat * 0.5, tm + beat);
    if (hit < shot.end - beat * 0.5) tm = hit;
    if (!(tm < shot.end - beat * 0.5)) tm = (shot.start + shot.end) / 2;
    const whip = 0.32; // seconds of the whip onto the angle
    // Off-axis angles: drifting before, whipped to 0 on the beat, held a beat, drifting off after.
    const th0 = 0.95 * side, ph0 = 0.32;
    let th: number, ph: number;
    if (t < tm - whip) {
      const drift = (t - shot.start) * 0.08 * side;
      th = th0 + drift; ph = ph0;
    } else if (t < tm) {
      const e = snap((t - (tm - whip)) / whip), before = th0 + (tm - whip - shot.start) * 0.08 * side;
      th = lerp(before, 0, e); ph = lerp(ph0, 0, e);
    } else {
      // …and keeps drifting once it is off (it used to stop dead there, the frame frozen for the rest of the shot).
      const after = Math.max(0, t - tm - beat), off = smooth(after / (bar * 1.5));
      th = -(0.45 * off + 0.06 * after) * side; ph = -0.12 * off - 0.02 * after;
    }
    this.settled = smooth((t - (tm - whip)) / whip);
    const cam = this.camera;
    cam.position.set(EYE * Math.sin(th) * Math.cos(ph), EYE * Math.sin(ph), EYE * Math.cos(th) * Math.cos(ph));
    cam.lookAt(0, 0, 0);
    cam.fov = 40;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Hairline seams on every shard; on the close, a frame round the whole cover, and a flash.
    const closed = t >= tm ? Math.exp(-(t - tm) / 0.5) : 0;
    const L = this.lines, { paper, signal } = this.init.palette;
    L.clear();
    // The seams fade as the view comes round to the angle, so at it the cover reads whole.
    const aligned = 1 - clamp01(Math.hypot(th, ph) / 0.35);
    const level = this.levels(t);
    this.place(level, Math.min(1.5, this.hits.sum(t, 1.2, age => punch(age, 0.2, 0.04))));
    this.pieces.forEach(([a, b, c], i) => {
      // (A loud shard's seams burn brighter; at the angle they all fade so the cover reads whole.)
      const seamI = (0.04 + 0.5 * (1 - aligned)) * (0.5 + 1.2 * level[this.bases[i].band]);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) L.seg(p.x, p.y, p.z, q.x, q.y, q.z, 1, paper.r * seamI, paper.g * seamI, paper.b * seamI);
    });
    const frame = t >= tm ? clamp01((t - tm) / 0.25) : 0;
    if (frame > 0) {
      const r = HALF * 1.06, I = 1.6 * (0.5 + closed);
      const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
      for (let k = 0; k < 4; k++) {
        const [x0, y0] = corners[k], [x1, y1] = corners[(k + 1) % 4];
        L.seg(x0, y0, 0, lerp(x0, x1, frame), lerp(y0, y1, frame), 0, 1.4, signal.r * I, signal.g * I, signal.b * I);
      }
    }
    L.commit(this.resolution, this.pixelRatio);
    ctx.fx.flash = Math.max(ctx.fx.flash, 0.15 * Math.exp(-Math.max(0, t - tm) / 0.08) * (t >= tm ? 1 : 0));
    ctx.fx.bloom = 0.3 + 0.3 * closed;
    ctx.fx.vignette = 0.5;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
