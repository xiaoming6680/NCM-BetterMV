// The song's armillary: nested graduated rings round a glowing core, one per song, worked out once from the whole
// song, standing for it through its MV (it replaced the song's crystal, 2026-10-13; the user: “我觉得晶体这个设计不太
// 好”, chose the armillary out of five sketches). Its identity is static and only its motion follows the music:
//  · the song's structure sets how many rings (its sections: up to 6 → three rings, up to 10 → four, more → five);
//  · its metre sets the graduations (a major mark every bar's worth of beats: 32/16 marks in 4, 24/12 in 3);
//  · its drums set how the rings click round — sparse: the inner ring steps every two beats, the outer ones every bar
//    or two; driving: the inner two every beat (in opposite directions), the next every two beats, the outer every bar;
//  · a hash of the song picks the inner rings' planes from a few classic ones (equator, colure, ecliptic…) and the
//    lean of the polar axis, so songs alike still differ.
// The outer ring is the meridian, a flat ring graduated round its face; the next is a band engraved with the song's
// name, tempo and metre; the core is a glass orb with the cover inside it. Steps are quick snaps with a rest between
// (never a constant whirr); the kick lifts the core a little; the bar lights the meridian round.
import * as THREE from 'three';
import type { Analysis } from '../types.ts';
import type { Palette } from '../render/palette.ts';
import type { LineBatch } from '../render/lines.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng, smooth, snap } from '../scenes/types.ts';

type V3 = [number, number, number];

export interface RingSpec {
  /** flat: a washer graduated on its face; band: a short cylinder (its width along the axis). */
  kind: 'flat' | 'band';
  /** Mid radius (the outer ring is 1) and width. */
  r: number;
  w: number;
  /** The ring's axis at rest (its plane's normal), in the armillary's frame (polar axis = y). */
  axis: V3;
  ticks: number;
  /** A major mark every `major` ticks. */
  major: number;
  /** Steps one tick every `every` beats, turning `dir`. */
  every: number;
  dir: 1 | -1;
  /** Engraved with the song's name. */
  text: boolean;
}

export interface ArmillarySpec {
  rings: RingSpec[];
  /** The polar axis' lean from vertical (rad). */
  lean: number;
  why: { sections: number; meter: number; bpm: number; drums: number };
}

const deg = Math.PI / 180;
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
/** The inner rings' planes: equator, colure, ecliptic both ways, and two between. */
const PLANES: V3[] = [
  [0, 1, 0],
  [0, 0, 1],
  [0, Math.cos(23.4 * deg), Math.sin(23.4 * deg)],
  [Math.sin(-23.4 * deg), Math.cos(23.4 * deg), 0],
  unit([1, 1.4, 0.4]),
  unit([-0.5, 0.7, 1]),
];

