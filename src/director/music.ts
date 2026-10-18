// Musical time for the renderer: beat/bar position at any song time, envelopes and decaying hit pulses.
// Everything is a pure function of t, so seeking and frame drops never desync the picture.
import type { Analysis, Envelopes, Hit, Section } from '../types.ts';

/** Index of the last element ≤ t, or −1. */
export function lastIndex(times: ArrayLike<number>, t: number): number {
  let lo = 0, hi = times.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export interface BeatInfo {
  /** Continuous beat count (beat index + phase). */
  pos: number;
  /** Phase within the current beat, 0..1. */
  phase: number;
  /** Beat position inside the bar, 0..meter (fractional). */
  inBar: number;
  bar: number;
  /** Phase within the current bar, 0..1. */
  barPhase: number;
  /** 60 / the length of this beat of the grid: for timing. The number to show is `Music.shownBpm`. */
  bpm: number;
}

type HitKind = keyof Analysis['hits'];
/** How long a hit's pulse takes to come up (seconds). */
const ATTACK = 0.03;

/**
 * The sections the MV is directed by: neighbours with the same label and about the same loudness (within 0.1 of the
 * run so far) as one. The analysis often splits a chorus or a drop into phrases (ten drops in a row, five choruses);
 * each split opened a new plate, a new look, a title card (“高潮 03”) and the drop's own entrance — the director cut
 * at every one (the user: “切换的过于频繁了”). A louder repeat stays a section of its own: it is an entrance.
 */
export function joinSections(sections: readonly Section[]): Section[] {
  const out: Section[] = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    if (last && last.label === s.label && Math.abs(s.energy - last.energy) <= 0.1) {
      const a = last.end - last.start, b = s.end - s.start;
      out[out.length - 1] = { ...last, end: s.end, energy: (last.energy * a + s.energy * b) / Math.max(1e-3, a + b), vocal: last.vocal || s.vocal };
    } else out.push({ ...s });
  }
  return out;
}

export class Music {
  readonly beats: Float64Array;
  readonly downbeats: Float64Array;
  readonly meter: number;
  /** The analysis, its sections joined (joinSections): every plate, the director and the overlay see these. */
  readonly a: Analysis;
  private hitTimes = new Map<HitKind, Float64Array>();

  constructor(a: Analysis) {
    this.a = { ...a, sections: joinSections(a.sections) };
    this.beats = Float64Array.from(a.beats);
    this.downbeats = Float64Array.from(a.downbeats);
    this.meter = a.meter || 4;
    for (const kind of Object.keys(a.hits) as HitKind[]) this.hitTimes.set(kind, Float64Array.from(a.hits[kind], h => h[0]));
  }

  get duration(): number { return this.a.duration; }

  /** Where the song's closing outro starts (the run of outro sections at the very end), or Infinity if it has none. */
  get ending(): number {
    const s = this.a.sections;
    let i = s.length;
    while (i > 0 && s[i - 1].label === 'outro') i--;
    return i < s.length ? s[i].start : Infinity;
  }

  /** 0..1 through the closing outro (0 before it). */
  endingProgress(t: number): number {
    const from = this.ending;
    return t <= from ? 0 : Math.min(1, (t - from) / Math.max(1, this.duration - from - 1));
  }

  private period(i: number): number {
    const b = this.beats, n = b.length;
    if (n < 2) return 60 / (this.a.bpm || 120);
    const k = Math.max(0, Math.min(n - 2, i));
    return b[k + 1] - b[k];
  }

  beatPos(t: number): number {
    const b = this.beats, n = b.length;
    if (!n) return (t * (this.a.bpm || 120)) / 60;
    const i = lastIndex(b, t);
    if (i < 0) return (t - b[0]) / this.period(0);
    if (i >= n - 1) return n - 1 + (t - b[n - 1]) / this.period(n - 2);
    return i + (t - b[i]) / (b[i + 1] - b[i]);
  }

  timeOfBeat(pos: number): number {
    const b = this.beats, n = b.length;
    if (!n) return (pos * 60) / (this.a.bpm || 120);
    if (pos <= 0) return b[0] + pos * this.period(0);
    if (pos >= n - 1) return b[n - 1] + (pos - (n - 1)) * this.period(n - 2);
    const i = Math.floor(pos);
    return b[i] + (pos - i) * (b[i + 1] - b[i]);
  }

