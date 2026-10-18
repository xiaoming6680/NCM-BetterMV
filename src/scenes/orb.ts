// Orb: a sphere of light-needles, the spectrum standing out of it. Each needle sits at a latitude that is a band —
// the bass round the equator, the treble at the poles — and is as long as that band is loud now (a quick rise, a
// slower fall); the whole urchin turns slowly, so its belt of bass needles pulses round it on every kick. Two rings
// circle it, each a channel's waveform at this instant wrapped round a circle. A kick swells it and sends out a
// shell of light; a chorus or a drop lengthens everything.
// Cameras: circling at a distance (orbit), close in over the needles (close), far back, the rings in view (wide). The
// words run round it.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, fitFov, rng, surge } from './types.ts';
import { LyricOrbit } from './lyricSpace.ts';
import { voiceOpts } from './lyricBlock.ts';
import { COLS, Spectrogram } from './viz.ts';
import { hue, v3 } from './fractal.ts';
import { LineBatch } from '../render/lines.ts';
import { lastIndex } from '../director/music.ts';

const NB = 64;
const NEEDLES = 2600;
const RC = 1;
const RING_SEGS = 360;
const SHELLS = 3;

type Pal = { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color };

const SOLID_VERT = /* glsl */ `varying vec3 vN; varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;

function coreFrag(p: Pal): string {
  return /* glsl */ `
uniform vec3 uCam;
uniform float uGlow;
varying vec3 vN;
varying vec3 vPos;
const vec3 INK = ${v3(p.ink.clone().multiplyScalar(0.25))}, RIM = ${v3(hue(p.signal))}, ACC = ${v3(hue(p.accent))};
void main() {
  vec3 v = normalize(uCam - vPos), n = normalize(vN);
  float f = pow(1.0 - max(dot(n, v), 0.0), 2.5);
  vec3 col = INK + mix(ACC, RIM, f) * f * (0.6 + 0.8 * uGlow) + ACC * 0.08 * uGlow;
  gl_FragColor = vec4(col, 1.0);
}`;
}

/** A shell of light thrown out by a kick: a sphere lit at its silhouette. */
function shellFrag(p: Pal): string {
  return /* glsl */ `
