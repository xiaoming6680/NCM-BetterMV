// Words that name a colour, set in that colour (issue #5: "歌词里写了蓝色就把那两个字换成蓝色"). Found once per song
// when the lyrics are parsed; every carrier that tints its words reads LyricWord.color (paintWord and the plates with
// their own tint).
//
// Chinese, Japanese and Korean are a character a word (tokenize), so their colour names are matched over the line's
// characters run together; Latin words are looked up whole. A character that is a colour in some words only (白 in
// 明白, 青 in 青春, 粉 in 粉丝, 银 in 银行) counts only in the words listed for it. Black is left out: the words are
// light on dark frames, and black type would vanish into its own dark halo.
import type { LyricLine } from '../types.ts';

/** Display colours (sRGB), bright enough to read on a dark frame like the paper-coloured words beside them. */
const C = {
  red: '#ff5247', orange: '#ff9a3d', yellow: '#ffd84a', gold: '#f2c14e', green: '#55d46e', cyan: '#45d2e0',
  sky: '#80c6ff', blue: '#4f8cff', indigo: '#6f70ff', purple: '#a86dff', magenta: '#ff52d4', pink: '#ff82bd',
  white: '#ffffff', grey: '#a3a8b0', silver: '#cfd6e0', brown: '#c4874e',
} as const;
type Hue = keyof typeof C;

/** CJK colour characters and what they name. */
const CJK_HUE: Record<string, Hue> = {
  红: 'red', 紅: 'red', 赤: 'red', 朱: 'red', 绯: 'red', 緋: 'red',
  橙: 'orange', 橘: 'orange',
  黄: 'yellow', 黃: 'yellow',
  金: 'gold',
  绿: 'green', 綠: 'green', 緑: 'green', 翠: 'green', 碧: 'green',
  青: 'cyan',
  蓝: 'blue', 藍: 'blue', 靛: 'indigo',
  紫: 'purple',
  粉: 'pink', 桃: 'pink',
  白: 'white',
  银: 'silver', 銀: 'silver',
  灰: 'grey',
  棕: 'brown', 褐: 'brown', 茶: 'brown',
};
/** Colour characters that are colours wherever they stand. */
const ALWAYS = '红紅蓝藍绿綠緑紫黄黃橙';
/**
 * Words in which a character that is not always a colour is one (and 色 compounds that are not colour + 色, such as
 * 水色). The whole word is matched; the part in brackets is coloured (all of it without brackets), in the listed hue
 * or its last colour character's.
 */
const WORDS: Array<[string, Hue?]> = [
  ['[白]云'], ['[白]雲'], ['[白]雪'], ['雪白'], ['洁白'], ['潔白'], ['苍白'], ['蒼白'], ['纯白'], ['純白'], ['[白]衣'], ['[白]发'], ['[白]髮'], ['[白]鸽'], ['[白]纸'], ['[白]裙'], ['[白]月光'], ['乳白'], ['灰白'], ['银白', 'silver'], ['銀白', 'silver'], ['白い'], ['真っ白'],
  ['金色'], ['金黄', 'gold'], ['金黃', 'gold'], ['[金]光'], ['金灿灿'], ['黄金'], ['黃金'], ['鎏金'],
  ['银色'], ['銀色'], ['[银]河'], ['[銀]河'], ['[银]光'], ['[銀]光'], ['[银]月'],
  ['灰色'], ['灰暗'],
  ['粉色'], ['粉红', 'pink'], ['粉紅', 'pink'], ['桃红', 'pink'], ['桃紅', 'pink'], ['桃色'], ['玫红', 'magenta'], ['玫瑰色', 'pink'],
  ['青色'], ['[青]山'], ['[青]草'], ['青翠', 'green'], ['[青]苔'], ['[青]天'], ['[青]空', 'sky'], ['青い', 'blue'], ['真っ青', 'blue'],
  ['赤色'], ['赤い'], ['真っ赤'], ['朱红'], ['朱紅'],
  ['碧蓝'], ['碧藍'], ['碧绿'], ['碧綠'], ['翠绿'], ['翠綠'],
  ['棕色'], ['褐色'], ['茶色'], ['咖啡色', 'brown'],
  ['水色', 'sky'], ['空色', 'sky'], ['天蓝', 'sky'], ['天藍', 'sky'], ['蔚蓝', 'sky'], ['蔚藍', 'sky'], ['湛蓝', 'sky'], ['湛藍', 'sky'], ['浅蓝', 'sky'], ['淺藍', 'sky'],
  ['靛蓝', 'indigo'], ['靛藍', 'indigo'], ['橘色'], ['橘红', 'orange'], ['橙红', 'orange'],
  // Kana loanwords and Korean colour words (also a character a word).
  ['レッド', 'red'], ['オレンジ', 'orange'], ['イエロー', 'yellow'], ['ゴールド', 'gold'], ['グリーン', 'green'], ['ブルー', 'blue'], ['パープル', 'purple'],
  ['ピンク', 'pink'], ['ホワイト', 'white'], ['シルバー', 'silver'], ['グレー', 'grey'],
  ['빨간', 'red'], ['빨강', 'red'], ['파란', 'blue'], ['파랑', 'blue'], ['노란', 'yellow'], ['노랑', 'yellow'], ['초록', 'green'], ['하얀', 'white'],
  ['분홍', 'pink'], ['보라', 'purple'], ['주황', 'orange'], ['회색', 'grey'], ['금빛', 'gold'], ['은빛', 'silver'],
];
/** Characters written before a colour as part of its name (深蓝, 火红, 漆黑…): coloured with it. */
const MODIFIERS = '深浅淺淡嫩亮暗鲜鮮火血雪乳米奶墨藏鹅鵝杏宝寶海湖天苍蒼湛蔚枯通嫣殷橘';