  at(t: number): BeatInfo {
    const pos = this.beatPos(t);
    const i = Math.floor(pos), phase = pos - i;
    const bi = Math.max(0, Math.min(this.a.beatInBar.length - 1, i));
    const inBarIndex = i < 0 ? ((i % this.meter) + this.meter) % this.meter : this.a.beatInBar[bi] ?? 0;
    const bar = Math.max(0, lastIndex(this.downbeats, t));
    const d = this.downbeats;
    const barStart = d.length ? d[bar] : 0;
    const barEnd = bar + 1 < d.length ? d[bar + 1] : barStart + this.period(i) * this.meter;
    return {
      pos, phase, inBar: inBarIndex + phase, bar,
      barPhase: Math.max(0, Math.min(1, (t - barStart) / Math.max(1e-3, barEnd - barStart))),
      bpm: 60 / this.period(i),
    };
  }

  /** Per beat, the tempo to show (see shownBpm); made on first use. */
  private shown?: Float32Array;

  /**
   * The tempo to show at t (the HUD, a plate's label), in named BPM: the song's tempo while the grid keeps within 3 %
   * of it, else the local tempo (the median of the 8 beat intervals around t). One beat's interval jitters by a few
   * per cent where the grid is the tracker's rather than a locked one; shown as it was, the number changed every beat.
   */
  shownBpm(t: number): number {
    if (!this.shown) {
      const b = this.beats, n = b.length, grid = this.a.bpm || 120, named = this.a.namedBpm || grid, scale = named / grid;
      const out = new Float32Array(Math.max(1, n - 1)).fill(named);
      const iv: number[] = [];
      for (let i = 0; i + 1 < n; i++) {
        iv.length = 0;
        for (let j = Math.max(0, i - 4); j < Math.min(n - 1, i + 4); j++) iv.push(b[j + 1] - b[j]);
        iv.sort((x, y) => x - y);
        const local = 60 / iv[iv.length >> 1];
        out[i] = Math.abs(local / grid - 1) <= 0.03 ? named : local * scale;
      }
      this.shown = out;
    }
    return this.shown[Math.max(0, Math.min(this.shown.length - 1, Math.floor(this.beatPos(t))))];
  }

  /** Envelope value with linear interpolation. */
  env(name: keyof Omit<Envelopes, 'fps'>, t: number): number {
    const e = this.a.env, arr = e[name];
    const x = t * e.fps;
    const i = Math.floor(x);
    if (i < 0) return arr[0] ?? 0;
    if (i >= arr.length - 1) return arr[arr.length - 1] ?? 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  /**
   * Strength of the latest hit of a kind, decaying exponentially (seconds). It comes up over 30 ms rather than in one
   * frame, and the hit before carries on decaying underneath, so nothing driven by it (a zoom, a swell, a light)
   * jumps: a punch on the beat, not a jolt (the user: “动画曲线不好”).
   */
  pulse(kind: HitKind, t: number, decay = 0.16): number {
    const times = this.hitTimes.get(kind);
    if (!times || !times.length) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const at = (j: number): number => {
      const hit: Hit = this.a.hits[kind][j], age = t - hit[0];
      if (age >= ATTACK) return hit[1] * Math.exp(-(age - ATTACK) / decay);
      const x = age / ATTACK;
      return hit[1] * x * x * (3 - 2 * x);
    };
    return i > 0 ? Math.max(at(i), at(i - 1)) : at(i);
  }

  /** Hits of a kind inside [t0, t1). */
  hitsBetween(kind: HitKind, t0: number, t1: number): Hit[] {
    const times = this.hitTimes.get(kind);
    if (!times) return [];
    const out: Hit[] = [];
    for (let i = Math.max(0, lastIndex(times, t0)); i < times.length && times[i] < t1; i++) if (times[i] >= t0) out.push(this.a.hits[kind][i]);
    return out;
  }

  sectionIndex(t: number): number {
    const s = this.a.sections;
    for (let i = 0; i < s.length; i++) if (t < s[i].end) return i;
    return s.length - 1;
  }

  section(t: number): Section {
    return this.a.sections[this.sectionIndex(t)];
  }

  downbeatAtOrAfter(t: number): number {
    const d = this.downbeats, i = lastIndex(d, t - 1e-6);
    return i + 1 < d.length ? d[i + 1] : this.duration;
  }

  /** Nearest downbeat to t. */
  snapToDownbeat(t: number): number {
    const d = this.downbeats;
    if (!d.length) return t;
    const i = Math.max(0, lastIndex(d, t));
    const a = d[i], b = i + 1 < d.length ? d[i + 1] : a;
    return Math.abs(t - a) <= Math.abs(b - t) ? a : b;
  }
}
