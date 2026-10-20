// Word times from the aligner pack's result (src/plugin/aligner.ts runs the pack; tools/aligner/fa.py aligns): which
// of its placements to believe, and the words written into the lines. Apart from the plugin's pack interface so the
// rules can be checked against word-timed lyrics in node (.planning/间奏歌词/rules.ts).
import type { LyricLine } from '../types.ts';
import { syllables } from './parse.ts';

/** A line as the pack placed it: per word [start, end] (end null: not found), null when not placed; mean letter probability. */
export interface AlignedLine { words: Array<[number, number] | [number, null] | null>; conf: number | null }
export interface AlignResult { version: number; id: number; lines: AlignedLine[]; device?: string; ms?: Record<string, number>; error?: string }

/** Lines whose letters fit the audio worse than this (mean probability) keep the spread estimate (docs/ALIGNER.md). */
const MIN_CONF = 0.005;

/**
 * Where the pack placed a line's words, those it can be believed on (null: not placed, or not believed). It fits every
 * letter somewhere in its window (up to the next line, or 2 s + 0.8 s a syllable on from the line's stamp), so where
 * it can't hear a line to its end it parks the last words late in the window, in the instrumental after the line,
 * which then stayed up through it (the user: “间奏有时会显示歌词”). A placed word that starts more than PAUSE s after
 * the word before it stops, or later than BUDGET s + PER_SYLLABLE s for each syllable before it, is not believed, nor
 * is any word after it. On the 6 songs in the NetEase cache with word-timed lyrics to check against (1 051 words):
 * of the 10 lines followed by a gap, those still up 2 s after the singer stopped went 9 → 4 (with the line ending at
 * its last word, below); word starts within 0.25 s 80.0 → 80.5 %.
 */
const PAUSE = 3, BUDGET = 2, PER_SYLLABLE = 0.6;
function believed(r: AlignedLine, syl: number[], stamp: number): Array<number | null> {
  const out: Array<number | null> = [];
  let before = 0, sungTo: number | null = null, doubt = false;
  r.words.forEach((w, j) => {
    const s = w && typeof w[0] === 'number' ? w[0] : null;
    if (s !== null && ((sungTo !== null && s - sungTo > PAUSE) || s > stamp + BUDGET + PER_SYLLABLE * before)) doubt = true;
    out.push(doubt ? null : s);
    if (s !== null && !doubt) sungTo = typeof w![1] === 'number' ? w![1] : s + 0.3;
    before += syl[j];
  });
  return out;
}

/**
 * Word times from an alignment, written into the lines in place. Words the pack couldn't place (backing vocals in
 * brackets, numbers) or isn't believed on (believed) are put between their placed neighbours by syllable count, or
 * 0.3 s a syllable after the last; lines it fitted poorly keep the estimate. A line ends with its last word. Returns
 * how many lines changed.
 */
export function applyAlignment(lines: LyricLine[], result: AlignResult): number {
  let changed = 0;
  lines.forEach((line, i) => {
    const r = result.lines[i];
    if (!r || r.conf === null || r.conf < MIN_CONF || r.words.length !== line.words.length) return;
    const syl = line.words.map(w => syllables(w.text));
    const starts = believed(r, syl, line.start);
    const known = starts.flatMap((s, j) => (s === null ? [] : [j]));
    if (!known.length) return;
    const next = lines[i + 1]?.start ?? Infinity;
    const t: number[] = new Array(line.words.length);
    for (const j of known) t[j] = starts[j]!;
    // Before the first placed word and after the last: 0.3 s a syllable; between two placed words: by syllables.
    for (let j = known[0] - 1; j >= 0; j--) t[j] = t[j + 1] - 0.3 * syl[j];
    for (let k = 0; k < known.length - 1; k++) {
      const a = known[k], b = known[k + 1];
      let total = 0;
      for (let j = a; j < b; j++) total += syl[j];
      let acc = 0;
      for (let j = a + 1; j < b; j++) { acc += syl[j - 1]; t[j] = t[a] + (t[b] - t[a]) * acc / total; }
    }
    for (let j = known[known.length - 1] + 1; j < t.length; j++) t[j] = t[j - 1] + 0.3 * syl[j - 1];
    for (let j = 1; j < t.length; j++) t[j] = Math.max(t[j], t[j - 1]);
    line.words.forEach((w, j) => {
      const sungTo = starts[j] !== null ? r.words[j]?.[1] : null;
      if (j + 1 < t.length) {
        // A word lasts until the next unless the singer clearly stopped (then a little past where its letters end).
        const gap = typeof sungTo === 'number' ? t[j + 1] - sungTo : 0;
        w.start = t[j];
        w.end = gap > 0.6 ? Math.max(t[j] + 0.12, sungTo! + 0.15) : t[j + 1];
      } else {
        w.start = t[j];
        const end = Math.max(typeof sungTo === 'number' ? sungTo + 0.2 : 0, t[j] + 0.3 * syl[j]);
        w.end = Math.max(t[j] + 0.15, Math.min(end, next - 0.05));
      }
    });
    line.start = Math.min(line.start, line.words[0].start);
    // (Not the estimate's end: from the stamp alone a line is given up to 0.6 s a syllable, and stayed up long after
    // the singer had stopped.)
    line.end = line.words[line.words.length - 1].end;
    changed++;
  });
  return changed;
}
