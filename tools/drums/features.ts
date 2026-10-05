// Candidate drum peaks with features and labels (vs the stem reference) → CSV, for fitting the gates.
//   bun tools/drums/features.ts <name> <encoded audio> <ref.json>   → <name>-kick.csv, <name>-snare.csv (in the cwd)
// (KD / KL / SD override the candidate picking: kick delta, kick local floor, snare delta; OUT prefixes the csv paths.)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { computeSpectra } from '../../src/analysis/spectrum.ts';
import { computeOnsets } from '../../src/analysis/onset.ts';
import { pickPeaks, LATENCY } from '../../src/analysis/hits.ts';
import { analyze } from '../../src/analysis/index.ts';
import { Slicer, quantile } from '../../src/analysis/util.ts';
const FF = 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe', SR = 22050;
const [name, enc, refPath] = process.argv.slice(2);
const raw = enc + '.f32';
if (!existsSync(raw)) Bun.spawnSync([FF, '-v', 'error', '-y', '-i', enc, '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw]);
const b = readFileSync(raw), x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const run = <T,>(g: Generator<number, T, void>): T => { for (;;) { const r = g.next(); if (r.done) return r.value; } };
const sl = new Slicer(Infinity), spec = run(computeSpectra(x, SR, sl, 0, 1)), ons = run(computeOnsets(spec, sl, 0, 1));
const beats = analyze(x, SR, {}).beats;
const full = new Float32Array(spec.power.length); for (let i = 0; i < full.length; i++) full[i] = Math.sqrt(spec.power[i]);
const T = full.length, fps = 100;
const ref = JSON.parse(readFileSync(refPath, 'utf8'));
function gridDist(t: number, div: number): number {
  let lo = 0, hi = beats.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  const p = beats[hi] - beats[lo] || 0.5, ph = (t - beats[lo]) / p * div;
  return Math.abs(ph - Math.round(ph)) / div; // in beats
}
function localLevel(odf: Float32Array, f: number): number {
  const b0 = Math.floor(f / 100), bm: number[] = [];
  for (let q = Math.max(0, b0 - 4); q <= Math.min(Math.floor(T / 100), b0 + 4); q++) { let m = 0; for (let i = q * 100; i < Math.min(T, q * 100 + 100); i++) m = Math.max(m, odf[i]); bm.push(m); }
  bm.sort((a, c) => a - c); return bm[bm.length >> 1] || 1e-9;
}
const out = (kind: 'kick' | 'snare') => {
  const odf = ons[kind], p99 = quantile(odf, 0.99) || 1, fp99 = quantile(ons.flux, 0.99) || 1;
  const sp99 = quantile(ons.snare, 0.99) || 1, kp99 = quantile(ons.kick, 0.99) || 1;
  const level = kind === 'kick' ? ons.lowLevel : ons.highLevel;
  const peaks = kind === 'kick'
    ? pickPeaks(odf, { maxHalf: 3, avgHalf: 10, delta: +(process.env.KD ?? 0.35), minGap: 9, local: 4, localMin: +(process.env.KL ?? 0.5) })
    : pickPeaks(odf, { maxHalf: 3, avgHalf: 10, delta: +(process.env.SD ?? 0.45), minGap: 8 });
  const gt: number[] = (ref[kind] as Array<[number, number]>).map(h => h[0]);
  const other: number[] = (ref[kind === 'kick' ? 'snare' : 'kick'] as Array<[number, number]>).map(h => h[0]);
  const hats: number[] = ((ref.hat ?? []) as Array<[number, number]>).map(h => h[0]);
  const rows = ['t,label,onOther,onHat,odfRel,odfLocal,dominance,decay60,decay150,pre,flux,cross,midHigh,grid4,grid8'];
  for (const f of peaks) {
    const t = f / fps - LATENCY[kind];
    let pk = 0; for (let k = f; k < Math.min(T, f + 5); k++) pk = Math.max(pk, level[k]);
    let pre = 0, n = 0; for (let k = Math.max(0, f - 8); k <= Math.max(0, f - 3); k++) { pre += level[k]; n++; }
    let mid = 0, high = 0; for (let k = Math.max(0, f - 1); k <= Math.min(T - 1, f + 1); k++) { mid = Math.max(mid, ons.snareMid[k]); high = Math.max(high, ons.snareHigh[k]); }
    const near = (arr: number[]) => arr.some(g => Math.abs(g - t) <= 0.05) ? 1 : 0;
    rows.push([t.toFixed(3), near(gt), near(other), near(hats),
      (odf[f] / p99).toFixed(4), (odf[f] / localLevel(odf, f)).toFixed(4), (odf[f] / (full[Math.min(T - 1, f + 2)] || 1e-12)).toFixed(4),
      (level[Math.min(T - 1, f + 6)] / (pk || 1e-12)).toFixed(4), (level[Math.min(T - 1, f + 15)] / (pk || 1e-12)).toFixed(4),
      (pk / ((pre / Math.max(1, n)) || 1e-12)).toFixed(4), (ons.flux[f] / fp99).toFixed(4),
      (kind === 'kick' ? ons.snare[f] / sp99 : Math.max(...Array.from({ length: 7 }, (_, i) => ons.kick[Math.min(T - 1, Math.max(0, f - 2 + i))])) / kp99).toFixed(4), (mid / (high || 1e-12)).toFixed(4),
      gridDist(t, 1).toFixed(4), gridDist(t, 2).toFixed(4)].join(','));
  }
  writeFileSync(`${process.env.OUT ?? ''}${name}-${kind}.csv`, rows.join('\n'));
  console.log(name, kind, 'candidates', peaks.length, 'ref', gt.length, 'candidates on a ref hit', rows.slice(1).filter(r => r.split(',')[1] === '1').length);
};
out('kick'); out('snare');
