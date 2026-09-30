// Song sections from bar-synchronous features.
// Boundaries: bar self-similarity (chroma, bass chroma, MFCC, loudness, drums, tempo and its slope, sung share) →
// multi-scale checkerboard novelty + loudness/density jumps + lyric cues (singing starts, the repetition class of the
// lines changes, a repeated block of lines starts, the lead singing stops or starts) + the one-bar dip before a loud
// bar + the start of the song's tail, all weighted by loudness → dynamic programming on bars that prefers 8/16-bar
// phrases and sections under ~40 s; a second pass cuts the copies of a repeated block of lines alike.
// Labels come from energy (relative to the loudest section and to the verses), trend, vocals, repeated lyrics and drum
// drive (a drop needs a driving percussive beat); groups join sections with the same label and similar audio or
// shared lyric lines.
import type { Hit, LyricLine, Section, SectionLabel } from '../types.ts';
import { N_MFCC, type BeatFeatures } from './features.ts';
import { lowerBound, quantile } from './util.ts';

export interface Bars {
  /** Beat index where each bar starts. */
  start: number[];
  /** Time of each bar start (s). */
  time: number[];
  /** End of the last bar (s). */
  end: number;
}

export function makeBars(beats: number[], beatInBar: number[], duration: number): Bars {
  const start: number[] = [];
  for (let i = 0; i < beats.length; i++) if (beatInBar[i] === 0) start.push(i);
  const time = start.map(i => beats[i]);
  let end = duration;
  if (start.length) {
    const last = start[start.length - 1];
    const barLen = start.length > 1 ? time[time.length - 1] - time[time.length - 2] : 2;
    end = Math.min(duration, Math.max(beats[beats.length - 1], beats[last] + barLen));
  }
  return { start, time, end };
}

interface BarData {
  nb: number;
  dim: number;
  /** nb × dim standardised, weighted feature vectors. */
  vec: Float64Array;
  db: Float64Array;
  density: Float64Array;
  drums: Float64Array;
}

function barData(f: BeatFeatures, bars: Bars, beats: number[], lyrics: LyricLine[], lowDb: Float64Array, highDb: Float64Array): BarData {
  const nb = bars.start.length;
  const groups: Array<[number, number]> = [];
  // Per-bar features: chroma 12, bass 12, mfcc 12, db, bright, density, kick, snare, hat, low-band and high-band level
  // (z-scored per song), then sung share, tempo and tempo slope on fixed scales.
  const dim = 12 + 12 + (N_MFCC - 1) + 6 + 2 + 3;
  const raw = new Float64Array(nb * dim);
  const db = new Float64Array(nb), density = new Float64Array(nb), drums = new Float64Array(nb), bpm = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    const a = bars.start[j], b = j + 1 < nb ? bars.start[j + 1] : f.n;
    const cnt = Math.max(1, b - a), o = j * dim;
    for (let i = a; i < b; i++) {
      for (let k = 0; k < 12; k++) {
        raw[o + k] += f.chroma[i * 12 + k] / cnt;
        raw[o + 12 + k] += f.bass[i * 12 + k] / cnt;
      }
      for (let k = 1; k < N_MFCC; k++) raw[o + 24 + k - 1] += f.mfcc[i * N_MFCC + k] / cnt;
      raw[o + 36] += f.db[i] / cnt;
      raw[o + 37] += f.bright[i] / cnt;
      raw[o + 38] += f.density[i] / cnt;
      raw[o + 39] += f.kick[i] / cnt;
      raw[o + 40] += f.snare[i] / cnt;
      raw[o + 41] += f.hat[i] / cnt;
    }
    raw[o + 42] = lowDb[j];
    raw[o + 43] = highDb[j];
    db[j] = raw[o + 36];
    density[j] = raw[o + 38];
    drums[j] = raw[o + 39] + raw[o + 40] + raw[o + 41];
    const e = b < beats.length ? beats[b] : beats[beats.length - 1];
    const span = b < beats.length ? b - a : b - 1 - a;
    bpm[j] = span > 0 && e > beats[a] ? (60 * span) / (e - beats[a]) : 0;
  }
  const bpmRef = quantile(bpm.filter(v => v > 0), 0.5) || 120;
  // The bass coming in or dropping out is what most often changes between sections of electronic and pop songs.
  groups.push([0, 12], [12, 24], [24, 36], [36, 42], [42, 44]);
  const weights = [1.0, 0.8, 1.0, 1.2, 1.3];
  const vec = new Float64Array(nb * dim);
  for (let k = 0; k < dim - 3; k++) {
    let m = 0, s = 0;
    for (let j = 0; j < nb; j++) m += raw[j * dim + k];
    m /= Math.max(1, nb);
    for (let j = 0; j < nb; j++) s += (raw[j * dim + k] - m) ** 2;
    s = Math.sqrt(s / Math.max(1, nb - 1)) || 1;
    let g = 0;
    while (g + 1 < groups.length && k >= groups[g][1]) g++;
    const w = weights[g] / Math.sqrt(groups[g][1] - groups[g][0]);
    for (let j = 0; j < nb; j++) vec[j * dim + k] = ((raw[j * dim + k] - m) / s) * w;
  }
  // Tempo and tempo slope on fixed scales (not z-scored, so a steady grid adds nothing): ±1 per 10 % tempo
  // change, and ±1 per 2 %/bar of acceleration (smoothed over ±2 bars, ignoring < 0.7 %/bar of jitter).
  for (let j = 0; j < nb; j++) {
    vec[j * dim + dim - 2] = bpm[j] > 0 ? Math.log(bpm[j] / bpmRef) / Math.log(1.1) : 0;
    const a = Math.max(0, j - 2), b = Math.min(nb - 1, j + 2);
    let slope = b > a && bpm[a] > 0 && bpm[b] > 0 ? Math.log(bpm[b] / bpm[a]) / (b - a) : 0;
    slope = Math.sign(slope) * Math.max(0, Math.abs(slope) - 0.007);
    vec[j * dim + dim - 1] = slope / 0.02;
  }
  // Sung share of each bar (from the lyrics; 0 without them), smoothed over ±1 bar: 0..1.5.
  if (lyrics.length) {
    const cov = sungShare(lyrics, bars, nb);
    for (let j = 0; j < nb; j++) {
      const a = Math.max(0, j - 1), b = Math.min(nb - 1, j + 1);
      let sum = 0;
      for (let q = a; q <= b; q++) sum += cov[q];
      vec[j * dim + dim - 3] = (1.5 * sum) / (b - a + 1);
    }
  }
  return { nb, dim, vec, db, density, drums };
}

