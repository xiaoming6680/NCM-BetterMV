// Which lyric lines are on screen at a song time, and how far each word has been sung.
// A line stays until the next one has begun (they cross-fade), so the screen never goes blank between two sung
// lines; only before a real gap does a line leave on its own, a little after it ends.
import type { LyricLine, LyricWord } from '../types.ts';
import { lastIndex } from './music.ts';

export interface WordState {
  word: LyricWord;
  index: number;
  /** Seconds since the word started (negative = not yet sung). */
  age: number;
  /** 0 before the word, 0..1 while it is sung, 1 after. */
  progress: number;
}

export interface LineState {
  line: LyricLine;
  index: number;
  /** Seconds since the line started (negative while it is entering early). */
  age: number;
  /** 0..1 fade-out once the line is over (1 = gone). */
  exit: number;
  words: WordState[];
  /** 0..1 how much of the translation to reveal (it has no word times: typed out as the line begins). */
  translationProgress: number;
}

/** Gaps shorter than this between two lines are bridged: the earlier line waits for the next. */
const BRIDGE_GAP = 2.5;

/**
 * The translation has no word times: it is typed out along with the sung line, a little ahead of it — this much
 * earlier (s) and this much faster — so it is whole a little before the line is. (Typed out over the line's first
 * second it ran far ahead of the voice; spread over the whole line it was whole only as the line ended.)
 */
const TRANSLATION_LEAD = 0.15, TRANSLATION_PACE = 1.2;
/** The last word counts as sung over at most this long (s): a held note doesn't hold the translation back. */
const LAST_WORD = 0.5;

/** 0..1 how much of the line has been sung by t: by characters, each word over the time to the next word's start. */
function sungShare(line: LyricLine, t: number): number {
  const w = line.words;
  if (!w.length) return Math.max(0, Math.min(1, (t - line.start) / Math.max(0.4, line.end - line.start)));
  const size = (k: number) => Math.max(1, w[k].text.trim().length);
  let total = 0;
  for (let k = 0; k < w.length; k++) total += size(k);
  let done = 0;
  for (let k = 0; k < w.length; k++) {
    if (t < w[k].start) break;
    const until = k + 1 < w.length ? w[k + 1].start : w[k].start + Math.min(LAST_WORD, Math.max(0.05, w[k].end - w[k].start));
    done += size(k) * Math.min(1, (t - w[k].start) / Math.max(1e-3, until - w[k].start));
  }
  return done / total;
}

export class LyricTrack {
  private starts: Float64Array;
  constructor(readonly lines: LyricLine[], readonly lead = 0.5, readonly tail = 0.8, readonly exitTime = 0.3) {
    this.starts = Float64Array.from(lines, l => l.start);
  }

  /** When line i starts to leave. */
  leaveAt(i: number): number {
    const line = this.lines[i], next = this.lines[i + 1];
    // Before the next line's first word, so this one has mostly moved off and faded by the time that word lights up
    // where it stood. (Leaving 0.12 s before, it was still three quarters there, and a centred card's first word
    // landed on top of it.)
    if (next && next.start - line.end < BRIDGE_GAP) return Math.max(line.end, next.start) - this.exitTime - 0.02;
    return line.end + this.tail;
  }

  /** Lines on screen at t, oldest first: at most the leaving line and the entering one. */
  visible(t: number): LineState[] {
    const out: LineState[] = [];
    for (let i = lastIndex(this.starts, t + this.lead); i >= 0 && out.length < 2; i--) {
      const leave = this.leaveAt(i);
      if (t >= leave + this.exitTime) break;
      out.unshift(this.state(i, t, Math.max(0, Math.min(1, (t - leave) / this.exitTime))));
    }
    return out;
  }

  /** The newest line on screen. */
  current(t: number): LineState | null {
    const v = this.visible(t);
    return v.length ? v[v.length - 1] : null;
  }

  state(i: number, t: number, exit = 0): LineState {
    const line = this.lines[i];
    const words = line.words.map((word, index) => ({
      word, index, age: t - word.start,
      progress: t < word.start ? 0 : t >= word.end ? 1 : (t - word.start) / Math.max(1e-3, word.end - word.start),
    }));
    return {
      line, index: i, age: t - line.start, exit, words,
      translationProgress: Math.max(0, Math.min(1, TRANSLATION_PACE * sungShare(line, t + TRANSLATION_LEAD))),
    };
  }

  /** Lines whose text appears more than once: the hooks. */
  hooks(): Set<string> {
    const count = new Map<string, number>();
    for (const l of this.lines) count.set(norm(l.text), (count.get(norm(l.text)) || 0) + 1);
    return new Set(Array.from(count).filter(([, n]) => n > 1).map(([k]) => k));
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