uniform vec3 uCam;
uniform float uK;
varying vec3 vN;
varying vec3 vPos;
const vec3 WHITE = ${v3(hue(p.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.5)))};
void main() {
  vec3 v = normalize(uCam - vPos), n = normalize(vN);
  float f = pow(1.0 - abs(dot(n, v)), 4.0);
  gl_FragColor = vec4(WHITE * f * uK, 1.0);
}`;
}

export class Orb implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 300);
  private spec: Spectrogram;
  private needles = new LineBatch(NEEDLES * 2);
  private rings = new LineBatch(RING_SEGS * 2);
  private dirs: Float32Array;
  private bandOf: Float32Array;
  private jitter: Float32Array;
  private lev = new Float32Array(NB);
  private tone: THREE.Color[];
  private core: THREE.Mesh;
  private coreU: Record<string, THREE.IUniform>;
  private shells: Array<{ mesh: THREE.Mesh; u: Record<string, THREE.IUniform> }> = [];
  private kicks: Float64Array;
  private kickV: Float64Array;
  private orbit: LyricOrbit;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private readonly soft: boolean;
  private az = 0;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.05);
    this.spec = Spectrogram.of(init.stereo, music.duration + 8, NB, 30);

    // Needles on a Fibonacci sphere; each one's band from its latitude, a little jitter so the belt isn't ruled.
    this.dirs = new Float32Array(NEEDLES * 3);
    this.bandOf = new Float32Array(NEEDLES);
    this.jitter = new Float32Array(NEEDLES);
    const random = rng(0x0b5);
    for (let i = 0; i < NEEDLES; i++) {
      const y = 1 - (2 * (i + 0.5)) / NEEDLES, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653;
      this.dirs.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      this.bandOf[i] = Math.max(0, Math.min(NB - 1, Math.pow(Math.abs(y), 0.85) * (NB - 1) + (random() - 0.5) * 2));
      this.jitter[i] = 0.8 + 0.4 * random();
    }
    const low = hue(palette.accent), mid = hue(palette.signal), high = hue(palette.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.3));
    this.tone = Array.from({ length: NB }, (_, b) => {
      const k = b / (NB - 1);
      return k < 0.5 ? low.clone().lerp(mid, THREE.MathUtils.smoothstep(k, 0.05, 0.5)) : mid.clone().lerp(high, THREE.MathUtils.smoothstep(k, 0.55, 1));
    });

    this.coreU = { uCam: { value: new THREE.Vector3() }, uGlow: { value: 0 } };
    this.core = new THREE.Mesh(new THREE.SphereGeometry(RC * 0.98, 64, 32), new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: coreFrag(palette), uniforms: this.coreU }));
    for (let i = 0; i < SHELLS; i++) {
      const u = { uCam: this.coreU.uCam, uK: { value: 0 } };
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: shellFrag(palette), uniforms: u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.visible = false;
      this.shells.push({ mesh, u });
      this.scene.add(mesh);
    }
    // Dust far out.
    const dust = new Float32Array(2500 * 3);
    for (let i = 0; i < 2500; i++) {
      const d = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(14 + 30 * random());
      dust.set([d.x, d.y, d.z], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    const dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: palette.paper.clone().multiplyScalar(0.35), size: 1.6, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.core, this.needles.mesh, this.rings.mesh, dots);

    const ev = this.soft ? Array.from(music.downbeats, d => [d, 0.5] as [number, number]) : music.a.hits.kick.filter(h => h[1] > 0.4);
    this.kicks = Float64Array.from(ev, h => h[0]);
    this.kickV = Float64Array.from(ev, h => h[1]);

    this.orbit = new LyricOrbit(palette, { style: this.soft ? 'poem' : 'hook', em: 0.34, radius: 3.0, mode: 'band', trans: { em: 0.15, radius: 3.0 }, ...voiceOpts(look, init.seed) });
    this.orbit.group.position.y = -0.1;
    this.scene.add(this.orbit.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // (A portrait frame: the ball across it, so the words round it stay in.)
    this.camera.fov = fitFov(40, aspect);
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  keepUp(t: number): void {
    this.spec.prefetch(t, 0.6);
  }

  private pose(t: number, shot: Shot): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    let r: number, el: number;
    const az = phase + side * t * 0.07;
    if (shot.variant === 'close') { r = 4.0 - 0.4 * k; el = 0.1 + 0.05 * Math.sin(t * 0.3); }
    else if (shot.variant === 'wide') { r = 11 - 0.8 * k; el = 0.32; }
    else { r = 7.2 - 0.6 * k; el = 0.18; }
    const cam = this.camera;
    cam.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    this.az = az;
  }

  update(ctx: FrameCtx): void {
    const { t, shot, music } = ctx;
    this.pose(t, shot);
    (this.coreU.uCam.value as THREE.Vector3).copy(this.camera.position);
    const sec = shot.section, loud = sec.label === 'chorus' || sec.label === 'drop';
    const kick = this.soft ? 0 : music.pulse('kick', t, 0.13);
    this.coreU.uGlow.value = kick;

    // Levels: a quick rise, a fall of 2 a second (needles don't flicker off between notes).
    const c = Math.floor(t * COLS);
    this.lev.fill(0);
    for (let k = 0; k <= 15; k++) {
      const col = this.spec.column(c - k), age = k / COLS;
      for (let b = 0; b < NB; b++) this.lev[b] = Math.max(this.lev[b], col[b] - age * 2);
    }

    // The needles, in the urchin's own turning frame.
    const N = this.needles;
    N.clear();
    const reach = (loud ? 1.6 : 1.25) * (1 + 0.25 * kick), gain = (0.75 + 0.4 * clamp01(sec.energy ?? 0.5)) * (loud ? 0.7 : 1);
    for (let i = 0; i < NEEDLES; i++) {
      const b = this.bandOf[i], b0 = Math.floor(b), f = b - b0;
      const lv = this.lev[b0] * (1 - f) + this.lev[Math.min(NB - 1, b0 + 1)] * f;
      const v = Math.max(0, (lv - 0.2) / 0.8) * this.jitter[i];
      const len = 0.03 + reach * Math.pow(v, 1.6);
      const x = this.dirs[i * 3], y = this.dirs[i * 3 + 1], z = this.dirs[i * 3 + 2];
      const r0 = RC, r1 = RC + len * 0.5, r2 = RC + len, col = this.tone[b0], e = (0.15 + 1.4 * v * v) * gain;
      N.seg(x * r0, y * r0, z * r0, x * r1, y * r1, z * r1, 1.3, col.r * e * 0.25, col.g * e * 0.25, col.b * e * 0.25);
      N.seg(x * r1, y * r1, z * r1, x * r2, y * r2, z * r2, 1.4, col.r * e, col.g * e, col.b * e);
    }
    N.commit(this.resolution, this.pixelRatio);
    this.needles.mesh.rotation.y = t * 0.18;
    this.needles.mesh.rotation.z = 0.25;
    const swell = 1 + 0.07 * kick;
    this.needles.mesh.scale.setScalar(swell);
    this.core.scale.setScalar(swell);

    // The rings: each channel's last 60 ms wrapped round a circle, tilted, turning.
    const st = this.init.stereo, R = this.rings;
    R.clear();
    if (st) {
      const n = Math.round(0.06 * st.rate), i1 = Math.round(t * st.rate);
      for (const [ch, radius, tilt, spin] of [[st.left, 2.15, 0.35, 0.4], [st.right, 2.55, -0.5, -0.3]] as const) {
        const m = new THREE.Matrix4().makeRotationX(tilt).multiply(new THREE.Matrix4().makeRotationY(t * spin));
        const col = this.tone[Math.round(NB * (ch === st.left ? 0.35 : 0.7))], e = (0.5 + 0.9 * music.env('rms', t)) * gain;
        let px = 0, py = 0, pz = 0;
        const p = new THREE.Vector3();
        for (let k = 0; k <= RING_SEGS; k++) {
          const a = (k / RING_SEGS) * Math.PI * 2, idx = i1 - n + Math.floor((k % RING_SEGS) / RING_SEGS * n);
          const s = idx >= 0 && idx < ch.length ? ch[idx] / 32767 : 0;
          const rr = radius * (1 + 0.08 * s);
          p.set(Math.cos(a) * rr, 0, Math.sin(a) * rr).applyMatrix4(m);
          if (k) R.seg(px, py, pz, p.x, p.y, p.z, 1.6, col.r * e, col.g * e, col.b * e);
          px = p.x; py = p.y; pz = p.z;
        }
      }
    }
    R.commit(this.resolution, this.pixelRatio);

    // Shells from the last kicks.
    let m = 0;
    for (let i = lastIndex(this.kicks, t); i >= 0 && m < SHELLS; i--) {
      const age = t - this.kicks[i];
      if (age > 1.2) break;
      const s = this.shells[m++];
      s.mesh.visible = true;
      // (Thrown out fast from rest — speed rising over the first few hundredths — then coasting.)
      s.mesh.scale.setScalar(RC * 1.1 + 2.6 * surge(age, 0.05) + 1.4 * age);
      s.u.uK.value = this.kickV[i] * (loud ? 0.55 : 0.6) * Math.exp(-age / 0.3);
    }
    for (let i = m; i < SHELLS; i++) this.shells[i].mesh.visible = false;

    this.orbit.update(ctx.lyrics, t, sec.energy, () => this.az, this.camera);

    ctx.fx.bloom = this.soft ? 0.5 : loud ? 0.45 : 0.6;
    ctx.fx.vignette = 0.6;
    ctx.fx.grain = 0.03;
  }
}
