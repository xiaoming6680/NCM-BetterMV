// Particles: the cover as ~30 000 points of light that hold its picture and come apart with the music — all moved on
// the GPU. hold: the picture in depth (bright pixels forward), drifting a little, the camera turning slowly round it.
// burst: on every hit (kick, snare, accent) the points blow outwards and fall back into the picture before the next.
// vortex: they wheel round the middle, the inner ones faster, each hit turning them on a notch. rain (ballad): they
// drift down off the picture, falling faster on each hit, and come round again from the top. All of it is timed to the
// detected hits, not the beat grid (a swell from the downbeat over the bar peaked a beat and a half late, and in
// syncopated songs most hits were nowhere near it). A cover on a plain ground (a white sheet with a figure on it, a
// black one with a bright subject) keeps only its subject: the ground is left out, and a light ground becomes the
// paper they float on.
// The sound moves through the picture: out from the middle a point is further back in time (the spectrum flows outwards
// across the cover, about two seconds to the edge), round it the bands run from the bass at the bottom to the treble
// at the top (left and right mirrored); where its band was loud the point is lifted towards the camera and lights up.
// So every kick is a swell running out through the picture, a held chord a raised ring, a quiet passage a flat print.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, punch, rng, surge } from './types.ts';
import { Accents } from './hits.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { COLS, SpecRing, Spectrogram } from './viz.ts';

const N = 176; // points per side
const SIZE = 6.4;
const NB = 64;
const RING = 256;
/** Seconds of the spectrum's past per unit out from the middle. */
const LAG = 0.55;

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aSeed;
  attribute float aW;
  uniform sampler2D tSpec;
  uniform float uTime, uBurst, uVortex, uRain, uDrift, uKick, uPx, uDepth, uNow, uLift, uBase;
  varying vec3 vColor;
  varying float vA;
  vec3 curl(vec3 p) {
    return vec3(sin(p.y * 1.7 + uTime * 0.4) + cos(p.z * 1.3 - uTime * 0.3), sin(p.z * 1.5 - uTime * 0.35) + cos(p.x * 1.1 + uTime * 0.25), sin(p.x * 1.9 + uTime * 0.3) + cos(p.y * 1.2 - uTime * 0.45));
  }
  void main() {
    vec3 p = position;
    float lum = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
    p.z = (lum - 0.4) * uDepth + (aSeed.z - 0.5) * 0.15;
    // The spectrum at this point's time (out from the middle) and band (round from the bottom).
    float r0 = length(position.xy);
    float k = acos(clamp(-position.y / max(r0, 1e-3), -1.0, 1.0)) / 3.14159265;
    float c = uNow - r0 * ${(LAG * COLS).toFixed(2)};
    float x = (k * ${(NB - 1).toFixed(1)} + 0.5) / ${NB.toFixed(1)};
    #define SPEC(dc) texture2D(tSpec, vec2(x, (mod(c - (dc), ${RING.toFixed(1)}) + 0.5) / ${RING.toFixed(1)})).r
    float s = SPEC(0.0);
    // How much louder than the half second before: each note or hit flashes up in its ring as it passes.
    float rise = max(0.0, s - 0.25 * (SPEC(8.0) + SPEC(16.0) + SPEC(24.0) + SPEC(32.0)) - 0.02);
    float glow = clamp(0.45 * smoothstep(0.55, 1.0, s) + 1.2 * smoothstep(0.02, 0.3, rise), 0.0, 1.0), on = step(0.001, uLift);
    p.z += glow * uLift * (0.8 + 0.4 * aSeed.w);
    p += curl(p * 0.6 + aSeed.xyz * 6.0) * 0.06 * uDrift;
    // Burst: out from the middle along each point's own direction, harder for the bright ones.
    vec3 dir = normalize(vec3(p.xy + (aSeed.xy - 0.5) * 0.3, (aSeed.w - 0.5) * 2.0));
    p += dir * uBurst * (1.5 + aSeed.w * 4.0) * (0.6 + lum);
    // Vortex: turn round the z axis, the inner ring faster.
    float r = length(p.xy), a = atan(p.y, p.x) + uVortex * (1.8 / (0.4 + r)) * (0.7 + aSeed.x * 0.6);
    p.xy = vec2(cos(a), sin(a)) * r;
    // Rain: fall, and come round again from the top.
    if (uRain > 0.0) {
      p.y -= uRain * (0.3 + aSeed.y * 0.9);
      p.y = mod(p.y + ${(SIZE / 2 + 0.5).toFixed(2)}, ${(SIZE + 1).toFixed(2)}) - ${(SIZE / 2 + 0.5).toFixed(2)};
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // (With the sound on, the points shrink to sparks with dark between them, so the lit rings read; lumped together
    // under additive blending a light cover was one cream blob.)
    gl_PointSize = uPx * (0.9 + lum * 1.4) * mix(1.0 + uKick * 0.6, uBase + 0.2 + 0.45 * glow, on) * aW / max(0.5, -mv.z);
    // (With the sound on, a point is the cover's colour as light: its hue lifted towards full strength, so a dark
    // cover's points still glow, and the sound sets how bright.)
    vec3 hueC = mix(aColor, aColor / max(0.2, max(aColor.r, max(aColor.g, aColor.b))), 0.6);
    vColor = mix(aColor * (0.95 + uKick * 0.35), hueC * (uBase + 1.6 * glow), on);
    vA = (0.7 + lum * 0.3) * aW;
    gl_Position = projectionMatrix * mv;
  }`;
const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor, vA * smoothstep(1.0, 0.35, r));
  }`;

/**
 * The cover's ground when it is plain: most of its border one colour (sRGB 0..1, with its luminance), else null.
 */
function plainGround(px: Uint8ClampedArray, S: number): { r: number; g: number; b: number; l: number } | null {
  const ring: number[][] = [];
  const band = Math.max(2, Math.round(S * 0.03));
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    if (x >= band && x < S - band && y >= band && y < S - band) continue;
    const o = (y * S + x) * 4;
    ring.push([px[o] / 255, px[o + 1] / 255, px[o + 2] / 255]);
  }
  // The median of each channel resists a subject that touches the edge.
  const med = [0, 1, 2].map(ch => ring.map(p => p[ch]).sort((a, b) => a - b)[ring.length >> 1]);
  const near = ring.filter(p => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]) < 0.08).length;
  if (near < ring.length * 0.75) return null;
  return { r: med[0], g: med[1], b: med[2], l: 0.2126 * med[0] + 0.7152 * med[1] + 0.0722 * med[2] };
}

