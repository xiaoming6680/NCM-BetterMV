// Sections against NetEase's own chorus marks (tools/truth/chorus.json: the 副歌 NetEase plays as a song's highlight),
// on the songs decoded in dev/eval-pcm/ (see eval-tempo.ts) with their lyrics from dev/ncm-cache/ (the dev server's):
//   bun tools/eval-sections.ts [--song id[,id…]] [--json out.json] [--worst n] [--no-lyrics] [--hint] [--detail] [--beats]
// Per song, for NetEase's chorus [cs, ce]:
//   cover  the share of it the analysis calls chorus or drop (the climaxes: what NetEase marks is one of them)
//   start  how far the nearest chorus / drop start is from cs, in bars (signed: + the analysis starts later)
//   hit    a chorus / drop starting within one bar of cs
// NetEase's marks are not full section truth (one segment per song, sometimes a verse hook or a second chorus), so the
// summary is for comparing versions of the analysis; read the worst songs one by one (--worst), with sections, the mark
// and the sung lines' times, never their words. --hint gives the analysis the mark as its chorusHint, as the plugin
// does: the score then mostly measures the songs where the sections found had nothing over the mark. --detail prints
// per section its energy, lyric cover (lead), hook and repeat share, drum drive and bass, ◀ where the mark is, and the
// sung lines as start:group×count (the same words, the same group), for reading a song without its words.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Analysis, Section } from '../src/types.ts';

const SR = 22050;
const ROOT = join(import.meta.dir, '..');
const PCM = join(ROOT, 'dev/eval-pcm');
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = opt('--song') ? new Set(opt('--song').split(',')) : null;
const worstN = Number(opt('--worst') || 25);
const useLyrics = !args.includes('--no-lyrics');
const useHint = args.includes('--hint');
const detail = args.includes('--detail');
// --beats: with Beat This!'s beats (tools/eval-beats.ts), as the plugin with the aligner pack.
const useBeats = args.includes('--beats');

const marks: Record<string, [number, number] | null> = JSON.parse(readFileSync(join(ROOT, 'tools/truth/chorus.json'), 'utf8')).chorus;
const names: Record<string, string> = {};
try {
  for (const s of JSON.parse(readFileSync(join(ROOT, 'tools/truth/tempo.json'), 'utf8')).songs) names[String(s.id)] = s.song;
} catch {}

const { analyze } = await import('../src/analysis/index.ts');
const { evalBeats } = await import('./eval-beats.ts');
const { parseNeteaseLyric } = await import('../src/lyrics/parse.ts');
const { sungLines } = await import('../src/analysis/sections.ts');
let sectionInfo: Array<Record<string, number>> = [];
(globalThis as { __bmvSectionInfo?: (d: unknown) => void }).__bmvSectionInfo = d => { sectionInfo = d as typeof sectionInfo; };

const CLIMAX = new Set(['chorus', 'drop']);
/** Bars between two times on the downbeats (fractional, signed). */
function barsBetween(down: number[], a: number, b: number): number {
  const at = (t: number) => {
    let i = 0;
    while (i + 1 < down.length && down[i + 1] <= t) i++;
    const j = Math.min(down.length - 1, i + 1), len = j > i ? down[j] - down[i] : 2;
    return i + (t - down[i]) / len;
  };
  return at(b) - at(a);
}

