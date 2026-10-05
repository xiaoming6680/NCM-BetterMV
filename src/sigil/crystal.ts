// The song's crystal: one solid per song, worked out once from the whole song, that stands for it through its MV
// (the user: “对所有的歌曲提前出一独一无二的特征，在每首MV里都添加立体图形，这个立体图形的形状根据这个特征来，类似于Phigros的PV”).
// Its identity is static — a Platonic seed chosen by tempo and metre, carved by Conway operators chosen by the song's
// structure and rhythm, spiked by its drums, stretched by its dynamics, twisted by a hash of its id so that no two
// songs match — and only its motion follows the music (spin, facet flashes, bursting apart on a drop). Every choice
// is from a few good-looking steps, never a continuous mapping, so no song gets an ugly shape.
// Drawn as glass: the cover seen through its facets, rims in the cover's signal colour, hairline edges (the MV's own
// line language) and a smaller dual core turning the other way inside.
import * as THREE from 'three';
import type { Analysis } from '../types.ts';
import type { Palette } from '../render/palette.ts';
import type { LineBatch } from '../render/lines.ts';
import { SEEDS, ambo, centroid, dual, edges, gyro, kis, normal, truncate, type Poly, type Vec } from './polyhedron.ts';
import { rng } from '../scenes/types.ts';

