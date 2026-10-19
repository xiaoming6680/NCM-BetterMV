import type { Music } from './music.ts';

/** The director's visual clock: large continuous motion may take two or four musical beats per visual step. */
export class VisualRhythm {
  private readonly positions: Float64Array;
  private readonly steps: Float64Array;

  constructor(private readonly music: Music) {
    const b = music.beats, n = b.length;
    this.positions = new Float64Array(Math.max(1, n));
    this.steps = new Float64Array(Math.max(1, n)).fill(1);
    // Choose once per musical bar, so one jittery interval cannot make the pace oscillate.
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && music.a.beatInBar[j] !== 0) j++;
      const intervals = [];
      for (let k = i; k < Math.min(j, n - 1); k++) intervals.push(b[k + 1] - b[k]);
      intervals.sort((a, c) => a - c);
      const period = intervals.length ? intervals[intervals.length >> 1] : (i > 0 ? b[i] - b[i - 1] : 60 / (music.a.bpm || 120));
      let divisor = 1;
      while (60 / Math.max(0.02, period) / divisor > 160) divisor *= 2;
      for (let k = i; k < j; k++) this.steps[k] = 1 / divisor;
      i = j;
    }
    for (let i = 1; i < n; i++) this.positions[i] = this.positions[i - 1] + this.steps[i - 1];
  }

  /** Integrated visual position: changing tempo never teleports the camera, and seeking is deterministic. */
  position(t: number): number {
    const pos = this.music.beatPos(t), last = this.positions.length - 1;
    const i = Math.max(0, Math.min(last, Math.floor(pos)));
    return this.positions[i] + (pos - i) * this.steps[i];
  }

  bpm(t: number): number {
    const info = this.music.at(t), i = Math.max(0, Math.min(this.steps.length - 1, Math.floor(info.pos)));
    return info.bpm * this.steps[i];
  }

  /** Transition speed is a visual choice, independent of the accuracy/density of the musical beat list. */
  beatDuration(t: number): number { return 60 / Math.max(40, this.bpm(t)); }
}
