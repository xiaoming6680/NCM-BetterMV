// Routes drilling into a self-similar fractal for ever (the fractal plates' camera, fractal.ts).
// The fractal contains smaller copies of itself (each a homothety g of it: x ↦ s·x + t, no turn), so a route through
// its holes from a point P to the image of P under one of them, then on from there through a copy of one of the
// routes, and so on, goes on without end, the walls round the camera always the same size relative to it. Each
// stretch is drawn in its own frame (the copy it lies in, scaled up to the whole), the camera always on the current
// one; the stretches are picked one after another from a seeded sequence (which way the route bends next), so the
// drilling never repeats itself.
// Each stretch is one smooth curve (cubic Hermite pieces through given points with given directions; curvature
// without jumps, and the joins carry on in the same direction). The camera looks along the route a little ahead
// (its direction averaged over the window ahead, or the point a little further along it), its up carried along the
// route without turning about the heading (parallel transport), so it never rolls of its own accord.
import * as THREE from 'three';
import type { FrameCtx, SceneInit, Shot } from './types.ts';
import { FractalPlate, hue, v3, type FractalOptions, type Pose } from './fractal.ts';
import { rng, smooth } from './types.ts';
import { lastIndex } from '../director/music.ts';

/** One stretch, in its own frame: the route's points and directions, and the map from the next stretch's frame. */
export interface Stretch {
  points: THREE.Vector3[];
  dirs: THREE.Vector3[];
  /** Frame k+1 → frame k: x ↦ s·x + t (its last point is this map's image of the next stretch's first). */
  s: number;
  t: THREE.Vector3;
}

export interface ChainOptions {
  /** Hermite tangent length as a share of each piece's chord. */
  tension?: number;
  /**
   * Where the camera looks: at the route's direction averaged over this much of it ahead (stretches), or else at the
   * point this far along it (`ahead`).
   */
  window?: number;
  ahead?: number;
  /** The camera's up at the start (made square to the heading). */
  up?: THREE.Vector3;
}

const SAMPLES = 48;
/** Samples of heading and up per stretch. */
const FRAMES = 96;

interface Built {
  st: Stretch;
  pts: THREE.Vector3[];
  tans: THREE.Vector3[];
  cum: Float64Array;
  length: number;
  heads?: THREE.Vector3[];
  ups?: THREE.Vector3[];
  /** Heading's turn per unit of u (radians) at each frame sample. */
  turn?: Float32Array;
}

export class Chain {
  private cache = new Map<number, Built>();
  private tension: number;
  private window: number;
  private ahead: number;
  private up0: THREE.Vector3;

  constructor(private make: (k: number) => Stretch, o: ChainOptions = {}) {
    this.tension = o.tension ?? 1;
    this.window = o.window ?? 0;
    this.ahead = o.ahead ?? 0.1;
    this.up0 = (o.up ?? new THREE.Vector3(0, 0, 1)).clone();
  }

