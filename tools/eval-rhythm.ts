// Local PCM regression snapshots: node --experimental-transform-types tools/eval-rhythm.ts <output.json> [id ...]
// Uses cached Beat This! predictions when present. No network, audio or lyric export.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { analyze } from '../src/analysis/index.ts';
import { Music } from '../src/director/music.ts';

const [output, ...requested] = process.argv.slice(2);
if (!output) throw new Error('Expected output JSON path');
const ids = requested.length ? requested : ['2044796386', '2099631232', '2042303390', '2105529773', '27713921', '2090536055'];
const rows = [];
for (const id of ids) {
  const path = `dev/eval-pcm/${id}`;
  if (!existsSync(path + '.s16')) continue;
  const b = readFileSync(path + '.s16'), pcm = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const x = Float32Array.from(pcm, v => v / 32768);
  const meta = JSON.parse(readFileSync(path + '.json', 'utf8'));
  const start = performance.now();
  const beatPath = `dev/eval-pcm/beats/${id}.json`;
  const drumPath = `dev/rhythm/${id}-drums.json`;
  const beatThis = existsSync(beatPath) ? JSON.parse(readFileSync(beatPath, 'utf8')) : undefined;
  if (beatThis && existsSync(drumPath)) beatThis.drums = JSON.parse(readFileSync(drumPath, 'utf8'));
  const a = analyze(x, 22050, { bpmHint: meta.wikiBpm,
    beatThis });
  const music = new Music(a);
  const row = { id, ms: Math.round(performance.now() - start), bpm: a.bpm, named: a.namedBpm,
    beats: a.beats, beatInBar: a.beatInBar, tempo: a.tempo, downbeats: a.downbeats, meter: a.meter,
    meterPerBeat: a.meterPerBeat, meterSegments: a.meterSegments, hits: a.hits, drumSource: a.drumSource,
    sections: a.sections.map(s => [s.start, s.end, s.label]),
    endPosition: music.beatPos(a.duration) };
  rows.push(row);
  console.log(id, JSON.stringify({ ms: row.ms, bpm: row.bpm, beats: row.beats.length,
    bars: row.downbeats.length, kick: a.hits.kick.length, snare: a.hits.snare.length }));
}
writeFileSync(output, JSON.stringify(rows));
