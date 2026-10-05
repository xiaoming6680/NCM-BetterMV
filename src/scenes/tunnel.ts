// Tunnel: the motion-graphics tunnel of the user's 《△ 三角》 (MG1 `tunnel`), made to run for any song.
// ~110 glowing frames recede into ink fog, each turned a little more than the one before (a twist). Between two
// frames the wall is a faint zigzag mesh, lit by a shock ring that runs down the tunnel on every kick; comets
// run round the frames as spiral light bands; insets and rays flicker on the off-beats. Near paper-white, mid
// accent, far signal. When the section rises into a louder one the tunnel whips over its last beat (twist and
// roll) and its far end opens onto the cover, which rushes at the camera — the next shot is the cover itself.
// Pulse: triangles, fast, kick surges. Ballad: circles, slow and soft, no shock rings.
// The words are in the tunnel: pulse, a sign for every few words that the camera flies through (LyricGates); ballad,
// each line a hanging scroll to one side of the path that the camera glides past (the rig's world mode).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, rng, smooth } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { LyricGates, poseInTube } from './lyricSpace.ts';
import { lastIndex } from '../director/music.ts';

const R = 2.3; // frame circumradius
const S = 0.45; // spacing between frames along the path
const NF = 110; // frames drawn ahead of the camera
const FOV = 64;
const RINGS = 8; // shock rings in flight at once…
const RING_LIFE = 1.2; // …each until it has faded past the fog (seconds)
const GATE = 3.6; // pulse: a sign strikes on this far ahead…
const SCROLL = 6.5; // …ballad: a line's scroll hangs this far ahead of where the camera was when it began

type RGB = [number, number, number];
const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const fogAt = (d: number) => smooth((d - 0.3) / 1.1) * Math.exp(-d / 10);

/** Gentle S-bend in both axes. */
const center = (s: number, o: THREE.Vector3) => o.set(1.8 * Math.sin(0.07 * s - 1.0), 1.1 * Math.sin(0.1 * s + 0.4), -s);

const bgVertex = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const bgFragment = /* glsl */ `
  uniform vec2 uVP; uniform float uAspect, uHaze; uniform vec3 uInk, uGlow, uFar;
  varying vec2 vP;
  void main() {
    vec2 d = (vP - uVP) * vec2(uAspect, 1.0);
    float q = length(d) * 0.5;
    vec3 c = uInk + uGlow * uHaze * 0.3 * exp(-q * q * 9.0) + uFar * uHaze * 0.05 * exp(-q * q * 70.0);
    gl_FragColor = vec4(c, 1.0);
  }`;

interface Basis { c: THREE.Vector3; r: THREE.Vector3; u: THREE.Vector3; t: THREE.Vector3 }

