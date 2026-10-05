// Plugin drum hits vs reference onsets from the separated drum stem.
//   bun tools/drums/compare.ts <encoded audio> <ref.json> [--dump]   (--dump writes <audio>.hits.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { analyze } from '../../src/analysis/index.ts';
const FF = 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe', SR = 22050;
const [enc, refPath] = process.argv.slice(2);
const raw = enc + '.f32';
if (!existsSync(raw)) Bun.spawnSync([FF, '-v', 'error', '-y', '-i', enc, '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw]);
const b = readFileSync(raw), x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const t0 = performance.now();
const a = analyze(x, SR, {});
const ms = performance.now() - t0;
const ref = JSON.parse(readFileSync(refPath, 'utf8')) as Record<string, Array<[number, number]>>;
const TOL = 0.05;
function match(est: number[], gt: number[]) {
  const used = new Set<number>(); const pairs: Array<[number, number]> = [];
  for (const e of est) { let bi = -1, bd = TOL + 1e-9; gt.forEach((g, i) => { const d = Math.abs(g - e); if (d <= bd && !used.has(i)) { bd = d; bi = i; } }); if (bi >= 0) { used.add(bi); pairs.push([e, gt[bi]]); } }
  return { tp: pairs.length, p: pairs.length / Math.max(1, est.length), r: pairs.length / Math.max(1, gt.length), pairs };
}
const f = (m: { p: number; r: number }) => (2 * m.p * m.r) / Math.max(1e-9, m.p + m.r);
const med = (v: number[]) => v.length ? [...v].sort((p, q) => p - q)[v.length >> 1] : NaN;
const fx = (v: number, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';
console.log(`analysis ${ms.toFixed(0)} ms; est kicks ${a.hits.kick.length}, snares ${a.hits.snare.length}, hats ${a.hits.hat.length}, accents ${a.hits.accent?.length ?? 0}; ref kicks ${ref.kick.length}, snares ${ref.snare.length}`);
for (const kind of ['kick', 'snare'] as const) {
  const est = a.hits[kind].map(h => h[0]), gt = ref[kind].map(h => h[0]);
  const m = match(est, gt), clear = match(a.hits[kind].filter(h => h[1] >= 0.25).map(h => h[0]), ref[kind].filter(h => h[1] >= 0.25).map(h => h[0]));
  const other = kind === 'kick' ? 'snare' : 'kick';
  const unmatched = est.filter(e => !m.pairs.some(p => p[0] === e));
  const cross = match(unmatched, ref[other].map(h => h[0]));
  console.log(`${kind.padEnd(5)} P/R/F ${fx(m.p)} / ${fx(m.r)} / ${fx(f(m))}   clear ${fx(clear.p)} / ${fx(clear.r)} / ${fx(f(clear))}   offset est−ref median ${fx(med(m.pairs.map(p => (p[0] - p[1]) * 1000)), 1)} ms   false ${unmatched.length} (of which on a ref ${other}: ${cross.tp})`);
}
console.log('\nper section (est / ref / matched):');
for (const s of a.sections) {
  const inS = (t: number) => t >= s.start && t < s.end;
  const row = (['kick', 'snare'] as const).map(k => {
    const est = a.hits[k].map(h => h[0]).filter(inS), gt = ref[k].map(h => h[0]).filter(inS), m = match(est, gt);
    return `${k} ${String(est.length).padStart(3)}/${String(gt.length).padStart(3)}/${String(m.tp).padStart(3)}`;
  }).join('   ');
  console.log(`${s.label.padEnd(7)} ${fx(s.start, 1).padStart(6)}–${fx(s.end, 1).padEnd(6)} ${row}`);
}
if (process.argv.includes('--dump')) writeFileSync(enc + '.hits.json', JSON.stringify({ hits: a.hits, beats: a.beats, sections: a.sections }));