  private built(k: number): Built {
    let b = this.cache.get(k);
    if (b) return b;
    const st = this.make(k), pts: THREE.Vector3[] = [], tans: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < st.points.length; i++) {
      const p0 = st.points[i], p1 = st.points[i + 1], chord = p0.distanceTo(p1);
      const m0 = st.dirs[i].clone().normalize().multiplyScalar(this.tension * chord);
      const m1 = st.dirs[i + 1].clone().normalize().multiplyScalar(this.tension * chord);
      for (let j = 0; j < SAMPLES; j++) {
        const t = j / SAMPLES, t2 = t * t, t3 = t2 * t;
        pts.push(p0.clone().multiplyScalar(2 * t3 - 3 * t2 + 1).addScaledVector(m0, t3 - 2 * t2 + t).addScaledVector(p1, -2 * t3 + 3 * t2).addScaledVector(m1, t3 - t2));
        tans.push(p0.clone().multiplyScalar(6 * t2 - 6 * t).addScaledVector(m0, 3 * t2 - 4 * t + 1).addScaledVector(p1, -6 * t2 + 6 * t).addScaledVector(m1, 3 * t2 - 2 * t).normalize());
      }
    }
    pts.push(st.points[st.points.length - 1].clone());
    tans.push(st.dirs[st.dirs.length - 1].clone().normalize());
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + pts[i].distanceTo(pts[i - 1]);
    b = { st, pts, tans, cum, length: cum[cum.length - 1] };
    this.cache.set(k, b);
    return b;
  }

  /** Sample index (fractional) at f in [0,1): the camera slows through a stretch as its walls close in. */
  private index(b: Built, f: number): number {
    const s = b.st.s, len = (b.length * (1 - Math.pow(s, f))) / (1 - s);
    let lo = 0, hi = b.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b.cum[m] <= len) lo = m; else hi = m; }
    const span = b.cum[hi] - b.cum[lo];
    return lo + (span > 0 ? (len - b.cum[lo]) / span : 0);
  }

  /** The route at u in the frame of stretch `frame` (≤ floor(u)); by default its own stretch's frame. */
  at(u: number, out = new THREE.Vector3(), frame = Math.floor(u)): THREE.Vector3 {
    const k = Math.floor(u), b = this.built(k), x = this.index(b, u - k), i = Math.floor(x);
    out.copy(b.pts[i]).lerp(b.pts[Math.min(i + 1, b.pts.length - 1)], x - i);
    for (let j = k - 1; j >= frame; j--) { const g = this.built(j).st; out.multiplyScalar(g.s).add(g.t); }
    return out;
  }

  /** The route's direction at u (the frames are only scaled, never turned, so it is the same in all of them). */
  dir(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    const k = Math.floor(u), b = this.built(k), x = this.index(b, u - k), i = Math.floor(x);
    return out.copy(b.tans[i]).lerp(b.tans[Math.min(i + 1, b.tans.length - 1)], x - i).normalize();
  }

  /** How far down stretch floor(u) has shrunk (1 at its start, its s at its end). */
  scale(u: number): number { const k = Math.floor(u); return Math.pow(this.built(k).st.s, u - k); }

  /** The map from stretch k's frame to stretch (k − m)'s: x ↦ S·x + T (S in w). */
  outer(k: number, m: number, out = new THREE.Vector4()): THREE.Vector4 {
    let S = 1;
    const T = new THREE.Vector3();
    for (let j = k - 1; j >= k - m; j--) { const g = this.built(j).st; S *= g.s; T.multiplyScalar(g.s).add(g.t); }
    return out.set(T.x, T.y, T.z, S);
  }

  /** The map from stretch k+1's frame to stretch k's (s in w). */
  next(k: number, out = new THREE.Vector4()): THREE.Vector4 {
    const g = this.built(k).st;
    return out.set(g.t.x, g.t.y, g.t.z, g.s);
  }

  /** Where the camera looks at u (see `window`, `ahead`). */
  heading(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (this.window > 0) {
      out.set(0, 0, 0);
      const d = new THREE.Vector3(), n = 12;
      for (let j = 0; j <= n; j++) out.addScaledVector(this.dir(u + (this.window * j) / n, d), 1 - (j / n) * 0.6);
      return out.normalize();
    }
    const k = Math.floor(u);
    return out.copy(this.at(u + this.ahead, new THREE.Vector3(), k)).sub(this.at(u)).normalize();
  }

  /** Headings and transported ups through stretch k (each stretch's start carries on from the last one's end). */
  private frames(k: number): Built {
    const b = this.built(k);
    if (b.heads) return b;
    let up: THREE.Vector3;
    if (k <= 0) {
      const h = this.heading(k);
      up = this.up0.clone().addScaledVector(h, -this.up0.dot(h)).normalize();
    } else up = this.frames(k - 1).ups![FRAMES].clone();
    const heads: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], turn = new Float32Array(FRAMES + 1);
    const q = new THREE.Quaternion();
    for (let i = 0; i <= FRAMES; i++) {
      const h = this.heading(k + Math.min(i / FRAMES, 1 - 1e-9));
      if (i) {
        q.setFromUnitVectors(heads[i - 1], h);
        up = up.clone().applyQuaternion(q);
        turn[i] = heads[i - 1].angleTo(h) * FRAMES;
      }
      // (Kept square to the heading against drift.)
      up.addScaledVector(h, -up.dot(h)).normalize();
      heads.push(h);
      ups.push(up.clone());
    }
    turn[0] = turn[1];
    b.heads = heads; b.ups = ups; b.turn = turn;
    return b;
  }

  /** The camera at u: position in its stretch's frame and orientation (looking along the heading, up transported). */
  pose(u: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const k = Math.floor(u), f = u - k, b = this.frames(k);
    this.at(u, pos);
    const x = f * FRAMES, i = Math.min(FRAMES - 1, Math.floor(x)), w = x - i;
    const h = b.heads![i].clone().lerp(b.heads![i + 1], w).normalize();
    const up = b.ups![i].clone().lerp(b.ups![i + 1], w);
    up.addScaledVector(h, -up.dot(h)).normalize();
    quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, pos.clone().add(h), up));
  }

  /** How fast the heading turns at u (radians per unit of u). */
  turnRate(u: number): number {
    const k = Math.floor(u), b = this.frames(k), x = (u - k) * FRAMES, i = Math.min(FRAMES - 1, Math.floor(x));
    return Math.max(b.turn![i], b.turn![i + 1]);
  }
}

