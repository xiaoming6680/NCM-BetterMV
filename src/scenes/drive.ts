// Drive: the push tunnel for a song's climaxes (its drops), after the drop of the user's 《游戏是你的解药吗？》
// (Clarity_MV/app/src/scenes/tunnel.ts). A dense tube of hairline frames rushing at a wide lens: near frames
// paper-white, then a pale accent, the deep accent far off; every fourth frame bright, the rest faint.
//  · Speed: a fast cruise counted in beats (the tempo sets it) and a surge on every kick.
//  · Kicks: a shock ring in the signal colour runs down the tube, swelling and lighting the frames it passes and the
//    walls between them; the lens punches in.
//  · Snares: the whole tube snaps round a notch.
//  · Worlds: each four-bar phrase the tube becomes another place — keycap well, rifled barrel, hexagonal hangar,
//    road, pixel mine (walls of the cover's pixels), triangle, a strobe of shapes — met at a place down the tube,
//    so the camera flies into the next world on the phrase's downbeat.
//  · Long speed streaks just outside the tube, barrel distortion, the song's crystal (with the cover inside it)
//    glowing at the far end, and at the start of the section a white shockwave blown out towards the camera.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng, smooth } from './types.ts';
import { LineBatch } from '../render/lines.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { Crystal } from '../sigil/crystal.ts';

const R = 2.3; // frame radius
const S = 0.45; // spacing between frames along the tube
const NF = 170; // frames drawn ahead of the camera
const P = 48; // points round a frame
const FOV = 76;
const BARREL = 0.18;
const SURGE = 18; // extra speed a kick gives, world units per second…
const TAU = 0.18; // …decaying over this many seconds
const PHRASE = 4; // bars per shape
const BLEND = 3.2; // units of tube over which one world's outline turns into the next
const RINGS = 8; // shock rings in flight at once…
const RING_LIFE = 1.3; // …each until it is past the far end of the tube (seconds)

type RGB = [number, number, number];
interface Basis { c: THREE.Vector3; r: THREE.Vector3; u: THREE.Vector3; t: THREE.Vector3 }

const hash = (a: number, b: number, c = 0) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** Frames right at the lens stay dim (they sweep the corners), peak a few frames in, then sink into the ink. */
const fogAt = (d: number) => smooth((d - 1) / 2.2) * Math.exp(-d / 17);
/** The tube's centre line: an S-bend in both axes. */
const center = (s: number, o: THREE.Vector3) => o.set(1.8 * Math.sin(0.05 * s - 1.0), 1.1 * Math.sin(0.07 * s + 0.4), -s);
const UP = new THREE.Vector3(0, 1, 0);

/** Frame outline weights: rounded square, circle, triangle (apex up), hexagon (a vertex at the sides), hard square. */
type Outline = [number, number, number, number, number];

/** Radius (× R) at angle th of a blend of the outlines. */
function shapeR(th: number, w: Outline): number {
  let r = w[1];
  const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
  if (w[0] > 0) r += w[0] * 0.86 * Math.pow(c * c * c * c * c + s * s * s * s * s, -0.2);
  if (w[2] > 0) {
    const k = (2 * Math.PI) / 3, a = ((((th - Math.PI / 2) % k) + k) % k) - k / 2;
    r += (w[2] * 0.625) / Math.cos(a);
  }
  if (w[3] > 0) {
    const k = Math.PI / 3, a = (((th % k) + k) % k) - k / 2;
    r += (w[3] * 0.95 * 0.866) / Math.cos(a);
  }
  if (w[4] > 0) r += (w[4] * 0.84) / Math.max(c, s);
  return r;
}

/**
 * The tube's worlds, one per four-bar phrase (after the push tunnel of the user's 《游戏是你的解药吗？》, where each
 * stretch was a game): a keycap well (rounded square, four corner rails), a rifled barrel (round, six helical
 * grooves), a hexagonal hangar (rails on its six edges, a rib every few frames), a road (a dashed lane on the
 * floor, lamps overhead, a pair of tail lights ahead), a pixel mine (square, the walls built of the cover's own
 * pixels), a triangle (the user's 《三角形》), and a strobe of shapes changing on every beat.
 */
