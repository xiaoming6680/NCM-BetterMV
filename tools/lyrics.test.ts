// node --experimental-transform-types --test tools/lyrics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNeteaseLyric, tokenize } from '../src/lyrics/parse.ts';

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

test('ordinary lyrics are not affected', () => {
  const lines = parseNeteaseLyric({ lrc: { lyric: lrc([[1, 'I walk alone'], [5, 'Under the sky, again']]) } }, 10);
  assert.deepEqual(lines.map(l => l.words.map(w => w.text)), [['I', 'walk', 'alone'], ['Under', 'the', 'sky,', 'again']]);
});

