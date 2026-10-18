// Canvas: the song paints its own cover. A brush of light crosses a dark canvas the size of the artwork and lays
// thick paint as the song plays; wherever it passes, the paint takes the cover's colour at that spot, so stroke by
// stroke the cover appears, and when the song ends the camera rises over the whole canvas: the picture this song
// painted. The music is the hand: the voice is the brush's pressure (wider, thicker strokes while words are sung),
// kicks dab splashes, snares flick droplets aside, each section is a gesture — between sections the brush lifts,
// flies to an empty, telling part of the picture and lands on the downbeat; into a drop it lands hard.
// Everything is a pure function of t: the stroke is planned for the whole song up front, and the paint maps hold
// every stamp up to t (drawn as time goes on, redrawn from the start after a seek back).
// Cameras: behind the brush (chase), ahead looking back at it and its trail (front), alongside (side), above (high),
// the whole canvas (map). In the song's last shot every camera rises into the whole canvas.
// 墨 (ink): the same hand on rice paper (写意). The paint maps are read as ink: the cover's darks become scorched,
// solid and pale ink (焦、浓、淡墨), its lights a faint trace, with a breath of its colour (淡彩); the stroke's edges
// bleed into the paper's fibres, the thin parts break into flying white (飞白), fresh ink is a shade darker and
// spreads a little; no relief, no gloss, the paper lit flat. No point of light: the newest, wettest ink shows where
// the brush is. Beyond the sheet, paper-coloured mist. The song leaves more of the paper blank (留白).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { rng, smooth, clamp01, lerp, freeGraph, finish } from './types.ts';
import { LyricBlocks, Stands, boxedBy, voiceFor } from './lyricBlock.ts';
import { INK_BLACK, ricePaper } from './ink.ts';
import type { Music } from '../director/music.ts';
import type { LyricLine, SectionLabel } from '../types.ts';

/** Canvas side, world units (the cover, square). */
const S = 480;
/** Paint map texels per side. */
const MAP = 2048;
/** Brush samples per second. */
const RATE = 60;
/** Planning cells per side. */
const GRID = 24;
const CELL = S / GRID;
/** Paint thickness → height: piles flatten out towards this. */
const PILE = 1.6;
/** How far the brush's glare reaches, in its halo's size (the halo is still at 0.4 of its strength there). */
const GLARE = 0.22;

const v3 = (c: THREE.Color, k = 1) => `vec3(${(c.r * k).toFixed(5)},${(c.g * k).toFixed(5)},${(c.b * k).toFixed(5)})`;
/** A light's colour: the hue of c at full strength. */
const hue = (c: THREE.Color) => { const m = Math.max(c.r, c.g, c.b, 1e-4); return c.clone().multiplyScalar(1 / m); };
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const WIDTH: Record<SectionLabel, number> = { intro: 12, verse: 19, pre: 23, chorus: 32, drop: 38, build: 15, break: 10, bridge: 23, outro: 13 };
const SPLASH: Record<SectionLabel, number> = { intro: 0.6, verse: 0.8, pre: 0.9, chorus: 1.25, drop: 1.6, build: 0.7, break: 0.5, bridge: 1, outro: 0.6 };
const LOUD = new Set<SectionLabel>(['chorus', 'drop']);

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Plan {
  n: number;
  x: Float32Array; z: Float32Array;
  /** Heading (unit). */
  dx: Float32Array; dz: Float32Array;
  /** Stroke width and paint thickness (0 while the brush is up). */
  w: Float32Array; th: Float32Array;
  /** Brush height above the canvas. */
  up: Float32Array;
}

interface Stamp {
  t: number;
  /** 0 a stroke segment, 1 a splash, 2 a flick of droplets. */
  kind: number;
  x: number; z: number; dx: number; dz: number;
  /** Half length along the heading (a splash: its radius), half width. */
  len: number; wid: number;
  th: number;
  seed: number;
}

/** How telling each part of the cover is: contrast and colour, a little towards the middle. */
function saliency(px: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(GRID * GRID);
  const step = size / GRID;
  let max = 1e-6;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    let s = 0, s2 = 0, chroma = 0, n = 0;
    for (let y = Math.floor(j * step); y < Math.floor((j + 1) * step); y++) for (let x = Math.floor(i * step); x < Math.floor((i + 1) * step); x++) {
      const o = (y * size + x) * 4, r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      s += l; s2 += l * l; chroma += Math.max(r, g, b) - Math.min(r, g, b); n++;
    }
    const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
    const cx = (i + 0.5) / GRID - 0.5, cy = (j + 0.5) / GRID - 0.5;
    const v = 0.12 + sd * 2.4 + (chroma / n) * 0.8 + 0.3 * (1 - Math.min(1, Math.hypot(cx, cy) * 2));
    out[j * GRID + i] = v;
    max = Math.max(max, v);
  }
  for (let k = 0; k < out.length; k++) out[k] /= max;
  return out;
}

/** 0..1 while a word is sung (backing vocals half), eased. */
function voiceCurve(lines: LyricLine[], n: number): Float32Array {
  const raw = new Float32Array(n);
  for (const l of lines) for (const w of l.words) {
    const a = Math.max(0, Math.floor(w.start * RATE)), b = Math.min(n, Math.ceil((w.end + 0.06) * RATE));
    for (let k = a; k < b; k++) raw[k] = Math.max(raw[k], l.backing ? 0.5 : 1);
  }
  const out = new Float32Array(n);
  let v = 0;
  for (let k = 0; k < n; k++) { v += (raw[k] - v) * (raw[k] > v ? 0.25 : 0.06); out[k] = v; }
  return out;
}

interface Lift { from: number; to: number; slam: boolean }

/** Where the brush leaves the canvas: before each new gesture (a section of three bars or more), hovering through a build into a drop. */
function liftsOf(music: Music): Lift[] {
  const out: Lift[] = [];
  const sec = music.a.sections;
  for (let i = 1; i < sec.length; i++) {
    const prev = sec[i - 1], s = sec[i];
    const beat = 60 / Math.max(40, music.at(s.start + 0.01).bpm), bar = beat * music.meter;
    if (prev.end - prev.start < bar * 3 || s.end - s.start < bar * 2) continue;
    const slam = s.label === 'drop' || (LOUD.has(s.label) && s.energy > prev.energy + 0.12);
    const dur = slam && prev.label === 'build' ? Math.min(bar * 2, (prev.end - prev.start) * 0.5) : Math.min(bar, 2.6);
    out.push({ from: s.start - dur, to: s.start, slam });
  }
  return out;
}

type Planned = { plan: Plan; lifts: Lift[] };

