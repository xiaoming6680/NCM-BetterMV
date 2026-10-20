// Kaleido: the cover folded into a kaleidoscope — 6, 8 or 12 mirrored segments, an endless zoom in log-polar
// space, hairlines on the segment and band edges. Pulse: holds, then snaps half a segment on every strong hit (not
// the grid's beats: in a syncopated song half of those have no drum; the fold count changes on downbeats) and pushes
// in on kicks. Ballad: turns and drifts slowly.
// The words: each line round a ring about the middle (LyricRing), read left to right over the top, the translation
// upright along the bottom; it comes up out of the middle and leaves outwards with the zoom. The pattern goes quiet
// under them (dark glass, uBand), so they read over its brightest rings.
// The pattern is also the song's spectrogram folded up: every ring of it leaves the middle carrying the spectrum of the
// moment it was born (the bass along one mirror line of each segment, the treble along the other) and the zoom carries
// it outwards, so the outer rings are the last few seconds and the sound wells up out of the middle. Quiet rings are
// dark glass, loud ones light up in the cover's colours, the loudest burn in the signal colour.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, fitFov, outExpo, rng, smooth, snap as snapTo } from './types.ts';
import { LyricRing } from './lyricSpace.ts';
import { Accents } from './hits.ts';
import { lastIndex } from '../director/music.ts';
import { VOICES, voiceFor } from './lyricBlock.ts';
import { COLS, SpecRing, Spectrogram } from './viz.ts';

const NB = 64;
/** Spectrum columns kept on the GPU: the outer rings of the pattern are this far back (8.5 s). */
const RING = 512;