const WORLDS = ['well', 'rifling', 'hangar', 'road', 'pixels', 'triangle', 'strobe'] as const;
type World = (typeof WORLDS)[number];
const OUTLINE: Record<Exclude<World, 'strobe'>, Outline> = {
  well: [1, 0, 0, 0, 0], rifling: [0, 1, 0, 0, 0], hangar: [0, 0, 0, 1, 0], road: [1, 0, 0, 0, 0], pixels: [0, 0, 0, 0, 1], triangle: [0, 0, 1, 0, 0],
};
const blend = (a: Outline, b: Outline, k: number): Outline => a.map((x, i) => lerp(x, b[i], k)) as Outline;

// Unit directions round a frame (the frame's own turn is applied as a rotation).
const COS = Float32Array.from({ length: P }, (_, k) => Math.cos((k / P) * Math.PI * 2));
const SIN = Float32Array.from({ length: P }, (_, k) => Math.sin((k / P) * Math.PI * 2));

/** The palette's colour at lightness l, its saturation lifted a little (grey stays grey, muted stays muted). */
function vivid(c: THREE.Color, l: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(hsl.h, hsl.s < 0.12 ? hsl.s : Math.min(0.9, hsl.s * 1.4), l, THREE.SRGBColorSpace);
}
const rgb = (c: THREE.Color): RGB => [c.r, c.g, c.b];

const bgVertex = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const bgFragment = /* glsl */ `
  uniform vec2 uVP; uniform float uAspect, uHaze; uniform vec3 uInk, uGlow, uFar;
  varying vec2 vP;
  void main() {
    vec2 d = (vP - uVP) * vec2(uAspect, 1.0);
    float q = length(d) * 0.5;
    gl_FragColor = vec4(uInk + uGlow * uHaze * 0.28 * exp(-q * q * 9.0) + uFar * uHaze * 0.05 * exp(-q * q * 70.0), 1.0);
  }`;