export interface DrillSpec {
  chain: Chain;
  /** Stretches per unit of travel (cruise-seconds). */
  rate: number;
  /** The fastest the camera may turn (degrees a second): it slows into a bend, like a driver, rather than swing. */
  turnMax: number;
  /** Stretches of ancestors drawn round the current one (their outer faces beyond the haze). */
  outer: number;
  /** How far ahead on the route the light hangs (stretches). */
  light: number;
}

const TABLE_RATE = 60;

/**
 * A fractal plate drilling along a chain (the camera, the light ahead, the maps the shader draws the fractal with).
 * Its progress along the route is integrated once over the song: the flight's speed (fractal.ts), held back wherever
 * the route would turn the camera faster than `turnMax`.
 * Each kick of a loud section (each downbeat elsewhere) sends a shell of light out from the camera across the walls
 * (uFold.zw: its radius in the walls' own size, its strength); the kick also lifts the light ahead a little (uFold.y).
 * Cameras: glide (on the route, swaying a hair), look (turned a little aside, steadily).
 */
export abstract class DrillPlate extends FractalPlate {
  protected readonly chain: Chain;
  private spec: DrillSpec;
  private table: Float64Array;
  private shellT: Float64Array;
  private shellV: Float64Array;

  constructor(init: SceneInit, look: 'pulse' | 'ballad', o: FractalOptions, spec: DrillSpec) {
    super(init, look, o);
    this.chain = spec.chain;
    this.spec = spec;
    // Progress along the route, 60 times a second.
    const n = Math.ceil((init.music.duration + 8) * TABLE_RATE) + 2, maxTurn = THREE.MathUtils.degToRad(spec.turnMax);
    this.table = new Float64Array(n);
    let u = 0;
    for (let i = 0; i < n; i++) {
      this.table[i] = u;
      const want = spec.rate * this.flight.speedAt(i / TABLE_RATE), turn = this.chain.turnRate(u);
      u += Math.min(want, turn > 1e-6 ? maxTurn / turn : want) / TABLE_RATE;
    }
    const music = init.music, sections = music.a.sections;
    const loud = (t: number) => { const s = sections[music.sectionIndex(t)]; return !!s && (s.label === 'chorus' || s.label === 'drop'); };
    const ev: Array<[number, number]> = [];
    for (const d of Array.from(music.downbeats)) if (!loud(d) && !this.soft) ev.push([d, 0.35]);
    for (const [t, v] of music.a.hits.kick) if (loud(t) && v > 0.4) ev.push([t, this.soft ? 0.35 : 0.5 + 0.4 * v]);
    ev.sort((a, b) => a[0] - b[0]);
    const kept: Array<[number, number]> = [];
    for (const e of ev) if (!kept.length || e[0] - kept[kept.length - 1][0] > 0.2) kept.push(e);
    this.shellT = Float64Array.from(kept, e => e[0]);
    this.shellV = Float64Array.from(kept, e => e[1]);
  }

  /** Where on the route at t (stretches). */
  protected progress(t: number): number {
    const x = Math.max(0, t * TABLE_RATE), i = Math.min(this.table.length - 2, Math.floor(x)), f = Math.min(1, x - i);
    return this.table[i] + (this.table[i + 1] - this.table[i]) * f;
  }

  protected override pose(t: number, shot: Shot, out: Pose): Pose {
    this.chain.pose(this.progress(t), out.pos, out.quat);
    const random = rng(shot.seed), side = random() < 0.5 ? -1 : 1, tilt = random() < 0.5 ? -1 : 1;
    // Look: turned well aside and tilted, so the beams and slabs cross the frame on the diagonal (straight down the
    // shaft the walls frame it square and flat). Steady: the turn is the route's, not the shot's.
    const look = shot.variant === 'look';
    const yaw = look ? side * 0.42 : 0, pitch = look ? tilt * 0.2 : 0, roll = Math.sin(t * 0.13) * 0.04;
    out.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')));
    return out;
  }

  override update(ctx: FrameCtx): void {
    super.update(ctx);
    // A lens's finish: the corners darkened and fringed, a soft glow, little grain (the picture should be soft).
    ctx.fx.vignette = 0.7;
    ctx.fx.ca = Math.max(ctx.fx.ca, 0.25);
    ctx.fx.bloom = this.soft ? 0.55 : 0.5;
    ctx.fx.grain = 0.02;
  }

