// Dev only: the hand-made Clarity analysis (from the Clarity_MV project) in the plugin's Analysis shape,
// so the visuals can be built before the automatic analysis is finished — and compared with it afterwards.
import type { Analysis, Hit, LyricLine, Section, SectionLabel } from '../types.ts';

interface Reference {
  duration: number;
  bpm: number;
  beats: number[];
  tempo: number[];
  downbeats: number[];
  sections: Array<{ name: string; start: number; end: number }>;
  fps: number;
  rms: number[]; low: number[]; mid: number[]; high: number[]; drums: number[];
  onsets: { kick: Hit[]; snare: Hit[]; hat: Hit[]; vocal?: Hit[] };
}

const LABELS: Array<[RegExp, SectionLabel]> = [
  [/^intro/, 'intro'], [/^verse/, 'verse'], [/^pre/, 'build'], [/^chorus/, 'chorus'], [/^drop/, 'drop'],
  [/^break/, 'break'], [/^bridge/, 'bridge'], [/^outro/, 'outro'],
];

export function fromReference(ref: Reference, lyrics: LyricLine[]): Analysis {
  const db = ref.downbeats;
  const beatInBar = ref.beats.map(b => {
    let i = 0;
    while (i + 1 < db.length && db[i + 1] <= b + 1e-3) i++;
    return Math.round((b - db[i]) / ((db[i + 1] ?? db[i] + 2) - db[i]) * 4) % 4;
  });
  const meanRms = (s: number, e: number) => {
    let sum = 0, n = 0;
    for (let i = Math.floor(s * ref.fps); i < Math.min(ref.rms.length, e * ref.fps); i++) { sum += ref.rms[i]; n++; }
    return n ? sum / n : 0;
  };
  const raw = ref.sections.map(s => meanRms(s.start, s.end));
  const top = Math.max(...raw);
  const groups = new Map<string, number>();
  const sections: Section[] = ref.sections.map((s, i) => {
    const base = s.name.replace(/\d+b?$/, '');
    if (!groups.has(base)) groups.set(base, groups.size);
    return {
      start: s.start, end: s.end, label: LABELS.find(([re]) => re.test(s.name))?.[1] ?? 'verse',
      energy: raw[i] / top, group: groups.get(base)!, vocal: lyrics.some(l => l.start < s.end && l.end > s.start),
    };
  });
  const f32 = (a: number[]) => Float32Array.from(a);
  const onset = new Float32Array(ref.drums.length);
  for (let i = 1; i < onset.length; i++) onset[i] = Math.max(0, ref.drums[i] - ref.drums[i - 1]) * 6;
  return {
    version: 0, duration: ref.duration, bpm: ref.bpm, meter: 4,
    beats: ref.beats, beatInBar, tempo: ref.tempo, downbeats: db, sections,
    env: { fps: ref.fps, rms: f32(ref.rms), low: f32(ref.low), mid: f32(ref.mid), high: f32(ref.high), onset },
    hits: { kick: ref.onsets.kick, snare: ref.onsets.snare, hat: ref.onsets.hat, accent: ref.onsets.vocal ?? [] },
  };
}