/** Reads the armillary from the analysis; `id` (the song's) picks the inner rings' planes and the axis' lean. */
export function armillarySpec(a: Analysis, id: number): ArmillarySpec {
  const strong = (hs: Array<[number, number]>) => hs.filter(h => h[1] > 0.35).length / Math.max(1, a.duration);
  const drums = strong(a.hits.kick) + 0.5 * strong(a.hits.snare);
  const random = rng((id * 2654435761) >>> 0);
  const sections = a.sections.length;
  const n = sections <= 6 ? 3 : sections <= 10 ? 4 : 5;
  const meter = a.meter === 3 ? 3 : 4;
  // Steps, innermost first.
  const ladder = drums < 0.7 ? [2, meter, 2 * meter, 2 * meter, 4 * meter] : drums < 1.2 ? [1, 2, meter, meter, 2 * meter] : [1, 1, 2, meter, meter];
  const pool = PLANES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const radii = [1, 0.84, 0.69, 0.56, 0.45];
  const marks = [8, 6, 4, 4, 3];
  const flip = random() < 0.5 ? 1 : -1;
  const rings: RingSpec[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i === 1 || i === 3 ? 'band' : 'flat';
    const r = radii[i];
    rings.push({
      kind, r,
      w: (kind === 'band' ? 0.11 : 0.075) * (0.75 + 0.25 * r),
      // The meridian stands upright through the poles; the engraved band is the ecliptic.
      axis: i === 0 ? [1, 0, 0] : i === 1 ? [0, Math.cos(23.4 * deg), -Math.sin(23.4 * deg)] : pool[i - 2],
      ticks: marks[i] * meter,
      major: meter,
      every: ladder[n - 1 - i],
      dir: ((i % 2 ? -1 : 1) * flip) as 1 | -1,
      text: i === 1,
    });
  }
  return { rings, lean: (0.3 + 0.35 * random()) * (random() < 0.5 ? -1 : 1), why: { sections, meter, bpm: Math.round(a.namedBpm ?? a.bpm), drums: +drums.toFixed(2) } };
}

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN, vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const ringFragment = /* glsl */ `
  uniform vec3 uPaper, uSignal;
  uniform float uTicks, uMajor, uLit, uAlpha, uPulse, uKind, uHasText, uTextRepeat;
  uniform sampler2D uText;
  varying vec2 vUv;
  varying vec3 vN, vView;
  void main() {
    vec3 n = normalize(vN), v = normalize(vView);
    float facing = abs(dot(n, v));
    vec2 fw = max(fwidth(vUv), vec2(1e-6));
    // Graduations: the distance to the nearest mark in pixels; faded out where they'd crowd into a grey.
    float tu = vUv.x * uTicks, idx = floor(tu + 0.5);
    float spacing = 1.0 / (fw.x * uTicks);
    float dpx = abs(tu - idx) * spacing;
    float major = 1.0 - step(0.5, mod(idx + 0.25, uMajor));
    // Flat rings are marked in from the outer edge, bands in from both edges.
    float e = uKind < 0.5 ? 1.0 - vUv.y : min(vUv.y, 1.0 - vUv.y);
    float len = uKind < 0.5 ? mix(0.38, 0.78, major) : mix(0.13, 0.21, major);
    float tick = (1.0 - smoothstep(0.55, 1.35, dpx)) * step(e, len) * smoothstep(2.5, 6.0, spacing);
    float lit = step(vUv.x, uLit);
    // The engraving, in the middle of a band, reading the right way round from whichever side it is seen (it read
    // upside down from outside and mirrored from inside; the user: “浑天仪环上的字反了”): u runs right to left seen
    // from outside the ring (the band goes counter-clockwise about its axis) and left to right from inside, as in
    // the tunnel the rings recede into; the canvas texture's v already points up.
    float txt = 0.0;
    if (uHasText > 0.5) {
      float tv = (vUv.y - 0.26) / 0.48;
      float inside = step(0.0, tv) * step(tv, 1.0);
      float tu = fract(vUv.x * uTextRepeat);
      if (dot(n, v) > 0.0) tu = 1.0 - tu;
      txt = texture2D(uText, vec2(tu, tv)).r * inside * smoothstep(5.0, 9.0, 0.48 / fw.y);
    }
    // Glass: a faint body that brightens towards the grazing edges, and a glint from a light up and to the left.
    vec3 h = normalize(normalize(vec3(-0.45, 0.75, 0.5)) + v);
    float glint = pow(abs(dot(n, h)), 70.0);
    vec3 col = uSignal * (0.07 + 0.4 * pow(1.0 - facing, 3.0)) + uPaper * glint * 0.4;
    col += mix(uPaper, uSignal * 1.25, lit) * tick * mix(0.42, 0.9, major);
    col += uPaper * txt * 0.75;
    col *= (gl_FrontFacing ? 1.0 : 0.55) * (1.0 + 0.2 * uPulse) * uAlpha;
    gl_FragColor = vec4(col, 1.0);
  }`;

const coreVertex = /* glsl */ `
  varying vec3 vN, vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const coreFragment = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uSignal, uPaper;
  uniform float uAlpha, uGlow;
  varying vec3 vN, vView;
  void main() {
    vec3 n = normalize(vN), v = normalize(vView);
    float facing = abs(dot(n, v)), fres = pow(1.0 - facing, 2.5);
    // The cover inside the orb, seen through its front and bent towards the rim.
    vec3 cover = texture2D(uCover, n.xy * 0.42 + 0.5).rgb;
    vec3 col = cover * (0.18 + 0.5 * facing) * uGlow + uSignal * fres * 0.85 * uGlow + uPaper * pow(fres, 6.0) * 0.35;
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`;

