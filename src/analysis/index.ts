// Whole-song music analysis for the MV director: beat grid, bars, local tempo, envelopes, drum hits and sections.
// Pure TypeScript, DOM-free, deterministic; runs on the main thread as a generator so the caller can spread the
// work over animation frames (the client blocks Web Workers).
//
// Pipeline: STFT (100 fps) → onset functions → tempogram + Viterbi tempo path → DP beat tracking → constant-tempo
// lock + robust smoothing of the grid → beat features → bar phase / meter → sections → hits and envelopes → the
// tempo as it is cited (the grid's or twice it).
import type { Analysis, Envelopes, LyricLine } from '../types.ts';
import { computeSpectra, FPS } from './spectrum.ts';
import { computeOnsets } from './onset.ts';
import { namedTempo, pathTempo, tempoFactor, tempogram, tempoPath } from './tempo.ts';
import { trackBeats, regularizeBeats, lockConstantTempo, cleanBeats } from './beats.ts';
import { beatThisTempo, downbeatEvidence, onePace, steadyGrid, tidyBeats, usableBeatThis, type BeatThisInput } from './beatthis.ts';
import { beatFeatures } from './features.ts';
import { detectMeter } from './meter.ts';
import { findSections, makeBars } from './sections.ts';
import { detectHits } from './hits.ts';
import { modelDrums, snareEvidence, mergeSnares } from './drums.ts';
import { Slicer, attackRelease, movingAverage, normalizeQuantile, quantile, std } from './util.ts';

export const ANALYSIS_VERSION = 1;
/** Latency (s) of the beat novelty peak against the attack it marks (measured on kick-on-the-beat music). */
export const BEAT_LATENCY = 0.009;

export interface AnalyzeOptions {
  lyrics?: LyricLine[];
  sliceMs?: number /* default 8 */;
  /**
   * Tempo hint (e.g. NetEase's song wiki BPM): usually right but rounded, occasionally wrong. Only used to pick the
   * tempo octave (×½, ×2, …) of the tracked tempo, or its 3∶2 relative when the tempogram backs that; a hint that
   * matches no relative of it is ignored.
   */
  bpmHint?: number;
  /**
   * The song's genres from the same wiki (SongWiki.genres, e.g. "二次元-节奏游戏音乐"): rhythm-game music is shown at
   * its chart's tempo (namedBpm).
   */
  genres?: string[];
  /**
   * NetEase's own chorus mark (/api/song/chorus: the 副歌 it plays as the song's highlight), seconds: on 11 of 12 songs
   * annotated by hand it lies on the chorus or the drop, often starting a beat or a few seconds early. Used only where
   * the sections found have no chorus or drop over it (src/analysis/sections.ts).
   */
  chorusHint?: [number, number];
  /**
   * Beat This!'s beats and probabilities from the aligner pack (src/analysis/beatthis.ts): its probability is added to
   * the novelty, its tempo picks the octave instead of `bpmHint`, and the beats and bars are its own, tidied.
   */
  beatThis?: BeatThisInput;
  /**
   * With beatThis: 'half' (default) keeps one pace per song, fast songs on half their tempo as the plugin's own grid
   * had them (onePace); 'full' keeps every beat Beat This! found, double-time passages included.
   */
  beatLevel?: 'half' | 'full';
}

