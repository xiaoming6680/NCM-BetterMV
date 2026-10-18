import type * as THREE from 'three';
import type { Music } from '../director/music.ts';
import type { LyricTrack } from '../director/lyrics.ts';
import type { Palette } from '../render/palette.ts';
import type { Fx } from '../render/engine.ts';
import type { Section } from '../types.ts';
import type { ArmillarySpec } from '../sigil/armillary.ts';

export type SceneId = 'relief' | 'diorama' | 'bokeh' | 'tunnel' | 'drive' | 'kaleido' | 'flip' | 'rings' | 'poster' | 'ridges' | 'halftone' | 'particles' | 'typewall' | 'ink' | 'crystal' | 'cards' | 'debug' | 'subdivide' | 'scope' | 'vinyl' | 'clouds' | 'city' | 'aurora' | 'canvas' | 'pillars' | 'ripple' | 'channel' | 'orb' | 'menger' | 'sierpinski' | 'cantor' | 'papercut' | 'rain' | 'lanterns' | 'neon' | 'kinetic' | 'blackhole' | 'cubes' | 'dots';

/** A section redrawn in another medium (src/render/looks.ts): a riso print, Hi-bit pixels, characters on a tube. */
export type LookId = 'riso' | 'hibit' | 'ascii' | 'vhs';

/** One camera setup inside a scene, between two downbeats. */
export interface Shot {
  scene: SceneId;
  start: number;
  end: number;
  /** Scene-specific camera setup. */
  variant: string;
  /** Deterministic per-shot randomness. */
  seed: number;
  section: Section;
  sectionIndex: number;
  /**
   * A run of shots under a bar long on one plate (the speeding-up cuts at the end of a build): the scene times its
   * moves over the whole run, so cutting to another camera carries on the move instead of starting it again.
   */
  run?: { start: number; end: number };
  /** (Development: a film's own look for this shot, over its section's.) */
  look?: LookId;
}

export interface FrameCtx {
  t: number;
  dt: number;
  music: Music;
  lyrics: LyricTrack;
  palette: Palette;
  shot: Shot;
  /** Seconds since the shot started. */
  shotT: number;
  aspect: number;
  /** Post effects for this frame; scenes add to the defaults. */
  fx: Fx;
}

export interface SceneInit {
  cover: THREE.Texture;
  /** Cover pixels, `coverSize`² RGBA, for building geometry from the artwork. */
  coverPixels: Uint8ClampedArray;
  coverSize: number;
  palette: Palette;
  music: Music;
  lyrics: LyricTrack;
  aspect: number;
  /** Song title (the ink plate carves its first character into a seal). */
  title?: string;
  artists?: string[];
  /** This play's random seed (the same song differs from play to play). */
  seed?: number;
  /** The song's own armillary (src/sigil/armillary.ts). */
  armillary: ArmillarySpec;
  /** The audio for the oscilloscope: both channels, 16-bit. */
  stereo?: Stereo;
  /** Oscilloscope music: the scope draws the channels' picture (XY), as a real one would. */
  xyMusic?: boolean;
}

/** Both channels of the song, 16-bit, scaled together to their peak. */
export interface Stereo {
  rate: number;
  left: Int16Array;
  right: Int16Array;
}

export interface MvScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(ctx: FrameCtx): void;
  resize(aspect: number): void;
  /**
   * Every frame, on screen or not: a plate whose picture builds up over the whole song (the canvas) keeps it up to t,
   * so coming back to it doesn't stall on a minute of catching up.
   */
  keepUp?(t: number, renderer: THREE.WebGLRenderer): void;
  /**
   * What the plate draws in passes of its own, off its scene graph (scenes, or passMesh(material) for a
   * FullScreenQuad): compiled along with it before the MV shows (Engine.compile).
   */
  readonly offscreen?: readonly THREE.Object3D[];
  /**
   * Frees what the plate made off its scene graph (render targets, scenes of its own); MvPlayer.unload disposes the
   * scene graph itself. Without it each song left these behind (a lyric layer's words and buffer, the canvas's paint
   * maps, the march buffers): GPU memory grew with every song.
   */
  dispose?(): void;
}

/** Disposes the geometries and materials under root, not their textures (a plate's may be shared or cached). */
export function freeGraph(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
  });
}

/**
 * Runs a plate's work made in steps (a generator yielding between them) to its end at once: the plate built in one go,
 * as load() does; MvPlayer.loadInSlices instead gives the page a breath at each step (a plate's static `building`).
 */
export function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x)));
export const inOutCubic = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const outBack = (x: number, s = 1.6) => { x = clamp01(x) - 1; return 1 + (s + 1) * x * x * x + s * x * x; };
// Motion curves with no jolt: what moves on screen gets going and comes to rest, its speed never jumping (the user,
// of the whole plugin: “动画不线性”“动画曲线不好” — outExpo and a bare exponential start at full speed, then crawl).
// outExpo and exponentials stay for light (flashes, fades, glow), where an instant attack reads as a hit.
const SNAP_K = 9, SNAP_1 = 1 - (1 + SNAP_K) * Math.exp(-SNAP_K);
/**
 * A beat-locked snap, 0..1 over x in 0..1: a critically damped spring from rest — quick (fastest a ninth of the way
 * in, two thirds there by a fifth), settling with no stop at the end. The jolt-free stand-in for outExpo in motion.
 */
export const snap = (x: number) => { x = clamp01(x); return (1 - (1 + SNAP_K * x) * Math.exp(-SNAP_K * x)) / SNAP_1; };
/** How far a push has carried, 0..1, `age` after it began: its speed rises from nothing, peaks at `tau`, dies away. */
export const surge = (age: number, tau: number) => (age <= 0 ? 0 : 1 - (1 + age / tau) * Math.exp(-age / tau));
/** That push's speed (over all time it comes to 1): for what streaks or stretches with the speed. */
export const surgeRate = (age: number, tau: number) => (age <= 0 ? 0 : (age / (tau * tau)) * Math.exp(-age / tau));
/** A hit's envelope for motion (a punch of the lens, a knock): up smoothly over `attack`, then away with `decay`. */
export const punch = (age: number, decay: number, attack = 0.03) =>
  (age < 0 ? 0 : age < attack ? smooth(age / attack) : Math.exp(-(age - attack) / decay));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Narrow frames (issue #4: a portrait monitor, 1440×2560, cut most plates' words off at both sides; a 9:16 export the
// same). The plates are composed for 16:9; on a narrower frame the same height shows less across.
/** How much of a 16:9 frame's width a frame of this aspect shows at the same height: 1 for 16:9 and wider. */
export const narrowness = (aspect: number) => Math.min(1, aspect / (16 / 9));
/**
 * The vertical field of view (degrees) that shows at least as much across as `fov` does on a frame `minAspect` wide:
 * `fov` itself on a wider frame. A plate centred on its subject (rings, a disc, a ball) whose words go round it keeps
 * them in a portrait frame this way — the subject across the frame as in a square one, sky above and below.
 */
export function fitFov(fov: number, aspect: number, minAspect = 1): number {
  if (aspect >= minAspect) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (minAspect / aspect)) * 180) / Math.PI;
}
