import type * as THREE from 'three';
import type { Music } from '../director/music.ts';
import type { LyricTrack } from '../director/lyrics.ts';
import type { Palette } from '../render/palette.ts';
import type { Fx } from '../render/engine.ts';
import type { Section } from '../types.ts';
import type { CrystalSpec } from '../sigil/crystal.ts';

export type SceneId = 'relief' | 'shatter' | 'diorama' | 'bokeh' | 'tunnel' | 'drive' | 'kaleido' | 'flip' | 'rings' | 'poster' | 'ridges' | 'halftone' | 'particles' | 'typewall' | 'ink' | 'crystal' | 'cards' | 'debug' | 'subdivide' | 'align' | 'scope';

/** A section redrawn in another medium (src/render/looks.ts): a riso print, Hi-bit pixels, characters on a tube. */
export type LookId = 'riso' | 'hibit' | 'ascii';

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
  /** The song's own crystal (src/sigil/crystal.ts). */
  crystal: CrystalSpec;
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
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
