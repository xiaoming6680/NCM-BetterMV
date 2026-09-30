// Crystal: the song's own solid (src/sigil/crystal.ts) on a plate of its own, at the two moments that frame a song.
//  · orbit — the last bar before a drop, in bullet time (after the orbit round the glowing object before the drop
//    of the user's 《游戏是你的解药吗？》): the camera circles the crystal slowly, then faster, pushing in, inside an
//    armillary of hairline rings; the snare roll flashes its facets; on the last sixteenth it starts to burst — and
//    the drop's push tunnel takes over with the crystal whole again at its far end.
//  · gather — the song's last bars: its shards spiral in out of the dark and lock together, flash once on a downbeat,
//    and the crystal turns on as the music ends (the closing credits stand beside it).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng, smooth } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { Crystal } from '../sigil/crystal.ts';

const bgVertex = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const bgFragment = /* glsl */ `
  uniform float uAspect, uGlow; uniform vec3 uInk, uTint;
  varying vec2 vP;
  void main() {
    float q = length(vP * vec2(uAspect, 1.0)) * 0.5;
    gl_FragColor = vec4(uInk + uTint * uGlow * 0.22 * exp(-q * q * 7.0), 1.0);
  }`;

export class CrystalScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 100);
  private crystal: Crystal;
  private lines = new LineBatch(6000);
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private rig: LyricRig;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.crystal = new Crystal(init.crystal, palette, init.cover);
    this.scene.background = palette.ink.clone();
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: bgVertex, fragmentShader: bgFragment, depthTest: false, depthWrite: false,
      uniforms: { uAspect: { value: 16 / 9 }, uGlow: { value: 1 }, uInk: { value: palette.ink.clone() }, uTint: { value: palette.signal.clone() } },
    }));
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.rig = new LyricRig(palette, 'hook');
    this.scene.add(this.bg, this.crystal.group, this.lines.mesh, this.rig.group);
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

  /** A hairline ring round the crystal (radius r, tilted), ticked every `ticks` segments; `lit` 0..1 of it bright. */
  private ring(r: number, tiltX: number, tiltZ: number, spin: number, I: number, ticks: number, lit: number): void {
    const n = 96, L = this.lines, c = this.init.palette.paper, s = this.init.palette.signal;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, spin, tiltZ, 'XYZ'));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      this.a.set(Math.cos(a0) * r, 0, Math.sin(a0) * r).applyMatrix4(m);
      this.b.set(Math.cos(a1) * r, 0, Math.sin(a1) * r).applyMatrix4(m);
      const on = k / n < lit ? 1 : 0.35;
      const col = k / n < lit ? s : c;
      L.seg(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z, 1, col.r * I * on, col.g * I * on, col.b * I * on);
      if (ticks && k % ticks === 0) {
        this.b.set(Math.cos(a0) * r * 1.06, 0, Math.sin(a0) * r * 1.06).applyMatrix4(m);
        this.a.set(Math.cos(a0) * r, 0, Math.sin(a0) * r).applyMatrix4(m);
        L.seg(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z, 1, c.r * I * 0.6, c.g * I * 0.6, c.b * I * 0.6);
      }
    }
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const len = Math.max(0.2, shot.end - shot.start), k = clamp01(ctx.shotT / len);
    const info = music.at(t);
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const snare = Math.max(music.pulse('snare', t, 0.08), 0.6 * music.pulse('hat', t, 0.05));
    const kick = music.pulse('kick', t, 0.12);
    const cam = this.camera, cr = this.crystal;
    let turn = t * 0.25, burst = 0, alpha = 1, flash = snare, glow = 1, ringsLit = 0, ringI = 0.5;

    if (shot.variant === 'gather') {
      // Shards spiral in over the first two thirds, lock with a flash on the first downbeat after, then it turns on.
      const g = clamp01(k / 0.66);
      burst = 2.6 * Math.pow(1 - inOutCubic(g), 1.5);
      turn = t * 0.2 + 4 * Math.pow(1 - g, 2) * side;
      const lock = Math.exp(-Math.max(0, ctx.shotT - 0.66 * len) / 0.25) * (g >= 1 ? 1 : 0);
      flash = 0.6 * lock + kick * 0.3;
      glow = 0.6 + 0.8 * g;
      alpha = smooth(k / 0.15);
      ringsLit = smooth((k - 0.6) / 0.3);
      ringI = 0.25 + 0.35 * g;
      const d = lerp(5.2, 3.9, outExpo(k));
      cam.position.set(Math.sin(0.3 * side) * d, 0.35, Math.cos(0.3 * side) * d);
      cam.fov = 40;
    } else {
      // Bullet time: circling slowly, then faster and closer through the bar; a push on the last beat.
      const e = k * k;
      const ang = (0.2 + 2.4 * e) * side;
      const d = lerp(4.6, 3.1, inOutCubic(k)) - 0.5 * smooth((k - 0.8) / 0.2);
      cam.position.set(Math.sin(ang) * d, 0.6 - 0.9 * k, Math.cos(ang) * d);
      cam.fov = 44 + 10 * smooth((k - 0.75) / 0.25);
      turn = shot.start * 0.3 + ctx.shotT * 0.35;
      // It starts to come apart on the last sixteenth.
      const sixteenth = 60 / Math.max(40, info.bpm) / 4;
      burst = 0.5 * Math.pow(clamp01((ctx.shotT - (len - sixteenth)) / sixteenth), 2);
      ringsLit = info.barPhase;
      ringI = 0.45 + 0.4 * k;
      glow = 0.8 + 0.8 * k;
    }
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    cr.set({ turn, tilt: 0.28, flash, burst, alpha });
    cr.group.scale.setScalar(1);
    cr.group.updateMatrixWorld();
    this.bg.material.uniforms.uGlow.value = glow * (0.7 + 0.5 * kick);

    const L = this.lines;
    L.clear();
    cr.lines(L, 1.4, 1.1);
    // The armillary: three rings at different tilts turning against each other; the outer one ticked and lit round
    // with the bar.
    const spin = t * 0.4;
    this.ring(1.55, 0.35, 0.1, spin, ringI * alpha, 8, ringsLit);
    this.ring(1.75, -0.9, 0.5, -spin * 0.7, ringI * 0.7 * alpha, 0, 0);
    this.ring(1.95, 1.2, -0.4, spin * 0.5, ringI * 0.5 * alpha, 12, 0);
    L.commit(this.resolution, this.pixelRatio);

    ctx.fx.bloom = 0.55 + 0.3 * flash;
    ctx.fx.ca = shot.variant === 'orbit' ? 0.2 + 0.8 * k * k : 0.15;
    ctx.fx.vignette = 0.55;
    this.rig.align = side > 0 ? 'left' : 'right';
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