export interface CrystalSpec {
  seed: keyof typeof SEEDS;
  /** Conway operators, applied right to left (as written: `kt` truncates, then raises spikes). */
  ops: string;
  /** Height of the kis spikes (0: none). */
  spike: number;
  /** Stretch along the spin axis, and twist (rad from bottom to top). */
  stretch: number;
  twist: number;
  /** Why: the features the shape was read from. */
  why: { bpm: number; meter: number; drums: number; hats: number; swing: number; sung: number };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Reads the crystal from the analysis. One carving at most, so every crystal stays a clean, readable solid:
 *  · seed — metre 3 → tetrahedron; else by tempo: < 80 dodecahedron, < 100 icosahedron, < 115 octahedron,
 *    < 130 cube, faster → tetrahedron (slow songs round, fast ones sharp); the song id takes some to their dual.
 *  · drums carve it — sparse (< 0.7 hits a second): ambo, a rounded solid; moderate (< 1.2): truncated, a faceted
 *    gem; driving (< 1.7): short spikes on every face (stellated); pounding: long spikes, a star. A tempo that
 *    swings or drifts (≥ 1.2 %) gyros it instead: twisted pentagons (rounds it, on solids of many faces).
 *  · hi-hats — busy hats cut a spiked or plain solid's faces once more before the spikes.
 *  · voice — the more of the song is sung, the taller the gem (instrumentals sit squat).
 *  · the song id — a slight twist, so that songs alike still differ.
 */
export function crystalSpec(a: Analysis, id: number): CrystalSpec {
  const strong = (hs: Array<[number, number]>) => hs.filter(h => h[1] > 0.35).length / Math.max(1, a.duration);
  const drums = strong(a.hits.kick) + 0.5 * strong(a.hits.snare);
  const hats = strong(a.hits.hat);
  const tempo = a.tempo.length ? a.tempo : [a.bpm];
  const mean = tempo.reduce((s, x) => s + x, 0) / tempo.length;
  const swing = Math.sqrt(tempo.reduce((s, x) => s + (x - mean) * (x - mean), 0) / tempo.length) / Math.max(1, mean);
  const sung = a.sections.filter(s => s.vocal).length / Math.max(1, a.sections.length);
  const random = rng((id * 2654435761) >>> 0);

  const bpm = a.bpm;
  let seed: CrystalSpec['seed'] = a.meter === 3 ? 'T' : bpm < 80 ? 'D' : bpm < 100 ? 'I' : bpm < 115 ? 'O' : bpm < 130 ? 'C' : 'T';
  if (random() < 0.35) seed = ({ T: 'T', C: 'O', O: 'C', D: 'I', I: 'D' } as const)[seed];
  let ops = '', spike = 0;
  const few = seed === 'T' || seed === 'C' || seed === 'O';
  if (swing > 0.012) ops = few ? 'g' : 'a'; // (a gyroed icosahedron is sixty pentagons: a ball of wool)
  else if (drums < 0.7) ops = 'a';
  else if (drums < 1.2) ops = 't';
  else {
    // Spikes only on solids of few faces: on more they turn into a thistle.
    if (hats >= 2.2 && few) ops = 't';
    spike = drums < 1.7 ? 0.45 : 0.9 + 0.4 * clamp01((drums - 1.7) / 1.2);
  }
  const stretch = sung > 0.6 ? 1.45 : sung > 0.3 ? 1.2 : 1;
  const twist = (random() - 0.5) * 0.6 + (ops === 'g' ? 0.5 : 0);
  return { seed, ops, spike, stretch, twist, why: { bpm: Math.round(bpm), meter: a.meter, drums: +drums.toFixed(2), hats: +hats.toFixed(2), swing: +swing.toFixed(3), sung: +sung.toFixed(2) } };
}

/** The solid for a spec (Conway operators applied right to left, faces kept under ~360), unit radius. */
export function crystalPoly(spec: CrystalSpec): Poly {
  let p = SEEDS[spec.seed]();
  const OPS: Record<string, (q: Poly) => Poly> = { t: truncate, a: ambo, g: gyro, d: dual };
  for (const o of spec.ops.split('').reverse()) {
    const q = OPS[o](p);
    if (q.f.length > 120) break;
    p = q;
  }
  if (spec.spike > 0) p = kis(p, spec.spike);
  // Stretch and twist along y, then fit into the unit sphere.
  let r = 0;
  p.v = p.v.map(([x, y, z]) => {
    const yy = y * spec.stretch, a = spec.twist * y;
    const q: Vec = [x * Math.cos(a) - z * Math.sin(a), yy, x * Math.sin(a) + z * Math.cos(a)];
    r = Math.max(r, Math.hypot(q[0], q[1], q[2]));
    return q;
  });
  p.v = p.v.map(v => [v[0] / r, v[1] / r, v[2] / r] as Vec);
  return p;
}

const vertexShader = /* glsl */ `
  attribute vec3 aNormal, aCenter;
  attribute float aRand;
  uniform float uBurst;
  varying vec3 vN, vView, vLocal;
  varying float vRand;
  void main() {
    // Bursting: each facet flies out along its normal, shrinking about its own centre.
    vec3 p = aCenter + (position - aCenter) * (1.0 - 0.35 * uBurst) + aNormal * uBurst * (0.5 + aRand);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * aNormal);
    vView = -mv.xyz;
    vLocal = position;
    vRand = aRand;
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uTint, uRim;
  uniform float uGlow, uFlash, uAlpha;
  varying vec3 vN, vView, vLocal;
  varying float vRand;
  void main() {
    vec3 n = normalize(vN), v = normalize(vView);
    float facing = abs(dot(n, v)), fres = pow(1.0 - facing, 2.0);
    // The cover inside the crystal, bent a little by each facet.
    vec3 cover = texture2D(uCover, vLocal.xy * 0.45 + 0.5 + n.xy * 0.12).rgb;
    vec3 col = cover * (0.12 + 0.22 * facing) + uTint * (fres * 0.75 + uGlow * 0.2) + uRim * pow(fres, 5.0) * 0.5;
    // Facets flash on the beat, some more than others.
    col *= 1.0 + uFlash * (0.2 + 0.8 * step(0.6, vRand));
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`;

export interface CrystalPose {
  /** Turn about its axis (rad) and the axis' tilt towards the camera (rad). */
  turn: number;
  tilt: number;
  /** 0..1: facets flash (the beat). */
  flash: number;
  /** 0..1+: the facets burst apart (a drop), 0 = whole. */
  burst: number;
  /** Overall brightness (fades it in and out). */
  alpha: number;
}

export class Crystal {
  readonly group = new THREE.Group();
  readonly poly: Poly;
  readonly core: Poly;
  /** Triangles drawn by the glass (the counter on the HUD). */
  readonly triangles: number;
  private material: THREE.ShaderMaterial;
  private faceData: Array<{ c: Vec; n: Vec; r: number }>;
  private edgeList: Array<[number, number]>;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private pose: CrystalPose = { turn: 0, tilt: 0, flash: 0, burst: 0, alpha: 1 };