/**
 * The lead vocal: sung lines minus vocal chops, the hook cut up over a drop — a repeated line between copies of
 * itself (however long it is held), or a short one (a bar or less) standing more than a bar away from other lines.
 * Sung among other lines, a hook is lead vocal; so are the long, spaced lines of a slow song.
 */
function leadLines(lyrics: LyricLine[], barLen: number): LyricLine[] {
  const counts = new Map<string, number>();
  for (const l of lyrics) counts.set(norm(l.text), (counts.get(norm(l.text)) || 0) + 1);
  const begin = (l: LyricLine) => (l.words.length ? l.words[0].start : l.start);
  const finish = (l: LyricLine) => (l.words.length ? l.words[l.words.length - 1].end : l.end);
  const sorted = lyrics.slice().sort((a, b) => begin(a) - begin(b));
  const same = (i: number, j: number) => j < 0 || j >= sorted.length || norm(sorted[j].text) === norm(sorted[i].text);
  return sorted.filter((l, i) => {
    if ((counts.get(norm(l.text)) || 0) < 2) return true;
    if (same(i, i - 1) && same(i, i + 1)) return false;
    const prevGap = i > 0 ? begin(l) - finish(sorted[i - 1]) : Infinity;
    const nextGap = i + 1 < sorted.length ? begin(sorted[i + 1]) - finish(l) : Infinity;
    const far = (j: number, gap: number) => same(i, j) || gap >= 1.25 * barLen;
    return !(finish(l) - begin(l) <= 1.2 * barLen && far(i - 1, prevGap) && far(i + 1, nextGap));
  });
}

/** Share of each bar covered by sung words (0..1). */
function sungShare(lyrics: LyricLine[], bars: Bars, nb: number): Float64Array {
  const cov = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    const t0 = bars.time[j], t1 = j + 1 < nb ? bars.time[j + 1] : bars.end;
    let c = 0;
    for (const l of lyrics) {
      const ws = l.words.length ? l.words[0].start : l.start, we = l.words.length ? l.words[l.words.length - 1].end : l.end;
      const o = Math.min(we, t1) - Math.max(ws, t0);
      if (o > 0) c += o;
    }
    cov[j] = Math.min(1, c / Math.max(1e-6, t1 - t0));
  }
  return cov;
}

/** Mean power of a band over each bar, in dB (0 for every bar when the band isn't given). */
function bandDb(power: Float32Array | undefined, bars: Bars, nb: number, fps: number): Float64Array {
  const out = new Float64Array(nb);
  if (!power) return out;
  for (let j = 0; j < nb; j++) {
    const a = Math.max(0, Math.floor(bars.time[j] * fps));
    const b = Math.min(power.length, Math.max(a + 1, Math.floor((j + 1 < nb ? bars.time[j + 1] : bars.end) * fps)));
    let s = 0;
    for (let i = a; i < b; i++) s += power[i];
    out[j] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
  }
  return out;
}

function selfSimilarity(d: BarData): Float64Array {
  const { nb, dim, vec } = d;
  const norm = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    let s = 0;
    for (let k = 0; k < dim; k++) s += vec[j * dim + k] ** 2;
    norm[j] = Math.sqrt(s) || 1;
  }
  const S = new Float64Array(nb * nb);
  for (let a = 0; a < nb; a++) {
    for (let b = a; b < nb; b++) {
      let s = 0;
      for (let k = 0; k < dim; k++) s += vec[a * dim + k] * vec[b * dim + k];
      const v = s / (norm[a] * norm[b]);
      S[a * nb + b] = S[b * nb + a] = v;
    }
  }
  return S;
}

/** Foote novelty at each bar boundary j (between bar j−1 and j) with a Gaussian-tapered checkerboard of ±K bars. */
function checkerboard(S: Float64Array, nb: number, K: number): Float64Array {
  const out = new Float64Array(nb + 1);
  const g = new Float64Array(2 * K);
  for (let u = -K; u < K; u++) g[u + K] = Math.exp(-0.5 * ((u + 0.5) / (K * 0.5)) ** 2);
  for (let j = 1; j < nb; j++) {
    let s = 0, w = 0;
    for (let u = -K; u < K; u++) {
      const a = j + u;
      if (a < 0 || a >= nb) continue;
      for (let v = -K; v < K; v++) {
        const b = j + v;
        if (b < 0 || b >= nb) continue;
        const wt = g[u + K] * g[v + K];
        s += ((u < 0) === (v < 0) ? 1 : -1) * wt * S[a * nb + b];
        w += wt;
      }
    }
    out[j] = w > 0 ? s / w : 0;
  }
  return out;
}

function zscore(a: Float64Array): Float64Array {
  let m = 0, s = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length || 1;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  s = Math.sqrt(s / Math.max(1, a.length - 1)) || 1;
  return a.map(v => (v - m) / s);
}

/**
 * Length cost of a section of L bars: phrases of 8 and 16 bars are free, 4/12 cheap, others dearer — but not
 * prohibitive, since a one-bar pick-up or tag makes 7- and 9-bar sections common.
 */
function lengthCost(L: number): number {
  let c = L % 8 === 0 ? 0 : L % 4 === 0 ? 0.25 : L % 2 === 0 ? 0.5 : 0.8;
  if (L < 4) c += 0.5;
  if (L > 16) c += 0.08 * (L - 16);
  return c;
}

const SEGMENT_COST = 2.0;

/** Sections longer than this (s) pay extra, whatever their bar count (16 bars of a slow ballad is a minute). */
const LONG_SECTION_S = 40;
/** Past this length (s) a section starts paying a little per second. */
const PREFERRED_S = 26;

/** Boundary bars (excluding 0 and nb) by DP over bar positions; `time(j)` is the start of bar j (time(nb) = end). */
function chooseBoundaries(nov: Float64Array, nb: number, time: (bar: number) => number): number[] {
  const F = new Float64Array(nb + 1).fill(-Infinity), from = new Int32Array(nb + 1).fill(-1);
  F[0] = 0;
  const maxL = 32;
  for (let j = 1; j <= nb; j++) {
    for (let i = Math.max(0, j - maxL); i < j; i++) {
      if (F[i] === -Infinity) continue;
      const L = j - i;
      if (L < 2 && nb >= 4) continue;
      // Partial phrases at the very start and end are not penalised for odd lengths, only for being short or long.
      let lc = i === 0 || j === nb ? (L < 4 ? 0.8 : 0) + (L > 16 ? 0.08 * (L - 16) : 0) : lengthCost(L);
      // Sections of 15–26 s are the norm; a longer one pays a little per second, and much more past 40 s (so two
      // 8-bar sections of a mid-tempo song aren't read as one 16-bar block).
      const dur = time(j) - time(i);
      lc += 0.05 * Math.max(0, dur - PREFERRED_S) + 0.08 * Math.max(0, dur - LONG_SECTION_S);
      const v = F[i] + (j < nb ? nov[j] : 0) - SEGMENT_COST - lc;
      if (v > F[j]) { F[j] = v; from[j] = i; }
    }
  }
  const cuts: number[] = [];
  for (let j = from[nb]; j > 0; j = from[j]) cuts.push(j);
  return cuts.reverse();
}

