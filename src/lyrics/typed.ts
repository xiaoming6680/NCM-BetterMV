// Lyrics that type themselves out: a run of line-timed lines a fraction of a second apart, each the one before with a
// word or a letter added, taken away or changed (《Credits EX》 writes its MV's on-screen text this way: 759 lines in
// 279 s, most under 0.15 s apart; issue #5). Shown as written, every step a line of its own, no plate could set a line
// before the next replaced it. A run like that is one line whose words come in as they are typed, so every carrier
// shows it in one place and the next step lands where the last one stood.
import type { LyricLine, LyricWord } from '../types.ts';

/** Two lines further apart than this (s) are never one line typed out. */
const TYPED_STEP = 0.36;
/**
 * The same line again is the same typed line only this soon (s): sung, a word chanted again comes no faster than
 * about 0.19 s (《LEVEL UP!》's chant, 0.19–0.6 s; a line sung twice 0.3 s apart in 《Remember Me》), and each time
 * it is sung it comes in again. 《Credits EX》 repeats a letter every 0.08 s before typing on from it.
 */
const SAME_STEP = 0.15;

/** Characters two texts begin with alike. */
function shared(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Whether `b` is `a` typed on: one begins with the other (letters added or taken away, or the same again), or both
 * begin alike for at least two characters and half the shorter (the last word changed: a count going up, a typo put
 * right).
 */
export function typedOn(a: string, b: string): boolean {
  const n = shared(a, b), short = Math.min(a.length, b.length);
  return short > 0 && (n === short || (n >= 2 && n >= short / 2));
}

/**
 * One line from the steps of a typed run: the text of its fullest step (the most words; the later of two alike), each
 * word from the first step that shows it whole or partly typed, the translation of that fullest step.
 */
function typedLine(steps: LyricLine[]): LyricLine {
  const tokens = steps.map(s => s.words.map(w => w.text));
  let full = 0;
  tokens.forEach((t, k) => { if (t.length >= tokens[full].length) full = k; });
  const final = tokens[full], end = steps[steps.length - 1].end;
  const starts = final.map((word, j) => {
    const k = tokens.findIndex(t => t.length > j && word.startsWith(t[j]));
    return steps[k >= 0 ? k : full].start;
  });
  for (let j = 1; j < starts.length; j++) starts[j] = Math.max(starts[j], starts[j - 1]);
  const words: LyricWord[] = final.map((text, j) => ({ text, start: starts[j], end: j + 1 < final.length ? Math.max(starts[j], starts[j + 1]) : end }));
  const chosen = steps[full];
  return { start: steps[0].start, end, text: chosen.text, words, timedWords: false, typed: true, translation: chosen.translation, backing: chosen.backing };
}

/** Whether line `b` types on from line `a` (TYPED_STEP, SAME_STEP, typedOn). */
function steps(a: LyricLine, b: LyricLine): boolean {
  const gap = b.start - a.start;
  return gap <= TYPED_STEP && typedOn(a.text, b.text) && (a.text !== b.text || gap < SAME_STEP);
}

/** Line-timed lines with every typed run made one line; other lines as they were. */
export function mergeTyped(lines: LyricLine[]): LyricLine[] {
  const out: LyricLine[] = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && steps(lines[j], lines[j + 1])) j++;
    out.push(j > i ? typedLine(lines.slice(i, j + 1)) : lines[i]);
    i = j + 1;
  }
  return out;
}
