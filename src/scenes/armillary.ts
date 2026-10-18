// The song's armillary (src/sigil/armillary.ts) on a plate of its own, at the two moments that frame a song. (Its
// scene id is still 'crystal', the figure it replaced, so that the scenes people have turned off stay off.)
//  · orbit — the last bar or two before a drop (bullet time, after the orbit round the glowing object before the
//    drop of the user's 《游戏是你的解药吗？》): the camera circles in while the rings click round on the beats and
//    whirl up; four beats before the drop they swing into one plane; from two and a half beats before, they step
//    back one after another on the eighth notes into a short tunnel of rings; from a beat and a quarter before, the
//    camera pushes down it, through the outer rings, and the cut lands on the drop's kick, into the push tunnel
//    (with the armillary at its far end).
//  · gather — the song's last bars: the rings swing in and settle, click round, then on the beats close up one onto
//    the next, outermost first, each shrinking and turning into the plane of the ring it lands on, the last onto the
//    core; the core alone dims as the music ends (the closing credits stand beside it).
// The words stand round it on a band: each word is set on the side the camera faced as it was sung, and the camera's
// circling carries the sung words round past it.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import type { Music } from '../director/music.ts';
import { clamp01, fitFov, lerp, outExpo, rng, smooth, snap } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { voiceOpts } from './lyricBlock.ts';
import { Armillary } from '../sigil/armillary.ts';

const bgVertex = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const bgFragment = /* glsl */ `
  uniform float uAspect, uGlow; uniform vec3 uInk, uTint;
  varying vec2 vP;
  void main() {
    float q = length(vP * vec2(uAspect, 1.0)) * 0.5;
    gl_FragColor = vec4(uInk + uTint * uGlow * 0.22 * exp(-q * q * 7.0), 1.0);
  }`;

/** The armillary's size on its plate (its outer ring's radius). */
const ARM_SCALE = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

