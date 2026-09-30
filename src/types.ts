// Contracts shared by analysis, lyrics, the director and the scenes. All times are seconds of song time.

export type SectionLabel = 'intro' | 'verse' | 'pre' | 'chorus' | 'drop' | 'build' | 'break' | 'bridge' | 'outro';
export const SECTION_LABELS: SectionLabel[] = ['intro', 'verse', 'pre', 'chorus', 'drop', 'build', 'break', 'bridge', 'outro'];

export interface Section {
  start: number;
  end: number;
  label: SectionLabel;
  /** Mean loudness, 0..1 relative to the song's loudest section. */
  energy: number;
  /** Sections sharing a group are repeats of the same material. */
  group: number;
  /** Lyrics are sung in this section. */
  vocal: boolean;
}

/** Envelopes sampled at `fps`; each is normalised to 0..1 by its own 99th percentile. */
export interface Envelopes {
  fps: number;
  rms: Float32Array;
  /** < 150 Hz */
  low: Float32Array;
  /** 150–2000 Hz */
  mid: Float32Array;
  /** > 4 kHz */
  high: Float32Array;
  /** Spectral-flux onset strength. */
  onset: Float32Array;
}

/** [time, strength 0..1] */
export type Hit = [number, number];

export interface Analysis {
  version: number;
  duration: number;
  /** Dominant tempo. */
  bpm: number;
  /** Beats per bar (4 for nearly everything). */
  meter: number;
  beats: number[];
  /** Per beat: position in the bar, 0 = downbeat. */
  beatInBar: number[];
  /** Per beat: local BPM. */
  tempo: number[];
  downbeats: number[];
  sections: Section[];
  env: Envelopes;
  hits: { kick: Hit[]; snare: Hit[]; hat: Hit[]; accent: Hit[] };
}

export interface LyricWord {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  words: LyricWord[];
  /** true when word times came from NetEase's word-level lyrics, false when they were spread over the line. */
  timedWords: boolean;
  translation?: string;
  /** Sung wholly in brackets in the lyrics: backing vocals or a vocal chop (the brackets are dropped from the text). */
  backing?: boolean;
}