const vertexShader = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover, tSpec;
  uniform float uAspect, uSpan, uSeg, uRot, uZoom, uKick, uLines, uSpiral, uNow, uSecPerZ, uSpec;
  uniform vec3 uPaper, uInk, uGlow;
  // Where the words are (LyricRing.bands, in units of the frame's half-height round the middle): inner and outer
  // radius, the middle angle and half the angle of each stretch; how quiet the pattern goes there.
  uniform vec4 uBand[4];
  uniform float uBandK[4];
  varying vec2 vP;
  void main() {
    vec2 p = vP * vec2(uAspect, 1.0) * uSpan;
    float r = length(p);
    float a = atan(p.y, p.x) + uRot;
    float seg = 6.2831853 / uSeg;
    float la = mod(a, seg);
    float m = abs(la - seg * 0.5);
    float lr = log(max(r, 1e-3)) * 1.25 - uZoom + uSpiral * a * 0.3;
    float band = fract(lr);
    vec2 uv = vec2(cos(m), sin(m)) * mix(0.06, 0.47, band) + 0.5;
    vec3 col = texture2D(uCover, uv).rgb;
    // When this ring left the middle (zoom units → seconds back), and which band this angle of the segment is.
    float age = max(0.0, 1.25 * log(max(r, 1e-3) / 0.05)) * uSecPerZ;
    float k = clamp(m / (seg * 0.5), 0.0, 1.0);
    float c = uNow - min(age, ${(RING / COLS - 0.6).toFixed(2)}) * ${COLS.toFixed(1)};
    float x = (k * ${(NB - 1).toFixed(1)} + 0.5) / ${NB.toFixed(1)};
    #define SPEC(dc) texture2D(tSpec, vec2(x, (mod(c - (dc), ${RING.toFixed(1)}) + 0.5) / ${RING.toFixed(1)})).r
    float s = SPEC(0.0);
    // How much louder than the half second before: a note or a hit lights its ring; a held sound only glows low.
    float rise = max(0.0, s - 0.25 * (SPEC(8.0) + SPEC(16.0) + SPEC(24.0) + SPEC(32.0)) - 0.02);
    // The cover seen through the spectrum: in every ring only a bar as thick as the band was loud when the ring left
    // the middle shows the cover (band by band across the segment, mirrored round the fold into petals), the rest is
    // dark; a note or a hit coming in thickens its bar and lights its rim. Light shapes on a dark ground, whatever the
    // cover (a light cover used to fill the frame).
    float hs = clamp(0.06 + 0.92 * smoothstep(0.18, 0.95, s) + 1.6 * rise, 0.0, 0.98) * exp(-age / 9.0);
    float d = abs(band - 0.5) - 0.5 * hs, aa = fwidth(band) * 1.2 + 0.004;
    float fill = mix(1.0, 1.0 - smoothstep(-aa, aa, d), uSpec);
    float rim = (1.0 - smoothstep(0.0, aa * 2.0, abs(d))) * step(0.01, hs) * uSpec;
    col /= 1.0 + 0.25 * max(col.r, max(col.g, col.b));
    col = mix(uInk * 0.5 + col * 0.06, col * (1.0 + 0.8 * rise), fill);
    col += (uPaper * 0.5 + uGlow * 0.5) * rim * (0.35 + 2.5 * rise);
    // Under the words the pattern goes quiet: dark glass, and no hairlines (bright enough to bloom back through).
    vec2 q = vP * vec2(uAspect, 1.0);
    float qr = length(q), qa = atan(q.y, q.x), quiet = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 b = uBand[i];
      float da = abs(mod(qa - b.z + 3.1415927, 6.2831853) - 3.1415927);
      float across = smoothstep(b.x - 0.06, b.x + 0.01, qr) * (1.0 - smoothstep(b.y - 0.01, b.y + 0.06, qr));
      quiet = max(quiet, across * (1.0 - smoothstep(b.w, b.w + 0.14, da)) * uBandK[i]);
    }
    col = mix(col, uInk * 0.45, quiet);
    float edgeA = 1.0 - smoothstep(0.0015, 0.0045, min(la, seg - la) * r);
    float edgeB = 1.0 - smoothstep(0.0, 0.025, min(band, 1.0 - band));
    col = mix(col, uPaper, max(edgeA * mix(1.0, 0.5, uSpec), edgeB * 0.7 * (1.0 - uSpec)) * uLines * (1.0 - smoothstep(0.15, 0.6, quiet)));
    col *= 0.9 + uKick * 0.2;
    col = mix(col, uInk, smoothstep(0.85, 1.7, r) * 0.65);
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Kaleido implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  private material: THREE.ShaderMaterial;
  private words: LyricRing;
  /** The frame's visible half-height at the words (the camera is 10 away): the shader's unit for uBand. */
  private half = 1;
  private ring: SpecRing;
  /** The hits the pattern snaps on: strong ones, at least 0.45 of a beat apart. */
  private snapT: Float64Array;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.ring = new SpecRing(Spectrogram.of(init.stereo, init.music.duration + 8, NB, 30), RING);
    const acc = Accents.of(init.music), snapT: number[] = [];
    acc.times.forEach((x, i) => {
      if (acc.strength[i] < 0.45) return;
      const beat = 60 / Math.max(40, init.music.at(x).bpm);
      if (!snapT.length || x - snapT[snapT.length - 1] >= 0.45 * beat) snapT.push(x);
    });
    this.snapT = Float64Array.from(snapT);
    const glow = palette.signal.clone().multiplyScalar(1 / Math.max(palette.signal.r, palette.signal.g, palette.signal.b, 1e-4));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uAspect: { value: 16 / 9 }, uSpan: { value: 1 }, uSeg: { value: 6 }, uRot: { value: 0 }, uZoom: { value: 0 },
        uKick: { value: 0 }, uLines: { value: 0.6 }, uSpiral: { value: 0 },
        tSpec: { value: this.ring.texture }, uNow: { value: 0 }, uSecPerZ: { value: 1 }, uSpec: { value: init.stereo ? 1 : 0 },
        uPaper: { value: palette.paper.clone() }, uInk: { value: palette.ink.clone() }, uGlow: { value: glow },
        uBand: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, uBandK: { value: [0, 0, 0, 0] },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);
    this.camera.position.set(0, 0, 10);
    // In the song's voice (lyricBlock.ts).
    const voice = VOICES[voiceFor(look, init.seed)];
    this.words = new LyricRing(palette, { style: look === 'ballad' ? 'poem' : 'hook', face: voice.faces[0], em: 0.5, transEm: 0.25 });
    this.scene.add(this.words.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    // A portrait frame sees the pattern across it as a square one would, so the ring of words stays in; the pattern is
    // drawn on the same scale (uSpan: how much more of it the frame's height spans), so the ring sits on its bands.
    const fov = fitFov(50, aspect);
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uAspect.value = aspect;
    this.material.uniforms.uSpan.value = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(25));
    // The ring at 0.64 of the frame's shorter half-side (the camera is 10 away).
    const half = 10 * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    this.half = half;
    this.words.radius = 0.64 * half * Math.min(1, aspect);
  }

  keepUp(t: number): void {
    this.ring.spec.prefetch(t, 0.8);
  }

  /** Snaps made by time x: one per snap hit, each a `snap` over 0.3 of a beat. */
  private snaps(x: number): number {
    const s = this.snapT, i = lastIndex(s, x);
    if (i < 0) return 0;
    return i + snapTo((x - s[i]) / (0.3 * 60 / Math.max(40, this.init.music.at(s[i]).bpm)));
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const info = music.at(t);
    const soft = this.look === 'ballad';
    const random = rng((info.bar * 2654435761) ^ shot.seed);
    const seg = soft ? 6 : [6, 8, 12][Math.floor(random() * 3)];
    const kick = (soft ? 0.5 : 1) * music.pulse('kick', t, 0.12);
    u.uSeg.value = seg;
    u.uSpiral.value = shot.variant === 'spiral' ? 1 : 0;
    if (soft) {
      u.uRot.value = t * 0.05;
      u.uZoom.value = t * 0.06;
    } else {
      // Hold, then snap half a segment on every strong hit.
      u.uRot.value = (Math.PI / seg) * this.snaps(t);
      u.uZoom.value = info.pos * 0.3 + kick * 0.08;
    }
    u.uKick.value = kick;
    // The spectrum's past in the rings: pulse zooms 0.3 a beat, so a ring is a beat older every 0.3 out; the ballad's
    // slow drift would hold one moment over the whole frame, so its sound flows out on its own, about 6 s to the edge.
    const now = t * COLS;
    this.ring.sync(Math.floor(now) - RING + 4, Math.floor(now) + 1);
    u.uNow.value = now;
    u.uSecPerZ.value = soft ? 1.6 : 60 / Math.max(60, info.bpm) / 0.3;
    if (this.init.stereo) u.uSpec.value = soft ? 0.7 : 1;
    u.uLines.value = (soft ? 0.35 : 0.55) + kick * 0.4;
    ctx.fx.bloom = (soft ? 0.4 : 0.45) + kick * 0.3;
    this.camera.updateMatrixWorld();
    this.words.update(ctx.lyrics, t, shot.section.energy, this.camera);
    const bands = this.words.bands;
    for (let i = 0; i < 4; i++) {
      const b = bands[i];
      u.uBand.value[i].set(b ? b.rIn / this.half : 0, b ? b.rOut / this.half : 0, b ? b.angle : 0, b ? b.span : 0);
      u.uBandK.value[i] = b ? b.k * (soft ? 0.75 : 0.9) : 0;
    }
  }
}