/** Yields progress 0..1 roughly every sliceMs of work; returns the finished Analysis. */
export function* analyzeSteps(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): Generator<number, Analysis, void> {
  const slicer = new Slicer(opts.sliceMs ?? 8);
  const duration = samples.length / sampleRate;
  const lyrics = opts.lyrics && opts.lyrics.length ? opts.lyrics : undefined;
  // Yield between stages whenever the slice is used up.
  function* pause(p: number): Generator<number, void, void> {
    if (slicer.due()) {
      yield p;
      slicer.resume();
    }
  }
  yield 0;
  slicer.resume();

  const spec = yield* computeSpectra(samples, sampleRate, slicer, 0, 0.7);
  const fps = spec.fps;
  const ons = yield* computeOnsets(spec, slicer, 0.7, 0.76);
  const levelDb = new Float32Array(spec.nFrames);
  for (let i = 0; i < spec.nFrames; i++) levelDb[i] = 10 * Math.log10(spec.power[i] + 1e-12);
  const nov = beatNovelty(ons.flux, ons.low, fps);
  // (Not at all when it held no steady beat anywhere: its probability and tempo would only mislead the tracker.)
  const bt = opts.beatThis && usableBeatThis(opts.beatThis) ? opts.beatThis : undefined;
  if (bt) {
    // Beat This!'s beat probability (at its frame rate) added to the novelty, both in standard deviations.
    const ext = new Float32Array(nov.length), p = bt.beatProb;
    for (let i = 0; i < ext.length; i++) {
      const f = (i / fps) * bt.fps, k = Math.floor(f), r = f - k;
      ext[i] = k + 1 < p.length ? p[k] * (1 - r) + p[k + 1] * r : 0;
    }
    const se = std(ext) || 1, sn = std(nov) || 1;
    for (let i = 0; i < nov.length; i++) nov[i] = nov[i] / sn + ext[i] / se;
  }
  const bpmHint = (bt && beatThisTempo(bt.beats)) || opts.bpmHint;
  yield* pause(0.77);
  const loudW = loudnessWeight(levelDb, fps);
  const tg = yield* tempogram(nov, fps, slicer, 0.77, 0.83, loudW);
  let curve = tempoPath(tg);
  // Octave from the hint; a dotted pulse (drum & bass) moved to the beat.
  const factor = tempoFactor(pathTempo(tg, curve), bpmHint, tg);
  if (factor !== 1) {
    // A path sent to another tempo can settle on a strong peak a fifth of the way off it (4∶5); held closer then.
    const target = pathTempo(tg, curve) * factor;
    curve = tempoPath(tg, target, 0.3);
    if (Math.abs(Math.log(pathTempo(tg, curve) / target)) > Math.log(1.06)) curve = tempoPath(tg, target, 0.12);
  }
  yield* pause(0.84);
  const rawBeats = yield* trackBeats(nov, curve.period, slicer, 0.84, 0.88);
  // Beat times: DP frames minus the novelty's latency against the actual attack.
  const beatsSec = new Float64Array(rawBeats.length);
  for (let i = 0; i < rawBeats.length; i++) beatsSec[i] = rawBeats[i] / fps - BEAT_LATENCY;
  // The lock also carries its grids over stretches where the DP lost them, and moves a grid onto the kicks.
  const locked = lockConstantTempo(beatsSec, {
    nov, kick: ons.kick, weight: loudW, bass: spec.bass, chromaFps: spec.chromaFps, fps, latency: BEAT_LATENCY,
  });
  // Strictly increasing within the song, before and after fitToAudible (which steps by the first / last interval).
  const smooth = cleanBeats(regularizeBeats(locked.beats, locked.regions), duration);
  let beats = cleanBeats(fitToAudible(smooth, levelDb, fps, duration), duration);
  if (beats.length < 8 || quantile(levelDb, 0.95) < -90) beats = fallbackGrid(duration);
  // With Beat This!: its beats, tidied, the stretches it lost filled from these, on one pace.
  const tidy = bt ? tidyBeats(bt, beats) : null;
  let heard = 0;
  if (tidy && bt) {
    heard = dominantTempo(tidy);
    const t = cleanBeats(steadyGrid(opts.beatLevel === 'full' ? tidy : onePace(tidy, bt.downProb, bt.fps, heard)), duration);
    if (t.length >= 8) beats = t;
  }
  const tempoPerBeat = localTempo(beats);
  yield* pause(0.89);

  const feats = beatFeatures(spec, ons, beats);
  yield* pause(0.9);
  const bars = detectMeter(feats, beats, lyrics, tidy && bt ? downbeatEvidence(bt, beats) : undefined);
  const beatInBar = bars.beatInBar;
  const downbeats = beats.filter((_, i) => beatInBar[i] === 0);
  yield* pause(0.91);
  const rmsLin = sqrtArr(spec.power);
  const hits = yield* detectHits(ons, fps, levelDb, rmsLin, beats, slicer, 0.91, 0.95);
  // The pack's drum model, when it ran: its kicks and hats replace the acoustic ones; its snares, with a mid-band
  // attack, join the acoustic snares it missed (docs/RHYTHM.md). Without it the acoustic hits stay as they are.
  const drums = modelDrums(opts.beatThis?.drums, duration);
  if (drums) {
    hits.kick = drums.kick;
    hits.hat = drums.hat;
    // (A song where the model hears no drums at all keeps no snares: the acoustic ones would be guitar and voice.)
    hits.snare = drums.kick.length + drums.snare.length + drums.hat.length
      ? mergeSnares(snareEvidence(drums.snare, ons, fps, 2), snareEvidence(hits.snare, ons, fps, 3)) : [];
  }
  const sections = findSections({ features: feats, beats, bars: makeBars(beats, beatInBar, duration), duration, rms: rmsLin, fps, lyrics, hits, low: spec.low, high: spec.high, chorus: opts.chorusHint });
  yield* pause(0.97);

  // Envelopes: amplitude with a 10 ms attack / 90 ms release follower, each divided by its own 99th percentile.
  const follow = (amp: Float32Array) => normalizeQuantile(attackRelease(amp, fps, 0.01, 0.09));
  const rmsEnv = follow(rmsLin);
  yield* pause(0.975);
  const lowEnv = follow(sqrtArr(spec.low));
  yield* pause(0.98);
  const midEnv = follow(sqrtArr(spec.mid));
  yield* pause(0.985);
  const highEnv = follow(sqrtArr(spec.high));
  yield* pause(0.99);
  const env: Envelopes = { fps, rms: rmsEnv, low: lowEnv, mid: midEnv, high: highEnv, onset: normalizeQuantile(ons.flux) };
  const bpm = dominantTempo(beats);
  let named = namedTempo(bpm, beats, beatInBar, bars.meter, hits.kick, hits.snare, levelDb, fps);
  // Beat This! may hold a half-time pulse the song is cited at twice (a 200 BPM rhythm-game song tracked at 100): with
  // its beats the wiki BPM no longer picks the grid's octave, so it says here when the shown tempo is twice the grid's.
  if (tidy && opts.bpmHint && Math.abs(Math.log(opts.bpmHint / (2 * named))) <= Math.log(1.09)) named *= 2;
  // Paced on half the tempo: shown at the tempo Beat This! heard (the one these songs are cited at).
  if (tidy && heard >= 160 && Math.abs(Math.log(heard / (2 * bpm))) < Math.log(1.06) && named < 1.5 * bpm) named = 2 * bpm;
  // Rhythm-game music (the wiki's 曲风 二次元-节奏游戏音乐) is cited at its chart's tempo, nearly always 150 BPM or more:
  // shown under 125 on one steady tempo, it was followed at half (Retribution ~ Cycle of Redemption ~ on 112.5, its
  // chart 225; Aegleseeker 117, chart 234). A song that changes tempo is left alone (Distorted Fate, 100 then 150).
  if (named < 125 && opts.genres?.some(g => g.includes('节奏游戏')) && steadyShare(beats, bpm) >= 0.8) named *= 2;
  yield 1;
  return {
    version: ANALYSIS_VERSION,
    duration,
    bpm,
    namedBpm: Math.round(named * 1000) / 1000,
    meter: bars.meter,
    drumSource: drums ? 'hybrid' : 'spectral',
    beats: beats.map(round4),
    beatInBar,
    tempo: tempoPerBeat.map(v => Math.round(v * 1000) / 1000),
    downbeats: downbeats.map(round4),
    sections,
    env,
    hits,
  };
}

