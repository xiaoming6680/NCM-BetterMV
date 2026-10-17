// The hits a plate moves on: the song's kicks, snares and accents above a strength, as one list. Hits closer than
// `gap` are merged (the stronger kept), so a motion on every one stays under about four a second — faster repeats read
// as twitching. Taken from the detected hits, not the beat grid: in syncopated music (J-core, breakbeat) half the
// kicks fall off the grid, and a move timed to the downbeat lands between them.
import type { Music } from '../director/music.ts';
import { lastIndex } from '../director/music.ts';

export class Accents {
  readonly times: Float64Array;
  readonly strength: Float64Array;

  constructor(music: Music, gap = 0.24) {
    const all: Array<[number, number]> = [
      ...music.a.hits.kick.filter(h => h[1] >= 0.35),
      ...music.a.hits.snare.filter(h => h[1] >= 0.45),
      ...music.a.hits.accent,
    ].map(h => [h[0], h[1]]);
    all.sort((a, b) => a[0] - b[0]);
    const out: Array<[number, number]> = [];
    for (const h of all) {
      const prev = out[out.length - 1];
      if (prev && h[0] - prev[0] < gap) { if (h[1] > prev[1]) out[out.length - 1] = h; } else out.push(h);
    }
    this.times = Float64Array.from(out, h => h[0]);
    this.strength = Float64Array.from(out, h => h[1]);
  }

  /** Σ strength · f(age) over the hits of the last `span` seconds (f(age) for age ≥ 0). */
  sum(t: number, span: number, f: (age: number) => number): number {
    let s = 0;
    for (let i = lastIndex(this.times, t); i >= 0 && t - this.times[i] < span; i--) s += this.strength[i] * f(t - this.times[i]);
    return s;
  }

  /** Σ strength · f(age) over every hit in [from, t]: for what a hit moves on and leaves moved (a turn, a fall). */
  since(from: number, t: number, f: (age: number) => number): number {
    let s = 0;
    for (let i = lastIndex(this.times, t); i >= 0 && this.times[i] >= from; i--) s += this.strength[i] * f(t - this.times[i]);
    return s;
  }

  /** The strongest hit in [t0, t1], or NaN. */
  strongest(t0: number, t1: number): number {
    let best = NaN, v = 0;
    for (let i = Math.max(0, lastIndex(this.times, t0)); i < this.times.length && this.times[i] <= t1; i++) {
      if (this.times[i] >= t0 && this.strength[i] > v) { v = this.strength[i]; best = this.times[i]; }
    }
    return best;
  }
}