export interface SectionInput {
  features: BeatFeatures;
  beats: number[];
  bars: Bars;
  duration: number;
  /** RMS envelope (linear, not normalised) at `fps`. */
  rms: Float32Array;
  fps: number;
  lyrics?: LyricLine[];
  hits?: { kick: Hit[]; snare: Hit[] };
  /** Band power per frame at `fps`: below 150 Hz (the bass and kick) and above 4 kHz (hats, air). */
  low?: Float32Array;
  high?: Float32Array;
}

export function findSections(inp: SectionInput): Section[] {
  const { features, bars, duration, rms, fps } = inp;
  const nb = bars.start.length;
  if (nb < 4) return [single(duration, inp)];
  const lyr = sungLines(inp.lyrics || []);
  const lowDb = bandDb(inp.low, bars, nb, fps), highDb = bandDb(inp.high, bars, nb, fps);
  const d = barData(features, bars, inp.beats, lyr, lowDb, highDb);
  const S = selfSimilarity(d);
  const n4 = checkerboard(S, nb, 4), n8 = checkerboard(S, nb, 8), n2 = checkerboard(S, nb, 2);
  // Loudness weight per bar: fades and near-silence must not create boundaries of their own.
  const ref = quantile(d.db, 0.9);
  const lw = d.db.map(v => Math.min(1, Math.max(0, (v - (ref - 30)) / 12)));
  const dbc = d.db.map(v => Math.max(v, ref - 30));
  // Loudness and density jumps between the 2 bars before and after each boundary.
  const jump = new Float64Array(nb + 1);
  for (let j = 1; j < nb; j++) {
    const a = mean(dbc, j - 2, j), b = mean(dbc, j, j + 2);
    const da = mean(d.density, j - 2, j), dbb = mean(d.density, j, j + 2);
    jump[j] = Math.abs(b - a) / 6 + Math.min(lw[j - 1], lw[j]) * Math.abs(Math.log((dbb + 1e-6) / (da + 1e-6))) / Math.LN2;
  }
  // The bass (and, less, the hats) coming in or dropping out, 2 bars against 2 bars (12 dB of bass → 2).
  const lowRef = quantile(lowDb, 0.9), highRef = quantile(highDb, 0.9);
  const lowC = lowDb.map(v => Math.max(v, lowRef - 30)), highC = highDb.map(v => Math.max(v, highRef - 30));
  const bassJump = new Float64Array(nb + 1), highJump = new Float64Array(nb + 1);
  for (let j = 1; j < nb; j++) {
    bassJump[j] = Math.abs(mean(lowC, j, j + 2) - mean(lowC, j - 2, j)) / 6;
    highJump[j] = Math.abs(mean(highC, j, j + 2) - mean(highC, j - 2, j)) / 8;
  }
  const z4 = zscore(n4), z8 = zscore(n8), z2 = zscore(n2), zj = zscore(jump), zb = zscore(bassJump), zh = zscore(highJump);
  const barLen = quantile(bars.time.slice(1).map((t, j) => t - bars.time[j]), 0.5) || 2;
  // Occurrences of a line closer together than this (s) are one chant, not a returning hook.
  const chantSpan = CHANT_BARS * barLen;
  const cue = lyricCues(lyr, bars, nb, barLen, chantSpan);
  // The lead singing stops (into an instrumental — into the drop when it stays loud) or starts again, 2 bars against
  // 2 bars. Hook lines chopped over a drop don't count as lead singing.
  const lead = leadLines(lyr, barLen);
  const sung = sungShare(lead, bars, nb);
  for (let j = 1; j < nb; j++) {
    const before = mean(sung, j - 2, j), after = mean(sung, j, j + 2);
    // (A last word held into the first bar of the instrumental still counts as stopping. Singing that stops for good —
    // 4 bars at least — while the beat goes on as loud is the chorus handing over to the drop, often with no other
    // change: that alone must be able to open a section. When the first unsung bar is the one-bar gap before the
    // drop, the drop starts after it.)
    if (before >= 0.5 && after <= 0.25) {
      const at = j + 1 < nb && dbc[j] <= Math.min(dbc[j - 1], dbc[j + 1]) - 1.5 && d.db[j + 1] >= ref - 3 ? j + 1 : j;
      cue[at] += mean(dbc, at, at + 2) >= ref - 5 ? (mean(sung, j, j + 4) <= 0.15 ? 3 : 2) : 1.2;
    } else if (before <= 0.15 && after >= 0.5) cue[j] += 1.0;
  }
  // A one-bar dip under both neighbours right before a loud bar: the gap before a drop or a big chorus
  // (1.5 dB → 0, 3.5 dB or more → 2).
  for (let j = 2; j < nb; j++) {
    const dip = Math.min(dbc[j - 2], dbc[j]) - dbc[j - 1];
    if (d.db[j] >= ref - 3) cue[j] += Math.min(2, Math.max(0, dip - 1.5));
  }
  // The start of the tail: the first bar (in the second half) from which the song never gets as loud again as in the
  // 4 bars before it — at least 2 dB under them everywhere, 3 dB on average. An outro that only thins out (the drums
  // or the bass leave) is a small change next to the song's drops and breaks. When the next bar qualifies too (a fade
  // over two bars), both get the cue and the phrase lengths decide.
  const tailAt = (j: number) => {
    const before = mean(dbc, j - 4, j);
    let top = -Infinity;
    for (let q = j; q < nb; q++) top = Math.max(top, dbc[q]);
    return top <= before - 2 && mean(dbc, j, nb) <= before - 3;
  };
  for (let j = Math.max(4, nb >> 1); j < nb - 1; j++) {
    if (!tailAt(j)) continue;
    cue[j] += TAIL_CUE;
    if (j + 2 < nb && tailAt(j + 1)) cue[j + 1] += TAIL_CUE;
    break;
  }
  const nov = new Float64Array(nb + 1);
  for (let j = 1; j < nb; j++) {
    const w = Math.max(lw[j - 1], lw[j]);
    nov[j] = w * (Math.max(0, 0.9 * z4[j] + 0.6 * z8[j] + 0.3 * z2[j] + 1.0 * zj[j] + 1.1 * zb[j] + 0.4 * zh[j]) + cue[j]);
  }
  const time = (bar: number) => (bar <= 0 ? 0 : bar >= nb ? duration : bars.time[bar]);
  let cuts = chooseBoundaries(nov, nb, time);
  // Repeated blocks are cut alike: where a section opens with a block of lines that comes back elsewhere, the same
  // place in the other copies gets a cue, and the boundaries are chosen again. (A second chorus often starts with
  // much less audible change than the first, e.g. after a verse that already dropped the bass.)
  const again = repeatCues(cuts, nov, lyr, bars, nb, chantSpan);
  if (again) {
    for (let j = 1; j < nb; j++) {
      const add = Math.max(lw[j - 1], lw[j]) * again[j];
      nov[j] += add;
      cue[j] += add;
    }
    cuts = chooseBoundaries(nov, nb, time);
  }
  // (Development: tools/eval-analysis.ts can hook in here to print the novelty.)
  (globalThis as { __bmvSectionDebug?: (d: Record<string, ArrayLike<number>>) => void }).__bmvSectionDebug?.({ time: bars.time, nov, cue, z4, z8, zj, zb, zh, lowDb, sung });
  // Section spans in bars → seconds (first section from 0, last to the end of the song).
  const edges = [0].concat(cuts, [nb]);
  const spans: Array<[number, number]> = [];
  for (let k = 0; k + 1 < edges.length; k++) spans.push([edges[k], edges[k + 1]]);
  const secs: Section[] = spans.map(([a, b]) => ({
    start: time(a), end: time(b), label: 'verse' as SectionLabel, energy: 0, group: 0, vocal: false,
  }));
  // Energy: mean linear RMS relative to the loudest section.
  const e = secs.map(s => meanRange(rms, Math.round(s.start * fps), Math.round(s.end * fps)));
  const eMax = Math.max(...e, 1e-12);
  secs.forEach((s, k) => (s.energy = Math.round((e[k] / eMax) * 1000) / 1000));
  const sim = sectionSimilarity(spans, S, nb);
  const info = lyricInfo(secs, lyr, new Set(lead), chantSpan);
  // Drum drive: percussive kicks (+ half the snares) per second (independent of the tempo octave).
  const perc = secs.map(s => {
    const count = (h: Hit[] | undefined) => (h ? h.filter(x => x[0] >= s.start && x[0] < s.end && x[1] >= 0.25).length : 0);
    return (count(inp.hits?.kick) + 0.5 * count(inp.hits?.snare)) / Math.max(1e-6, s.end - s.start);
  });
  // Bass level of each section against the song's full-bass level, dB (0 = full bass, −30 = none).
  const bass = spans.map(([a, b]) => (inp.low ? mean(lowC, a, b) - lowRef : 0));
  // The same for the treble above 4 kHz (hats, cymbals).
  const treble = spans.map(([a, b]) => (inp.high ? mean(highC, a, b) - highRef : 0));
  labelSections(secs, spans, d, info, sim, lyr.length > 0, perc, bass, treble);
  (globalThis as { __bmvSectionInfo?: (d: unknown) => void }).__bmvSectionInfo?.(secs.map((s, k) => ({ start: s.start, label: s.label, e: s.energy, cover: info[k].cover, lead: info[k].leadCover, hook: info[k].hook, rep: info[k].rep, perc: perc[k], bass: bass[k] })));
  assignGroups(secs, info, sim);
  return secs;
}

