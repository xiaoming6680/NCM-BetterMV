// node --experimental-transform-types --test tools/lyrics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNeteaseLyric, tokenize } from '../src/lyrics/parse.ts';
import { LyricTrack } from '../src/director/lyrics.ts';

const lrc = (rows: Array<[number, string]>) => rows.map(([t, s]) => {
  const m = Math.floor(t / 60), sec = (t % 60).toFixed(2).padStart(5, '0');
  return `[${String(m).padStart(2, '0')}:${sec}]${s}`;
}).join('\n');

test('words joined by a comma or full stop with no space are two words (issue #5)', () => {
  assert.deepEqual(tokenize('Thursday,October 22nd'), ['Thursday,', 'October', '22nd']);
  assert.deepEqual(tokenize('end.Start again'), ['end.', 'Start', 'again']);
  assert.deepEqual(tokenize('wait...what'), ['wait...', 'what']);
  assert.deepEqual(tokenize('Stop!Go?Now;then:here'), ['Stop!', 'Go?', 'Now;', 'then:', 'here']);
  assert.deepEqual(tokenize('Hello，world'), ['Hello，', 'world']);
});

test('marks inside a word, a number or an abbreviation do not split it', () => {
  assert.deepEqual(tokenize("don't rock'n'roll"), ["don't", "rock'n'roll"]);
  assert.deepEqual(tokenize('U.S.A. a.m. e-mail AC/DC'), ['U.S.A.', 'a.m.', 'e-mail', 'AC/DC']);
  assert.deepEqual(tokenize('1,000 at 10:30 is 3.14'), ['1,000', 'at', '10:30', 'is', '3.14']);
});

test('CJK stays a character a word, punctuation joining its neighbour', () => {
  assert.deepEqual(tokenize('你好，世界'), ['你', '好，', '世', '界']);
  assert.deepEqual(tokenize('“你”好'), ['“你”', '好']);
});

test('word-timed lyrics split joined words too, sharing the piece’s time', () => {
  const yrc = '[1000,3000](1000,800,0)Thursday,October (1800,600,0)22nd';
  const [line] = parseNeteaseLyric({ yrc: { lyric: yrc }, lrc: { lyric: '[00:01.00]Thursday,October 22nd' } }, 10);
  assert.deepEqual(line.words.map(w => w.text), ['Thursday,', 'October', '22nd']);
  assert.equal(line.words[0].start, 1);
  assert.ok(line.words[1].start > 1 && line.words[1].start < 1.8);
  assert.equal(line.words[1].end, 1.8);
  assert.equal(line.words[2].start, 1.8);
  // Pieces of one word, not parted by a space, still join; a piece ending in a comma does not join the next.
  const yrc2 = '[1000,3000](1000,300,0)Pas(1300,300,0)tell (1600,300,0)is,(1900,300,0)blue';
  const [l2] = parseNeteaseLyric({ yrc: { lyric: yrc2 } }, 10);
  assert.deepEqual(l2.words.map(w => w.text), ['Pastell', 'is,', 'blue']);
});

test('a line typed out over quick steps is one line, its words coming in as typed (issue #5)', () => {
  const lines = parseNeteaseLyric({ lrc: { lyric: lrc([[10, 'Thu'], [10.1, 'Thursday,'], [10.2, 'Thursday, Octo'], [10.3, 'Thursday, October'], [10.45, 'Thursday, October 22nd'], [12, 'Next line here']]) } }, 20);
  assert.equal(lines.length, 2);
  const [typed] = lines;
  assert.equal(typed.typed, true);
  assert.equal(typed.timedWords, false);
  assert.equal(typed.text, 'Thursday, October 22nd');
  assert.deepEqual(typed.words.map(w => w.text), ['Thursday,', 'October', '22nd']);
  assert.deepEqual(typed.words.map(w => w.start), [10, 10.2, 10.45]);
  assert.equal(typed.start, 10);
  assert.ok(typed.end > 10.45 && typed.end <= 12);
  assert.equal(lines[1].typed, undefined);
});

