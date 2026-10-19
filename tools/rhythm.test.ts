// node --experimental-transform-types --test tools/rhythm.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onePace, steadyGrid, usableBeatThis, type BeatThisInput } from '../src/analysis/beatthis.ts';
import { analyze, localTempo } from '../src/analysis/index.ts';
import { modelDrums, mergeSnares } from '../src/analysis/drums.ts';
import { Music } from '../src/director/music.ts';
import { cutTimes } from '../src/director/director.ts';
import { PULSE } from '../src/style/style.ts';
import type { Analysis } from '../src/types.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
function prediction(beats: number[]): BeatThisInput {
  return { beats, downbeats: [], fps: 50, beatProb: new Float32Array(0), downProb: new Float32Array(0) };
}
function fixture(beats: number[], grouping: number[] = beats.map(() => 4)): Analysis {
  let phase = 0;
  const inBar = grouping.map((m, i) => { if (i && m !== grouping[i - 1]) phase = 0; const p = phase; phase = (phase + 1) % m; return p; });
  const duration = beats[beats.length - 1] + (beats[1] - beats[0]);
  return { version: 2, duration, bpm: 120, meter: 4, beats, beatInBar: inBar, meterPerBeat: grouping,
    tempo: localTempo(beats), downbeats: beats.filter((_, i) => inBar[i] === 0),
    sections: [{ start: 0, end: duration, label: 'drop', energy: 0.8, group: 0, vocal: false }],
    env: { fps: 100, rms: new Float32Array(0), low: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0), onset: new Float32Array(0) },
    hits: { kick: [], snare: [], hat: [], accent: [] } };
}

test('a build rising into a drop speeds up: its last four bars a shot each, its last two on every beat', () => {
  // 120 BPM in 4/4: a bar is 2 s.
  const m = new Music(fixture(Array.from({ length: 200 }, (_, i) => i * 0.5)));
  const build = { start: 0, end: 24, label: 'build' as const, energy: 0.5, group: 0, vocal: false };
  const drop = { ...build, start: 24, end: 40, label: 'drop' as const, energy: 0.9 };
  const { cuts, rush } = cutTimes(m, PULSE, build, drop);
  near(rush, 20);
  for (const t of [4, 8, 12, 16, 18, 20, 20.5, 21, 22, 23.5]) assert.ok(cuts.some(c => Math.abs(c - t) < 0.06), `no cut at ${t}: ${cuts}`);
});

const grid = (n: number, period: number, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i * period);
let jitterSeed = 5;
const jitter = (ms: number) => { jitterSeed = (1664525 * jitterSeed + 1013904223) >>> 0; return (jitterSeed / 4294967296 - 0.5) * 2 * ms / 1000; };

test('a produced song becomes one exact grid: stray half-beats, a slow drift and frame steps go', () => {
  const period = 60 / 112.5, exact = grid(300, period, 0.3);
  const beats = exact.map(t => t + jitter(15));
  // Beat This! double-timing a few beats (onePace left two of them) and drifting 80 ms round a break.
  beats.push(exact[50] + period / 2, exact[53] + period / 2);
  for (let i = 140; i < 150; i++) beats[i] += 0.08 * Math.sin(Math.PI * (i - 140) / 10);
  const out = steadyGrid(beats.sort((p, q) => p - q));
  assert.equal(out.length, exact.length);
  out.forEach((t, i) => near(t, exact[i], 0.004));
});

test('a half-time passage on the grid keeps every other beat; a played, drifting tempo stays as it is', () => {
  const period = 0.5, full = grid(200, period);
  const beats = full.filter((t, i) => i < 80 || i >= 140 || i % 2 === 0);
  const out = steadyGrid(beats);
  assert.equal(out.length, beats.length);
  // Played: the tempo wanders ±3 % over a few bars.
  const played: number[] = [0];
  for (let i = 1; i < 200; i++) played.push(played[i - 1] + 0.5 * (1 + 0.03 * Math.sin(i / 6)));
  assert.deepEqual(steadyGrid(played), played);
});

test('two locked stretches join over a gap only when its beats are about one per grid point', () => {
  const period = 0.5, a = grid(60, period), b = grid(60, period, 40);
  const off = grid(19, period, 30.25 + 0.06).map(t => t + 0.08); // drifted beats, one per grid point
  near(steadyGrid([...a, ...off, ...b]).filter(t => t > 30 && t < 40).length, 19, 0);
  const sparse = grid(5, 2, 31); // a few beats in a 10 s gap: no join, they stay
  assert.deepEqual(steadyGrid([...a, ...sparse, ...b]).filter(t => t > 30 && t < 40), sparse);
});