/**
 * Lyric structure at bar boundaries (1.0): where singing first starts, where the repetition class of the lines
 * changes (verse lines are usually sung once, pre-chorus lines a few times, chorus lines many times), or where a
 * repeated block of lines starts (1.5 for a block of hook lines). A long pause before the line adds 0.5.
 */
function lyricCues(lyrics: LyricLine[], bars: Bars, nb: number, barLen: number, chantSpan: number): Float64Array {
  const cue = new Float64Array(nb + 1);
  if (!lyrics.length) return cue;
  const sung = lyrics
    .map(l => ({ s: l.words.length ? l.words[0].start : l.start, e: l.words.length ? l.words[l.words.length - 1].end : l.end, k: norm(l.text) }))
    .filter(l => l.k)
    .sort((a, b) => a.s - b.s);
  const counts = new Map<string, number>();
  for (const l of sung) counts.set(l.k, (counts.get(l.k) || 0) + 1);
  const cls = (k: string) => {
    const c = counts.get(k) || 0;
    return c <= 1 ? 0 : c <= 3 ? 1 : 2;
  };
  // Starts of repeated blocks: a run of ≥ 2 consecutive lines that recurs elsewhere starts here (the line before
  // differs between the two occurrences) — every chorus, and repeated pre-chorus or verse couplets.
  // A run of one hook line sung over and over (vocal chops in a drop) is not a block: the run must hold at least two
  // different lines. Nor is a line and the next one sung after a long instrumental (a drop) in between: the lines of a
  // block follow each other within BLOCK_GAP_BARS.
  const joined = (i: number) => i + 1 < sung.length && sung[i + 1].s - sung[i].e <= BLOCK_GAP_BARS * barLen;
  const blockStart = new Uint8Array(sung.length);
  for (let a = 0; a < sung.length; a++) {
    for (let b = a + 1; b < sung.length; b++) {
      if (sung[a].k !== sung[b].k || b + 1 >= sung.length || sung[a + 1].k !== sung[b + 1].k || !joined(a) || !joined(b)) continue;
      if (a > 0 && sung[a - 1].k === sung[b - 1].k) continue;
      let distinct = false;
      for (let i = 1; a + i < b && b + i < sung.length && sung[a + i].k === sung[b + i].k && joined(a + i - 1) && joined(b + i - 1); i++) if (sung[a + i].k !== sung[a].k) { distinct = true; break; }
      if (distinct) blockStart[a] = blockStart[b] = 1;
    }
  }
  // The first time a line is sung that comes back later in the song (a chant span or more away), right after two lines
  // sung only once: the verse hands over to the chorus (or its pre-chorus), even where the line after it changes.
  const firstBack = new Uint8Array(sung.length);
  const seen = new Set<string>();
  for (let q = 0; q < sung.length; q++) {
    const k = sung[q].k;
    if (!seen.has(k) && q >= 2 && counts.get(sung[q - 1].k) === 1 && counts.get(sung[q - 2].k) === 1) {
      for (let r = q + 1; r < sung.length; r++) if (sung[r].k === k && sung[r].s - sung[q].s >= chantSpan) { firstBack[q] = 1; break; }
    }
    seen.add(k);
  }
  for (let j = 1; j < nb; j++) {
    const t = bars.time[j];
    const L = j + 1 < nb ? bars.time[j + 1] - t : t - bars.time[j - 1];
    // First line starting at or after the bar (a pick-up up to 0.35 bar early counts).
    let q = 0;
    while (q < sung.length && sung[q].s < t - 0.35 * L) q++;
    if (q >= sung.length || sung[q].s >= t + 0.6 * L) continue;
    const prev = q > 0 ? sung[q - 1] : null;
    let c = 0;
    if (!prev || cls(prev.k) !== cls(sung[q].k)) c = 1;
    // A block of lines sung again elsewhere opens a section (every chorus, a repeated verse); a block that comes
    // back three times or more, or one of hook lines, is almost always the chorus or the drop.
    if (blockStart[q]) c = (counts.get(sung[q].k) || 0) >= 3 || cls(sung[q].k) === 2 ? 2 : 1.5;
    if (firstBack[q]) c = Math.max(c, 2);
    let lastEnd = -Infinity;
    for (let r = 0; r < q; r++) lastEnd = Math.max(lastEnd, sung[r].e);
    if (sung[q].s - lastEnd >= Math.max(2.5, 1.25 * L)) c += 0.5;
    cue[j] = c;
  }
  return cue;
}