test('a typed line that blinks, is cut back or has its last word changed stays one line, shown at its fullest', () => {
  const blink = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'Credits roll now.'], [1.17, 'Credits roll'], [1.34, 'Credits roll now.'], [1.51, 'Credits roll'], [3, 'Done']]) } }, 10);
  assert.deepEqual(blink.map(l => l.text), ['Credits roll now.', 'Done']);
  const count = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'Thank you (x1)'], [1.17, 'Thank you (x2)'], [1.34, 'Thank you (x3)'], [3, 'Done']]) } }, 10);
  assert.deepEqual(count.map(l => l.text), ['Thank you (x3)', 'Done']);
  // The changed word is shown from when its final form is typed, not before.
  assert.deepEqual(count[0].words.map(w => w.start), [1, 1, 1.34]);
});

test('quick lines that do not type one another out, and slow ones that do, stay apart', () => {
  const quick = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'one'], [1.1, 'two'], [1.2, 'three']]) } }, 10);
  assert.equal(quick.length, 3);
  const slow = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'I love you'], [4, 'I love you more']]) } }, 10);
  assert.deepEqual(slow.map(l => l.text), ['I love you', 'I love you more']);
  assert.ok(slow.every(l => !l.typed));
  // A word chanted again and again is sung each time; a letter repeated every 0.08 s is typed.
  const chant = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'Go!'], [1.2, 'Go!'], [1.5, 'Go!'], [1.8, 'Remember me'], [2.1, 'Remember me']]) } }, 10);
  assert.equal(chant.length, 5);
  const stutter = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'I'], [1.08, 'I'], [1.16, 'I'], [1.24, "I'm here"]]) } }, 10);
  assert.deepEqual(stutter.map(l => l.text), ["I'm here"]);
});

test('lines a fraction of a second apart: the line being sung is on screen, not only lines still to come (issue #5)', () => {
  const quick = Array.from({ length: 40 }, (_, i) => ({ start: 10 + i * 0.17, end: 10 + (i + 1) * 0.17, text: `w${i}`, words: [{ text: `w${i}`, start: 10 + i * 0.17, end: 10 + (i + 1) * 0.17 }], timedWords: false }));
  const track = new LyricTrack(quick);
  for (let t = 10.5; t < 16; t += 0.01) {
    const sung = quick.findIndex((l, i) => l.start <= t + 0.005 && (quick[i + 1]?.start ?? Infinity) > t + 0.005);
    const shown = track.visible(t);
    const st = shown.find(s => s.index === sung), into = (t - quick[sung].start) / 0.17;
    // Whole through most of its span; at its very end it fades as the next comes in.
    const say = `at ${t.toFixed(2)} line ${sung} is sung, shown ${shown.map(s => `${s.index}(${s.age.toFixed(2)}, ${s.exit.toFixed(2)})`).join(' ')}`;
    assert.ok(st && st.exit < 1, say);
    if (into < 0.7) assert.equal(st.exit, 0, say);
    assert.ok(shown.every(s => s.index <= sung + 1), `at ${t.toFixed(2)} a line two ahead is shown`);
  }
});

test('a typed line stays whole until its last word has been on screen, even when that word comes just before the next line', () => {
  const lines = [
    { start: 10, end: 11.4, text: 'a b c', words: [{ text: 'a', start: 10, end: 10.8 }, { text: 'b', start: 10.8, end: 11.2 }, { text: 'c', start: 11.2, end: 11.4 }], timedWords: false, typed: true },
    { start: 11.4, end: 13, text: 'd', words: [{ text: 'd', start: 11.4, end: 13 }], timedWords: false },
  ];
  const track = new LyricTrack(lines);
  const at = (t: number) => track.visible(t).find(s => s.index === 0);
  assert.equal(at(11.25)?.exit, 0);
  assert.ok(at(11.38)!.exit > 0);
});

test('lines seconds apart keep the half-second lead and the 0.3 s exit', () => {
  const slow = [0, 3, 6].map((s, i) => ({ start: s, end: s + 2.5, text: `l${i}`, words: [], timedWords: false }));
  const track = new LyricTrack(slow);
  assert.equal(track.leadOf(1), 0.5);
  assert.equal(track.exitOf(1), 0.3);
  assert.equal(track.leaveAt(0), 3 - 0.32);
  assert.deepEqual(track.visible(2.6).map(s => s.index), [0, 1]);
});

test('ordinary lyrics are not affected', () => {
  const lines = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'I walk alone'], [5, 'Under the sky, again']]) } }, 10);
  assert.deepEqual(lines.map(l => l.words.map(w => w.text)), [['I', 'walk', 'alone'], ['Under', 'the', 'sky,', 'again']]);
});