/**
 * `share`: how much of the canvas the song should cover. Yields every 1024 steps of the stroke (the whole song took
 * 0.15–0.25 s in NetEase's Chromium).
 */
function* planning(music: Music, lines: LyricLine[], sal: Float32Array, seed: number, soft: boolean, share = 0.8): Generator<void, Planned> {
  const n = Math.ceil((music.duration + 2) * RATE) + 1;
  const p: Plan = {
    n, x: new Float32Array(n), z: new Float32Array(n), dx: new Float32Array(n), dz: new Float32Array(n),
    w: new Float32Array(n), th: new Float32Array(n), up: new Float32Array(n),
  };
  const random = rng(seed);
  const voice = voiceCurve(lines, n);
  const lifts = liftsOf(music);
  const cov = new Float32Array(GRID * GRID);
  const centre = (c: number): [number, number] => [-S / 2 + ((c % GRID) + 0.5) * CELL, -S / 2 + (Math.floor(c / GRID) + 0.5) * CELL];

  // The first stroke starts beside the most telling part and runs into it.
  let best = 0;
  for (let c = 1; c < sal.length; c++) if (sal[c] > sal[best]) best = c;
  const [bx, bz] = centre(best);
  let heading = random() * Math.PI * 2;
  let x = THREE.MathUtils.clamp(bx - Math.cos(heading) * 70, -S / 2 + 30, S / 2 - 30), z = THREE.MathUtils.clamp(bz - Math.sin(heading) * 70, -S / 2 + 30, S / 2 - 30);
  heading = Math.atan2(bz - z, bx - x);
  let goal: [number, number] = [bx, bz], goalAt = 0;
  let width = 0, thick = 0, rms = 0;
  const firstLanding = Math.max(0.25, music.downbeats.length && music.downbeats[0] < 4 ? music.downbeats[0] : 0.25);
  let flight: { lift: Lift; fx: number; fz: number; tx: number; tz: number; h: number } | null = null;
  const m1 = random() * 6.28, m2 = random() * 6.28;
  const speed = (t: number, level: number) => (soft ? 14 : 20) * THREE.MathUtils.clamp(music.at(t).bpm / 120, 0.8, 1.3) * (0.7 + 0.55 * level);
  // How wide the brush has to be for the song to cover about four fifths of the canvas: the length it will paint,
  // estimated up front (the stroke's course doesn't change it), against the widths it would use.
  let along = 0, widths = 0, steps = 0, level = 0;
  for (let k = 0; k < n; k++) {
    const t = k / RATE;
    level += (music.env('rms', t) - level) * 0.05;
    if (t < firstLanding || t > music.duration - 1.5 || lifts.some(l => t >= l.from && t < l.to)) continue;
    along += speed(t, level) / RATE;
    widths += WIDTH[music.section(Math.min(t, music.duration - 0.01)).label] * (soft ? 1.15 : 1) * (0.85 + 0.3 * level);
    steps++;
  }
  const fill = steps ? THREE.MathUtils.clamp((share * S * S) / (along * (widths / steps)), (0.9 * share) / 0.8, 2.4) : 1;

  const score = (c: number, loud: boolean) => Math.pow(sal[c], loud ? 1.6 : 0.8) * Math.pow(1 - cov[c], 2);
  const pickGoal = (loud: boolean) => {
    let bestC = -1, bestS = -1e9;
    for (let c = 0; c < cov.length; c++) {
      const [cx, cz] = centre(c), d = Math.hypot(cx - x, cz - z);
      if (d < 30 || d > 220) continue;
      const a = Math.abs(wrapAngle(Math.atan2(cz - z, cx - x) - heading));
      if (a > 2.1) continue;
      const s = score(c, loud) * (1 - a / 3.2) * (1 - d / 360) + random() * 0.04;
      if (s > bestS) { bestS = s; bestC = c; }
    }
    if (bestC < 0) for (let c = 0; c < cov.length; c++) { const s = score(c, loud) + random() * 0.02; if (s > bestS) { bestS = s; bestC = c; } }
    goal = centre(bestC);
  };

  for (let k = 0; k < n; k++) {
    const t = k / RATE;
    const sec = music.section(Math.min(t, music.duration - 0.01));
    const loud = LOUD.has(sec.label);
    rms += (music.env('rms', t) - rms) * 0.05;
    const lift = t < firstLanding ? { from: -1, to: firstLanding, slam: false } : lifts.find(l => t >= l.from && t < l.to) ?? (t > music.duration - 1.5 ? { from: music.duration - 1.5, to: music.duration + 9, slam: false } : null);
    if (lift) {
      if (!flight || flight.lift.from !== lift.from) {
        // Off to the most telling empty part not too far away (into a loud section: the picture's heart).
        const into = music.section(Math.min(lift.to + 0.05, music.duration - 0.01));
        const intoLoud = LOUD.has(into.label);
        let tc = -1, ts = -1e9;
        for (let c = 0; c < cov.length; c++) {
          const [cx, cz] = centre(c), d = Math.hypot(cx - x, cz - z);
          if (d < 40 && lift.from > 0) continue;
          const s = score(c, intoLoud) - (d / S) * 0.25 + random() * 0.03;
          if (s > ts) { ts = s; tc = c; }
        }
        // (The first and the last: it only comes down, or goes up.)
        const still = lift.from < 0 || lift.to > music.duration;
        const [tx, tz] = still ? [x, z] : centre(tc);
        flight = { lift, fx: x, fz: z, tx, tz, h: lift.slam ? 26 : 9 + Math.hypot(tx - x, tz - z) * 0.06 };
      }
      const f = flight, len = Math.max(0.1, f.lift.to - Math.max(0, f.lift.from));
      const u = clamp01((t - Math.max(0, f.lift.from)) / len);
      const e = u * u * (3 - 2 * u);
      const nx = lerp(f.fx, f.tx, e), nz = lerp(f.fz, f.tz, e);
      if (Math.hypot(nx - x, nz - z) > 1e-3) heading = Math.atan2(nz - z, nx - x);
      x = nx; z = nz;
      // Up and over; into a drop it rises, hangs, and dives on the downbeat.
      const h = f.lift.from < 0 ? 6 * (1 - smooth(u * 1.4 - 0.4)) : f.lift.to > music.duration ? 14 * smooth(u * 3) : f.lift.slam ? (u < 0.82 ? smooth(u / 0.4) * f.h : f.h * (1 - Math.pow((u - 0.82) / 0.18, 2))) : Math.sin(Math.PI * u) * f.h;
      p.up[k] = Math.max(0, h);
      width = thick = 0;
      goalAt = -1;
    } else {
      flight = null;
      if (goalAt < 0 || t - goalAt > 0.45 || Math.hypot(goal[0] - x, goal[1] - z) < 24) { pickGoal(loud); goalAt = t; }
      const v = speed(t, rms);
      let want = Math.atan2(goal[1] - z, goal[0] - x) + 0.45 * Math.sin(t * 0.8 + m1) + 0.2 * Math.sin(t * 2.1 + m2);
      const edge = Math.max(Math.abs(x), Math.abs(z)) > S / 2 - 34;
      if (edge) want = Math.atan2(-z, -x);
      const turn = (v / (loud ? 26 : 17)) * (edge ? 2.2 : 1) / RATE;
      heading += THREE.MathUtils.clamp(wrapAngle(want - heading), -turn, turn);
      x = THREE.MathUtils.clamp(x + Math.cos(heading) * v / RATE, -S / 2 + 6, S / 2 - 6);
      z = THREE.MathUtils.clamp(z + Math.sin(heading) * v / RATE, -S / 2 + 6, S / 2 - 6);
      // The voice is the pressure.
      const press = 0.72 + 0.5 * voice[k] * Math.min(1, 0.4 + music.env('mid', t));
      const wantW = WIDTH[sec.label] * (soft ? 1.15 : 1) * fill * press * (0.85 + 0.3 * rms);
      const wantT = (0.25 + 0.5 * rms) * (0.8 + 0.4 * voice[k]) * (loud ? 1.2 : 1);
      width += (wantW - width) * (width < 1 ? 0.3 : 0.08);
      thick += (wantT - thick) * 0.1;
      p.up[k] = 0;
      // What the stroke has covered.
      const r = width / 2 + CELL * 0.35;
      for (let j = Math.max(0, Math.floor((z + S / 2 - r) / CELL)); j <= Math.min(GRID - 1, Math.floor((z + S / 2 + r) / CELL)); j++)
        for (let i = Math.max(0, Math.floor((x + S / 2 - r) / CELL)); i <= Math.min(GRID - 1, Math.floor((x + S / 2 + r) / CELL)); i++) {
          const [cx, cz] = centre(j * GRID + i);
          if (Math.hypot(cx - x, cz - z) < r) cov[j * GRID + i] = Math.min(1, cov[j * GRID + i] + (v / RATE) * width / (CELL * CELL) * 0.8);
        }
    }
    p.x[k] = x; p.z[k] = z; p.dx[k] = Math.cos(heading); p.dz[k] = Math.sin(heading);
    p.w[k] = width; p.th[k] = thick;
    if ((k & 1023) === 1023) yield;
  }
  return { plan: p, lifts };
}