/**
 * Cues for cutting repeated blocks alike (null when there are none). For each boundary opened by a line (starting from
 * a quarter bar before to 0.6 bar after it) whose block — that line and the next different one; a doubled line counts
 * once — comes back once or twice at least a chant span away, the bar at the same point of each other copy (within 0.3
 * bar) gets a cue of 0.6 × the boundary's novelty, at most REPEAT_CUE, unless it is a boundary already. (So a clear
 * boundary carries over to a copy where the music changes less, and a weak one hardly does.) A block that comes back
 * more often is a hook sung all through the choruses, where it opens no section in particular.
 */
function repeatCues(cuts: number[], nov: Float64Array, lyrics: LyricLine[], bars: Bars, nb: number, chantSpan: number): Float64Array | null {
  const sung = lyrics
    .map(l => ({ s: l.words.length ? l.words[0].start : l.start, k: norm(l.text) }))
    .filter(l => l.k)
    .sort((a, b) => a.s - b.s);
  // The next line with other words, and whether a line is the first of a run of the same line.
  const nextOther = (i: number) => {
    let j = i + 1;
    while (j < sung.length && sung[j].k === sung[i].k) j++;
    return j < sung.length ? sung[j].k : '';
  };
  const firstOfRun = (i: number) => i === 0 || sung[i - 1].k !== sung[i].k;
  const isCut = new Uint8Array(nb + 1);
  for (const c of cuts) isCut[c] = 1;
  const barLen = (j: number) => (j + 1 < nb ? bars.time[j + 1] - bars.time[j] : bars.end - bars.time[j]);
  let out: Float64Array | null = null;
  for (const c of cuts) {
    const t = bars.time[c], L = barLen(c);
    let q = 0;
    while (q < sung.length && sung[q].s < t - 0.25 * L) q++;
    if (q >= sung.length || sung[q].s > t + 0.6 * L || !firstOfRun(q)) continue;
    const next = nextOther(q);
    if (!next) continue;
    const partners: number[] = [];
    for (let r = 0; r < sung.length; r++) {
      if (r !== q && sung[r].k === sung[q].k && firstOfRun(r) && nextOther(r) === next && Math.abs(sung[r].s - sung[q].s) >= chantSpan) partners.push(r);
    }
    if (!partners.length || partners.length > 2) continue;
    for (const r of partners) {
      const at = sung[r].s + (t - sung[q].s);
      const j = lowerBound(bars.time, at);
      const near = j > 0 && (j >= nb || at - bars.time[j - 1] < bars.time[j] - at) ? j - 1 : j;
      if (near <= 0 || near >= nb || isCut[near] || Math.abs(bars.time[near] - at) > 0.3 * barLen(near)) continue;
      if (!out) out = new Float64Array(nb + 1);
      out[near] = Math.max(out[near], Math.min(REPEAT_CUE, 0.6 * nov[c]));
    }
  }
  return out;
}

function single(duration: number, inp: SectionInput): Section {
  return { start: 0, end: duration, label: 'verse', energy: 1, group: 0, vocal: !!(inp.lyrics && inp.lyrics.length) };
}

function mean(a: Float64Array, from: number, to: number): number {
  from = Math.max(0, from); to = Math.min(a.length, to);
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
}

function meanRange(a: Float32Array, from: number, to: number): number {
  from = Math.max(0, from); to = Math.min(a.length, to);
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
}

/** Diagonal (time-aligned) mean self-similarity of two sections, best whole-bar alignment of the shorter one. */
function sectionSimilarity(spans: Array<[number, number]>, S: Float64Array, nb: number): (p: number, q: number) => number {
  return (p: number, q: number) => {
    const [a0, a1] = spans[p], [b0, b1] = spans[q];
    const la = a1 - a0, lb = b1 - b0, L = Math.min(la, lb);
    if (L <= 0) return -1;
    let best = -1;
    const step = Math.max(1, Math.floor(L / 2));
    for (let sa = 0; sa + L <= la; sa += step) {
      for (let sb = 0; sb + L <= lb; sb += step) {
        let s = 0;
        for (let k = 0; k < L; k++) s += S[(a0 + sa + k) * nb + (b0 + sb + k)];
        best = Math.max(best, s / L);
      }
    }
    return best;
  };
}