  constructor(readonly spec: CrystalSpec, private palette: Palette, cover: THREE.Texture) {
    this.poly = crystalPoly(spec);
    this.core = dual(SEEDS[spec.seed]());
    const random = rng(0x9e3779b9);
    this.faceData = this.poly.f.map(f => ({ c: centroid(this.poly, f), n: normal(this.poly, f), r: random() }));
    this.edgeList = edges(this.poly);
    const pos: number[] = [], nrm: number[] = [], cen: number[] = [], rnd: number[] = [];
    this.poly.f.forEach((f, fi) => {
      const { c, n, r } = this.faceData[fi];
      for (let k = 1; k + 1 < f.length; k++) {
        for (const i of [f[0], f[k], f[k + 1]]) {
          pos.push(...this.poly.v[i]); nrm.push(...n); cen.push(...c); rnd.push(r);
        }
      }
    });
    this.triangles = pos.length / 9;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aNormal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: {
        uCover: { value: cover }, uTint: { value: palette.signal.clone() }, uRim: { value: palette.paper.clone() },
        uGlow: { value: 0.5 }, uFlash: { value: 0 }, uAlpha: { value: 1 }, uBurst: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** Sets the crystal's motion for this frame (the group's position and scale are the caller's). */
  set(pose: Partial<CrystalPose>): void {
    Object.assign(this.pose, pose);
    const p = this.pose, u = this.material.uniforms;
    this.group.rotation.set(p.tilt, p.turn, 0, 'XYZ');
    u.uFlash.value = p.flash;
    u.uBurst.value = p.burst;
    u.uAlpha.value = p.alpha;
    this.group.visible = p.alpha > 0.002;
  }

  /**
   * Adds the crystal's edges to a scene's hairline batch (after `set`, with the group's world matrix current):
   * each facet's outline — so a burst carries its edges with it — and the dual core, turning the other way.
   */
  lines(batch: LineBatch, width: number, intensity = 1): void {
    const p = this.pose;
    if (p.alpha <= 0.002) return;
    const m = this.group.matrixWorld, rim = this.palette.paper, sig = this.palette.signal;
    const I = intensity * p.alpha * (1 + 0.9 * p.flash) * 0.75;
    const a = this.tmp, b = this.tmp2;
    if (p.burst < 0.005) {
      for (const [i, j] of this.edgeList) {
        a.set(...this.poly.v[i]).applyMatrix4(m); b.set(...this.poly.v[j]).applyMatrix4(m);
        batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width, rim.r * I, rim.g * I, rim.b * I);
      }
    } else this.poly.f.forEach((f, fi) => {
      const { c, n, r } = this.faceData[fi];
      const k = 1 - 0.35 * p.burst, o = p.burst * (0.5 + r);
      const at = (i: number, out: THREE.Vector3) => {
        const v = this.poly.v[i];
        return out.set(c[0] + (v[0] - c[0]) * k + n[0] * o, c[1] + (v[1] - c[1]) * k + n[1] * o, c[2] + (v[2] - c[2]) * k + n[2] * o).applyMatrix4(m);
      };
      for (let e = 0; e < f.length; e++) {
        at(f[e], a); at(f[(e + 1) % f.length], b);
        batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width, rim.r * I, rim.g * I, rim.b * I);
      }
    });
    // The core: the seed's dual at 40 %, counter-rotating, in the signal colour.
    const core = this.core, cs = 0.4 * (1 + 0.6 * p.burst), turn = -2 * p.turn;
    const cosT = Math.cos(turn), sinT = Math.sin(turn), J = intensity * p.alpha * (0.8 + 0.7 * p.flash);
    const put = (v: Vec, out: THREE.Vector3) => out.set((v[0] * cosT - v[2] * sinT) * cs, v[1] * cs, (v[0] * sinT + v[2] * cosT) * cs).applyMatrix4(m);
    for (const f of core.f) for (let e = 0; e < f.length; e++) {
      put(core.v[f[e]], a); put(core.v[f[(e + 1) % f.length]], b);
      batch.seg(a.x, a.y, a.z, b.x, b.y, b.z, width * 0.8, sig.r * J * 0.5, sig.g * J * 0.5, sig.b * J * 0.5);
    }
  }

  /** Conway notation, for the HUD (`ktI`). */
  get label(): string { return this.poly.name; }
}
