// Vinyl: the song pressed on a record. The cover is the label; the grooves run from the rim (the song's start) to the
// label (its end), brighter where the song is louder, with a smooth gap between tracks at each section change; the
// stylus rides at the moment playing now, and the groove it has just cut glows behind it. The record turns once a bar
// (pulse) or once every two (ballad), so the label comes round on the downbeat; the sheen stays where the light is
// while the grooves turn under it. Into a louder section the platter spins back for half a beat (a DJ's rewind).
// The words run round the label, the word being sung at the top; the translation round the bottom.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { lastIndex } from '../director/music.ts';

const R = 4;
const LABEL = 0.32;
const START = 0.965;
const END = 0.37;
const GAPS = 16;
/** The tonearm's pivot (world units, beside the record's top right) and its length to the stylus. */
const PIVOT = new THREE.Vector2(R * 1.18, R * 0.82);
const ARM = R * 1.22;

const vertexShader = /* glsl */ `varying vec2 vP; void main() { vP = position.xy / ${R.toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover, uEnv;
  uniform float uRot, uPlay, uNeedle, uKick, uGaps[${GAPS}], uTime;
  uniform vec3 uInk, uPaper, uSignal, uAccent;
  varying vec2 vP;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  void main() {
    float r = length(vP);
    float aw = fwidth(r);
    if (r > 1.06) discard;
    float a = atan(vP.y, vP.x);
    vec3 col;
    if (r > 1.0) {
      // The platter's rim: dark metal, a row of strobe dots turning with it.
      float ra = a - uRot * 1.0;
      float dots = step(0.5, fract(ra * 180.0 / 6.2831853)) * smoothstep(1.025, 1.03, r) * (1.0 - smoothstep(1.045, 1.05, r));
      col = uInk * 1.6 + vec3(0.03) + vec3(0.07) * dots;
      col *= 1.0 - smoothstep(1.05, 1.06, r) * 0.8;
    } else if (r < ${LABEL.toFixed(3)}) {
      // The label: the cover, turning; the spindle; a pressed rim.
      vec2 q = rot(vP, uRot) / ${LABEL.toFixed(3)} * 0.5 + 0.5;
      col = texture2D(uCover, q).rgb;
      col *= 1.0 - 0.3 * smoothstep(${(LABEL * 0.9).toFixed(3)}, ${LABEL.toFixed(3)}, r);
      col = mix(col, uInk * 0.4, 1.0 - smoothstep(0.02, 0.022 + aw, r));
      col += vec3(0.25) * exp(-pow((r - 0.024) / 0.003, 2.0));
    } else {
      float u = (${START.toFixed(3)} - r) / ${(START - END).toFixed(3)};
      float grooved = step(${END.toFixed(3)}, r) * step(r, ${START.toFixed(3)});
      float env = texture2D(uEnv, vec2(clamp(u, 0.0, 1.0), 0.5)).r * grooved;
      // Grooves: fine rings, fading out where they would be finer than a pixel.
      float gf = 260.0;
      float g = sin(r * gf * 6.2831853) * clamp(1.0 - fwidth(r * gf) * 1.6, 0.0, 1.0);
      float gap = 0.0;
      for (int i = 0; i < ${GAPS}; i++) if (uGaps[i] > 0.0) gap = max(gap, 1.0 - smoothstep(0.0025, 0.0025 + aw * 1.5, abs(r - uGaps[i])));
      // The sheen: two wedges across the record, fixed to the light while the grooves turn under them.
      float c = abs(cos(a - 0.9));
      float lobe = 0.85 * pow(c, 16.0) + 0.5 * pow(c, 260.0) + 0.1 * pow(c, 2.0);
      vec3 sheenCol = mix(uPaper, uSignal, 0.22);
      vec3 vinyl = uInk * 0.7 + vec3(0.012);
      col = vinyl + vinyl * env * 1.4;
      col += sheenCol * lobe * (0.12 + 0.5 * env) * (0.75 + 0.25 * g) * grooved * (1.0 - gap);
      col += sheenCol * lobe * gap * 0.35;
      col *= 1.0 - gap * 0.35;
      // Dust and hairline scratches that turn with the record (so the spin reads even where it is smooth).
      float ra = a + uRot;
      col += vec3(0.05) * step(0.997, hash(floor(vec2(ra * 90.0, r * 140.0))));
      // What has been played is a touch warmer; the groove just cut glows behind the stylus.
      float played = step(uPlay, r) * grooved;
      col += uSignal * 0.035 * played;
      float behind = mod(uNeedle - a + 6.2831853, 6.2831853);
      float trail = exp(-behind * 0.9);
      col += uSignal * exp(-pow((r - uPlay) / 0.005, 2.0)) * (0.15 + 0.85 * trail) * (0.7 + 0.6 * uKick);
      // The bevelled rim.
      col += vec3(0.08) * smoothstep(0.985, 0.998, r);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Vinyl implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);
  private material: THREE.ShaderMaterial;
  private arm = new THREE.Group();
  private armBar: THREE.Mesh;
  private head: THREE.Group;
  private orbit: LyricOrbit;
  private gaps: Float32Array;
  private lifts: Float64Array;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette, music } = init;
    this.scene.background = palette.ink.clone();
    // The loudness over the song, smoothed, 0..1, as a strip the grooves read by radius.
    const rms = music.a.env.rms, N = 1024, env = new Uint8Array(N * 4);
    let peak = 1e-6;
    for (let i = 0; i < rms.length; i++) peak = Math.max(peak, rms[i]);
    for (let i = 0; i < N; i++) {
      const a = Math.floor((i / N) * rms.length), b = Math.max(a + 1, Math.floor(((i + 1) / N) * rms.length));
      let s = 0;
      for (let k = a; k < b; k++) s += rms[Math.min(k, rms.length - 1)];
      const v = Math.pow(clamp01(s / (b - a) / peak), 0.8);
      env[i * 4] = env[i * 4 + 1] = env[i * 4 + 2] = Math.round(v * 255);
      env[i * 4 + 3] = 255;
    }
    const envTex = new THREE.DataTexture(env, N, 1, THREE.RGBAFormat);
    envTex.minFilter = envTex.magFilter = THREE.LinearFilter;
    envTex.needsUpdate = true;
    // A gap between tracks at each section change (the first GAPS of them).
    this.gaps = new Float32Array(GAPS);
    const dur = Math.max(1, music.duration);
    music.a.sections.slice(1, GAPS + 1).forEach((s, i) => { this.gaps[i] = START - (START - END) * (s.start / dur); });
    // Into a louder section: the moments the platter spins back.
    const secs = music.a.sections;
    this.lifts = Float64Array.from(secs.filter((s, i) => i > 0 && s.energy > secs[i - 1].energy + 0.12).map(s => s.start));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uCover: { value: init.cover }, uEnv: { value: envTex }, uRot: { value: 0 }, uPlay: { value: START }, uNeedle: { value: 0 }, uKick: { value: 0 },
        uGaps: { value: this.gaps }, uTime: { value: 0 },
        uInk: { value: palette.ink.clone() }, uPaper: { value: palette.paper.clone() }, uSignal: { value: palette.signal.clone() }, uAccent: { value: palette.accent.clone() },
      },
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.06, 256), this.material);
    this.scene.add(disc);

    // The tonearm: a pivot, a bar and a headshell, flat graphic shapes with hairline edges.
    const body = new THREE.MeshBasicMaterial({ color: palette.paper.clone().multiplyScalar(0.32) });
    const edge = new THREE.LineBasicMaterial({ color: palette.paper.clone().multiplyScalar(0.85) });
    const withEdges = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, body);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edge));
      return m;
    };
    const pivot = withEdges(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 48).rotateX(Math.PI / 2));
    pivot.position.set(PIVOT.x, PIVOT.y, 0.15);
    const ring = withEdges(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 48).rotateX(Math.PI / 2));
    ring.position.set(PIVOT.x, PIVOT.y, 0.03);
    this.armBar = withEdges(new THREE.BoxGeometry(1, 0.09, 0.08));
    this.head = new THREE.Group();
    const shell = withEdges(new THREE.BoxGeometry(0.62, 0.3, 0.1));
    shell.position.set(-0.12, 0, 0);
    this.head.add(shell);
    this.arm.add(this.armBar, this.head);
    this.arm.position.z = 0.32;
    this.scene.add(pivot, ring, this.arm);

    this.orbit = new LyricOrbit(palette, { style: look === 'ballad' ? 'poem' : 'hook', em: 0.42, radius: R * LABEL + 0.55, mode: 'flat', trans: { em: 0.22, radius: R * LABEL + 0.3 } });
    this.orbit.group.position.z = 0.04;
    this.scene.add(this.orbit.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The stylus at radius `rp` (record units): the arm from the pivot, `ARM` long, meeting that groove. */
  private placeArm(rp: number): number {
    const d = PIVOT.length(), phi = Math.atan2(PIVOT.y, PIVOT.x), r = rp * R;
    const cosT = THREE.MathUtils.clamp((r * r + d * d - ARM * ARM) / (2 * r * d), -1, 1);
    const a = phi - Math.acos(cosT);
    const tip = new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    const mid = tip.clone().add(PIVOT).multiplyScalar(0.5);
    const dir = Math.atan2(PIVOT.y - tip.y, PIVOT.x - tip.x);
    this.armBar.position.set(mid.x, mid.y, 0);
    this.armBar.rotation.z = dir;
    this.armBar.scale.x = tip.distanceTo(PIVOT);
    this.head.position.set(tip.x, tip.y, 0);
    this.head.rotation.z = dir - 0.35;
    return a;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const soft = this.look === 'ballad';
    const info = music.at(t);
    const kick = soft ? 0 : music.pulse('kick', t, 0.12);
    const u = this.material.uniforms;
    // Once a bar (once every two in ballads), locked to the beat; clockwise seen from above.
    const per = music.meter * (soft ? 2 : 1);
    let turn = (info.pos / per) * Math.PI * 2;
    // The spin-back into a louder section: half a beat before it the platter is dragged back a quarter turn, then
    // released onto the beat.
    const beat = 60 / Math.max(40, info.bpm);
    const k = lastIndex(this.lifts, t + beat * 0.5);
    if (!soft && k >= 0) {
      const into = (t - (this.lifts[k] - beat * 0.5)) / (beat * 0.5);
      if (into >= 0 && into < 1) turn -= Math.sin(smooth(into) * Math.PI) * Math.PI * 0.5;
    }
    u.uRot.value = -turn;
    const play = START - (START - END) * clamp01(t / Math.max(1, music.duration));
    u.uPlay.value = play;
    u.uKick.value = kick;
    u.uTime.value = t;
    u.uNeedle.value = this.placeArm(play);

    const random = rng(shot.seed);
    const sk = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const cam = this.camera;
    const side = random() < 0.5 ? -1 : 1;
    cam.up.set(0, 0, 1);
    if (shot.variant === 'tilt') {
      // A three-quarter view across the turntable, drifting round.
      const az = side * lerp(0.35, 0.05, inOutCubic(sk)) + 0.25, el = lerp(0.6, 0.7, sk), d = lerp(9.6, 8.4, inOutCubic(sk));
      cam.fov = 40;
      cam.position.set(Math.sin(az) * Math.cos(el) * d, -Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d);
      cam.lookAt(0.5, 0.1, 0);
    } else if (shot.variant === 'groove') {
      // Low over the grooves at the rim, the label and the words ahead; the grooves sweep by underneath.
      const a = -1.2 + side * 0.25 + sk * 0.25 * side;
      const rr = lerp(R * 1.02, R * 0.88, inOutCubic(sk));
      cam.fov = 52;
      cam.position.set(Math.cos(a) * rr, Math.sin(a) * rr, lerp(1.2, 0.95, sk));
      cam.lookAt(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, 0);
    } else {
      // Straight down, pushing in slowly; the frame turns a little against the record.
      cam.fov = 40;
      cam.up.set(0, 1, 0);
      cam.position.set(0.6 * side * (1 - sk), -0.3, lerp(12.4, 10.4, inOutCubic(sk)));
      cam.lookAt(0.3 * side * (1 - sk), 0, 0);
      cam.rotateZ(side * lerp(0.06, -0.02, sk));
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    ctx.fx.bloom = soft ? 0.35 : 0.4 + kick * 0.15;
    ctx.fx.vignette = 0.6;
    this.orbit.update(ctx.lyrics, t, shot.section.energy);
  }
}