interface LyricInfo {
  /** Share of the section covered by sung words. */
  cover: number;
  /** The same for the lead vocal only (without vocal chops, see leadLines). */
  leadCover: number;
  /** Share of the section's lines that are sung at least twice in the song (a chant in one stretch counts once). */
  rep: number;
  /** Mean over the section's lines of min(1, (times the line occurs in the song − 1) / 3): 0 = verse-like, 1 = hook. */
  hook: number;
  /** Share of the section's lines chanted (3 times or more) in one stretch of the song only. */
  chant: number;
  lines: Set<string>;
  /** Its lines sung three times or more across the song (the hook). */
  hookLines: Set<string>;
  /** Lines per second. */
  lineRate: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Sung lines only. A short speaker tag before a colon ("男：…", "女:", "合：", "Rap:", a singer's name — duets mark
 * their lines so) is taken off and the line kept; any other line with a colon is a credit the lyric parser didn't know
 * ("鸣谢：…") and is dropped, with a line continuing it within 1.5 s (only a credit line itself extends that). Bare
 * punctuation is dropped.
 */
export function sungLines(lyrics: LyricLine[]): LyricLine[] {
  const out: LyricLine[] = [];
  let creditAt = -Infinity;
  for (const l of lyrics) {
    const tag = SPEAKER.exec(l.text);
    if (!tag && /[:：]/.test(l.text)) {
      creditAt = l.start;
      continue;
    }
    if (!tag && l.start - creditAt < 1.5) continue;
    // A line sung wholly in brackets is backing vocals or a vocal chop ("（ And I need you like … ）"), not the lead.
    if (l.backing) continue;
    const line = tag ? { ...l, text: l.text.slice(tag[0].length) } : l;
    if (norm(line.text).length > 0) out.push(line);
  }
  return out;
}

/**
 * A speaker tag opening a line: up to 8 characters without spaces (in brackets or not) right before a colon, then the
 * words. (Credits are written "作词 : …", with spaces round the colon.)
 */
const SPEAKER = /^\s*[(（【\[]?[^\s:：()（）【】\[\]]{1,8}[)）】\]]?[:：]\s*(?=[^:：]*[\p{L}\p{N}][^:：]*$)/u;

function lyricInfo(secs: Section[], lyrics: LyricLine[], lead: Set<LyricLine>, chantSpan: number): LyricInfo[] {
  const counts = new Map<string, number>(), first = new Map<string, number>(), last = new Map<string, number>();
  for (const l of lyrics) {
    const k = norm(l.text);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
    first.set(k, Math.min(l.start, first.has(k) ? (first.get(k) as number) : Infinity));
    last.set(k, Math.max(l.start, last.has(k) ? (last.get(k) as number) : -Infinity));
  }
  // A line sung again and again in one stretch only (doubled, or chanted in a bridge or a vamp) is not a hook that comes
  // back: all its occurrences within a chant span count as one. Three or more of them make a chant.
  const chant = new Set<string>();
  counts.forEach((c, k) => {
    if (c > 1 && (last.get(k) as number) - (first.get(k) as number) < chantSpan) {
      counts.set(k, 1);
      if (c >= 3) chant.add(k);
    }
  });
  return secs.map(s => {
    let sung = 0, leadSung = 0, hook = 0, n = 0, rep = 0, ch = 0;
    const lines = new Set<string>(), hookLines = new Set<string>();
    for (const l of lyrics) {
      const k = norm(l.text);
      if (!k) continue;
      const ws = l.words.length ? l.words[0].start : l.start;
      const we = l.words.length ? l.words[l.words.length - 1].end : l.end;
      const o = Math.min(we, s.end) - Math.max(ws, s.start);
      if (o <= 0) continue;
      sung += o;
      if (lead.has(l)) leadSung += o;
      if (o >= 0.5 * (we - ws) || o >= 1) {
        n++;
        hook += Math.min(1, ((counts.get(k) || 1) - 1) / 3);
        if ((counts.get(k) || 0) >= 2) rep++;
        if (chant.has(k)) ch++;
        lines.add(k);
        if ((counts.get(k) || 0) >= 3) hookLines.add(k);
      }
    }
    const len = Math.max(1e-6, s.end - s.start);
    return { cover: sung / len, leadCover: leadSung / len, rep: n ? rep / n : 0, hook: n ? hook / n : 0, chant: n ? ch / n : 0, lines, hookLines, lineRate: n / len };
  });
}

/**
 * Occurrences of a line closer together than this many bars are one chant, not a returning hook (in bars, not seconds:
 * 30 s is 17 bars of a 140 BPM song but 8 of a ballad).
 */
const CHANT_BARS = 12;
/** Two lines with more than this many bars without singing between them don't belong to one block of lines. */
const BLOCK_GAP_BARS = 4;

/**
 * Labels from energy (relative to the loudest section and to the verses), trend, vocals and repeated lyrics:
 * quiet between loud, or a bass-less breakdown between the big sections → break; sung hook lines + more energy than
 * the verses → chorus; loud without (much) singing → drop; rising into a louder section → build (pre when sung), and
 * a short bass-less stretch right before a drop → build even when sung; loud but sung with verse lines → verse; a
 * one-off section late in the song (other music, a chant heard only there, or new lines sung louder or in held
 * notes) → bridge; first / last → intro / outro, with a soft reprise or a short tag before the last one.
 */
function labelSections(
  secs: Section[],
  spans: Array<[number, number]>,
  d: BarData,
  info: LyricInfo[],
  sim: (p: number, q: number) => number,
  hasLyrics: boolean,
  perc: number[],
  bass: number[],
  treble: number[],
): void {
  const n = secs.length;
  const E = secs.map(s => s.energy);
  secs.forEach((s, k) => (s.vocal = info[k].cover >= 0.12));
  const hi = Math.max(0.72, 0.9 * quantile(E, 0.7));
  const high = E.map(e => e >= hi);
  // Verses are sung through and at least 4 bars long (a lull with one stray line doesn't set the verse level).
  const verseLike = secs.map((s, k) => s.vocal && info[k].cover >= 0.3 && info[k].hook < 0.25 && spans[k][1] - spans[k][0] >= 4);
  // Energy of the quietest sung verse-like section in the body of the song (not the intro or the tail).
  const body = E.filter((_, k) => verseLike[k] && k > 0 && k + 1 < n);
  const verseE = body.length ? Math.min(...body) : quantile(E, 0.3);
  const trend = spans.map(([a, b]) => {
    if (b - a < 2) return 0;
    const half = Math.floor((b - a) / 2);
    const db1 = mean(d.db, a, a + half), db2 = mean(d.db, b - half, b);
    const de1 = mean(d.density, a, a + half), de2 = mean(d.density, b - half, b);
    return (db2 - db1) / 3 + Math.log((de2 + 1e-6) / (de1 + 1e-6)) / Math.LN2;
  });
  const labels: Array<SectionLabel | ''> = secs.map(() => '');
  // Driving: dense kicks and snares, or (half-time drops, with few kicks) a beat on full bass.
  const drivenAt = (k: number) => perc[k] >= DROP_DRIVE || (perc[k] >= 0.9 && bass[k] >= -5);
  // A section that only leads into a clearly louder section sung with repeated lines (or a loud sung one): a
  // pre-chorus, not the chorus. (Right before an unsung drop, the sung repeated block is the chorus.)
  const leadIn = (k: number) => k + 1 < n && E[k + 1] >= 1.15 * E[k] && secs[k + 1].vocal && info[k + 1].leadCover >= 0.35 && (high[k + 1] || info[k + 1].rep >= 0.5);
  // The loudest of the two sections on one side of k (so a short build or tail next to it doesn't hide the drop).
  const sideBig = (k: number, dir: number) => {
    let best = -1;
    for (let q = k + dir; q >= 0 && q < n && Math.abs(q - k) <= 2; q += dir) if (best < 0 || E[q] > E[best]) best = q;
    return best;
  };
  // Whether all of a section's lines were sung in an earlier section (false without lines).
  const heard = new Set<string>(), reprise: boolean[] = [];
  for (let k = 0; k < n; k++) {
    let all = info[k].lines.size > 0;
    info[k].lines.forEach(l => { if (!heard.has(l)) all = false; });
    reprise.push(all);
    info[k].lines.forEach(l => heard.add(l));
  }
  // A drop by pass 1's reading: loud, driven, hardly any lead singing.
  const dropLike = (q: number) => q < n && high[q] && drivenAt(q) && info[q].leadCover < 0.35;
  // Pass 1: break, build into a drop, chorus, drop, loud verse.
  for (let k = 0; k < n; k++) {
    const s = secs[k], li = info[k];
    const pe = k > 0 ? E[k - 1] : 0, ne = k + 1 < n ? E[k + 1] : 0;
    // A short stretch that doesn't rise between two louder ones: where the bass drops out, or an unsung lull. (Right
    // before a much louder big section it is the build into it, labelled in pass 2.)
    const intoBig = k + 1 < n && high[k + 1] && E[k + 1] >= 1.3 * E[k];
    const short = k > 0 && k + 1 < n && spans[k][1] - spans[k][0] <= 4 && trend[k] <= 0.15 && !intoBig;
    const bassGap = short && bass[k] < Math.min(bass[k - 1], bass[k + 1]) - 10 && E[k] < 0.85 * Math.min(pe, ne);
    const lull = short && li.leadCover < 0.2 && E[k] < 0.6 * Math.max(pe, ne);
    // A breakdown: 6 bars or more without lead singing where the bass drops out, clearly quieter than the big
    // sections on both sides. (Over it the hook may still echo: a line or two, all heard before.)
    const p2 = sideBig(k, -1), n2 = sideBig(k, 1);
    const breakdown = p2 >= 0 && n2 >= 0 && spans[k][1] - spans[k][0] >= 6 && (li.leadCover < 0.1 || (li.leadCover < 0.35 && reprise[k])) &&
      bass[k] < Math.min(bass[p2], bass[n2]) - 10 && E[k] < 0.8 * Math.min(E[p2], E[n2]);
    // Four bars or less right before a drop, the bass 8 dB or more under the drop's and clearly quieter: the build-up
    // into it, even with a line sung over it (future bass: the bass drops out under a snare roll and a riser while the
    // chorus' last hook line is sung).
    const buildUp = hasLyrics && s.vocal && k > 0 && spans[k][1] - spans[k][0] <= 4 && dropLike(k + 1) && bass[k] <= bass[k + 1] - 8 && E[k + 1] >= 1.15 * E[k];
    if (k > 0 && k + 1 < n && ((E[k] < 0.5 && E[k] < 0.5 * Math.min(pe, ne)) || bassGap || lull || breakdown)) labels[k] = 'break';
    else if (buildUp) labels[k] = 'build';
    // (Loud and driven with only hook chops over it is a drop, handled below.)
    else if (s.vocal && (li.hook >= 0.5 || (li.rep >= 0.75 && !leadIn(k))) && (high[k] || (E[k] >= 1.1 * pe && E[k] >= verseE) || E[k] >= 1.1 * verseE) && !(high[k] && drivenAt(k) && li.leadCover < 0.35)) labels[k] = 'chorus';
    else if (high[k]) {
      const driven = drivenAt(k);
      if (hasLyrics) {
        // Barely sung but loud: a drop, even when the few lines in it are the hook (vocal chops).
        if (li.leadCover < 0.35) labels[k] = driven ? 'drop' : li.hook >= 0.5 ? 'chorus' : k > 0 && k + 1 < n ? 'bridge' : 'verse';
        else if (li.hook >= 0.5) labels[k] = 'chorus';
        else labels[k] = 'verse';
      } else {
        // (Two bars or less right after a drop are its tail, whatever the drums do there.)
        const tail = k > 0 && labels[k - 1] === 'drop' && spans[k][1] - spans[k][0] <= 2;
        labels[k] = (driven && k > 0 && (pe <= 0.8 * E[k] || labels[k - 1] === 'drop')) || tail ? 'drop' : 'chorus';
      }
    }
  }
  // A sung build-up chorus followed by a much louder, not more densely sung chorus-like section: that one is the drop.
  // And a sung section right after a drop, as loud and as driven, is the drop going on with the voice back.
  for (let k = 1; k < n; k++) {
    if (labels[k] === 'chorus' && labels[k - 1] === 'chorus' && high[k] && drivenAt(k) && E[k] >= 1.2 * E[k - 1] && info[k].cover <= info[k - 1].cover) labels[k] = 'drop';
    else if (labels[k] === 'chorus' && labels[k - 1] === 'drop' && E[k] >= 0.9 * E[k - 1] && drivenAt(k)) labels[k] = 'drop';
  }
  // The first section is the intro unless the song opens on its chorus.
  if (n > 1 && labels[0] !== 'chorus') labels[0] = 'intro';
  // Pass 2: build / pre before the big sections, the rest verse or bridge.
  for (let k = 0; k < n; k++) {
    if (labels[k]) continue;
    const next = k + 1 < n ? labels[k + 1] : '';
    const bigNext = k + 1 < n && (next === 'chorus' || next === 'drop') && E[k + 1] > E[k];
    const sung = secs[k].vocal && info[k].leadCover >= 0.3;
    // A pre-chorus follows a verse; the first sung section before a chorus is a verse.
    const preLike = k > 0 && (labels[k - 1] === 'verse' || labels[k - 1] === 'pre');
    // (A short stretch right before a much louder big section is its build-up whatever its own trend.)
    const shortInto = bigNext && spans[k][1] - spans[k][0] <= 4 && E[k + 1] >= 1.3 * E[k];
    if (bigNext && (trend[k] > 0.15 || shortInto) && E[k + 1] >= 1.2 * E[k] && !sung) labels[k] = 'build';
    else if (bigNext && (preLike || (!hasLyrics && trend[k] > 0.15))) labels[k] = 'pre';
    // An instrumental stretch between sung parts: an interlude, not a verse.
    else if (hasLyrics && !secs[k].vocal && k > 0 && k + 1 < n && secs.slice(0, k).some(x => x.vocal) && secs.slice(k + 1).some(x => x.vocal)) labels[k] = 'bridge';
    else labels[k] = 'verse';
  }
  // A sung section right before a chorus, about as loud, already singing the chorus' hook (a line sung three times or
  // more, heard again in that chorus): the chorus has begun. (Not when its lines are mostly sung only once, as in a
  // verse: a verse may open with the hook, e.g. the end of the drop before it.)
  for (let k = n - 2; k >= 0; k--) {
    if (labels[k + 1] !== 'chorus' || (labels[k] !== 'verse' && labels[k] !== 'pre') || !secs[k].vocal || E[k] < 0.8 * E[k + 1] || info[k].hook < 0.25) continue;
    let shared = false;
    info[k].hookLines.forEach(l => { if (info[k + 1].lines.has(l)) shared = true; });
    if (shared) labels[k] = 'chorus';
  }
  // Two bars or less without singing where the drums stop (the hits thin out and the treble falls by 6 dB), right
  // before a breakdown: the breakdown has begun.
  for (let k = n - 2; k >= 1; k--) {
    const stop = perc[k] < 0.5 * perc[k - 1] && treble[k] < treble[k - 1] - 6;
    if (labels[k + 1] === 'break' && spans[k][1] - spans[k][0] <= 2 && info[k].leadCover < 0.2 && stop) labels[k] = 'break';
  }
  // A section sung in a chant heard nowhere else in the song, after the first big section: a bridge, not a verse.
  let seenBig = false;
  for (let k = 0; k + 1 < n; k++) {
    if (seenBig && labels[k] === 'verse' && info[k].chant >= 0.5) labels[k] = 'bridge';
    if (labels[k] === 'chorus' || labels[k] === 'drop') seenBig = true;
  }
  const fresh = (k: number) => {
    let seen = false;
    for (let q = 0; q < k && !seen; q++) info[k].lines.forEach(l => { if (info[q].lines.has(l)) seen = true; });
    return info[k].lines.size > 0 && !seen;
  };
  // Bridge: a verse-like section after at least two separate chorus/drop blocks, unlike every other verse — or sung
  // with lines not heard before, and clearly louder than every verse so far (the climax of a ballad) or in far fewer,
  // longer lines (held notes). (Blocks are separated by at least 4 bars of something else: a 2-bar break inside a drop
  // doesn't make two.)
  let bigBlocks = 0;
  for (let k = 1; k < n - 1; k++) {
    const big = (l: SectionLabel | '') => l === 'chorus' || l === 'drop';
    let q = k - 1;
    while (q > 0 && !big(labels[q]) && spans[q][1] - spans[q][0] < 4) q--;
    if (big(labels[q]) && !big(labels[k]) && spans[k][1] - spans[k][0] >= 4) bigBlocks++;
    if (labels[k] !== 'verse' || bigBlocks < 2) continue;
    let alike = false, louder = true, sparser = true, verses = 0;
    for (let q = 0; q < n; q++) {
      if (q === k || labels[q] !== 'verse') continue;
      if (sim(k, q) >= 0.35) alike = true;
      if (q > k || !secs[q].vocal) continue;
      verses++;
      if (E[k] < 1.1 * E[q]) louder = false;
      if (info[k].lineRate > 0.6 * info[q].lineRate) sparser = false;
    }
    if (!alike || (verses > 0 && fresh(k) && (louder || sparser))) labels[k] = 'bridge';
  }
  // Everything unsung and not loud before the first sung section is still the intro.
  if (hasLyrics) for (let k = 1; k < n && !secs[k].vocal; k++) if (!high[k]) labels[k] = 'intro';
  if (n > 1 && !(labels[0] === 'chorus' && high[0])) labels[0] = 'intro';
  // The tail: after the last chorus or drop, whatever is clearly quieter and has no lead singing (a fade with a few
  // vocal chops) is outro; the last section unless it is loud; and, walking back from there, a soft reprise of lines
  // sung before and a short unsung tag.
  let lastBig = -1;
  labels.forEach((l, k) => { if (l === 'chorus' || l === 'drop') lastBig = k; });
  if (lastBig > 0) for (let k = lastBig + 1; k < n; k++) if (E[k] < 0.7 * E[lastBig] && info[k].leadCover < 0.3) labels[k] = 'outro';
  const last = n - 1;
  if (n > 1 && !(high[last] && E[last] >= 0.8 * E[last - 1])) labels[last] = 'outro';
  if (lastBig > 0 && labels[last] === 'outro') {
    for (let k = last - 1; k > lastBig; k--) {
      if (labels[k] === 'outro') continue;
      const soft = secs[k].vocal && reprise[k] && E[k] < 0.5 * E[lastBig];
      const tag = info[k].leadCover < 0.3 && spans[k][1] - spans[k][0] <= 4;
      if (!soft && !tag) break;
      // (Right after an unsung drop, a short tag is the drop running out, not yet the outro.)
      labels[k] = tag && !soft && k === lastBig + 1 && labels[lastBig] === 'drop' ? 'drop' : 'outro';
    }
  }
  secs.forEach((s, k) => (s.label = labels[k] || 'verse'));
}

/** Groups: same label and (similar audio or shared lyric lines) → the same group; numbered by first appearance. */
function assignGroups(secs: Section[], info: LyricInfo[], sim: (p: number, q: number) => number): void {
  const reps: number[] = [];
  secs.forEach((sec, k) => {
    let bestG = -1, bestS = -Infinity;
    for (let g = 0; g < reps.length; g++) {
      const r = reps[g];
      if (secs[r].label !== sec.label) continue;
      let shared = 0;
      info[k].lines.forEach(l => { if (info[r].lines.has(l)) shared++; });
      const lyr = shared / Math.max(1, Math.min(info[k].lines.size, info[r].lines.size));
      const s = Math.max(sim(k, r), info[k].lines.size && info[r].lines.size ? lyr : -1);
      if (s > bestS) { bestS = s; bestG = g; }
    }
    if (bestG >= 0 && bestS >= GROUP_SIMILARITY) sec.group = bestG;
    else { sec.group = reps.length; reps.push(k); }
  });
}

const GROUP_SIMILARITY = 0.45;
/** Boundary cue where the song's tail begins (see findSections). */
const TAIL_CUE = 3.5;
/** Boundary cue at the same point of another copy of a block of lines that opens a section (see repeatCues). */
const REPEAT_CUE = 2;
/** A drop needs a driving drum beat: at least this many percussive kicks (+ ½ snares) per second. */
const DROP_DRIVE = 1.5;