export interface ArmillaryPose {
  /** Turn about the polar axis (rad). */
  turn: number;
  /** Continuous beat position: the rings click round on it. */
  beat: number;
  /** Phase of the bar, 0..1: the meridian's marks light round. 0 = none lit. */
  bar: number;
  /** Extra spin of every ring (rad), for the speeding-up before a drop. */
  whirl: number;
  /** 0..1: the rings swing in from wide and settle (0: out of sight). */
  open: number;
  /** 0..1: every ring turns into one plane, square to the point given to `set`. */
  align: number;
  /**
   * After aligning: 0..n−1, the rings step back from the plane one after another, innermost first and deepest (the
   * outer ring stays), and the core with the innermost: a short tunnel of rings. Needs `toward`.
   */
  recede: number;
  /**
   * 0..n: the rings close up one after another, outermost first, each onto the next one in — shrinking to its
   * radius and turning into its plane, so that it lands on it — and the last onto the core (the caller eases each
   * step; a whole number is a ring fully merged).
   */
  merge: number;
  /** The kick, 0..1. */
  pulse: number;
  alpha: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const SEGS = 256;

/** A ring's surface: u round it, v across it; the ring's axis is its local y. */
function ribbon(spec: RingSpec): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const u = i / SEGS, a = u * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const v of [0, 1]) {
      if (spec.kind === 'flat') {
        const r = spec.r + (v - 0.5) * spec.w;
        pos.push(c * r, 0, s * r); nrm.push(0, 1, 0);
      } else {
        pos.push(c * spec.r, (v - 0.5) * spec.w, s * spec.r); nrm.push(c, 0, s);
      }
      uv.push(u, v);
    }
    if (i < SEGS) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The engraving: one run of the text, white on black; returns the texture and its width over its height. */
function engraving(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const H = 128, font = `600 ${Math.round(H * 0.62)}px "BMV Archivo Bold", "Noto Sans SC", "Microsoft YaHei UI", sans-serif`;
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  g.font = font;
  const spaced = text.split('').join(String.fromCharCode(0x200a));
  const w = Math.min(4096, Math.ceil(g.measureText(spaced).width + H * 0.6));
  c.width = w; c.height = H;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, H);
  g.font = font; g.fillStyle = '#fff'; g.textBaseline = 'middle';
  g.fillText(spaced, H * 0.3, H * 0.54, w - H * 0.6);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  return { texture, aspect: w / H };
}

interface Ring {
  spec: RingSpec;
  holder: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  rest: THREE.Quaternion;
  scatter: THREE.Quaternion;
  /** This frame: its share of the whole's alpha (opening, folding). */
  alpha: number;
}

export class Armillary {
  readonly group = new THREE.Group();
  /** Turns about the leaning polar axis; the rings and the core hang in it. */
  private frame = new THREE.Group();
  private rings: Ring[];
  private core: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private pose: ArmillaryPose = { turn: 0, beat: 0, bar: 0, whirl: 0, open: 1, align: 0, recede: 0, merge: 0, pulse: 0, alpha: 1 };
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  static readonly CORE = 0.2;
  /** How far back the innermost ring steps when the rings recede (in units of the outer ring's radius). */
  static readonly DEPTH = 1.2;

