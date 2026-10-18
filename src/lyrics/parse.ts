// NetEase lyric JSON (/api/song/lyric/v1) → timed lines and words.
// Word times come from yrc when NetEase has it; otherwise each line's words are spread over the line by syllable count.
import type { LyricLine, LyricWord } from '../types.ts';

export interface NeteaseLyric {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yrc?: { lyric?: string };
  pureMusic?: boolean;
  nolyric?: boolean;
  uncollected?: boolean;
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LEAD = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g;
// NetEase's placeholder for pure music ("纯音乐，请欣赏~", "此歌曲为没有填词的纯音乐，请您欣赏"…).
const INSTRUMENTAL = /^纯音乐[，,\s]*请您?欣赏|没有填词的纯音乐/;
// Notices written into the lyrics ("【未经著作权人许可 不得翻唱 翻录或使用】").
const NOTICE = /未经.{0,12}许可|不得翻唱|不得翻录/;
// Credits written as ordinary timed lines ("作词 : …", "吉他Guitar：…", "Mixed by …").
const CREDIT = /^[^:：]{0,30}(作词|作曲|编曲|词|曲|制作|监制|出品|统筹|企划|发行|版权|策划|吉他|贝斯|鼓|键盘|钢琴|弦乐|和声|琵琶|古筝|二胡|笛|箫|扬琴|唢呐|提琴|打击乐|合成器|编程|采样|配唱|总监|混音|母带|录音|人声|演唱|原唱|翻唱|OP|SP|ISRC|Producer|Produced|Arrange|Compose|Lyric|Written|Mix|Master|Guitar|Bass|Drum|Keyboard|Piano|String|Vocal|Record|Engineer|Pipa|Guzheng|Erhu|Flute|Cello|Violin|Viola|Percussion|Synth|Programming|Director|Supervisor)[^:：]{0,30}[:：]/i;
const COMPANY = /(Co\.,? ?Ltd|Entertainment|Records|Publishing|有限公司|工作室|唱片公司)/i;
// Section labels written as lines ("(Chorus)", "[Verse 2]", "Hook:", "Interlude", "副歌"); a whole bracket is gone by the
// time a line is checked, a lone one stays (NetEase has "Chorus]"). Only a line that is nothing but the label counts:
// "Break my heart" is a lyric.
const SECTION = /^[(（[【]?\s*(?:intro|verse|pre[-\s]?chorus|post[-\s]?chorus|chorus|hook|bridge|outro|refrain|interlude|drop|break|主歌|副歌|桥段|前奏|间奏|尾奏)(?:\s*\d+|\s+[ivx]+|\s*[一二三四五六七八九十]+)?\s*[:：]?\s*[)）\]】]?\s*[:：]?$/i;
const isCredit = (text: string) => (CREDIT.test(text) && text.length < 200) || COMPANY.test(text) || NOTICE.test(text) || INSTRUMENTAL.test(text) || SECTION.test(text) || !/[\p{L}\p{N}]/u.test(text);

const seconds = (m: string, s: string, f?: string) => Number(m) * 60 + Number(s) + (f ? Number(f.padEnd(3, '0')) / 1000 : 0);
const key = (t: number) => Math.round(t * 100);

/** [time, text] pairs of an LRC document; credits written as JSON lines and [xx:…] tags are dropped. */
function lrcEntries(text: string | undefined): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '{') continue;
    const lead = line.match(LEAD);
    if (!lead) continue;
    const words = line.slice(lead[0].length).trim();
    for (const [, m, s, f] of lead[0].matchAll(STAMP)) out.push([seconds(m, s, f), words]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const PUNCT = /^[\p{P}\p{S}]+$/u;
/** Opening brackets and quotes: they belong to the word after them. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;

/**
 * Punctuation never stands as a word of its own (NetEase's word-timed lyrics often give "(" or "," their own slot):
 * an opening bracket or quote joins the word after it, anything else the word before it. Works on plain tokens and
 * on timed words (a joined mark takes no time of its own).
 */
function joinPunctuation<T>(items: T[], text: (x: T) => string, withText: (x: T, s: string) => T): T[] {
  const out: T[] = [];
  let pending = '';
  for (const it of items) {
    const s = text(it).trim();
    if (!s) continue;
    if (PUNCT.test(s)) {
      if (OPENING.test(s) || !out.length) pending += s;
      else out[out.length - 1] = withText(out[out.length - 1], text(out[out.length - 1]) + s);
    } else {
      out.push(withText(it, pending + s));
      pending = '';
    }
  }
  return out;
}

/** Words of a line: Latin runs split on spaces, each CJK character on its own; punctuation joins a neighbour. */
export function tokenize(text: string): string[] {
  const re = /[㐀-鿿豈-﫿぀-ヿ가-힯]|[^\s㐀-鿿豈-﫿぀-ヿ가-힯]+/g;
  return joinPunctuation(Array.from(text.matchAll(re), m => m[0]), t => t, (_, s) => s);
}

/** Scripts written without spaces between words: each character is a word of its own. */
const SPACELESS = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

const WRAPPED = /^\s*[(（[【]\s*(.*?)\s*[)）\]】]\s*$/;
/** A line sung wholly in brackets is backing vocals: shown without the brackets, and flagged for the analysis. */
function unwrap(text: string): { text: string; backing: boolean } {
  const m = text.match(WRAPPED);
  return m && m[1] ? { text: m[1], backing: true } : { text, backing: false };
}

/** A line's text tidied: no space before punctuation or after an opening bracket. */
const tidy = (text: string) => text
  .replace(/\s+([,.!?;:，。！？；：、)）\]】])/g, '$1')
  .replace(/([(（[【])\s+/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

export function syllables(word: string): number {
  if (/[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(word)) return 1;
  const groups = word.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Spread a line's words over its sung span, weighted by syllables. */
export function spreadWords(text: string, start: number, end: number): LyricWord[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const weights = tokens.map(syllables);
  const total = weights.reduce((a, b) => a + b, 0);
  // Singers rarely fill the whole gap to the next line: about 0.4 s per syllable, never past the gap.
  const sung = Math.min(end - start, Math.max(0.6, total * 0.4));
  const words: LyricWord[] = [];
  let t = start;
  for (let i = 0; i < tokens.length; i++) {
    const d = (sung * weights[i]) / total;
    words.push({ text: tokens[i], start: t, end: t + d });
    t += d;
  }
  return words;
}

/** The translation at each of its stamps; '' where a line is left untranslated (NetEase writes nothing or "//"). */
function translations(doc: NeteaseLyric): Map<number, string> {
  const map = new Map<number, string>();
  for (const [t, text] of lrcEntries(doc.tlyric?.lyric)) map.set(key(t), text === '//' ? '' : text);
  return map;
}

function fromYrc(doc: NeteaseLyric): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of String(doc.yrc?.lyric || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = raw.trim().match(YRC_LINE);
    if (!m) continue;
    const start = Number(m[1]) / 1000, end = start + Number(m[2]) / 1000;
    const pieces = Array.from(m[3].matchAll(YRC_WORD), ([, ws, wd, text]) => ({ text, start: Number(ws) / 1000, end: (Number(ws) + Number(wd)) / 1000 }))
      .filter(p => p.text);
    // NetEase splits some words into timed syllables with nothing between them ("Pastell" "é, ", "N" "-" "now "):
    // pieces not parted by a space are one word — except in scripts written without spaces, a character a word.
    const words: LyricWord[] = [];
    let open = false;
    for (const p of pieces) {
      const body = p.text.trim(), last = words[words.length - 1];
      if (body && open && last && !/^\s/.test(p.text) && !SPACELESS.test(last.text.slice(-1)) && !SPACELESS.test(body[0])) {
        last.text += body;
        last.end = p.end;
      } else if (body) words.push({ text: body, start: p.start, end: p.end });
      open = !!body && !/\s$/.test(p.text);
    }
    const spaceless = SPACELESS.test(m[3]);
    const { text, backing } = unwrap(tidy(spaceless ? words.map(w => w.text).join('') : pieces.map(p => p.text).join('')));
    if (!text || isCredit(text)) continue;
    const joined = joinPunctuation(words, w => w.text, (w, t) => ({ ...w, text: t }));
    if (backing && joined.length) {
      joined[0] = { ...joined[0], text: joined[0].text.replace(/^[(（[【]+/, '') };
      const last = joined.length - 1;
      joined[last] = { ...joined[last], text: joined[last].text.replace(/[)）\]】]+$/, '') };
    }
    lines.push({ start, end, text, words: joined.filter(w => w.text), timedWords: true, backing });
  }
  return lines;
}

/**
 * The translation whose stamp is closest to t, within `within` seconds (0.35: NetEase's translation stamps drift by
 * tens of ms); none when that stamp's line is left untranslated.
 */
function nearest(trans: Map<number, string>, t: number, within = 0.35): string | undefined {
  const k = key(t);
  let best = trans.get(k), bestD = Math.round(within * 100) + 1;
  if (best === undefined) for (const [stamp, text] of trans) { const d = Math.abs(stamp - k); if (d < bestD) { bestD = d; best = text; } }
  return best || undefined;
}

/** A line's words alone: letters and digits, in lower case (the same line written with other spacing or marks). */
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The translations of the word-timed lines. NetEase stamps a translation with its line's time in the line-level lyric
 * (lrc), and the yrc's lines can start well apart from those (《Shut up My Moms Calling (Sped up)》: 0.2–0.9 s later
 * on most lines, over 4 s in two passages — 18 of its 33 lines lost their translation, and a held "ooh" took the
 * next line's). So each line is first found in the lrc by its words — in order, the next lrc line with the same
 * words within 8 s — and takes the translation at that line's stamp, or none; a line not found there takes the
 * one nearest its own start.
 */
function translate(lines: LyricLine[], doc: NeteaseLyric, trans: Map<number, string>): void {
  const lrc = lrcEntries(doc.lrc?.lyric).filter(([, text]) => text).map(([t, text]) => ({ t, words: plain(unwrap(tidy(text)).text) }));
  let from = 0;
  for (const l of lines) {
    const words = plain(l.text);
    let twin = -1;
    for (let j = from; words && j < lrc.length && lrc[j].t < l.start + 8; j++) if (lrc[j].words === words && lrc[j].t > l.start - 8) { twin = j; break; }
    if (twin >= 0) from = twin + 1;
    l.translation = twin >= 0 ? nearest(trans, lrc[twin].t, 0.1) : nearest(trans, l.start);
  }
}

function fromLrc(doc: NeteaseLyric, trans: Map<number, string>, duration: number): LyricLine[] {
  const entries = lrcEntries(doc.lrc?.lyric);
  const lines: LyricLine[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [start, rawText] = entries[i];
    const { text, backing } = unwrap(tidy(rawText));
    if (!text || INSTRUMENTAL.test(text) || isCredit(text)) continue;
    // A line lasts until the next sung line. NetEase often puts an empty stamp right after a line; trust it as the
    // end only when it leaves the line enough time for its syllables (it frequently cuts a long last word short).
    let j = i + 1;
    while (j < entries.length && !entries[j][1]) j++;
    const nextSung = j < entries.length ? entries[j][0] : duration;
    const blank = i + 1 < j ? entries[i + 1][0] : Infinity;
    // Slow songs spend well over 0.3 s a syllable; err long (the display bridges short gaps anyway).
    const needed = Math.max(2.5, tokenize(text).reduce((n, w) => n + syllables(w), 0) * 0.42);
    const end = Math.min(nextSung, start + 12, blank >= start + needed ? blank : start + needed * 1.4);
    lines.push({ start, end, text, words: spreadWords(text, start, end), timedWords: false, translation: nearest(trans, start), backing });
  }
  return lines;
}

/**
 * How far NetEase's word-level lyric (yrc) runs late, judged against its own line-level lyric (lrc): 0 unless it is
 * clearly and steadily late, then the shift that brings it back to the usual gap. Over 63 cached songs with both, yrc
 * starts a line between 0.4 s before and 0.3 s after lrc (about +0.15 s in the middle) and neither is always the
 * right one; a few run late on every line (《Cytus II Opening - The Whole Rest》: +0.42 to +0.99 s, the user heard
 * every word late). Only those are moved: at least 8 lines, the median over 0.4 s, nine lines in ten late.
 */
export function yrcLag(lines: LyricLine[], doc: NeteaseLyric): number {
  const stamps = lrcEntries(doc.lrc?.lyric).filter(([, text]) => text).map(([t]) => t);
  if (lines.length < 8 || !stamps.length) return 0;
  const d: number[] = [];
  for (const l of lines) {
    let best = Infinity;
    for (const s of stamps) if (Math.abs(l.start - s) < Math.abs(best)) best = l.start - s;
    if (Math.abs(best) < 2) d.push(best);
  }
  if (d.length < 8) return 0;
  d.sort((a, b) => a - b);
  const median = d[d.length >> 1];
  const late = d.filter(x => x > 0).length / d.length;
  return median > 0.4 && late >= 0.9 ? median - 0.15 : 0;
}

/** Moves every time in the lines `by` seconds (negative = earlier). */
export function shiftLines(lines: LyricLine[], by: number): void {
  for (const l of lines) {
    l.start += by;
    l.end += by;
    for (const w of l.words) { w.start += by; w.end += by; }
  }
}

export function parseNeteaseLyric(doc: NeteaseLyric, duration: number): LyricLine[] {
  if (!doc || doc.pureMusic || doc.nolyric || doc.uncollected) return [];
  const trans = translations(doc);
  const timed = fromYrc(doc);
  if (!timed.length) return fromLrc(doc, trans, duration);
  // A yrc that runs late is brought back (before the translations are matched: a line not found in the lrc takes
  // the one nearest its corrected start).
  const lag = yrcLag(timed, doc);
  if (lag > 0) shiftLines(timed, -lag);
  translate(timed, doc, trans);
  return timed;
}