/** Runs analyzeSteps to completion synchronously. */
export function analyze(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): Analysis {
  const it = analyzeSteps(samples, sampleRate, { ...opts, sliceMs: Infinity });
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

function sqrtArr(a: Float32Array): Float32Array {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = Math.sqrt(a[i]);
  return o;
}

/** Novelty for tempo and beat tracking: full-band flux plus the kick-band flux, high-passed and rectified. */
export function beatNovelty(flux: Float32Array, low: Float32Array, fps: number): Float32Array {
  const n = flux.length, out = new Float32Array(n);
  const sf = std(flux) || 1, sk = std(low) || 1;
  for (let i = 0; i < n; i++) out[i] = flux[i] / sf + low[i] / sk;
  const avg = movingAverage(out, Math.round(fps * 0.5));
  for (let i = 0; i < n; i++) {
    const v = out[i] - avg[i];
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

/** 0..1 per frame: 1 within 12 dB of the song's loud level (95th percentile), 0 at 24 dB below; ±0.5 s smoothing. */
export function loudnessWeight(levelDb: Float32Array, fps: number): Float32Array {
  const n = levelDb.length;
  const ref = quantile(levelDb, 0.95);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.min(1, Math.max(0, (levelDb[i] - (ref - 24)) / 12));
  return movingAverage(w, Math.round(fps * 0.5));
}

/**
 * Fit the grid to the audible part of the song (75 dB under the loud level counts as silence): drop beats in the
 * silence before and after the music, and continue the grid with its own period back to where the music starts and
 * on to where it ends (a first hit at 0 s, a fade-out tail) so the director has beats wherever there is sound.
 */
function fitToAudible(beats: number[], levelDb: Float32Array, fps: number, duration: number): number[] {
  if (beats.length < 5) return beats;
  const ref = quantile(levelDb, 0.95);
  let first = 0, last = levelDb.length - 1;
  while (first < levelDb.length && levelDb[first] < ref - 75) first++;
  while (last > first && levelDb[last] < ref - 75) last--;
  const start = first / fps, end = Math.min(duration, last / fps);
  const head = (beats[4] - beats[0]) / 4, tail = (beats[beats.length - 1] - beats[beats.length - 5]) / 4;
  const out = beats.filter(b => b >= Math.max(0, start - 0.5 * head) && b <= Math.min(duration, end + Math.max(1.5, tail)));
  if (!out.length) return out;
  while (out[0] - head >= Math.max(0, start - 0.25 * head)) out.unshift(out[0] - head);
  while (out[out.length - 1] + tail <= end) out.push(out[out.length - 1] + tail);
  return out;
}

/** A plain 120 BPM grid when there is nothing to track (silence, very short input). */
function fallbackGrid(duration: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < duration; t += 0.5) out.push(t);
  return out.length ? out : [0];
}

/** Per-beat BPM from the (smoothed) beat grid. */
export function localTempo(beats: number[]): number[] {
  const n = beats.length, out = new Array<number>(n);
  if (n < 2) return beats.map(() => 120);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    out[i] = (60 * (b - a)) / (beats[b] - beats[a]);
  }
  return out;
}

/** Tempo that covers the most time: duration-weighted mode of per-beat tempo (1 % bins), refined by averaging. */
/** Share of the beat intervals within 5 % of the tempo `bpm`. */
function steadyShare(beats: number[], bpm: number): number {
  let n = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs((beats[i] - beats[i - 1]) * bpm / 60 - 1) < 0.05) n++;
  return beats.length > 1 ? n / (beats.length - 1) : 0;
}

export function dominantTempo(beats: number[]): number {
  const n = beats.length;
  if (n < 2) return 120;
  const bins = new Map<number, number>();
  for (let i = 0; i + 1 < n; i++) {
    const d = beats[i + 1] - beats[i];
    const k = Math.round(Math.log(60 / d) / Math.log(1.01));
    bins.set(k, (bins.get(k) || 0) + d);
  }
  let bestK = 0, bestW = -1;
  bins.forEach((w, k) => {
    const s = w + 0.5 * ((bins.get(k - 1) || 0) + (bins.get(k + 1) || 0));
    if (s > bestW) { bestW = s; bestK = k; }
  });
  let sw = 0, st = 0;
  for (let i = 0; i + 1 < n; i++) {
    const d = beats[i + 1] - beats[i];
    const k = Math.round(Math.log(60 / d) / Math.log(1.01));
    if (Math.abs(k - bestK) <= 1) { sw += d; st += 1; }
  }
  return st ? Math.round((60 * st * 1000) / sw) / 1000 : 120;
}

export { FPS };