  protected override tune(ctx: FrameCtx): void {
    const { t } = ctx, u = this.progress(t), k = Math.floor(u);
    this.u.uScale.value = this.chain.scale(u);
    this.u.uPhase.value = u - k;
    this.chain.outer(k, this.spec.outer, this.u.uOuter.value as THREE.Vector4);
    this.chain.next(k, this.u.uNext.value as THREE.Vector4);
    this.chain.at(u + this.spec.light, this.u.uLight.value as THREE.Vector3, k);
    const i = lastIndex(this.shellT, t), age = i < 0 ? 99 : t - this.shellT[i];
    const kick = this.soft ? 0 : ctx.music.pulse('kick', t, 0.3);
    // (Brightness only: the shell and the light; nothing on the beat moves.)
    (this.u.uFold.value as THREE.Vector4).set(0, 0.3 * kick, age * 6, i < 0 ? 0 : this.shellV[i] * Math.exp(-age / 0.5) * smooth(age / 0.05));
    this.u.uKick.value = kick;
  }
}

/**
 * The drilling plates' light (after the bright passages of Leaf's "Aleph-0" BGA): pale stone in a sun that comes in
 * across the shafts, with soft shadows; the windows' depths falling to near black (occlusion from samples, in the walls'
 * own size); the air lit and pale towards the sun and deep, cool and nearly neutral away from it, so far halls fall
 * dark and the near stone stands out of them; a glow down the route ahead; the frame's corners darkened into the
 * shade's hue. The colour is the light's (the cover's paper and signal), the shade only faintly the cover's second
 * colour. A plate's `shade` calls `lit(p, n, rd, t, base)`; `haze` is here.
 */
export function drillLook(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): string {
  const grey = (c: THREE.Color, k: number) => { const l = (c.r + c.g + c.b) / 3; return c.clone().lerp(new THREE.Color(l, l, l), k); };
  const wall = hue(p.paper).lerp(new THREE.Color(1, 1, 1), 0.6).lerp(hue(p.signal), 0.06).multiplyScalar(0.9);
  const air = hue(p.paper).lerp(new THREE.Color(1, 1, 1), 0.4).lerp(hue(p.accent), 0.25).multiplyScalar(0.42);
  const shade = grey(hue(p.accent).lerp(hue(p.ink), 0.5), 0.65).multiplyScalar(0.5);
  const edge = grey(hue(p.accent).lerp(hue(p.ink), 0.6), 0.5).multiplyScalar(0.18);
  const sun = hue(p.paper).lerp(new THREE.Color(1, 1, 1), 0.3).lerp(hue(p.signal), 0.15);
  return /* glsl */ `
const vec3 WALL = ${v3(wall)}, AIR = ${v3(air)}, SHADE = ${v3(shade)}, SUNC = ${v3(sun)}, GLOW = ${v3(hue(p.accent))}, SIG = ${v3(hue(p.signal))};
#define GLOW_DUST SUNC
#define LENS_EDGE ${v3(edge)}
// The sun: one direction in every stretch's frame (the frames are only scaled).
const vec3 SUN = normalize(vec3(0.55, 0.35, 0.76));

/** Soft shadow towards the sun (lengths in the walls' own size). */
float shadow(vec3 ro) {
  float res = 1.0, t = 0.02 * uScale;
  for (int i = uZero; i < 18; i++) {
    float h = map(ro + SUN * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.015 * uScale, 0.3 * uScale);
    if (res < 0.004 || t > 3.0 * uScale) break;
  }
  return clamp(res, 0.0, 1.0);
}

/** Occlusion: how buried the point is (five samples out along the normal, in the walls' own size). */
float occlusion(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = uZero; i < 5; i++) {
    float h = uScale * (0.012 + 0.05 * float(i));
    o += (h - map(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 6.0 * o / uScale, 0.0, 1.0);
}

vec3 haze(vec3 rd) {
  float s = max(dot(rd, SUN), 0.0), a = max(dot(rd, normalize(uLight - uCam)), 0.0);
  vec3 c = mix(SHADE * 0.22, AIR, pow(s, 2.5));
  return c + SUNC * (pow(s, 12.0) * 0.5 + pow(s, 60.0) * 1.2) + SUNC * pow(a, 30.0) * (0.35 + uFold.y);
}

/** A surface of colour base, lit; and the shell of light sweeping out from the camera on the beat. */
vec3 lit(vec3 p, vec3 n, vec3 rd, float t, vec3 base) {
  vec3 q = p + n * max(0.004 * uScale, 0.003 * t);
  float occ = occlusion(q, n);
  float dif = max(dot(n, SUN), 0.0) * shadow(q);
  vec3 sky = mix(SHADE * 0.35, AIR * 1.2, clamp(0.5 + 0.5 * dot(n, SUN), 0.0, 1.0));
  vec3 col = base * (SUNC * dif * 2.8 + sky * occ);
  col *= mix(0.06, 1.0, pow(occ, 1.6));
  col += GLOW * pow(1.0 - occ, 3.0) * 0.05;
  float e = (length(p - uCam) / uScale - uFold.z) / 0.18;
  col += SIG * uFold.w * exp(-e * e) * (0.3 + 0.7 * occ) * 0.45;
  return col;
}`;
}
