// Beat This! beats for the eval tools' --beats: the aligner pack's output for an evaluation song, kept in
// dev/eval-pcm/beats/<key>.json by tools/aligner/eval_beats.py (key: the NetEase id of dev/eval-pcm/<id>.s16, or the
// name of dev/eval-pcm/analysis/<key>.f32). Undefined when the song has none (run eval_beats.py first).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BeatThisInput } from '../src/analysis/beatthis.ts';

const DIR = join(import.meta.dir, '..', 'dev/eval-pcm/beats');

export function evalBeats(key: string): BeatThisInput | undefined {
  const f = join(DIR, `${key}.json`);
  if (!existsSync(f)) return undefined;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return { fps: r.fps, beatProb: r.beatProb, downProb: r.downProb, beats: r.beats, downbeats: r.downbeats };
}
