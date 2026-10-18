// How squarely the beat grid sits on the onsets, per song (no beat annotations needed):
//   bun tools/eval-grid.ts [--song id[,id…]] [--dir <pcm folder>] [--json out.json] [--compare old.json]
// For each song: lock coverage (share of beats on an exact constant grid: 32+ beats whose intervals agree within
// 0.5 ms — the constant-tempo lock's grids, or smoothed DP beats as steady as one), on-beat novelty (the smoothed beat novelty at the beats, in
// standard deviations, weighted by loudness: higher = beats closer to the onset peaks) and its contrast against the
// beats' seven other 1/8 phases. On-beat novelty favours the DP beats, which sit on onset peaks by construction, so it
// compares versions of the grid on the same songs (--compare lists the songs that moved 1 % or more), not songs with
// each other.
// Audio: dev/eval-pcm/<id>.s16 (mono 22050 Hz, as for eval-tempo) and the wiki BPM in the .json beside it as bpmHint;
// --dir reads another folder of the same format (all .s16 in it), the song name from "name" in the .json if present.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, beatNovelty, loudnessWeight, BEAT_LATENCY } from '../src/analysis/index.ts';
import { computeSpectra } from '../src/analysis/spectrum.ts';
import { computeOnsets } from '../src/analysis/onset.ts';
import { Slicer, gaussianSmooth, std } from '../src/analysis/util.ts';

const SR = 22050;
const ROOT = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const dir = opt('--dir') || join(ROOT, 'dev/eval-pcm');
const names: Record<string, string> = {};
for (const s of JSON.parse(readFileSync(join(ROOT, 'tools/truth/tempo.json'), 'utf8')).songs) names[s.id] = s.song;
const ids = opt('--song') ? opt('--song').split(',')
  : opt('--dir') ? readdirSync(dir).filter(f => f.endsWith('.s16')).map(f => f.slice(0, -4))
  : Object.keys(names);

function drain<T>(g: Generator<number, T, void>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }

interface Row { id: string; song: string; bpm: number; lock: number; onBeat: number; contrast: number }
const rows: Row[] = [];
for (const id of ids) {
  const pcm = join(dir, `${id}.s16`), meta = join(dir, `${id}.json`);
  if (!existsSync(pcm)) { console.log(`skip ${id}: no ${pcm}`); continue; }
  const m = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : {};
  const buf = readFileSync(pcm), s16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
  const x = new Float32Array(s16.length);
  for (let i = 0; i < s16.length; i++) x[i] = s16[i] / 32768;
  const a = analyze(x, SR, { bpmHint: m.wikiBpm ?? undefined });
  // The novelty the beat tracker follows, as the lock sees it (smoothed, in standard deviations).
  const slicer = new Slicer(Infinity);
  const spec = drain(computeSpectra(x, SR, slicer, 0, 1)), ons = drain(computeOnsets(spec, slicer, 0, 1));
  const fps = spec.fps;
  const levelDb = new Float32Array(spec.nFrames);
  for (let i = 0; i < spec.nFrames; i++) levelDb[i] = 10 * Math.log10(spec.power[i] + 1e-12);
  const sm = gaussianSmooth(beatNovelty(ons.flux, ons.low, fps), 1.5), sd = std(sm) || 1;
  const loud = loudnessWeight(levelDb, fps);
  const at = (t: number) => { const f = (t + BEAT_LATENCY) * fps, i = Math.floor(f), r = f - i; return i >= 0 && i + 1 < sm.length ? (sm[i] * (1 - r) + sm[i + 1] * r) / sd : 0; };
  const w = (t: number) => loud[Math.max(0, Math.min(loud.length - 1, Math.round(t * fps)))];
  const b = a.beats, n = b.length;
  let on = 0, off = 0, sw = 0;
  for (let i = 0; i + 1 < n; i++) {
    const P = b[i + 1] - b[i];
    let o = 0;
    for (let p = 1; p < 8; p++) o += at(b[i] + (p / 8) * P) / 7;
    on += w(b[i]) * at(b[i]); off += w(b[i]) * o; sw += w(b[i]);
  }
  // Exact grid stretches: consecutive intervals within 0.5 ms of the stretch's first one (beats are rounded to 0.1 ms).
  let locked = 0;
  for (let i = 0; i + 1 < n;) {
    let j = i + 1;
    while (j + 1 < n && Math.abs((b[j + 1] - b[j]) - (b[i + 1] - b[i])) < 0.0005) j++;
    if (j - i + 1 >= 32) locked += j - i + 1;
    i = j;
  }
  const row = { id, song: names[id] ?? m.name ?? id, bpm: a.bpm, lock: locked / Math.max(1, n), onBeat: on / (sw || 1), contrast: on / (off || 1) };
  rows.push(row);
  console.log(`${id.padEnd(11)} grid ${row.bpm.toFixed(1).padStart(6)}  lock ${(100 * row.lock).toFixed(0).padStart(3)} %  on-beat ${row.onBeat.toFixed(2)}  contrast ${row.contrast.toFixed(2)}  ${row.song}`);
}
const mean = (k: 'lock' | 'onBeat' | 'contrast') => rows.reduce((p, r) => p + r[k], 0) / (rows.length || 1);
console.log(`\n${rows.length} songs: lock ${(100 * mean('lock')).toFixed(1)} %, on-beat ${mean('onBeat').toFixed(3)}, contrast ${mean('contrast').toFixed(3)}`);
if (opt('--compare')) {
  const old: Record<string, Row> = {};
  for (const r of JSON.parse(readFileSync(opt('--compare'), 'utf8')) as Row[]) old[r.id] = r;
  const moved = rows.filter(r => old[r.id] && Math.abs(r.onBeat / old[r.id].onBeat - 1) >= 0.01).sort((p, q) => p.onBeat / old[p.id].onBeat - q.onBeat / old[q.id].onBeat);
  console.log(`\nvs ${opt('--compare')}: ${moved.length} songs moved 1 % or more (on-beat novelty)`);
  for (const r of moved) {
    const o = old[r.id];
    console.log(`${(100 * (r.onBeat / o.onBeat - 1)).toFixed(1).padStart(6)} %  on-beat ${o.onBeat.toFixed(2)} → ${r.onBeat.toFixed(2)}  lock ${(100 * o.lock).toFixed(0)} → ${(100 * r.lock).toFixed(0)} %  ${r.song}`);
  }
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(rows, null, 1));
