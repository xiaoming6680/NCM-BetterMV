import type { Hit } from '../types.ts';
import type { DrumInput } from './beatthis.ts';
import type { Onsets } from './onset.ts';

/** Reject hat-dominated candidates using attack timbre, never tempo or position on a grid. */
export function snareEvidence(hits: Hit[], ons: Onsets, fps: number, ratio: number): Hit[] {
  return hits.filter(([t]) => {
    const f = Math.round(t * fps);
    let mid = 0, high = 0;
    for (let k = Math.max(0, f - 1); k < Math.min(ons.snareMid.length, f + 4); k++) {
      mid += ons.snareMid[k]; high += ons.snareHigh[k];
    }
    return mid > 0 && mid >= ratio * high;
  });
}

/** Model snares plus conservative acoustic attacks it missed. 40 ms merges the two detectors' latency jitter. */
export function mergeSnares(model: Hit[], acoustic: Hit[]): Hit[] {
  const out = [...model];
  for (const h of acoustic) if (!model.some(m => Math.abs(m[0] - h[0]) <= 0.04)) out.push(h);
  return out.sort((a, b) => a[0] - b[0]);
}

/** Validate a worker/cache result before using it. A valid empty transcription is meaningful (a drumless song). */
export function modelDrums(input: DrumInput | undefined, duration: number): DrumInput | null {
  if (!input || !['kick', 'snare', 'hat'].every(k => Array.isArray(input[k as keyof DrumInput]))) return null;
  const clean = (hits: Hit[]): Hit[] => {
    const sorted = hits.filter(h => Array.isArray(h) && Number.isFinite(h[0]) && Number.isFinite(h[1])
      && h[0] >= 0 && h[0] < duration && h[1] > 0).map(h => [h[0], Math.min(1, h[1])] as Hit).sort((a, b) => a[0] - b[0]);
    const out: Hit[] = [];
    for (const h of sorted) {
      const prev = out[out.length - 1];
      if (prev && h[0] - prev[0] < 0.02) { if (h[1] > prev[1]) out[out.length - 1] = h; }
      else out.push(h);
    }
    return out;
  };
  return { kick: clean(input.kick), snare: clean(input.snare), hat: clean(input.hat) };
}