/** Every mark the brush makes, in the order it makes them. */
function stampsOf(p: Plan, music: Music, lifts: Lift[], seed: number, soft: boolean): Stamp[] {
  const out: Stamp[] = [];
  const random = rng(seed ^ 0x9e3779b9);
  // Strokes: one segment per sample, end to end (a crossing stroke piles its paint on; its own segments don't).
  let stroke = random() * 1000;
  for (let k = 0; k + 1 < p.n; k++) {
    if (p.w[k] < 0.5 || p.w[k + 1] < 0.5) { if (p.w[k] < 0.5) stroke = random() * 1000; continue; }
    const ax = p.x[k], az = p.z[k], bx = p.x[k + 1], bz = p.z[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    out.push({ t: k / RATE, kind: 0, x: (ax + bx) / 2, z: (az + bz) / 2, dx: (bx - ax) / len, dz: (bz - az) / len, len: len / 2 + 0.06, wid: p.w[k] / 2, th: p.th[k], seed: stroke });
  }
  const at = (t: number) => Math.max(0, Math.min(p.n - 1, Math.round(t * RATE)));
  const down = (t: number) => p.w[at(t)] > 0.5;
  // Kicks dab splashes just ahead of the brush.
  let last = -1;
  for (const [t, s] of music.a.hits.kick) {
    const sec = music.section(t);
    if (s < (soft ? 0.55 : LOUD.has(sec.label) ? 0.35 : 0.6) || t - last < 0.12 || !down(t)) continue;
    const k = at(t);
    const r = (5 + 12 * s) * SPLASH[sec.label] * (soft ? 0.6 : 1);
    const side = (random() - 0.5) * p.w[k] * 0.5;
    out.push({ t, kind: 1, x: p.x[k] + p.dx[k] * r * 0.4 - p.dz[k] * side, z: p.z[k] + p.dz[k] * r * 0.4 + p.dx[k] * side, dx: p.dx[k], dz: p.dz[k], len: r, wid: r, th: p.th[k] * 1.3 + 0.15, seed: random() * 1000 });
    last = t;
  }
  // Landings.
  for (const l of lifts) {
    const k = at(l.to + 0.01);
    const r = l.slam ? (soft ? 34 : 52) : 18;
    out.push({ t: l.to, kind: 1, x: p.x[k], z: p.z[k], dx: p.dx[k], dz: p.dz[k], len: r, wid: r, th: l.slam ? 1.0 : 0.6, seed: random() * 1000 });
  }
  // Snares flick droplets off to the side (not in a ballad).
  if (!soft) {
    let side = random() < 0.5 ? -1 : 1;
    for (const [t, s] of music.a.hits.snare) {
      if (s < 0.5 || !down(t)) continue;
      const k = at(t), sec = music.section(t);
      side = -side;
      const a = Math.atan2(p.dz[k], p.dx[k]) + side * (1.1 + random() * 0.7);
      const dx = Math.cos(a), dz = Math.sin(a), L = (16 + 30 * s) * (LOUD.has(sec.label) ? 1.3 : 1);
      const ox = p.x[k] - p.dz[k] * side * p.w[k] * 0.4, oz = p.z[k] + p.dx[k] * side * p.w[k] * 0.4;
      out.push({ t, kind: 2, x: ox + dx * L / 2, z: oz + dz * L / 2, dx, dz, len: L / 2, wid: 3 + 3 * s, th: 0.35 + 0.25 * s, seed: random() * 1000 });
    }
  }
  out.sort((a, b) => a.t - b.t || a.kind - b.kind);
  return out;
}

// ── Shaders ──────────────────────────────────────────────────────────────────────────────────────────────────────

const NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
float n2(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}`;

const STAMP_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec4 aA; // centre x, z, heading x, z
in vec4 aB; // t, half length, half width, thickness
in vec2 aC; // kind, seed
uniform vec2 uWindow;
out vec2 vLocal;
out vec2 vWorld;
flat out vec4 vA;
flat out vec4 vB;
flat out vec2 vC;
void main() {
  vA = aA; vB = aB; vC = aC;
  if (aB.x <= uWindow.x || aB.x > uWindow.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 dir = aA.zw, nrm = vec2(-dir.y, dir.x);
  int kind = int(aC.x + 0.5);
  vec2 ext = kind == 0 ? vec2(aB.y + aB.z * 0.5 + 1.0, aB.z + 1.6) : kind == 1 ? vec2(aB.y * 2.0) : vec2(aB.y + aB.z, aB.z * 1.6);
  vLocal = position.xy * ext;
  vWorld = aA.xy + dir * vLocal.x + nrm * vLocal.y;
  gl_Position = vec4(vWorld / ${(S / 2).toFixed(1)}, 0.0, 1.0);
}`;

function stampFrag(pass: number): string {
  return /* glsl */ `
precision highp float;
in vec2 vLocal;
in vec2 vWorld;
flat in vec4 vA;
flat in vec4 vB;
flat in vec2 vC;
uniform sampler2D uCover;
uniform float uBlur, uBristle;
out vec4 fragColor;
${NOISE}
const float S = ${S.toFixed(1)};
vec2 coverUv(vec2 w) { return vec2((w.x + S * 0.5) / S, 1.0 - (w.y + S * 0.5) / S); }

/** Mask (x) and paint height (y) of this stamp here. */
vec2 shape() {
  int kind = int(vC.x + 0.5);
  float seed = vC.y;
  if (kind == 0) {
    // A stretch of stroke with a rounded front (only the newest one's shows: the next is drawn over it): bristle
    // streaks along it (constant along the stroke, so segments join), ragged edges, paint piled at the sides,
    // dry-brush gaps where it is thin.
    float hw = vB.z, v = vLocal.y, u = vLocal.x;
    if (u < -vB.y) return vec2(0.0);
    float r = u > vB.y ? length(vec2((u - vB.y) * 2.0, v)) : abs(v);
    float br = n1(v * 0.55 + seed) * 0.65 + n1(v * 1.45 + seed * 1.7) * 0.35;
    float rag = (n2(vWorld * 0.35 + seed) - 0.5) * 2.2 + (n2(vWorld * 1.3 + seed) - 0.5) * 0.8;
    float m = 1.0 - smoothstep(hw - 1.0 + rag, hw + 0.4 + rag, r);
    float dry = smoothstep(0.1, 0.3, br + vB.w * 0.6);
    m *= mix(0.3, 1.0, dry);
    float edge = smoothstep(0.55, 0.9, r / max(hw, 1.0)) * (1.0 - smoothstep(0.9, 1.05, r / max(hw, 1.0)));
    return vec2(m, vB.w * (0.55 + 0.6 * br + 0.7 * edge));
  }
  if (kind == 1) {
    // A splash: a blob with a ragged, spiky rim and droplets thrown out round it.
    float R = vB.y, r = length(vLocal) / R;
    vec2 d = vLocal / max(length(vLocal), 1e-4);
    float edge = 1.0 + (n2(d * 2.2 + seed) - 0.5) * 0.5 + (n2(d * 5.0 + seed * 1.3) - 0.5) * 0.3 + pow(n2(d * 4.0 + seed * 2.1), 4.0) * 0.45;
    float m = 1.0 - smoothstep(edge - 0.08, edge + 0.02, r);
    float h = (1.25 - 0.6 * r) + 0.6 * smoothstep(0.75, 1.0, r / edge);
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float a = hash11(seed + fi * 3.1) * 6.2832, dist = R * (1.15 + 0.75 * hash11(seed + fi * 5.7));
      float rad = R * (0.04 + 0.09 * hash11(seed + fi * 7.3));
      vec2 c = vec2(cos(a), sin(a)) * dist;
      float dm = 1.0 - smoothstep(rad * 0.75, rad, length(vLocal - c));
      if (dm > m) { m = dm; h = 0.8; }
    }
    return vec2(m, vB.w * h);
  }
  // A flick: droplets in a line, big near the brush, smaller and further apart out along it.
  float L = vB.y * 2.0, hw = vB.z, u = vLocal.x + vB.y;
  float m = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i), s = pow((fi + 0.5) / 9.0, 0.8);
    float rad = hw * (1.0 - 0.72 * s) * (0.6 + 0.4 * hash11(seed + fi * 2.3));
    vec2 c = vec2(s * L, (hash11(seed + fi * 4.1) - 0.5) * hw * 0.8 * s);
    vec2 q = (vLocal + vec2(vB.y, 0.0) - c) * vec2(0.6, 1.0);
    m = max(m, 1.0 - smoothstep(rad * 0.8, rad, length(q)));
  }
  return vec2(m, vB.w * 0.9);
}

void main() {
  vec2 sh = shape();
  if (sh.x < 0.004) discard;
#if ${pass} == 0
  // The cover's colour here, dragged back along the stroke by the bristles (a splash: outwards from its middle).
  bool stroke = int(vC.x + 0.5) == 0;
  vec2 dir = stroke ? vA.zw : normalize(vLocal + 1e-4) * (int(vC.x + 0.5) == 1 ? 1.0 : 0.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) col += texture(uCover, coverUv(vWorld - dir * 2.2 * float(i)), uBlur).rgb;
  col *= 0.25;
  // (A little lighter and darker along the bristles; with ink, clear streaks.)
  float br = n1(vLocal.y * 0.55 + vC.y);
  if (uBristle > 0.2) br = br * 0.7 + n1(vLocal.y * 2.1 + vC.y * 1.3) * 0.3;
  if (stroke) col *= 1.0 - uBristle + 2.0 * uBristle * br;
  fragColor = vec4(col, sh.x);
#else
  // Thickness (the thickest coat: a stroke's own overlapping segments don't pile up) and when it was painted.
  fragColor = vec4(sh.y * sh.x, sh.x > 0.3 ? vB.x + 1.0 : 0.0, 0.0, 1.0);
#endif
}`;
}

// (Flat: the paint's relief is all in the shading. Raised on a vertex grid, its edges came out as stepped walls.)
const CANVAS_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 projectionMatrix, viewMatrix;
out vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

interface Look { ink: THREE.Color; paper: THREE.Color; signal: THREE.Color; accent: THREE.Color; light: boolean }

function canvasFrag(p: Look, key: THREE.Vector3): string {
  // A primed canvas lit from low on one side: dark (the cover's darkest tone, a touch of its white) under a light
  // cover's paint, light (its white, dimmed) under a dark cover's, so the paint always stands off the ground.
  const canvas = p.light ? p.ink.clone().lerp(p.paper, 0.18).multiplyScalar(0.6) : p.paper.clone().lerp(p.ink, 0.25).multiplyScalar(0.45);
  const voidC = p.ink.clone().lerp(p.accent, 0.12).multiplyScalar(0.35);
  const keyC = hue(p.paper.clone().lerp(p.accent, 0.15)).multiplyScalar(0.9);
  const brushC = hue(p.paper.clone().lerp(p.signal, 0.35)).multiplyScalar(0.9);
  const amb = p.ink.clone().lerp(p.accent, 0.35).multiplyScalar(0.35).add(new THREE.Color(0.015, 0.015, 0.02));
  return /* glsl */ `
precision highp float;
in vec3 vWorld;
uniform sampler2D uColor, uThick;
uniform vec3 uCam, uBrush;
uniform float uT, uBrushI, uReveal, uGlow;
out vec4 fragColor;
${NOISE}
const float S = ${S.toFixed(1)}, E = ${(1 / MAP).toFixed(7)};
const vec3 CANVAS = ${v3(canvas)}, VOID = ${v3(voidC)}, KEYC = ${v3(keyC)}, BRUSHC = ${v3(brushC)}, AMB = ${v3(amb)};
const vec3 KEY = vec3(${key.x.toFixed(4)}, ${key.y.toFixed(4)}, ${key.z.toFixed(4)});
float H(vec2 uv) { return ${PILE.toFixed(2)} * (1.0 - exp(-texture(uThick, uv).r / ${PILE.toFixed(2)})); }
void main() {
  vec2 uv = (vWorld.xz + S * 0.5) / S;
  vec4 paint = texture(uColor, uv);
  // The coverage's half-way line is the paint's edge, kept sharp however close the camera comes (the map's texels
  // are a quarter unit: magnified, its edges would be steps).
  float w = clamp(fwidth(paint.a) * 0.8, 0.002, 0.5);
  float a = smoothstep(0.5 - w, 0.5 + w, paint.a);
  vec3 pc = paint.rgb / max(paint.a, 0.05);
  // The paint's relief; the canvas weave where it is bare (faded out where it would shimmer).
  float hl = H(uv - vec2(E, 0.0)), hr = H(uv + vec2(E, 0.0)), hd = H(uv - vec2(0.0, E)), hu = H(uv + vec2(0.0, E));
  vec2 wv = vWorld.xz * 4.2;
  float aa = 1.0 - smoothstep(0.4, 1.4, max(fwidth(wv.x), fwidth(wv.y)));
  float weave = mix(0.5, (sin(wv.x) * 0.5 + 0.5) * (sin(wv.y + 1.57 * step(0.5, fract(vWorld.x * 0.67))) * 0.5 + 0.5), aa);
  vec3 n = normalize(vec3((hl - hr) / (2.0 * E * S), 1.0, (hd - hu) / (2.0 * E * S)));
  n = normalize(n + vec3((weave - 0.5) * 0.12 * (1.0 - a) * aa, 0.0, (weave - 0.5) * 0.06 * (1.0 - a) * aa));
  float grain = n2(vWorld.xz * 0.04) - 0.5 + (n2(vWorld.xz * 0.3) - 0.5) * 0.4;
  vec3 alb = mix(CANVAS * (0.75 + 0.5 * weave + 0.5 * grain), pc, a);

  // The paint's ridges cast short shadows across the canvas in the low light.
  float h0 = H(uv), shade = 1.0;
  vec2 ld = normalize(KEY.xz) / S;
  float rise = KEY.y / length(KEY.xz);
  for (int i = 1; i <= 10; i++) {
    float d = float(i) * 0.4;
    shade = min(shade, clamp(1.0 - (H(uv + ld * d) - h0 - d * rise) * 2.5, 0.0, 1.0));
  }
  vec3 V = normalize(uCam - vWorld);
  float key = 0.75 + 0.6 * uReveal;
  float dif = max(dot(n, KEY), 0.0) * mix(shade, 1.0, 0.25);
  vec3 bl = uBrush - vWorld;
  float bd = length(bl);
  vec3 bL = bl / max(bd, 1e-3);
  float fall = uBrushI / (1.0 + bd * bd / 140.0);
  float bdif = max(dot(n, bL), 0.0) * fall;
  // Fresh paint is wet and holds a little light.
  float tp = texture(uThick, uv).g;
  float age = tp > 0.5 ? uT - (tp - 1.0) : 1e3;
  float heat = exp(-max(age, 0.0) / 2.6) * a;
  float wet = 0.22 * a + 0.4 * heat;
  float spec = pow(max(dot(n, normalize(KEY + V)), 0.0), 32.0) * key * shade + pow(max(dot(n, normalize(bL + V)), 0.0), 48.0) * fall;
  vec3 col = alb * (AMB + KEYC * dif * key + BRUSHC * bdif) + pc * a * (0.06 + 0.1 * uGlow + 0.45 * uReveal);
  col += (KEYC + BRUSHC * fall) * spec * wet * 0.6;
  col += pc * heat * 0.3;
  float d = length(uCam - vWorld);
  col = mix(VOID, col, exp(-d * mix(0.0026, 0.0006, uReveal)));
  fragColor = vec4(clamp(col, 0.0, 8.0), 1.0);
}`;
}

const SKY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

function skyFrag(p: Look): string {
  const horizon = p.ink.clone().lerp(p.accent, 0.12).multiplyScalar(0.35);
  const zenith = p.ink.clone().multiplyScalar(0.25);
  const floorC = p.ink.clone().multiplyScalar(0.3);
  return /* glsl */ `
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCam;
out vec4 fragColor;
const vec3 HORIZON = ${v3(horizon)}, ZENITH = ${v3(zenith)}, FLOOR = ${v3(floorC)};
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(w.xyz / w.w - uCam);
  vec3 col = rd.y > 0.0 ? mix(HORIZON, ZENITH, pow(rd.y, 0.45)) : mix(HORIZON, FLOOR, pow(-rd.y, 0.35));
  fragColor = vec4(col, 1.0);
}`;
}

/** The cover's own range of brightness (sRGB luma, its 8th and 92nd percentiles): the inks span it, light cover or dark. */
function lumaRange(px: Uint8ClampedArray): [number, number] {
  const hist = new Uint32Array(64);
  let n = 0;
  for (let o = 0; o < px.length; o += 16, n++) hist[Math.min(63, Math.floor(((0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255) * 64))]++;
  const at = (q: number) => { let acc = 0; for (let i = 0; i < 64; i++) { acc += hist[i]; if (acc >= q * n) return (i + 0.5) / 64; } return 1; };
  const lo = at(0.08), hi = at(0.92);
  return hi - lo < 0.25 ? [Math.max(0, (lo + hi) / 2 - 0.125), Math.min(1, (lo + hi) / 2 + 0.125)] : [lo, hi];
}

/** 墨: the sheet of rice paper, the paint maps read as ink (see the header). */
function inkCanvasFrag(paper: THREE.Color, [lo, hi]: [number, number]): string {
  const fog = paper.clone().multiplyScalar(0.97);
  return /* glsl */ `
precision highp float;
in vec3 vWorld;
uniform sampler2D uColor, uThick;
uniform vec3 uCam;
uniform float uT, uReveal;
out vec4 fragColor;
${NOISE}
const float S = ${S.toFixed(1)};
const vec3 PAPER = ${v3(paper)}, INK = ${v3(INK_BLACK)}, FOG = ${v3(fog)};
void main() {
  vec2 uv = (vWorld.xz + S * 0.5) / S;
  // The ink spreads into the fibres: the coverage read through a little wander, its edge broken and feathered.
  vec2 wander = vec2(n2(vWorld.xz * 0.6), n2(vWorld.xz * 0.6 + 7.1)) - 0.5;
  vec4 paint = texture(uColor, uv + wander * 0.0012);
  float fib = n2(vec2(vWorld.x * 2.4, vWorld.z * 0.35)) - 0.5;
  float w = clamp(fwidth(paint.a) * 0.8, 0.002, 0.5);
  float edge = paint.a + fib * 0.16 + (n2(vWorld.xz * 0.25) - 0.5) * 0.12;
  float a = smoothstep(0.5 - w - 0.06, 0.5 + w, edge);
  // A pale bleed just outside the stroke (洇).
  float bleed = smoothstep(0.12, 0.45, edge) * (1.0 - a) * 0.22;
  vec3 pc = paint.rgb / max(paint.a, 0.05);
  float l = pow(max(dot(pc, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2);
  // The cover's darks (against its own range) in distinct inks — pale, solid, scorched; its lights still leave a faint
  // trace where the brush went.
  float dark = 1.0 - clamp((l - ${lo.toFixed(3)}) / ${(hi - lo).toFixed(3)}, 0.0, 1.0);
  float tone = 0.36 + smoothstep(0.2, 0.3, dark) * 0.2 + smoothstep(0.48, 0.56, dark) * 0.24 + smoothstep(0.74, 0.82, dark) * 0.2;
  // Fresh ink is a shade darker (the wet head of the stroke shows where the brush is).
  float tp = texture(uThick, uv).g;
  float age = tp > 0.5 ? uT - (tp - 1.0) : 1e3;
  float wet = exp(-max(age, 0.0) / 1.6);
  tone = min(1.0, tone * (1.0 + 0.25 * wet)) * (0.86 + 0.24 * n2(vWorld.xz * 0.9));
  float ink = max(tone * a, bleed * tone);
  // Rice paper: warm, mottled, its fibres showing.
  float fibre = smoothstep(0.62, 0.9, n2(vec2(vWorld.x * 30.0, vWorld.z * 1.3))) * 0.05;
  vec3 ground = PAPER * (0.93 + 0.07 * n2(vWorld.xz * 0.05) - fibre);
  // A breath of the cover's colour where the ink lies (淡彩).
  vec3 wash = mix(vec3(1.0), clamp(pc * 1.6 / max(max(pc.r, max(pc.g, pc.b)), 0.05), 0.0, 1.0), 0.4);
  vec3 col = mix(ground * mix(vec3(1.0), wash, clamp(ink * 1.6, 0.0, 1.0) * 0.55), INK, ink * 0.94);
  float d = length(uCam - vWorld);
  col = mix(FOG, col, exp(-d * mix(0.0024, 0.0005, uReveal)));
  fragColor = vec4(col, 1.0);
}`;
}

/** 墨: paper-coloured mist round the sheet, a little lighter overhead. */
function inkSkyFrag(paper: THREE.Color): string {
  const horizon = paper.clone().multiplyScalar(0.97), zenith = paper.clone().lerp(new THREE.Color(1, 1, 1), 0.25);
  return /* glsl */ `
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCam;
out vec4 fragColor;
const vec3 HORIZON = ${v3(horizon)}, ZENITH = ${v3(zenith)};
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(w.xyz / w.w - uCam);
  fragColor = vec4(mix(HORIZON, ZENITH, pow(max(rd.y, 0.0), 0.6)), 1.0);
}`;
}

// ── The scene ────────────────────────────────────────────────────────────────────────────────────────────────────

export class CanvasScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 4000);
  private plan: Plan;
  private stamps: Stamp[];
  private targets: THREE.WebGLRenderTarget[];
  private passes: THREE.Scene[];
  get offscreen(): THREE.Object3D[] { return this.passes; }
  private stampCam = new THREE.Camera();
  /** uBlur: a mip bias for reading the cover (ink paints its masses, not a photo's grain). */
  private stampU = { uWindow: { value: new THREE.Vector2() }, uCover: { value: null as THREE.Texture | null }, uBlur: { value: 0 }, uBristle: { value: 0.1 } };
  /** The time the paint maps hold (−∞: empty). */
  private drawn = -Infinity;
  private t = 0;
  private u: Record<string, THREE.IUniform>;
  private skyU: Record<string, THREE.IUniform>;
  private brush: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private core: THREE.Color;
  private halo: THREE.Mesh;
  private blocks: LyricBlocks;
  /** Lines stand over the canvas ahead, in turn high left and lower right. */
  private stands = new Stands([[-0.14, 0.26], [0.14, 0.17]]);
  private soft: boolean;
  /** 墨: ink on rice paper. */
  private ink: boolean;
  private duration: number;

  /** The plate built in steps, its stroke planned between yields (for MvPlayer.loadInSlices). */
  static *building(init: SceneInit, look: 'pulse' | 'ballad' | 'ink' = 'pulse', seed = 1): Generator<void, CanvasScene> {
    return new CanvasScene(init, look, seed, yield* CanvasScene.planned(init, look, seed));
  }

  private static planned(init: SceneInit, look: 'pulse' | 'ballad' | 'ink', seed: number): Generator<void, Planned> {
    return planning(init.music, init.lyrics.lines, saliency(init.coverPixels, init.coverSize), seed, look !== 'pulse', look === 'ink' ? 0.62 : 0.8);
  }

  constructor(init: SceneInit, look: 'pulse' | 'ballad' | 'ink' = 'pulse', seed = 1, planned = finish(CanvasScene.planned(init, look, seed))) {
    const { palette, music } = init;
    this.soft = look !== 'pulse';
    this.ink = look === 'ink';
    const paper = ricePaper(palette);
    this.scene.background = this.ink ? paper.clone() : palette.ink.clone().multiplyScalar(0.3);
    this.plan = planned.plan;
    this.stamps = stampsOf(this.plan, music, planned.lifts, seed, this.soft);
    this.duration = music.duration;
    this.boxed = boxedBy(music);

    // The paint maps: colour (laid over), and thickness with when it was last painted (both the most).
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.targets = [new THREE.WebGLRenderTarget(MAP, MAP, opts), new THREE.WebGLRenderTarget(MAP, MAP, opts)];
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const A = new Float32Array(this.stamps.length * 4), B = new Float32Array(this.stamps.length * 4), C = new Float32Array(this.stamps.length * 2);
    this.stamps.forEach((s, i) => {
      A.set([s.x, s.z, s.dx, s.dz], i * 4);
      B.set([s.t, s.len, s.wid, s.th], i * 4);
      C.set([s.kind, s.seed], i * 2);
    });
    quad.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    quad.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    quad.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 2));
    quad.instanceCount = this.stamps.length;
    this.stampU.uCover.value = init.cover;
    this.stampU.uBlur.value = this.ink ? 2.2 : 0;
    this.stampU.uBristle.value = this.ink ? 0.4 : 0.1;
    const blend = [
      { equation: THREE.AddEquation, src: THREE.SrcAlphaFactor, dst: THREE.OneMinusSrcAlphaFactor, srcA: THREE.OneFactor, dstA: THREE.OneMinusSrcAlphaFactor },
      { equation: THREE.MaxEquation, src: THREE.OneFactor, dst: THREE.OneFactor, srcA: THREE.OneFactor, dstA: THREE.OneFactor },
    ];
    this.passes = blend.map((b, pass) => {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: STAMP_VERT, fragmentShader: stampFrag(pass), uniforms: this.stampU,
        depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: b.equation, blendEquationAlpha: b.equation,
        blendSrc: b.src, blendDst: b.dst, blendSrcAlpha: b.srcA, blendDstAlpha: b.dstA, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(quad, m);
      mesh.frustumCulled = false;
      const sc = new THREE.Scene();
      sc.add(mesh);
      return sc;
    });

    // The canvas.
    const random = rng(seed ^ 0x51ed);
    const az = random() * Math.PI * 2;
    const key = new THREE.Vector3(Math.cos(az) * Math.cos(0.38), Math.sin(0.38), Math.sin(az) * Math.cos(0.38));
    this.u = {
      uColor: { value: this.targets[0].texture }, uThick: { value: this.targets[1].texture },
      uCam: { value: new THREE.Vector3() }, uBrush: { value: new THREE.Vector3() }, uT: { value: 0 }, uBrushI: { value: 1 }, uReveal: { value: 0 }, uGlow: { value: 0 },
    };
    const grid = new THREE.PlaneGeometry(S, S, 1, 1);
    grid.rotateX(-Math.PI / 2);
    const canvas = new THREE.Mesh(grid, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CANVAS_VERT, fragmentShader: this.ink ? inkCanvasFrag(paper, lumaRange(init.coverPixels)) : canvasFrag(palette, key), uniforms: this.u }));
    canvas.frustumCulled = false;
    this.scene.add(canvas);

    // Round it: the dark beyond the canvas.
    this.skyU = { uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() } };
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const sky = new THREE.Mesh(tri, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SKY_VERT, fragmentShader: this.ink ? inkSkyFrag(paper) : skyFrag(palette), uniforms: this.skyU, depthTest: false, depthWrite: false }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      (this.skyU.uInvVP.value as THREE.Matrix4).multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
      (this.skyU.uCam.value as THREE.Vector3).copy(camera.position);
    };
    this.scene.add(sky);

    // The brush: a point of light with a soft halo.
    this.core = hue(palette.paper.clone().lerp(palette.signal, 0.2)).multiplyScalar(2.2);
    this.brush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: this.core.clone() }));
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hue(palette.signal.clone().lerp(palette.paper, 0.4)) }, uI: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec2 vUv; void main() { float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r)); gl_FragColor = vec4(uColor * a * uI, 1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    // (Not depth-tested: half sunk into the canvas, its lower edge was a hard line across the paint.)
    this.halo.renderOrder = 5;
    this.scene.add(this.brush, this.halo);

    // (On paper, light dust would not show: the words just go.)
    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 2.3, maxW: this.soft ? 11 : 13, trans: 0.48, onLight: this.ink, dust: this.ink ? undefined : [0, 1.5, 0] });
    this.scene.add(this.blocks.group);

    this.scene.onBeforeRender = renderer => this.paint(renderer);
    this.resize(init.aspect);
  }

  /** The paint maps and the stamp passes' scenes (MvScene.dispose). */
  dispose(): void {
    for (const t of this.targets) t.dispose();
    for (const sc of this.passes) freeGraph(sc);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  keepUp(t: number, renderer: THREE.WebGLRenderer): void {
    this.t = t;
    this.paint(renderer);
  }

  /** Brings the paint maps up to this.t: the stamps since the last frame, or all of them again after a seek back. */
  private paint(renderer: THREE.WebGLRenderer): void {
    const t = this.t;
    if (t === this.drawn) return;
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    const fresh = t < this.drawn;
    (this.stampU.uWindow.value as THREE.Vector2).set(fresh || this.drawn === -Infinity ? -1e9 : this.drawn, t);
    this.passes.forEach((sc, i) => {
      renderer.setRenderTarget(this.targets[i]);
      if (fresh || this.drawn === -Infinity) { renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); }
      renderer.render(sc, this.stampCam);
    });
    renderer.setClearColor(color, alpha);
    renderer.setRenderTarget(prev);
    renderer.autoClear = auto;
    this.drawn = t;
  }

  private probe = { x: 0, z: 0, dx: 0, dz: 0, up: 0, w: 0 };
  private boxed: (t: number) => boolean;
  /** Where the brush's light is at t and how far its glare reaches (its halo without the kicks), for the stands. */
  private glareAt = (t: number, out: THREE.Vector3): number => {
    const b = this.brushAt(t, this.probe);
    out.set(b.x, b.up + 0.9, b.z);
    return GLARE * (5 + b.w * 0.06);
  };

  /** The brush at t, interpolated. */
  private brushAt(t: number, out: { x: number; z: number; dx: number; dz: number; up: number; w: number }) {
    const p = this.plan, f = THREE.MathUtils.clamp(t * RATE, 0, p.n - 1.001), i = Math.floor(f), k = f - i;
    out.x = lerp(p.x[i], p.x[i + 1], k); out.z = lerp(p.z[i], p.z[i + 1], k);
    const hx = lerp(p.dx[i], p.dx[i + 1], k), hz = lerp(p.dz[i], p.dz[i + 1], k), hl = Math.hypot(hx, hz) || 1;
    out.dx = hx / hl; out.dz = hz / hl;
    out.up = lerp(p.up[i], p.up[i + 1], k);
    out.w = lerp(p.w[i], p.w[i + 1], k);
    return out;
  }

  /** Camera height in this section (eased across section changes); breaks rise to look over the picture. */
  private height(t: number, music: Music): number {
    const lift = (label: SectionLabel) => (label === 'break' ? 26 : label === 'chorus' ? 3 : label === 'drop' ? 1.5 : label === 'intro' ? 4 : 0);
    const secs = music.a.sections, i = music.sectionIndex(t), s = secs[i];
    const prev = secs[i - 1];
    const k = prev ? smooth((t - s.start + 0.6) / 1.8) : 1;
    return lerp(prev ? lift(prev.label) : lift(s.label), lift(s.label), k);
  }

  /**
   * 0..1 how far the camera has risen over the whole canvas: only in the song's last shot, a few seconds in (the
   * brush is seen finishing first), over 5 to 12 seconds.
   */
  private revealAt(t: number, shot: Shot): number {
    if (shot.variant === 'map' || shot.end < this.duration - 0.5) return 0;
    let from = shot.start + Math.min(4, (shot.end - shot.start) * 0.25);
    if (this.duration - from < 6) from = this.duration - 6;
    const len = THREE.MathUtils.clamp((this.duration - from) * 0.6, 5, 12);
    return smooth((t - from) / len);
  }

  private pose(t: number, music: Music, shot: Shot, pos: THREE.Vector3, quat: THREE.Quaternion, aim?: THREE.Vector3): void {
    const variant = shot.variant;
    const b = { x: 0, z: 0, dx: 0, dz: 0, up: 0, w: 0 }, b2 = { ...b };
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    const extra = this.height(t, music);
    if (variant === 'map') {
      eye.set(0, S * 0.94, S * 0.16);
      target.set(0, 0, -S * 0.01);
    } else if (variant === 'front') {
      this.brushAt(t + 1.15, b);
      this.brushAt(t, b2);
      eye.set(b.x - b.dz * 4, 4.5 + b.up * 0.8 + extra, b.z + b.dx * 4);
      target.set(b2.x, b2.up + 0.8, b2.z);
    } else if (variant === 'side') {
      this.brushAt(t - 0.25, b);
      this.brushAt(t + 0.35, b2);
      eye.set(b.x - b.dz * 20, 6 + b.up * 0.9 + extra, b.z + b.dx * 20);
      target.set(b2.x, b2.up, b2.z);
    } else if (variant === 'high') {
      this.brushAt(t - 0.7, b);
      this.brushAt(t + 0.5, b2);
      eye.set(b.x - b.dx * 8, 46 + b.up + extra, b.z - b.dz * 8);
      target.set(b2.x, 0, b2.z);
    } else {
      this.brushAt(t - 0.8, b);
      this.brushAt(t + 0.5, b2);
      eye.set(b.x - b.dx * 3, 12 + b.up * 0.9 + extra, b.z - b.dz * 3);
      target.set(b2.x, b2.up * 0.7, b2.z);
    }
    const r = this.revealAt(t, shot);
    if (r > 0) {
      const e = r * r * (3 - 2 * r);
      eye.lerp(new THREE.Vector3(0, S * 0.94, S * 0.16), e);
      target.lerp(new THREE.Vector3(0, 0, -S * 0.01), Math.min(1, e * 1.4));
    }
    pos.copy(eye);
    aim?.copy(target);
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    quat.setFromRotationMatrix(m);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    // (The paint follows the song's time through keepUp, not this: a shot held on its first frame under a
    // transition is updated at a later time, and would set the maps forward and back every frame.)
    const cam = this.camera;
    this.pose(t, music, shot, cam.position, cam.quaternion);
    cam.updateMatrixWorld();
    const sec = music.section(t);
    const loud = LOUD.has(sec.label);

    const b = this.brushAt(t, { x: 0, z: 0, dx: 0, dz: 0, up: 0, w: 0 });
    const kick = music.pulse('kick', t, 0.2);
    const tip = new THREE.Vector3(b.x, b.up + 0.9, b.z);
    this.brush.position.copy(tip);
    this.brush.scale.setScalar(1 + kick * 0.6 + music.env('mid', t) * 0.3);
    this.halo.position.copy(tip);
    this.halo.quaternion.copy(cam.quaternion);
    this.halo.scale.setScalar(5 + kick * 3 + b.w * 0.06);
    const r = this.revealAt(t, shot);
    // (On paper there is no point of light: the wet head of the stroke shows the brush.)
    this.brush.visible = this.halo.visible = r < 0.98 && !this.ink;

    const u = this.u;
    (u.uCam.value as THREE.Vector3).copy(cam.position);
    (u.uBrush.value as THREE.Vector3).copy(tip).setY(tip.y + 2.5);
    u.uT.value = t;
    u.uBrushI.value = (0.45 + kick * (this.soft ? 0.3 : 0.6) + music.env('rms', t) * 0.25) * (1 - r);
    u.uReveal.value = r;
    u.uGlow.value = (loud ? 0.6 : 0.2) + 0.4 * music.env('rms', t);

    // The words: each line one block standing over the canvas ahead, where the camera following the brush will have
    // it in view while it is sung (lyricBlock.ts); it comes up to it as the line ends. The camera keeps the brush in
    // the middle of the frame, just under the blocks' lanes: a block stands clear of its light where it can (the
    // brush white-hot behind a translation took half of it away), and where it can't, the light draws in behind it.
    const view = { reach: 24, far: 34, fov: cam.fov, aspect: cam.aspect, em: this.soft ? 0.064 : 0.068, clear: this.ink ? undefined : this.glareAt, boxed: this.boxed };
    const pose = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => this.pose(time, music, shot, pp, qq);
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root, leave, size) => {
      const s = this.stands.get(shot.start, st, leave, pose, 2.3, view, size);
      s.apply(time, root);
      return smooth((s.depth(time) - 6) / 5);
    });
    // Behind a word the light draws in to a small spark: the halo goes, the core shrinks and half dims (dimmed alone
    // it was a grey ball).
    const glare = this.blocks.glare(cam, tip, GLARE * this.halo.scale.x);
    this.brush.scale.multiplyScalar(1 - 0.5 * glare);
    this.brush.material.color.copy(this.core).multiplyScalar(1 - 0.5 * glare);
    (this.halo.material as THREE.ShaderMaterial).uniforms.uI.value = (0.4 + kick * 0.5) * (1 - 0.9 * glare);

    ctx.fx.bloom = this.ink ? 0.04 : 0.25;
    ctx.fx.vignette = this.ink ? 0.25 : 0.55;
    ctx.fx.grain = this.ink ? 0.035 : 0.03;
  }
}