  constructor(readonly spec: ArmillarySpec, private palette: Palette, cover: THREE.Texture, title = '') {
    this.group.add(this.frame);
    const random = rng(0x2545f491);
    const meter = spec.why.meter;
    const words = [title, `${spec.why.bpm} BPM`, `${meter}/4`].filter(Boolean).join('\u3000\u3000') + '\u3000\u3000';
    this.rings = spec.rings.map(rs => {
      const ink = rs.text ? engraving(words) : null;
      // As many runs of the text round the band as keep the letters their own shape.
      const repeat = ink ? Math.max(1, Math.round((Math.PI * 2 * rs.r) / rs.w / ink.aspect)) : 1;
      const material = new THREE.ShaderMaterial({
        vertexShader: ringVertex, fragmentShader: ringFragment,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: {
          uPaper: { value: palette.paper.clone() }, uSignal: { value: palette.signal.clone() },
          uTicks: { value: rs.ticks }, uMajor: { value: rs.major }, uLit: { value: 0 }, uAlpha: { value: 1 }, uPulse: { value: 0 },
          uKind: { value: rs.kind === 'flat' ? 0 : 1 }, uHasText: { value: ink ? 1 : 0 }, uTextRepeat: { value: repeat },
          uText: { value: ink?.texture ?? null },
        },
      });
      const mesh = new THREE.Mesh(ribbon(rs), material);
      mesh.frustumCulled = false;
      const holder = new THREE.Group();
      holder.add(mesh);
      this.frame.add(holder);
      const rest = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...rs.axis));
      const scatter = new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - 0.5) * 3, (random() - 0.5) * 3, (random() - 0.5) * 3)).multiply(rest);
      return { spec: rs, holder, mesh, rest, scatter, alpha: 1 };
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(Armillary.CORE, 48, 32), new THREE.ShaderMaterial({
      vertexShader: coreVertex, fragmentShader: coreFragment,
      uniforms: { uCover: { value: cover }, uSignal: { value: palette.signal.clone() }, uPaper: { value: palette.paper.clone() }, uAlpha: { value: 1 }, uGlow: { value: 1 } },
    }));
    this.frame.add(this.core);
  }

  /** Rings, ticks a ring has. */
  get ringCount(): number { return this.rings.length; }

  /** For the HUD: rings, then marks on the meridian (`IV 32`, an em space between). */
  get label(): string { return `${['', 'I', 'II', 'III', 'IV', 'V'][this.rings.length]}\u2003${this.rings[0].spec.ticks}`; }

  /**
   * Sets this frame's motion. The group's position and scale are the caller's (set them first); `toward` is the
   * world point the rings square up to as they align (the camera).
   */
  set(pose: Partial<ArmillaryPose>, toward?: THREE.Vector3): void {
    Object.assign(this.pose, pose);
    const p = this.pose;
    this.group.visible = p.alpha > 0.002;
    if (!this.group.visible) return;
    this.group.updateMatrixWorld();
    this.frame.quaternion.setFromEuler(new THREE.Euler(0, 0, this.spec.lean)).multiply(this.q.setFromAxisAngle(Y, p.turn));
    this.frame.updateMatrixWorld();
    // `toward` in the frame's own space: the aligned plane is square to it, and the rings recede away from it.
    let target: THREE.Quaternion | null = null;
    const dir = toward ? this.v.copy(toward).sub(this.group.getWorldPosition(this.a)).applyQuaternion(this.frame.getWorldQuaternion(this.q2).invert()).normalize() : null;
    if (dir && p.align > 0) target = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    const n = this.rings.length;
    this.rings.forEach((ring, i) => {
      const rs = ring.spec;
      // Inner rings settle first when opening, square up first when aligning and step back first; outer ones merge first.
      const fromIn = n - 1 - i;
      const open = smooth(p.open * (1 + 0.35 * (n - 1)) - 0.35 * fromIn);
      const align = target ? inOutCubic(p.align * (1 + 0.2 * (n - 1)) - 0.2 * fromIn) : 0;
      const merge = clamp01(p.merge - i);
      ring.holder.quaternion.copy(ring.scatter).slerp(ring.rest, open);
      if (target) ring.holder.quaternion.slerp(target, align);
      const back = dir ? clamp01(p.recede - fromIn) * Armillary.DEPTH * (i / Math.max(1, n - 1)) : 0;
      if (dir) ring.holder.position.copy(dir).multiplyScalar(-back); else ring.holder.position.set(0, 0, 0);
      // Snap a mark's worth on each step, then rest until the next.
      const x = p.beat / rs.every, frac = x - Math.floor(x);
      const steps = Math.floor(x) + snap(frac / Math.min(1, 0.35 / rs.every));
      // (A ring taking in the one outside it turns two marks as it lands.)
      const caught = i > 0 ? smooth((clamp01(p.merge - (i - 1)) - 0.8) / 0.2) : 0;
      ring.mesh.rotation.y = rs.dir * (((steps + 2 * caught) * Math.PI * 2) / rs.ticks + p.whirl * (1 + 0.25 * i));
      // Merging: it closes onto the next ring in (the last onto the core), brightening as it meets it, and is gone.
      // (Its turn into that ring's plane is set below, once every ring's own place is known.)
      const into = i + 1 < n ? this.rings[i + 1].spec.r : Armillary.CORE * 1.1;
      ring.holder.scale.setScalar(lerp(1, into / rs.r, merge) * lerp(1.7, 1, open));
      ring.alpha = open * (1 - smooth((merge - 0.72) / 0.28));
      const u = ring.mesh.material.uniforms;
      u.uAlpha.value = p.alpha * ring.alpha * (1 + 0.6 * merge);
      u.uPulse.value = p.pulse;
      u.uLit.value = i === 0 ? p.bar : 0;
    });
    for (let i = n - 2; i >= 0; i--) {
      const merge = clamp01(p.merge - i);
      if (merge > 0) this.rings[i].holder.quaternion.slerp(this.rings[i + 1].holder.quaternion, merge);
    }
    // The core steps back with the innermost ring, and takes in the last ring's light when it merges.
    const coreBack = dir ? clamp01(p.recede) * Armillary.DEPTH * 1.12 : 0;
    if (dir) this.core.position.copy(dir).multiplyScalar(-coreBack); else this.core.position.set(0, 0, 0);
    const took = clamp01(p.merge - (n - 1)), merged = clamp01(p.merge / n);
    const cu = this.core.material.uniforms;
    cu.uAlpha.value = p.alpha * smooth(p.open * 2);
    cu.uGlow.value = (0.85 + 0.3 * p.pulse) * (1 + 0.2 * merged + 0.45 * took);
    this.core.scale.setScalar(1 + 0.04 * p.pulse + 0.1 * merged);
    this.group.updateMatrixWorld(true);
  }

  /**
   * Adds the rings' edges and the polar axis to a scene's hairline batch (after `set`). `eye` dims the far side of
   * each ring so the nesting reads. `badge`: a figure a few pixels across — each of the outer three rings as one
   * line round its middle, no more (both edges of every ring would run together into a smudge).
   */
  lines(batch: LineBatch, width: number, intensity: number, eye: THREE.Vector3, badge = false): void {
    const p = this.pose;
    if (p.alpha <= 0.002) return;
    const paper = this.palette.paper, signal = this.palette.signal;
    const centre = this.group.getWorldPosition(this.v);
    const ex = eye.x - centre.x, ey = eye.y - centre.y, ez = eye.z - centre.z, el = Math.hypot(ex, ey, ez) || 1;
    const scale = this.group.getWorldScale(new THREE.Vector3()).x;
    const a = this.a, b = this.b;
    const near = (x: number, y: number, z: number) => 0.62 + 0.38 * Math.max(-1, Math.min(1, ((x - centre.x) * ex + (y - centre.y) * ey + (z - centre.z) * ez) / (el * scale + 1e-6)));
    const N = badge ? 48 : 128;
    this.rings.forEach((ring, i) => {
      const rs = ring.spec, m = ring.mesh.matrixWorld;
      const I = intensity * p.alpha * ring.alpha * (1 + 0.15 * p.pulse) * (i === 0 ? 0.85 : 0.7);
      if (I < 0.003 || (badge && i > 2)) return;
      for (const side of badge ? [0] : [-0.5, 0.5]) {
        const rr = rs.kind === 'flat' ? rs.r + side * rs.w : rs.r, yy = rs.kind === 'flat' ? 0 : side * rs.w;
        for (let k = 0; k < N; k++) {
          const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
          a.set(Math.cos(a0) * rr, yy, Math.sin(a0) * rr).applyMatrix4(m);
          b.set(Math.cos(a1) * rr, yy, Math.sin(a1) * rr).applyMatrix4(m);
          const k2 = I * near((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width, paper.r * k2, paper.g * k2, paper.b * k2);
        }
      }
    });
    // The polar axis through the core, with a short cross at each pole (gone once the rings leave their places).
    const fm = this.frame.matrixWorld, J = intensity * p.alpha * 0.45 * smooth(p.open * 2) * (1 - smooth(p.align * 1.6)) * (1 - smooth(p.merge));
    const reach = 1.22;
    for (const [y0, y1] of [[Armillary.CORE * 1.1, reach], [-reach, -Armillary.CORE * 1.1]]) {
      a.set(0, y0, 0).applyMatrix4(fm); b.set(0, y1, 0).applyMatrix4(fm);
      batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width, paper.r * J, paper.g * J, paper.b * J);
    }
    for (const y of [reach, -reach]) {
      a.set(-0.05, y, 0).applyMatrix4(fm); b.set(0.05, y, 0).applyMatrix4(fm);
      batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width, signal.r * J * 1.4, signal.g * J * 1.4, signal.b * J * 1.4);
    }
  }
}