/** Latin colour words (lower case), with plurals ("blues") and -ish. */
const LATIN: Record<string, Hue> = {
  red: 'red', crimson: 'red', scarlet: 'red', ruby: 'red', vermilion: 'red',
  orange: 'orange', amber: 'orange',
  yellow: 'yellow', gold: 'gold', golden: 'gold',
  green: 'green', emerald: 'green', jade: 'green', lime: 'green',
  teal: 'cyan', turquoise: 'cyan', cyan: 'cyan', aqua: 'cyan',
  blue: 'blue', azure: 'sky', navy: 'indigo', sapphire: 'blue', cobalt: 'blue', indigo: 'indigo',
  purple: 'purple', violet: 'purple', lavender: 'purple', lilac: 'purple', magenta: 'magenta',
  pink: 'pink', white: 'white', silver: 'silver', grey: 'grey', gray: 'grey', brown: 'brown',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each listed word without its brackets: its hue and which of its characters are coloured. */
const LISTED = new Map(WORDS.map(([w, h]) => {
  const plain = w.replace(/[[\]]/g, ''), open = w.indexOf('['), close = w.indexOf(']');
  const part = open < 0 ? [0, plain.length] : [open, close - 1];
  return [plain, { hue: h ?? cjkHueOf(w.slice(open + 1, close < 0 ? undefined : close)), part }];
}));
/** Longest first, so 金灿灿 wins over 金光's 金 and 玫瑰色 over 色 compounds. */
const CJK_RE = new RegExp([
  ...[...LISTED.keys()].sort((a, b) => b.length - a.length).map(escape),
  `[${MODIFIERS}]?[${ALWAYS}]+色?`,
].join('|'), 'gu');

/** The hue of the last colour character in a run. */
function cjkHueOf(run: string): Hue | undefined {
  let hue: Hue | undefined;
  for (const ch of run) if (CJK_HUE[ch]) hue = CJK_HUE[ch];
  return hue;
}

function latinHue(word: string): Hue | undefined {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return LATIN[w] ?? (w.endsWith('s') ? LATIN[w.slice(0, -1)] : undefined) ?? (w.endsWith('ish') ? LATIN[w.slice(0, -3)] : undefined);
}

const CJK_WORD = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー々][\p{P}\s]*$/u;

/** Sets LyricWord.color on every word of the lines that names a colour (or is a character of one). */
export function colorWords(lines: LyricLine[]): void {
  for (const line of lines) {
    // CJK words run together, each other word a break the match can't cross.
    let s = '';
    const owner: number[] = [];
    line.words.forEach((w, i) => {
      if (CJK_WORD.test(w.text)) {
        const ch = w.text.replace(/[\p{P}\s]/gu, '');
        s += ch;
        for (let k = 0; k < ch.length; k++) owner.push(i);
      } else {
        s += '\u0000';
        owner.push(-1);
        const hue = latinHue(w.text);
        if (hue) w.color = C[hue];
      }
    });
    for (const m of s.matchAll(CJK_RE)) {
      const listed = LISTED.get(m[0]), hue = listed ? listed.hue : cjkHueOf(m[0]);
      if (!hue) continue;
      const [from, to] = listed ? listed.part : [0, m[0].length];
      // A listed colour coloured to its end takes a 色 after it (纯白色).
      const end = m.index! + to + (to === m[0].length && s[m.index! + to] === '色' ? 1 : 0);
      for (let k = m.index! + from; k < end; k++) if (owner[k] >= 0) line.words[owner[k]].color = C[hue];
    }
  }
}