interface Row { id: string; song: string; mark: [number, number]; cover: number; start: number; hit: boolean; sections: Array<[string, number, number]>; lines: number }
const rows: Row[] = [];
let skipped = 0;
const ids = Object.keys(marks).filter(id => marks[id] && (!only || only.has(id)) && existsSync(join(PCM, `${id}.s16`)));
const t0 = performance.now();
for (const id of ids) {
  const mark = marks[id]!;
  const buf = readFileSync(join(PCM, `${id}.s16`)), s = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
  const x = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) x[i] = s[i] / 32768;
  const meta = join(PCM, `${id}.json`), lyricFile = join(ROOT, `dev/ncm-cache/lyric-${id}.json`);
  const wiki = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).wikiBpm ?? undefined : undefined;
  const lyrics = useLyrics && existsSync(lyricFile) ? parseNeteaseLyric(JSON.parse(readFileSync(lyricFile, 'utf8')), x.length / SR) : [];
  let a: Analysis;
  try { a = analyze(x, SR, { lyrics, bpmHint: wiki, chorusHint: useHint ? mark : undefined, beatThis: useBeats ? evalBeats(id) : undefined }); } catch (e) { skipped++; console.log(`skip ${id}: ${(e as Error).message}`); continue; }
  const secs: Section[] = a.sections;
  if (detail) {
    const barAt = (t: number) => { let i = 0; while (i + 1 < a.downbeats.length && a.downbeats[i + 1] <= t + 0.01) i++; return i; };
    console.log(`
${names[id] ?? id}  ${a.bpm.toFixed(1)} BPM (wiki ${wiki ?? '—'})  mark ${mark[0].toFixed(1)}–${mark[1].toFixed(1)}  ${lyrics.length} lines`);
    secs.forEach((sec, k) => {
      const f = sectionInfo[k] ?? {};
      const on = Math.min(sec.end, mark[1]) - Math.max(sec.start, mark[0]) > 0.5 ? '◀' : ' ';
      console.log(`${on} ${sec.label.padEnd(6)} ${sec.start.toFixed(1).padStart(6)}–${sec.end.toFixed(1).padStart(6)}  ${String(barAt(sec.end) - barAt(sec.start)).padStart(2)} bars  E ${f.e?.toFixed(2)}  lead ${f.lead?.toFixed(2)}  hook ${f.hook?.toFixed(2)}  rep ${f.rep?.toFixed(2)}  drums ${f.perc?.toFixed(2)}  bass ${f.bass?.toFixed(1)}`);
    });
    const key = (t: string) => t.toLowerCase().replace(/[\s\p{P}]/gu, '');
    const group = new Map<string, number>(), count = new Map<string, number>();
    const sung = sungLines(lyrics);
    for (const l of sung) { const k = key(l.text); if (!group.has(k)) group.set(k, group.size); count.set(k, (count.get(k) ?? 0) + 1); }
    if (sung.length) console.log('lines ' + sung.map(l => `${l.start.toFixed(0)}:${group.get(key(l.text))}×${count.get(key(l.text))}`).join(' '));
  }
  let inside = 0;
  for (const sec of secs) if (CLIMAX.has(sec.label)) inside += Math.max(0, Math.min(sec.end, mark[1]) - Math.max(sec.start, mark[0]));
  const cover = inside / Math.max(0.1, mark[1] - mark[0]);
  const starts = secs.filter(sec => CLIMAX.has(sec.label)).map(sec => sec.start);
  let start = NaN;
  for (const st of starts) { const d = barsBetween(a.downbeats, mark[0], st); if (!Number.isFinite(start) || Math.abs(d) < Math.abs(start)) start = d; }
  rows.push({ id, song: names[id] ?? id, mark, cover, start, hit: Number.isFinite(start) && Math.abs(start) <= 1.01, sections: secs.map(sec => [sec.label, +sec.start.toFixed(2), +sec.end.toFixed(2)]), lines: lyrics.length });
  process.stdout.write(`\r${rows.length}/${ids.length}`);
}
const secsTaken = (performance.now() - t0) / 1000;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
const fin = rows.filter(r => Number.isFinite(r.start));
const within = (b: number) => fin.filter(r => Math.abs(r.start) <= b + 0.01).length;
console.log(`\n\n${rows.length} songs (${skipped} skipped), ${secsTaken.toFixed(0)} s${useLyrics ? '' : ', without lyrics'}${useHint ? ', with the mark as chorus hint' : ''}`);
console.log(`cover  mean ${(100 * mean(rows.map(r => r.cover))).toFixed(1)} %   ≥50 % ${rows.filter(r => r.cover >= 0.5).length}   0 % ${rows.filter(r => r.cover === 0).length}`);
console.log(`start  within ½ bar ${within(0.5)}   1 bar ${within(1)}   2 bars ${within(2)}   4 bars ${within(4)}   no chorus/drop at all ${rows.length - fin.length}`);
console.log(`score  ${(100 * mean(rows.map(r => 0.5 * r.cover + 0.5 * (r.hit ? 1 : Math.max(0, 1 - (Math.abs(r.start) - 1) / 3) || 0)))).toFixed(1)}  (half cover, half start: 1 within a bar, falling to 0 at 4)`);
const worst = rows.slice().sort((p, q) => (p.cover + (p.hit ? 1 : 0)) - (q.cover + (q.hit ? 1 : 0))).slice(0, worstN);
console.log(`\nworst ${worst.length}:`);
for (const r of worst) {
  console.log(`${r.id.padStart(10)}  cover ${(100 * r.cover).toFixed(0).padStart(3)} %  start ${Number.isFinite(r.start) ? r.start.toFixed(1).padStart(5) : '    —'} bars  mark ${r.mark[0].toFixed(1)}–${r.mark[1].toFixed(1)}  lines ${r.lines}  ${r.song}`);
  console.log(`            ${r.sections.map(s => `${s[0]}@${s[1].toFixed(1)}`).join(' ')}`);
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(rows, null, 1));
