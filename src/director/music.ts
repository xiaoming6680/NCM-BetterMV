// Musical time for the renderer: beat/bar position at any song time, envelopes and decaying hit pulses.
// Everything is a pure function of t, so seeking and frame drops never desync the picture.
import type { Analysis, Envelopes, Hit, Section } from '../types.ts';
import { VisualRhythm } from './rhythm.ts';

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
  /** Current tracked pulses per bar, not the song-wide summary. */
  meter: number;
  barStart: number;
  barEnd: number;
}

type HitKind = keyof Analysis['hits'];
/** How long a hit's pulse takes to come up (seconds). */
const ATTACK = 0.03;

export class Music {
  readonly beats: Float64Array;
  readonly downbeats: Float64Array;
  readonly meter: number;
  /** Director-owned density controls. These never change the analysis, drum events or musical positions. */
  readonly visual: VisualRhythm;
  private hitTimes = new Map<HitKind, Float64Array>();

  constructor(readonly a: Analysis) {
    this.beats = Float64Array.from(a.beats);
    this.downbeats = Float64Array.from(a.downbeats);
    this.meter = a.meter || 4;
    for (const kind of Object.keys(a.hits) as HitKind[]) this.hitTimes.set(kind, Float64Array.from(a.hits[kind], h => h[0]));
    this.visual = new VisualRhythm(this);
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
    const meter = this.a.meterPerBeat?.[bi] || this.meter;
    const firstPhase = this.a.beatInBar[0] ?? 0;
    const inBarIndex = i < 0 ? ((i + firstPhase) % meter + meter) % meter
      : i >= this.beats.length ? ((this.a.beatInBar[bi] ?? 0) + i - bi) % meter : this.a.beatInBar[bi] ?? 0;
    const bar = this.downbeats.length ? lastIndex(this.downbeats, t) : Math.floor((i - inBarIndex) / meter);
    const d = this.downbeats;
    const before = !d.length || t < d[0];
    const barStart = before ? this.timeOfBeat(i - inBarIndex) : d[bar];
    const barEnd = before ? (d.length ? d[0] : this.timeOfBeat(i - inBarIndex + meter))
      : bar + 1 < d.length ? d[bar + 1] : this.timeOfBeat(this.beatPos(barStart) + meter);
    const from = this.beatPos(barStart), to = this.beatPos(barEnd);
    return {
      pos, phase, inBar: inBarIndex + phase, bar,
      barPhase: Math.max(0, Math.min(1, (pos - from) / Math.max(1e-3, to - from))),
      bpm: 60 / this.period(i), meter, barStart, barEnd,
    };
  }

  meterAt(t: number): number {
    const i = Math.max(0, Math.min(this.beats.length - 1, lastIndex(this.beats, t)));
    return this.a.meterPerBeat?.[i] || this.meter;
  }

  /** Actual time between the enclosing bar boundaries, including tempo changes inside that bar. */
  barDuration(t: number): number {
    const info = this.at(t);
    return Math.max(0.001, info.barEnd - info.barStart);
  }

  /** Number of real bar boundaries still ahead; useful for a countdown across meter or tempo changes. */
  barsBetween(from: number, to: number): number {
    return Math.max(0, lastIndex(this.downbeats, to - 1e-6) - lastIndex(this.downbeats, from - 1e-6));
  }

  meterLabel(t: number): string {
    const segment = this.a.meterSegments?.find(s => t >= s.start && t < s.end);
    return segment && segment.confidence < 0.2 ? '拍号不确定' : `${this.meterAt(t)} 拍/小节`;
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