export class Tunnel implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 400);
  private lines = new LineBatch(14000);
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private exit: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private rig: LyricRig;
  private gates: LyricGates;
  private kicks: Float64Array;
  private near: RGB; private mid: RGB; private far: RGB;
  private readonly soft: boolean;
  private readonly sides: number;
  private readonly speed: number;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private tmp = new THREE.Vector3();
  private upW = new THREE.Vector3(0, 1, 0);
  private bufA: THREE.Vector3[];
  private bufB: THREE.Vector3[];
  private ringR = new Float32Array(RINGS);
  private ringA = new Float32Array(RINGS);

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.soft = look === 'ballad';
    this.sides = this.soft ? 36 : 3;
    this.speed = this.soft ? 0.7 : S * 4;
    this.bufA = Array.from({ length: this.sides }, () => new THREE.Vector3());
    this.bufB = Array.from({ length: this.sides }, () => new THREE.Vector3());
    const rgb = (c: THREE.Color): RGB => [c.r, c.g, c.b];
    this.near = rgb(palette.paper);
    this.mid = rgb(palette.accent);
    this.far = rgb(palette.signal);
    this.kicks = Float64Array.from(init.music.a.hits.kick.filter(h => h[1] > 0.35), h => h[0]);

    this.scene.background = palette.ink.clone();
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: bgVertex, fragmentShader: bgFragment, depthTest: false, depthWrite: false,
      uniforms: {
        uVP: { value: new THREE.Vector2() }, uAspect: { value: 16 / 9 }, uHaze: { value: 1 },
        uInk: { value: palette.ink.clone() }, uGlow: { value: palette.accent.clone().lerp(palette.ink, 0.5) }, uFar: { value: palette.signal.clone() },
      },
    }));
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.scene.add(this.bg, this.lines.mesh);

    this.exit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: init.cover, toneMapped: true, depthTest: false, depthWrite: false }));
    this.exit.renderOrder = 4;
    this.exit.visible = false;
    this.scene.add(this.exit);

    this.rig = new LyricRig(palette, 'poem');
    this.rig.frame = { vh: 5.6, vw: 9 };
    this.gates = new LyricGates(palette, { style: 'hook', em: 0.7, maxW: 3.3, trans: { em: 0.24, vertical: false }, linger: 5 });
    this.scene.add(this.soft ? this.rig.group : this.gates.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bg.material.uniforms.uAspect.value = aspect;
  }

  /** Drawing-buffer size and pixel ratio, so hairlines keep their pixel width. */
  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  private basis(s: number): Basis {
    const c = center(s, new THREE.Vector3());
    const t = center(s + 0.05, this.tmp).sub(c).normalize().clone();
    const r = new THREE.Vector3().crossVectors(t, this.upW).normalize();
    const u = new THREE.Vector3().crossVectors(r, t).normalize();
    return { c, r, u, t };
  }

  /**
   * Camera distance along the path. The tempo sets the pace: exactly one major frame (four frames) passes per
   * beat, so a faster song runs a faster tunnel. Pulse lunges at the start of each beat and eases into the next
   * frame (hold, then snap — harder when the music is louder); ballad glides at a steady speed.
   */
  private travel(t: number, drive: number): number {
    const pos = this.init.music.beatPos(t);
    if (this.soft) return pos * this.speed;
    const i = Math.floor(pos), ph = pos - i;
    const lunge = 1 - Math.pow(1 - ph, 3 + drive * 4);
    return (i + lerp(ph, lunge, 0.35 + 0.55 * drive)) * S * 4;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const info = music.at(t);
    const beat = 60 / Math.max(40, info.bpm);
    const section = shot.section;
    const energy = section.energy;
    const next = music.a.sections[shot.sectionIndex + 1];
    const rising = !!next && next.energy > energy + 0.08;
    const build = rising ? smooth((t - section.start) / Math.max(1, section.end - section.start)) : 0;
    const whip = rising && !this.soft ? clamp01((t - (section.end - beat)) / beat) : 0;
    const kick = this.soft ? 0 : music.pulse('kick', t, 0.08);
    const hat = music.pulse('hat', t, 0.07);
    const random = rng(shot.seed);
    const sign = random() < 0.5 ? -1 : 1;

    // Twist (rad per frame) and a whole-tunnel turn.
    const lastKickT = (() => { const i = lastIndex(this.kicks, t); return i >= 0 ? this.kicks[i] : -99; })();
    let K = this.soft ? 0.004 + 0.006 * Math.sin(info.pos * Math.PI / 16) : 0.005 + 0.01 * energy + 0.012 * Math.exp(-(t - lastKickT) / 0.35) + 0.035 * build * build;
    K += 0.06 * whip * whip;
    const phi = (this.soft ? 0.05 : 0.12) * t - 1.6 * Math.pow(whip, 2.5);

    // Camera on the path, looking ahead.
    const sCam = this.travel(t, Math.min(1, energy + build * 0.5)) + 14 * Math.pow(whip, 3);
    const cb = this.basis(sCam);
    const cam = this.camera;
    cam.position.copy(cb.c);
    if (shot.variant === 'wall') cam.position.addScaledVector(cb.r, 1.1 * sign).addScaledVector(cb.u, 0.5);
    cam.up.copy(cb.u);
    cam.lookAt(center(sCam + 7, new THREE.Vector3()));
    let roll = 0.025 * Math.sin(t * 0.9);
    if (shot.variant === 'roll') roll += (t - shot.start) * (this.soft ? 0.15 : 0.6) * sign;
    roll += 0.5 * Math.pow(whip, 3);
    cam.rotateZ(roll);
    cam.fov = FOV + 8 * whip * whip + build * 8 - (info.inBar < 1 && !this.soft ? Math.exp(-info.inBar * 6) * 3 : 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Vanishing point for the background haze.
    const vp = center(sCam + 40, new THREE.Vector3()).project(cam);
    this.bg.material.uniforms.uVP.value.set(vp.x, vp.y);
    this.bg.material.uniforms.uHaze.value = 0.7 + energy * 0.6 + build;

    // The far end opens over the last beat of a rising section.
    const eo = clamp01((whip - 0.3) / 0.7);
    const dEnd = eo > 0 ? 0.5 * Math.pow(80, 1 - eo) : Infinity;

    const L = this.lines;
    L.clear();
    const n = this.sides;
    const i0 = Math.floor(sCam / S) + 1;
    // The shock rings of the recent kicks, each running on down the tunnel and fading into the fog: a new kick sends
    // a new ring after the last one instead of cutting it short.
    const ringR = this.ringR, ringA = this.ringA;
    let nr = 0;
    if (!this.soft) {
      for (let i = lastIndex(this.kicks, t); i >= 0 && nr < RINGS; i--) {
        const age = t - this.kicks[i];
        if (age > RING_LIFE) break;
        ringR[nr] = 2.5 + age * 42;
        ringA[nr++] = Math.pow(0.5, age / 0.3);
      }
    }
    const comet = (t - shot.start) * (this.soft ? 0.12 : 0.5);
    const bright = 1 + 0.8 * whip * whip + build * 0.5;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
    // Two frame buffers, swapped each step: `ring` is this frame, `prev` the one before it.
    let ring = this.bufA, prev = this.bufB, prevOk = false;
    for (let j = 0; j <= NF; j++) {
      const i = i0 + j, d = i * S - sCam;
      const fog = fogAt(d);
      const ok = fog >= 0.008 && d <= dEnd;
      const b = this.basis(i * S);
      const th = K * (d / S) + phi + Math.PI / 2;
      for (let k = 0; k < n; k++) {
        const a = th + (k * 2 * Math.PI) / n;
        ring[k].copy(b.c).addScaledVector(b.r, R * Math.cos(a)).addScaledVector(b.u, R * Math.sin(a));
      }
      if (!ok) { prevOk = false; [ring, prev] = [prev, ring]; continue; }
      const major = i % 4 === 0;
      let col: RGB = mix(this.near, this.mid, smooth((d - 1.2) / 5));
      col = mix(col, this.far, smooth((d - 7) / 12));
      const nearK = Math.exp(-d / 4);
      // Where rings overlap they add up without going past a full ring.
      let dark = 1;
      for (let q = 0; q < nr; q++) dark *= 1 - ringA[q] * Math.exp(-Math.pow((d - ringR[q]) / 1.6, 2));
      const sh = 1 - dark;
      let I = major ? 1.7 : 0.3 + 0.28 * hash(i, 1.7);
      if (this.soft) I *= 0.6;
      I *= (1 + (major ? 1.6 : 3.2) * kick * nearK + 2.2 * sh) * bright;
      if (eo > 0) I *= 1 + 3 * eo * Math.exp(-(dEnd - d) / 1.2);
      const c = I * fog;
      const w = Math.max(0.7, Math.min(2.0, 4.2 / d)) * (major ? 1.2 : 0.9) * (this.soft ? 0.8 : 1);
      for (let k = 0; k < n; k++) {
        const a = ring[k], bb = ring[(k + 1) % n];
        L.seg(a.x, a.y, a.z, bb.x, bb.y, bb.z, w, col[0] * c, col[1] * c, col[2] * c);
      }
      // Insets on the majors (and a few minors), flickering on the off-beats.
      const insets = major ? 2 : hash(i, 5.3) < 0.72 ? 0 : 1;
      for (let m = 1; m <= insets; m++) {
        const k = 1 - m * 0.16, fl = (0.35 + 0.65 * hat) * c * 0.45;
        for (let e = 0; e < n; e++) {
          A.copy(ring[e]).sub(b.c).multiplyScalar(k).add(b.c);
          B.copy(ring[(e + 1) % n]).sub(b.c).multiplyScalar(k).add(b.c);
          L.seg(A.x, A.y, A.z, B.x, B.y, B.z, w * 0.6, col[0] * fl, col[1] * fl, col[2] * fl);
        }
      }
      // Walls: rails and zigzag diagonals to the previous frame, faint, lit by the shock ring.
      if (prevOk) {
        const wc = c * (0.08 + 1.4 * sh) * (this.soft ? 0.5 : 1);
        const step = this.soft ? 6 : 1;
        for (let k = 0; k < n; k += step) {
          const a = ring[k], p0 = prev[k], p1 = prev[(k + 1) % n];
          L.seg(a.x, a.y, a.z, p0.x, p0.y, p0.z, w * 0.5, col[0] * wc, col[1] * wc, col[2] * wc);
          if (!this.soft) L.seg(a.x, a.y, a.z, p1.x, p1.y, p1.z, w * 0.4, col[0] * wc * 0.6, col[1] * wc * 0.6, col[2] * wc * 0.6);
        }
      }
      // Comets: three bright dashes running round the frames, spiralling into the distance.
      if (d < 14) {
        for (let q = 0; q < 3; q++) {
          const ph = (comet + q / 3 + d * 0.02) % 1;
          const pos = ph * n, e = Math.floor(pos) % n, x = pos - Math.floor(pos);
          P.copy(ring[e]).lerp(ring[(e + 1) % n], x);
          Q.copy(ring[e]).lerp(ring[(e + 1) % n], Math.min(1, x + 0.12 * (this.soft ? 0.5 : 1)));
          const cc = c * 2.2 * (1 - d / 14);
          L.seg(P.x, P.y, P.z, Q.x, Q.y, Q.z, w * 1.6, this.near[0] * cc, this.near[1] * cc, this.near[2] * cc);
        }
      }
      // Rays outside the tube on the majors, on the off-beats.
      if (major && !this.soft && hat > 0.15) {
        for (let k = 0; k < n; k++) {
          A.copy(ring[k]).sub(b.c).multiplyScalar(1.12).add(b.c);
          B.copy(ring[k]).sub(b.c).multiplyScalar(1.12 + 0.35 * hat).add(b.c);
          const rc = c * hat;
          L.seg(A.x, A.y, A.z, B.x, B.y, B.z, w * 0.8, col[0] * rc, col[1] * rc, col[2] * rc);
        }
      }
      [ring, prev] = [prev, ring];
      prevOk = true;
    }
    L.commit(this.resolution, this.pixelRatio);

    // The opening at the end: the cover, sized to the frame it replaces, rushing at the camera.
    this.exit.visible = eo > 0;
    if (eo > 0) {
      const b = this.basis(sCam + dEnd);
      this.exit.position.copy(b.c);
      this.exit.quaternion.copy(cam.quaternion);
      this.exit.scale.setScalar(R * 1.25);
      this.exit.material.color.setScalar(0.4 + 0.6 * eo);
    }

    ctx.fx.bloom = (this.soft ? 0.4 : 0.55) + energy * 0.2 + kick * 0.3;
    ctx.fx.ca = kick * 0.4 + whip * 0.6;
    // The words. Pulse: each chunk a sign low in the triangle (where it is wide), alternately left and right, that
    // strikes on GATE units ahead as it is sung, rides there while sung, then holds while the tunnel lunges at it and
    // fades as it reaches the lens; it turns with the twist of the frames round it. The translation is a row along the
    // floor of the triangle (a column on the wall ran across the signs). Ballad: each line a scroll
    // hanging beside the path, alternately left and right, angled towards it, left where it was hung.
    const lyrics = ctx.lyrics, drive = Math.min(1, energy + build * 0.5);
    if (this.soft) {
      this.rig.place = (root, st) => {
        const s = this.travel(st.line.start - 0.5, drive) + SCROLL, d = s - sCam, side = st.index % 2 ? 1 : -1, b = this.basis(s);
        poseInTube(root, b.c, b.r, b.u, b.t, side * 0.85, 0.1, 0, side * 0.35);
        return smooth((d - 0.6) / 1.6);
      };
      this.rig.onLight = false;
      this.rig.update(cam, lyrics, t, ctx.aspect, energy);
    } else {
      this.gates.update(lyrics, t, energy, (c, tt, root) => {
        const s = this.travel(Math.min(tt, c.end), drive) + GATE, d = s - sCam;
        if (d < 0.25) return 0;
        const b = this.basis(s);
        poseInTube(root, b.c, b.r, b.u, b.t, c.ordinal % 2 ? 0.28 : -0.28, -R * 0.12, 0.25 * K * (d / S));
        // Once the next sign strikes, this one (nearer, so bigger) gives way rather than lie across it.
        return smooth((d - 0.3) / 1.2) * Math.exp(-d / 14) * (1 - smooth((tt - c.next + 0.08) / 0.25));
      }, (st, tt, root) => {
        const s = this.travel(Math.min(tt, lyrics.leaveAt(st.index)), drive) + GATE * 0.9, d = s - sCam;
        if (d < 0.25) return 0;
        const b = this.basis(s), side = st.index % 2 ? 1 : -1, [w, h] = root.userData.size as [number, number];
        if (root.userData.vertical) poseInTube(root, b.c, b.r, b.u, b.t, side * 1.05, -0.35, 0.25 * K * (d / S), side * 0.5);
        else poseInTube(root, b.c, b.r, b.u, b.t, 0, -R * 0.42, 0.25 * K * (d / S));
        root.scale.setScalar(Math.min(1, (root.userData.vertical ? 2.2 : 3.2) / Math.max(w, h)));
        return smooth((d - 0.5) / 1.6);
      });
    }
  }
}