export class Drive implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 400);
  private lines = new LineBatch(22000);
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private crystal: Crystal;
  private rig: LyricRig;
  private kicks: Float64Array;
  private snares: Float64Array;
  private snareTurn: Float32Array;
  private white: RGB; private ice: RGB; private mid: RGB; private far: RGB; private shock: RGB; private wall: RGB;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private pts = new Float32Array((NF + 2) * P * 3);
  private radii = new Float32Array(P);
  private ringR = new Float32Array(RINGS);
  private ringA = new Float32Array(RINGS);
  private shk = new Float32Array(NF + 2);
  /** Per frame: the two worlds it is between and how far into the second, and its centre. */
  private fa: World[] = new Array(NF + 2).fill('well');
  private fb: World[] = new Array(NF + 2).fill('well');
  private fw = new Float32Array(NF + 2);
  private cen = new Float32Array((NF + 2) * 3);
  private radA = new Float32Array(P);
  private radB = new Float32Array(P);
  private radC = new Float32Array(P);
  /** How many drops came before each section. */
  private dropOrdinal: number[];
  /** The cover's colours on a 48 × 32 grid (round the tube × along it), for the pixel mine's walls. */
  private cells = new Float32Array(48 * 32 * 3);
  private tmp = new THREE.Vector3();
  private bA: Basis = { c: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), t: new THREE.Vector3() };
  private bB: Basis = { c: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), t: new THREE.Vector3() };

  constructor(private init: SceneInit) {
    const { palette } = init;
    // The reference: ice-white near, sky in the middle, electric blue far, a red shock. Here the far hue is the
    // cover's accent and the shock its signal colour; when the two are one hue (or the cover is black and white)
    // the shock is white — never a colour the cover doesn't have.
    const farC = vivid(palette.accent, 0.52);
    const hsl = { h: 0, s: 0, l: 0 }, sig = { h: 0, s: 0, l: 0 };
    farC.getHSL(hsl, THREE.SRGBColorSpace);
    palette.signal.getHSL(sig, THREE.SRGBColorSpace);
    const dh = Math.abs(((hsl.h - sig.h + 1.5) % 1) - 0.5);
    const shockC = sig.s > 0.12 && (hsl.s < 0.12 || dh > 0.1) ? palette.signal.clone() : palette.paper.clone();
    this.far = rgb(farC);
    this.mid = rgb(vivid(palette.accent, 0.68));
    this.ice = rgb(new THREE.Color().copy(palette.paper).lerp(vivid(palette.accent, 0.85), 0.5));
    this.white = rgb(palette.paper);
    this.shock = rgb(shockC);
    this.wall = rgb(new THREE.Color().copy(palette.ink).lerp(shockC, 0.8));
    this.kicks = Float64Array.from(init.music.a.hits.kick.filter(h => h[1] > 0.35), h => h[0]);
    this.snares = Float64Array.from(init.music.a.hits.snare.filter(h => h[1] > 0.35), h => h[0]);
    this.snareTurn = Float32Array.from(this.snares, s => (Math.floor(init.music.at(s).bar / 8) % 2 === 0 ? 1 : -1));
    let drops = 0;
    this.dropOrdinal = init.music.a.sections.map(s => (s.label === 'drop' ? drops++ : drops));
    const px = init.coverPixels, cs = init.coverSize;
    for (let v = 0; v < 32; v++) for (let u = 0; u < 48; u++) {
      const o = (Math.min(cs - 1, Math.floor(((v + 0.5) / 32) * cs)) * cs + Math.min(cs - 1, Math.floor(((u + 0.5) / 48) * cs))) * 4;
      const q = (v * 48 + u) * 3;
      // Its hue kept, its brightness lifted so a dark cover still builds a visible wall.
      const lin = [0, 1, 2].map(c => Math.pow(px[o + c] / 255, 2.2)), top = Math.max(1e-3, ...lin);
      for (let c = 0; c < 3; c++) this.cells[q + c] = (lin[c] / top) * (0.45 + 0.55 * top);
    }

    this.scene.background = palette.ink.clone();
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: bgVertex, fragmentShader: bgFragment, depthTest: false, depthWrite: false,
      uniforms: {
        uVP: { value: new THREE.Vector2() }, uAspect: { value: 16 / 9 }, uHaze: { value: 1 },
        uInk: { value: palette.ink.clone() }, uGlow: { value: farC.clone().lerp(palette.ink, 0.55) }, uFar: { value: farC.clone() },
      },
    }));
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    // The song's crystal at the far end of the tube: where the flight is heading, never reached.
    this.crystal = new Crystal(init.crystal, palette, init.cover);
    this.crystal.group.renderOrder = -5;
    this.scene.add(this.bg, this.crystal.group, this.lines.mesh);
    this.rig = new LyricRig(palette, 'hook');
    // Lay the words out for the resting lens, so a kick's zoom punch moves them with the tube instead of resizing
    // the next line; and shrink them by what the barrel magnifies the middle.
    this.rig.layoutFov = FOV;
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bg.material.uniforms.uAspect.value = aspect;
    const lens = 1 + BARREL * (0.25 * aspect * aspect + 0.25);
    this.rig.group.scale.set(1 / lens, 1 / lens, 1);
  }

  /** Drawing-buffer size and pixel ratio, so hairlines keep their pixel width. */
  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  private basis(s: number, b: Basis): Basis {
    center(s, b.c);
    b.t.copy(center(s + 0.05, this.tmp)).sub(b.c).normalize();
    b.r.crossVectors(b.t, UP).normalize();
    b.u.crossVectors(b.r, b.t).normalize();
    return b;
  }

  /** Distance along the tube: a cruise of `perBeat` units a beat since the section began, plus the kicks' surges. */
  private travel(t: number, from: number, perBeat: number): number {
    const m = this.init.music;
    let s = perBeat * (m.beatPos(t) - m.beatPos(from));
    for (let i = lastIndex(this.kicks, t); i >= 0 && this.kicks[i] >= from; i--) s += SURGE * TAU * (1 - Math.exp(-(t - this.kicks[i]) / TAU));
    return s;
  }

  /** The strobe world's outline: a new shape on every beat, snapping over a quarter beat. */
  private strobe(t: number): Outline {
    const beats = this.init.music.beatPos(t), b = Math.floor(beats);
    const one = (q: number): Outline => OUTLINE[(['well', 'rifling', 'triangle', 'hangar'] as const)[((q % 4) + 4) % 4]];
    return blend(one(b - 1), one(b), outExpo(clamp01((beats - b) / 0.25)));
  }

  /** The world of a phrase of a section (each later drop starts further along the cycle). */
  private world(sectionIndex: number, phrase: number): World {
    return WORLDS[(Math.max(0, phrase) + 2 * (this.dropOrdinal[sectionIndex] ?? 0)) % WORLDS.length];
  }

  private depthColor(d: number): RGB {
    let c = mix(this.ice, this.white, smooth((d - 1.5) / 2.5) * (1 - smooth((d - 4) / 3)));
    c = mix(c, this.mid, smooth((d - 5) / 6));
    return mix(c, this.far, smooth((d - 10) / 12));
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const info = music.at(t);
    const section = shot.section;
    const energy = section.energy;
    const u = Math.max(0, t - section.start);
    const perBeat = 15 + 6 * energy;
    const kick = music.pulse('kick', t, 0.07), kickSlow = music.pulse('kick', t, 0.2);
    const snareP = music.pulse('snare', t, 0.09);
    const random = rng(shot.seed);
    const sign = random() < 0.5 ? -1 : 1;

    // Twist: a notch snapped on each snare (eased over 80 ms), turning the way of the eight bars it fell in — so
    // the tube reverses its turning every eight bars without jumping back.
    let snap = 0, phi = 0;
    for (let i = lastIndex(this.snares, t); i >= 0 && this.snares[i] >= section.start; i--) {
      const e = outExpo(clamp01((t - this.snares[i]) / 0.08));
      snap += e;
      phi += 0.2 * e * this.snareTurn[i];
    }
    const K = 0.006 + 0.0016 * Math.min(snap, 20);

    // Camera on the tube's line, looking a little ahead; wide lens, punched by the kicks and the section's start.
    const sCam = this.travel(t, section.start, perBeat);
    const cb = this.basis(sCam, this.bA);
    const cam = this.camera;
    cam.position.copy(cb.c);
    cam.up.copy(cb.u);
    cam.lookAt(center(sCam + 7, this.tmp));
    let roll = 0.03 * Math.sin(u * 2.1) + snareP * 0.05;
    if (shot.variant === 'roll') roll += (t - shot.start) * 0.5 * sign;
    cam.rotateZ(roll);
    cam.fov = FOV + 12 * Math.exp(-u / 0.12) + 10 * kick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const vp = center(sCam + 30, this.tmp).project(cam);
    this.bg.material.uniforms.uVP.value.set(vp.x, vp.y);
    this.bg.material.uniforms.uHaze.value = 1 + 0.6 * kickSlow;

    // The shock rings of the recent kicks, each running on down the tube and fading into the haze: a new kick sends
    // a new ring after the last one instead of cutting it short. (A ring sets off a few frames in, so the nearest,
    // largest frames don't flood the picture.)
    const lk = lastIndex(this.kicks, t), ringR = this.ringR, ringA = this.ringA;
    let nr = 0;
    for (let i = lk; i >= 0 && nr < RINGS; i--) {
      const age = t - this.kicks[i];
      if (age > RING_LIFE) break;
      ringR[nr] = 3.5 + age * 60;
      ringA[nr++] = Math.pow(0.5, age / 0.35);
    }

    // Worlds: each phrase's world begins at a place in the tube — where the camera will be on the phrase's
    // downbeat — so the next world is already there down the tube and the camera flies into it on the beat; the
    // frames round each boundary blend from one outline to the other over BLEND units.
    const phraseBeats = PHRASE * music.meter, b0 = music.beatPos(section.start);
    const phrase = Math.max(0, Math.floor((music.beatPos(t) - b0) / phraseBeats));
    const prevW = this.world(shot.sectionIndex, phrase - 1), here = this.world(shot.sectionIndex, phrase), nextW = this.world(shot.sectionIndex, phrase + 1);
    const tHere = music.timeOfBeat(b0 + phrase * phraseBeats), tNext = music.timeOfBeat(b0 + (phrase + 1) * phraseBeats);
    const sHere = phrase > 0 ? this.travel(tHere, section.start, perBeat) : -Infinity;
    const sNext = tNext < section.end - 0.05 ? this.travel(tNext, section.start, perBeat) : Infinity;
    const outline = (wd: World): Outline => (wd === 'strobe' ? this.strobe(t) : OUTLINE[wd]);
    const oPrev = outline(prevW), oHere = outline(here), oNext = outline(nextW);
    const radA = this.radA, radB = this.radB, radC = this.radC;
    for (let k = 0; k < P; k++) {
      const th = (k / P) * Math.PI * 2;
      radA[k] = R * shapeR(th, oPrev); radB[k] = R * shapeR(th, oHere); radC[k] = R * shapeR(th, oNext);
    }

    // Frame points, one ring per frame, each turned by its twist and swollen by the shocks (and their softer wakes).
    const pts = this.pts, i0 = Math.floor(sCam / S) + 1, radii = this.radii, shk = this.shk, cen = this.cen;
    for (let j = 0; j <= NF + 1; j++) {
      const i = i0 + j, d = i * S - sCam, b = this.basis(i * S, this.bB), s = i * S;
      let wa = here, wb = here, wk = 0, from = radB, to = radB;
      if (s < sHere + BLEND / 2) { wa = prevW; wb = here; wk = smooth((s - (sHere - BLEND / 2)) / BLEND); from = radA; to = radB; }
      else if (s > sNext - BLEND / 2) { wa = here; wb = nextW; wk = smooth((s - (sNext - BLEND / 2)) / BLEND); from = radB; to = radC; }
      this.fa[j] = wa; this.fb[j] = wb; this.fw[j] = wk;
      for (let k = 0; k < P; k++) radii[k] = lerp(from[k], to[k], wk);
      cen[j * 3] = b.c.x; cen[j * 3 + 1] = b.c.y; cen[j * 3 + 2] = b.c.z;
      // Where rings overlap they add up without going past a full ring.
      let dark = 1, wake = 0;
      for (let n = 0; n < nr; n++) {
        dark *= 1 - ringA[n] * Math.exp(-Math.pow((d - ringR[n]) / 2.4, 2));
        wake += 0.35 * ringA[n] * Math.exp(-Math.pow((d - ringR[n] + 5) / 4, 2));
      }
      shk[j] = 1 - dark;
      const swell = 1 + 0.2 * (shk[j] + Math.min(wake, 0.5));
      const th0 = K * (d / S) + phi, ct = Math.cos(th0), st = Math.sin(th0);
      for (let k = 0; k < P; k++) {
        const rr = radii[k] * swell;
        const x = rr * (ct * COS[k] - st * SIN[k]), y = rr * (st * COS[k] + ct * SIN[k]), o = (j * P + k) * 3;
        pts[o] = b.c.x + b.r.x * x + b.u.x * y;
        pts[o + 1] = b.c.y + b.r.y * x + b.u.y * y;
        pts[o + 2] = b.c.z + b.r.z * x + b.u.z * y;
      }
    }
    const L = this.lines;
    L.clear();
    const seg = (j0: number, k0: number, j1: number, k1: number, wd: number, c: RGB, I: number) => {
      const a = (j0 * P + (k0 % P)) * 3, b = (j1 * P + (k1 % P)) * 3;
      L.seg(pts[a], pts[a + 1], pts[a + 2], pts[b], pts[b + 1], pts[b + 2], wd, c[0] * I, c[1] * I, c[2] * I);
    };
    const bright = 1 + 0.25 * energy;
    const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
    // Screen pixels (logical) per world unit at distance 1, for things drawn at their on-screen size.
    const focal = (this.resolution.y / this.pixelRatio / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const pt = (j: number, k: number, out: THREE.Vector3) => {
      const o = (j * P + (((k % P) + P) % P)) * 3;
      return out.set(pts[o], pts[o + 1], pts[o + 2]);
    };
    const toCentre = (j: number, v: THREE.Vector3, k: number) => v.lerp(V3.set(cen[j * 3], cen[j * 3 + 1], cen[j * 3 + 2]), k);
    /** A world's lines between frame j and the next (weight wt: how much of this world the frame is). */
    const decor = (wd: World, j: number, i: number, d: number, wt: number, sh: number, fogM: number, base: RGB) => {
      if (wt < 0.01 || d > 36) return;
      const lw = clamp(3.6 / d, 0.7, 2.0), I = fogM * 0.9 * (1 + 0.6 * sh) * wt;
      const rails = (ks: number[]) => { for (const k of ks) seg(j, k, j + 1, k, lw * 0.9, base, I); };
      switch (wd) {
        case 'well': rails([6, 18, 30, 42]); break; // the rounded square's corners
        case 'triangle': rails([12, 28, 44]); break; // its three corners, apex up
        case 'hangar':
          rails([0, 8, 16, 24, 32, 40]);
          // A rib every sixth frame: a second outline just inside it.
          if (i % 6 === 0) for (let k = 0; k < P; k += 2) {
            toCentre(j, pt(j, k, V1), 0.1); toCentre(j, pt(j, k + 2, V2), 0.1);
            L.seg(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, lw, base[0] * I * 1.3, base[1] * I * 1.3, base[2] * I * 1.3);
          }
          break;
        case 'rifling':
          // Six grooves winding one point round per frame: helices that turn as the camera flies along them.
          for (let q = 0; q < 6; q++) { const k = q * 8 + i; seg(j, k, j + 1, k + 1, lw * 1.1, base, I * 1.3); }
          break;
        case 'road':
          // The floor (the bottom is point 36): a dashed centre lane and its two edges; lamps overhead.
          if ((i >> 1) % 2 === 0) seg(j, 36, j + 1, 36, lw * 2, this.white, I * 3);
          rails([31, 41]);
          if (i % 12 === 0) for (const k of [8, 16]) {
            pt(j, k, V1); toCentre(j, pt(j, k, V2), 0.28);
            L.seg(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, lw * 1.4, this.white[0] * I * 2.4, this.white[1] * I * 2.4, this.white[2] * I * 2.4);
          }
          break;
        case 'pixels':
          // The walls built of the cover's pixels: a cell for every two points round and two frames along,
          // outlined in its own colour, lit up by the shock.
          // Each block is a short bar as wide as the block is tall on screen (the batch only draws lines), a few left
          // out so the wall reads as blocks, not a sheet.
          if (i % 2 === 0 && j + 2 <= NF + 1 && d < 28 && d > 1.2) {
            const v = ((i >> 1) % 32 + 32) % 32, J = I * (0.35 + 0.9 * sh);
            const cell = S * 2 * 0.8 * focal / d;
            for (let k = 0; k < P; k += 2) {
              if (hash(i, k, 3.3) < 0.3) continue;
              const q = (v * 48 + (k % 48)) * 3, cr = this.cells[q] * J, cg = this.cells[q + 1] * J, cb = this.cells[q + 2] * J;
              // From the middle of its first edge along the frame to the middle of the next frame's.
              pt(j, k, V1).add(pt(j + 2, k, V2)).multiplyScalar(0.5);
              const ax = V1.x, ay = V1.y, az = V1.z;
              pt(j, k + 2, V1).add(pt(j + 2, k + 2, V2)).multiplyScalar(0.5);
              V2.set(ax, ay, az).lerp(V1, 0.1);
              V1.lerp(V2, 0.1);
              L.seg(V2.x, V2.y, V2.z, V1.x, V1.y, V1.z, clamp(cell, 1, 140), cr, cg, cb);
            }
          }
          break;
        case 'strobe': break;
      }
    };
    for (let j = 0; j <= NF; j++) {
      const i = i0 + j, d = i * S - sCam, fog = fogAt(d);
      if (fog < 0.008) continue;
      const sh = shk[j], near = Math.exp(-Math.abs(d) / 5);
      const major = i % 4 === 0;
      // Far off the frames are a few pixels across and pile up at the vanishing point: fewer points, and only
      // the bright frames past 36 units (the look is the same, the GPU's work about half).
      if (!major && d > 36 && sh < 0.05) continue;
      const step = d > 40 ? 4 : d > 22 ? 2 : 1;
      const base = this.depthColor(d);
      const col = mix(base, this.shock, clamp01(sh * 1.5));
      // The kick and the shock light the bright frames; the faint ones only a little, so the gaps stay dark.
      let I = major ? 1.9 : 0.28 + 0.26 * hash(i, 1.7);
      I *= (major ? 1 + 1.6 * kick * near + 2 * sh : 1 + 1.1 * kick * near + 1.2 * sh) * bright;
      const c = I * fog, wd = clamp(4.6 / d, 0.7, 2.4) * (major ? 1.25 : 0.85) * (1 + 0.6 * sh);
      if (c > 0.004) for (let k = 0; k < P; k += step) seg(j, k, j, k + step, wd, col, c);
      const fogM = fogAt(d + S * 0.5);
      // The walls between frames: only the shock lights them.
      if (sh > 0.05) for (let k = 0; k < P; k += 3) seg(j, k, j + 1, k + 1, clamp(2.4 / d, 0.6, 1.1), this.wall, fogM * 0.8 * sh);
      // Each world's own lines down the walls (the ones the speed runs along), blended across its boundary.
      decor(this.fa[j], j, i, d, 1 - this.fw[j], sh, fogM, base);
      decor(this.fb[j], j, i, d, this.fw[j], sh, fogM, base);
    }
    // The road's traffic: a pair of tail lights holding a few frames ahead, streaking back towards us.
    const roadK = here === 'road' ? 1 : 0;
    if (roadK) {
      const dc = 8 + 1.5 * Math.sin(t * 0.7), jc = Math.min(NF, Math.max(5, Math.round((dc + sCam) / S) - i0));
      for (const side of [-1, 1]) {
        const k = 36 + side * 3;
        for (let q = 0; q < 4; q++) {
          pt(jc - q, k, V1).lerp(V3.set(cen[(jc - q) * 3], cen[(jc - q) * 3 + 1], cen[(jc - q) * 3 + 2]), 0.12);
          pt(jc - q - 1, k, V2).lerp(V3.set(cen[(jc - q - 1) * 3], cen[(jc - q - 1) * 3 + 1], cen[(jc - q - 1) * 3 + 2]), 0.12);
          const I = (q === 0 ? 7 : 3 / q) * fogAt(dc) * (1 + kick);
          L.seg(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, q === 0 ? 5 : 2.5, this.shock[0] * I, this.shock[1] * I, this.shock[2] * I);
        }
      }
    }

    // Speed streaks on a shell just outside the tube (they fill the lens' edges), stretched by the speed.
    const beat = 60 / Math.max(40, info.bpm);
    let speed = perBeat / beat;
    for (let i = lk; i >= 0 && t - this.kicks[i] < 1; i--) speed += SURGE * Math.exp(-(t - this.kicks[i]) / TAU);
    const stretch = clamp(speed / 30, 0.2, 2.2);
    const RS = 0.25, NA = 56, k0 = Math.floor(sCam / RS);
    const A = new THREE.Vector3(), Q = new THREE.Vector3();
    for (let j = 0; j < 30; j++) {
      const k = k0 + j, s0 = k * RS, d = s0 - sCam;
      if (d < 0.2) continue;
      const fog = smooth((d - 0.2) / 1.0) * smooth((7 - d) / 4);
      if (fog < 0.01) continue;
      const bA = this.basis(s0, this.bA), bB = this.basis(s0 + 0.5, this.bB), th = K * (d / S) + phi;
      for (let m = 0; m < NA; m++) {
        if (hash(k, m, 1.1) > 0.07) continue;
        const len = (0.8 + 2.2 * Math.pow(hash(k, m, 2.2), 2)) * stretch;
        const ang = th + ((m + 0.5) / NA) * Math.PI * 2, rad = R * (1.35 + 0.25 * hash(k, m, 4.4));
        const x = rad * Math.cos(ang), y = rad * Math.sin(ang);
        A.copy(bA.c).addScaledVector(bA.r, x).addScaledVector(bA.u, y);
        Q.copy(bB.c).addScaledVector(bB.r, x).addScaledVector(bB.u, y).sub(A).multiplyScalar(len / 0.5).add(A);
        const c = (0.25 + 0.5 * hash(k, m, 5.5)) * fog * bright;
        const col = hash(k, m, 6.6) < 0.1 ? this.shock : mix(this.ice, this.mid, 0.3 + 0.7 * smooth((d - 2) / 8));
        L.seg(A.x, A.y, A.z, Q.x, Q.y, Q.z, clamp(3 / d, 0.6, 1.6), col[0] * c, col[1] * c, col[2] * c);
      }
    }
    // The drop's shockwave: two rings of light, white and the shock colour, blown out past the walls towards us.
    const sw = t - section.start;
    if (sw >= 0 && sw < 0.4) {
      const k = (1 - sw / 0.4) * 1.6, d = 6 - sw * 12, rad = R * (1.05 + sw * 4.5), b = this.basis(sCam + Math.max(0.9, d), this.bB);
      for (const [ro, col] of [[1, this.white], [0.86, this.shock]] as Array<[number, RGB]>) {
        for (let q = 0; q < 72; q++) {
          const a0 = (q / 72) * Math.PI * 2, a1 = ((q + 1) / 72) * Math.PI * 2;
          A.copy(b.c).addScaledVector(b.r, rad * ro * Math.cos(a0)).addScaledVector(b.u, rad * ro * Math.sin(a0));
          Q.copy(b.c).addScaledVector(b.r, rad * ro * Math.cos(a1)).addScaledVector(b.u, rad * ro * Math.sin(a1));
          L.seg(A.x, A.y, A.z, Q.x, Q.y, Q.z, 5 * (1 - sw / 0.4) + 1.5, col[0] * k, col[1] * k, col[2] * k);
        }
      }
    }
    // The crystal far down the tube, in the haze, turning; its facets flash on the kicks.
    const end = this.basis(sCam + 26, this.bB);
    this.crystal.group.position.copy(end.c);
    this.crystal.group.scale.setScalar(R * 0.7);
    this.crystal.set({ turn: t * 0.6, tilt: 0.3, flash: kick, burst: 0, alpha: 0.7 + 0.3 * kickSlow });
    this.crystal.group.updateMatrixWorld();
    this.crystal.lines(L, 1.1, 0.8);
    L.commit(this.resolution, this.pixelRatio);

    ctx.fx.bloom = 0.5 + energy * 0.1 + kick * 0.12;
    ctx.fx.ca = kick * 0.4 + 0.6 * Math.exp(-u / 0.15);
    ctx.fx.barrel = BARREL + 0.08 * kick;
    ctx.fx.vignette = 0.4;
    this.rig.align = sign > 0 ? 'left' : 'right';
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, energy);
  }
}