export class Particles implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  private material: THREE.ShaderMaterial;
  private rig: LyricRig;
  private height = 1080;
  private readonly onPaper: boolean;
  private ring: SpecRing;
  private hits: Accents;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.ring = new SpecRing(Spectrogram.of(init.stereo, init.music.duration + 8, NB, 30), RING);
    this.hits = Accents.of(init.music);
    const S = init.coverSize, px = init.coverPixels, random = rng(11), c = new THREE.Color();
    const ground = plainGround(px, S);
    // Ballads float the subject on the cover's own light ground; pulse always on ink, where it glows.
    const onPaper = this.onPaper = !!ground && ground.l > 0.6 && look === 'ballad';
    this.scene.background = onPaper ? new THREE.Color().setRGB(ground.r, ground.g, ground.b, THREE.SRGBColorSpace) : palette.ink.clone();
    const n = N * N;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n * 4), weight = new Float32Array(n).fill(1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const sx = Math.min(S - 1, Math.floor(((i + 0.5) / N) * S)), sy = Math.min(S - 1, Math.floor(((j + 0.5) / N) * S)), o = (sy * S + sx) * 4;
      const r = px[o] / 255, gg = px[o + 1] / 255, b = px[o + 2] / 255;
      c.setRGB(r, gg, b, THREE.SRGBColorSpace);
      pos.set([((i + 0.5) / N - 0.5) * SIZE, (0.5 - (j + 0.5) / N) * SIZE, 0], k * 3);
      col.set([c.r, c.g, c.b], k * 3);
      seed.set([random(), random(), random(), random()], k * 4);
      // Leave out the plain ground: a point counts by how far its colour is from the ground's.
      if (ground) weight[k] = THREE.MathUtils.smoothstep(Math.hypot(r - ground.r, gg - ground.g, b - ground.b), 0.09, 0.2);
    }
    // A subject too small to make a picture of: keep everything after all.
    if (ground && weight.reduce((a, w) => a + w, 0) < n * 0.015) weight.fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aW', new THREE.BufferAttribute(weight, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      blending: onPaper || (palette.light && !ground) ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uBurst: { value: 0 }, uVortex: { value: 0 }, uRain: { value: 0 }, uDrift: { value: 1 },
        uKick: { value: 0 }, uPx: { value: 20 }, uDepth: { value: 1.2 },
        // How much of the picture stays lit between the swells: a light cover is let down most (lumped under additive
        // blending it was one cream blob), a dark one hardly (let down too, it was gone); ballads keep more (the slow
        // rain is the picture coming apart).
        tSpec: { value: this.ring.texture }, uNow: { value: 0 }, uLift: { value: 0 }, uBase: { value: look === 'ballad' ? 0.6 : palette.light ? 0.42 : 0.72 },
      },
    });
    const points = new THREE.Points(g, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
    // The words hang in front of the cloud of points, so the slow orbit slides them across it; ballad lines to one
    // side. Each line comes in from deeper in the cloud.
    this.rig = new LyricRig(palette, look === 'ballad' ? 'poem' : 'hook');
    this.rig.faces = voiceFaces(look, init.seed);
    this.rig.onLight = onPaper;
    this.rig.frame = { vh: 5.2, vw: 8.5 };
    this.rig.place = (root, st) => {
      const s = look === 'ballad' ? (st.index % 2 ? 1 : -1) * 2.6 : 0;
      root.position.set(s, 0, 1.8 - (1 - outExpo((st.age + 0.5) / 0.8)) * 2.5);
    };
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Viewport height in device pixels: point sizes follow it. */
  setViewportHeight(h: number): void { this.height = h; }

  keepUp(t: number): void {
    this.ring.spec.prefetch(t, 0.8);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const info = music.at(t);
    const soft = this.look === 'ballad';
    const beat = 60 / Math.max(40, info.bpm);
    const random = rng(shot.seed);
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const kick = soft ? 0 : music.pulse('kick', t, 0.12);
    const since = t - shot.start;
    u.uTime.value = t;
    u.uKick.value = kick;
    const now = t * COLS;
    this.ring.sync(Math.floor(now - 4.6 * LAG * COLS) - 2, Math.floor(now) + 1);
    u.uNow.value = now;
    // (Not on a light ground: there the points are printed, not lit.)
    u.uLift.value = !this.init.stereo || this.onPaper ? 0 : (soft ? 0.7 : 1.4) * (shot.section.label === 'chorus' || shot.section.label === 'drop' ? 1.2 : 1);
    // Points about as wide as the gap between them, so the picture reads as a picture.
    u.uPx.value = this.height * 0.032 * (this.onPaper ? 1.6 : soft ? 1.1 : 1);
    u.uBurst.value = 0;
    u.uVortex.value = 0;
    u.uRain.value = 0;
    u.uDrift.value = soft ? 1.4 : 1;
    // Ballads move on their hits too, half as far.
    const hv = soft ? 0.5 : 1;
    // The blow of the hits: out on each (all the way 60 ms after it), back into the picture within about a beat; hits
    // close together add up to a bigger swell, never past twice one. One hit leaves the picture readable: blown all
    // the way apart two or three times a second, it read as flicker.
    const decay = Math.min(0.3, 0.55 * beat);
    const blow = hv * (0.12 + 0.22 * shot.section.energy) * 2 * (1 - Math.exp(-0.7 * this.hits.sum(t, 6 * decay, age => punch(age, decay, 0.06))));
    switch (shot.variant) {
      case 'burst': u.uBurst.value = blow; break;
      // The held picture and the wheel give a little on the hits too; each hit turns the wheel on a notch (its speed
      // peaks 70 ms after the hit) and makes the rain fall a step.
      case 'hold': u.uBurst.value = 0.4 * blow; break;
      case 'vortex': u.uVortex.value = since * (soft ? 0.25 : 0.6) + hv * 0.25 * this.hits.since(shot.start, t, age => surge(age, 0.07)); u.uBurst.value = 0.3 * blow; break;
      case 'rain': u.uRain.value = since * 0.35 + hv * 0.25 * this.hits.since(shot.start, t, age => surge(age, 0.09)); break;
    }
    const cam = this.camera, side = random() < 0.5 ? -1 : 1;
    const a = side * lerp(0.35, -0.2, inOutCubic(k)), dist = lerp(9.5, 8.2, inOutCubic(k));
    cam.position.set(Math.sin(a) * dist, lerp(0.6, -0.3, k), Math.cos(a) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    // (Bloom on a light ground only washes the points out.)
    ctx.fx.bloom = this.onPaper ? 0.03 : soft ? 0.45 : 0.55 + kick * 0.3;
    if (this.onPaper) ctx.fx.vignette = 0.2;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