test('onePace and the grid fold a double-time stretch back to the pace of the song', () => {
  const beats = [...grid(40, 0.5), ...grid(24, 0.25, 20), ...grid(40, 0.5, 26)];
  // (onePace alone leaves a beat or two of the burst at each end: the grid takes them out.)
  const out = steadyGrid(onePace(beats, new Float32Array(0), 50, 120));
  out.slice(1).forEach((t, i) => near(t - out[i], 0.5, 1e-9));
  assert.ok(usableBeatThis(prediction(beats)));
});

test('bar phase counts beats, with a tempo change inside the bar', () => {
  const music = new Music(fixture([0, 0.5, 1, 1.25, 1.5, 1.75]));
  near(music.at(1).barPhase, 0.5); // Two of four pulses, despite a tempo change inside the bar.
});

test('a loud section with nothing louder after it cuts every two bars', () => {
  const m = new Music(fixture(Array.from({ length: 200 }, (_, i) => i * 0.5)));
  const chorus = { start: 0, end: 32, label: 'chorus' as const, energy: 0.9, group: 0, vocal: false };
  const { cuts, rush } = cutTimes(m, PULSE, chorus, undefined);
  assert.equal(rush, Infinity);
  cuts.slice(1).forEach((t, i) => near(t - cuts[i], 4, 0.06));
});

test('model events are sanitized and survive missing beat predictions', () => {
  const input = { kick: [[1, 0.5], [1.01, 0.9], [1.07, 2], [-1, 1], [NaN, 1]], snare: [], hat: [] };
  const drums = modelDrums(input as any, 2)!;
  assert.deepEqual(drums.kick, [[1.01, 0.9], [1.07, 1]]);
  assert.equal(modelDrums({ kick: [] } as any, 2), null);
  const result = analyze(new Float32Array(44100), 22050, { beatThis: { ...prediction([]), drums } });
  assert.deepEqual(result.hits.kick, drums.kick);
  assert.equal(result.drumSource, 'hybrid');
  assert.ok(result.beats.length > 0);
  assert.deepEqual(mergeSnares([[1, 0.8]], [[1.02, 0.6], [1.06, 0.5]]), [[1, 0.8], [1.06, 0.5]]);
});

test('musical time is invertible; visual time stays continuous through tempo and odd-meter changes', () => {
  const beats = Array.from({ length: 40 }, (_, i) => i < 8 ? i * 0.5 : 4 + (i - 8) * 0.25);
  const music = new Music(fixture(beats, beats.map((_, i) => i < 8 ? 4 : 7)));
  for (let t = -0.4; t < music.duration; t += 0.037) near(music.timeOfBeat(music.beatPos(t)), t);
  near(music.barDuration(4), 1.75);
  assert.equal(music.at(4).meter, 7);
  assert.equal(music.at(4).inBar, 0);
  assert.equal(music.at(4).bpm, 240);
  assert.equal(music.visual.bpm(4), 120);
  near(music.visual.position(4 + 1e-7), music.visual.position(4 - 1e-7), 1e-5);
  const later = music.visual.position(9);
  music.visual.position(2); // seek backwards and replay
  near(music.visual.position(9), later);
  assert.deepEqual(music.a.beats, beats);
});

test('old analyses and empty audio retain valid timing', () => {
  const old = fixture(Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.5));
  delete old.meterPerBeat;
  const music = new Music(old);
  assert.equal(music.meterAt(3), 4);
  near(music.barDuration(3), 2);
  assert.equal(music.at(0).bar, -1);
  const silent = analyze(new Float32Array(22050), 22050);
  assert.ok(silent.beats.every(Number.isFinite));
  for (const hits of Object.values(silent.hits)) assert.equal(hits.length, 0);
});

test('model drums do not depend on the beat grid', () => {
  const drums = { kick: [[0.5, 0.9], [1, 0.8], [1.5, 0.9]], snare: [[0.75, 0.7]], hat: [] } as BeatThisInput['drums'];
  const slow = analyze(new Float32Array(22050 * 4), 22050, { beatThis: { ...prediction(grid(8, 0.5)), drums } });
  const fast = analyze(new Float32Array(22050 * 4), 22050, { beatThis: { ...prediction(grid(15, 0.25, 0.13)), drums } });
  assert.deepEqual(slow.hits.kick, fast.hits.kick);
  assert.deepEqual(slow.hits.kick, drums!.kick);
});