export class ArmillaryScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 100);
  private arm: Armillary;
  private lines = new LineBatch(6000);
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private orbit: LyricOrbit;
  private eyeAt = new THREE.Vector3();
  private eyeDir = new THREE.Vector3(0, 0, 1);
  private right = new THREE.Vector3();
  private tunnel = new THREE.Vector3(0, 0, 1);
  private tunnel2 = new THREE.Vector3(0, 0, 1);
  private lookAt = new THREE.Vector3();
  private lookAt2 = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private toward = new THREE.Vector3();
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;

  constructor(init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: bgVertex, fragmentShader: bgFragment, depthTest: false, depthWrite: false,
      uniforms: { uAspect: { value: 16 / 9 }, uGlow: { value: 1 }, uInk: { value: palette.ink.clone() }, uTint: { value: palette.signal.clone() } },
    }));
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.orbit = new LyricOrbit(palette, { style: 'hook', em: 0.26, radius: 1.85, mode: 'band', trans: { em: 0.12, radius: 1.85 }, ...voiceOpts('pulse', init.seed) });
    this.orbit.group.rotation.set(0.18, 0, 0.06);
    this.arm = new Armillary(init.armillary, palette, init.cover, init.title);
    this.arm.group.scale.setScalar(ARM_SCALE);
    this.scene.add(this.bg, this.arm.group, this.lines.mesh, this.orbit.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bg.material.uniforms.uAspect.value = aspect;
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  /** The camera at the song's end: settling in, then drawing slowly closer as the rings close up. Returns the fov. */
  private gatherEye(t: number, shot: Shot, out: THREE.Vector3): number {
    const k = clamp01((t - shot.start) / Math.max(0.2, shot.end - shot.start));
    const side = rng(shot.seed)() < 0.5 ? -1 : 1;
    const d = lerp(5.2, 3.9, snap(k)) - 0.9 * smooth((k - 0.4) / 0.6);
    out.set(Math.sin(0.3 * side) * d, 0.35, Math.cos(0.3 * side) * d);
    return 40;
  }

  /**
   * The camera round the armillary before a drop, in beats before the cut: circling in and slowing to a stop as the
   * rings line up, then still while they recede, then pushing forward down the rings — faster and faster, through
   * the outer ring — onto the drop's kick, where the tunnel takes over. The rings line up square to `tunnel`, a
   * little off the line of sight (so the rings stepping back read as a tunnel, not just as rings shrinking); the push
   * runs down it and ends looking at the core. Returns the field of view.
   */
  private orbitEye(t: number, shot: Shot, music: Music, out: THREE.Vector3, look = this.lookAt, tunnel = this.tunnel): number {
    const beat = 60 / Math.max(40, music.at(shot.end - 0.01).bpm);
    const B = Math.max(1, (shot.end - shot.start) / beat), bb = Math.max(0, (shot.end - t) / beat), u = clamp01(1 - bb / B);
    const side = rng(shot.seed)() < 0.5 ? -1 : 1;
    const ang = side * (0.25 + 1.4 * smooth((B - bb) / Math.max(1, B - 1.75)));
    const y = lerp(0.75, 0.04, smooth((B - bb) / Math.max(1, B - 1.5)));
    const dir = this.eyeDir.set(Math.sin(ang), y, Math.cos(ang)).normalize();
    const right = this.right.crossVectors(dir, UP).normalize();
    tunnel.copy(dir).applyAxisAngle(right, 0.26);
    const push = clamp01((1.25 - bb) / 1.25), e = Math.pow(push, 2.2);
    out.copy(dir).multiplyScalar(lerp(4.8, 3.6, smooth(u))).lerp(this.tmp.copy(tunnel).multiplyScalar(-1.1), e);
    look.copy(tunnel).multiplyScalar(-Armillary.DEPTH * 1.12 * ARM_SCALE * smooth(push));
    return 44 + 18 * push * push;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const len = Math.max(0.2, shot.end - shot.start), k = clamp01(ctx.shotT / len);
    const info = music.at(t);
    const kick = music.pulse('kick', t, 0.12);
    const cam = this.camera, arm = this.arm, n = arm.ringCount;
    const beat = 60 / Math.max(40, info.bpm), B = len / beat;
    let glow: number, push = 0;
    if (shot.variant === 'gather') {
      cam.fov = this.gatherEye(t, shot, cam.position);
      cam.lookAt(0, 0, 0);
      // Each ring lands on the next one in on a beat, the first a little before the middle of the shot.
      const bs = ctx.shotT / beat;
      const m0 = Math.round(B * 0.45), gap = Math.max(1, Math.round((B * 0.3) / n));
      let merge = 0;
      for (let j = 0; j < n; j++) merge += smooth((bs - (m0 + j * gap - 0.75)) / 0.75);
      arm.set({ turn: 0.2 * t, beat: info.pos, bar: 0, whirl: 0, open: clamp01(bs / music.meter), align: 0, recede: 0, merge, pulse: 0.5 * kick,
        alpha: smooth(k / 0.08) * (1 - 0.8 * smooth((k - 0.88) / 0.12)) });
      glow = 0.6 + 0.5 * (merge / n);
    } else {
      cam.fov = this.orbitEye(t, shot, music, cam.position);
      cam.lookAt(this.lookAt);
      const bb = Math.max(0, (shot.end - t) / beat);
      push = clamp01((1.25 - bb) / 1.25);
      // Stepping back on the eighth notes from two and a half beats before the drop.
      const gap = Math.max(0.25, Math.round((1.5 / Math.max(1, n - 1)) * 4) / 4);
      let recede = 0;
      for (let j = 0; j < n - 1; j++) recede += snap((2.5 - bb - j * gap) / 0.4);
      this.toward.copy(this.tunnel).multiplyScalar(10);
      arm.set({ turn: shot.start * 0.3 + ctx.shotT * 0.3, beat: info.pos, bar: info.barPhase, whirl: 2.4 * Math.pow(smooth((B - bb) / Math.max(1, B - 2.5)), 2),
        open: 1, align: smooth((4 - bb) / 1.5), recede, merge: 0, pulse: 0.5 * kick, alpha: 1 }, this.toward);
      glow = 0.8 + 0.5 * k + 0.4 * push;
    }
    // (A portrait frame: the armillary across it, so the band of words round it stays in.)
    cam.fov = fitFov(cam.fov, ctx.aspect);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.bg.material.uniforms.uGlow.value = glow * (0.7 + 0.4 * kick);
    const L = this.lines;
    L.clear();
    arm.lines(L, 1.2, 1, cam.position);
    L.commit(this.resolution, this.pixelRatio);
    ctx.fx.bloom = 0.5 + 0.15 * kick + 0.2 * push;
    ctx.fx.ca = shot.variant === 'orbit' ? 0.15 + 0.5 * k * k + 0.6 * push * push : 0.12;
    ctx.fx.vignette = 0.55;
    // The words fly off as the camera rushes in (it would pass through the band).
    this.orbit.group.visible = push < 0.4;
    const eye = shot.variant === 'gather'
      ? (tt: number, o: THREE.Vector3) => this.gatherEye(tt, shot, o)
      : (tt: number, o: THREE.Vector3) => this.orbitEye(tt, shot, music, o, this.lookAt2, this.tunnel2);
    // The band's angle facing the camera at a time (in the band's own tilted frame).
    const og = this.orbit.group;
    og.updateMatrixWorld();
    const inv = og.matrixWorld.clone().invert();
    this.orbit.update(ctx.lyrics, t, shot.section.energy, tt => {
      eye(Math.max(shot.start, tt), this.eyeAt);
      this.eyeAt.applyMatrix4(inv);
      return Math.atan2(this.eyeAt.x, this.eyeAt.z);
    }, cam);
  }
}
