// Turns the analysis into shots for a style: which scene, which camera, cut on which beat, how each cut lands.
// With `accelerate`, cuts speed up towards a louder section (bars → single bars → every beat); consecutive
// shots never reuse a camera.
import * as THREE from 'three';
import type { Music } from './music.ts';
import type { LyricTrack } from './lyrics.ts';
import type { FrameCtx, LookId, MvScene, SceneId, Shot } from '../scenes/types.ts';
export type { LookId } from '../scenes/types.ts';
import { clamp01, outExpo, punch, rng, smooth } from '../scenes/types.ts';
import type { Palette } from '../render/palette.ts';
import { defaultFx, type Fx } from '../render/engine.ts';
import { THROUGH_CUT, TransitionKind, type Transition } from '../render/shots.ts';
import { PLATE_LENS } from '../render/lens.ts';
import { MgOverlay } from './overlay.ts';
import { Armillary, type ArmillarySpec } from '../sigil/armillary.ts';
import { SECTION_LABELS, type LyricLine, type Section } from '../types.ts';
import { norm } from './lyrics.ts';
import { STYLES, type Plate, type SongTraits, type Style } from '../style/style.ts';
import { lastIndex } from './music.ts';
import { Accents } from '../scenes/hits.ts';
import { findPushes, findStops, plateTime, stopAt, type Push, type Stop } from './moments.ts';

/**
 * Cut times inside a section, on downbeats or their bar's hit: a shot every `baseBars` (2 bars in loud sections),
 * and `rush`: where the cuts on every beat begin (Infinity: none). A section rising into a louder one speeds up: its
 * last four bars a shot each, its last two cut on every beat (those only change the camera, see planShots).
 */
export function cutTimes(music: Music, style: Style, section: Section, next: Section | undefined): { cuts: number[]; rush: number } {
  const beats = Array.from(music.beats).filter(b => b > section.start + 0.05 && b < section.end - 0.05);
  const downs = Array.from(music.downbeats).filter(d => d > section.start + 0.05 && d < section.end - 0.05);
  const cuts = [section.start];
  const per = style.baseBars(section);
  const hero = style.heroBars?.(section) ?? per;
  const rising = style.accelerate && !!next && next.energy > section.energy + 0.08 && section.label !== 'intro';
  const accelFrom = rising ? Math.max(0, downs.length + 1 - 4) : Infinity;
  const rush = rising && downs.length >= 2 ? downs[downs.length - 2] : Infinity;
  // A cut on a downbeat goes to that bar's hit (the strongest from 0.4 beat before to half a beat after), so it lands
  // on a drum: in a syncopated song the grid's downbeat often has none.
  const barHits = Accents.of(music).barHits();
  const onHit = (d: number) => {
    const beat = 60 / Math.max(40, music.at(d).bpm), i = lastIndex(barHits, d + 0.5 * beat);
    return i >= 0 && barHits[i] >= d - 0.4 * beat && barHits[i] > section.start + 0.12 && barHits[i] < section.end - 0.12 ? barHits[i] : d;
  };
  for (let i = 0; i < downs.length; i++) {
    const n = i + 1;
    // (Not the speeding-up cuts: moved to a hit, one would leave a sliver of a shot.)
    if (n >= accelFrom) cuts.push(downs[i]);
    else if (n >= hero && n % per === 0) cuts.push(onHit(downs[i]));
  }
  if (Number.isFinite(rush)) for (const b of beats) if (b > rush + 0.05 && !cuts.some(c => Math.abs(c - b) < 0.05)) cuts.push(b);
  cuts.sort((a, b) => a - b);
  cuts.push(section.end);
  return { cuts, rush };
}

// (Drops too: they take turns opening on the push tunnel and the spectrum tube, so a song with two drops doesn't
// climax in the same tunnel twice; the user: “高潮段不应该只有推进”.)
const TAKE_TURNS = new Set(['verse', 'chorus', 'break', 'bridge', 'drop']);

/**
 * Plates that hold longer than a shot: how many of the section's cuts one of their shots runs through (the cuts in
 * between are not made). Kinetic type sets each sung line in a layout of its own and needs the time to play it out
 * (the user: “给部分场景的播放时间加长一些，比如叠字”).
 */
const LINGER: Partial<Record<SceneId, number>> = { kinetic: 2 };

/**
 * The plates a section may use once the ones the user turned off (the settings page) are taken out. A section left
 * with none borrows the plates this song's other sections use, then any style's (each borrowing section opening on a
 * different one); only when every plate is off does it keep its own.
 */
function allowed(pool: Plate[], off: ReadonlySet<string>, sections: Section[], index: number, style: Style, song: SongTraits): Plate[] {
  const keep = (list: Plate[]) => list.filter(p => !off.has(p.scene));
  const left = keep(pool);
  if (left.length || !off.size) return left;
  const spare = new Map<SceneId, Plate>();
  const others = Object.values(STYLES).filter(s => s !== style);
  for (const from of [style, ...others]) {
    for (const s of from === style ? sections : SECTION_LABELS.map(label => ({ ...sections[0], label }))) {
      for (const p of keep(from.pool(s, song))) if (!spare.has(p.scene)) spare.set(p.scene, p);
    }
    if (spare.size) break;
  }
  if (!spare.size) return pool;
  const list = [...spare.values()], k = index % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** `off`: plates the user turned off in the settings (the armillary's and the opening's own shots included). */
export function planShots(music: Music, style: Style, songSeed: number, song: SongTraits, off: ReadonlySet<string> = new Set()): Shot[] {
  const shots: Shot[] = [];
  const sections = music.a.sections;
  let prevScene = '', prevVariant = '';
  const used = new Map<string, number>(); // plate -> times used, so the rotation reaches every plate
  const seen = new Map<string, number>(); // label -> sections so far with it
  const barLen = (t: number) => music.barDuration(t);
  /** Shots that only change the camera, cut short at the end of a build (joinRuns). */
  const rushed = new Set<Shot>();
  sections.forEach((section, sectionIndex) => {
    const pool = allowed(style.pool(section, song), off, sections, sectionIndex, style, song);
    const { cuts, rush } = cutTimes(music, style, section, sections[sectionIndex + 1]);
    const random = rng((songSeed ^ (sectionIndex * 2654435761)) >>> 0);
    // Verses, choruses, breaks, bridges and drops take turns opening on their first two plates (the drop's push tunnel
    // and spectrum tube…); the others always open on their signature (the build's tunnel…).
    const nth = seen.get(section.label) ?? 0;
    seen.set(section.label, nth + 1);
    const hero = pool[TAKE_TURNS.has(section.label) ? nth % Math.min(2, pool.length) : 0];
    let plate = hero;
    // Plates shown in this section so far: a section goes round its whole pool before it shows one twice (the drop's
    // push tunnel, the least used across the song since only drops have it, used to come back mid-drop for another
    // four bars — 40 % of every drop).
    const here = new Map<string, number>([[hero.scene, 1]]);
    /** Cuts the shot on screen still runs through (LINGER). */
    let lingering = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] < 0.12) continue;
      // The speeding-up cuts at the end of a build keep the plate and only change the camera (as does a shot
      // shorter than a bar).
      const short = cuts[i] >= rush - 1e-3 || cuts[i + 1] - cuts[i] < barLen(cuts[i]) * 0.9;
      const last = shots[shots.length - 1];
      if (i > 0 && !short && lingering > 0 && last && last.sectionIndex === sectionIndex && last.end === cuts[i]) {
        last.end = cuts[i + 1];
        lingering--;
        continue;
      }
      if (i === 0) plate = hero; // a section opens on its hero plate
      else if (!short) {
        // The plate least used in this section, then in the song, that isn't the one just shown; ties broken by the
        // seeded shuffle.
        const order = pool.map(p => ({ p, r: random() }))
          .filter(o => pool.length === 1 || o.p.scene !== prevScene)
          .sort((a, b) => (here.get(a.p.scene) ?? 0) - (here.get(b.p.scene) ?? 0) || (used.get(a.p.scene) ?? 0) - (used.get(b.p.scene) ?? 0) || a.r - b.r);
        plate = order.length ? order[0].p : pool[0];
        here.set(plate.scene, (here.get(plate.scene) ?? 0) + 1);
      }
      const variants = plate.variants;
      let variant = variants[Math.floor(random() * variants.length)];
      if (plate.scene === prevScene && variant === prevVariant && variants.length > 1) variant = variants[(variants.indexOf(variant) + 1) % variants.length];
      used.set(plate.scene, (used.get(plate.scene) ?? 0) + 1);
      prevScene = plate.scene;
      prevVariant = variant;
      const shot: Shot = { scene: plate.scene, start: cuts[i], end: cuts[i + 1], section, sectionIndex, variant, seed: (songSeed * 131 + shots.length * 7919) >>> 0 };
      if (short && i > 0) rushed.add(shot);
      else lingering = (LINGER[plate.scene] ?? 1) - 1;
      shots.push(shot);
    }
  });
  joinRuns(shots, rushed);
  // Most plays end on the canvas rising over the cover this song has painted; the others on the armillary closing up
  // (under ink the canvas is a brush writing the cover on rice paper, and there is no armillary).
  const finale = !off.has('canvas') && rng((songSeed ^ 0xf1a1e) >>> 0)() < 0.6;
  if (!off.has('crystal')) placeArmillary(shots, music, style, songSeed, !finale);
  if (finale) placeFinale(shots, music, songSeed);
  return off.has('cards') ? shots : placeOpening(shots, music, songSeed);
}

/**
 * The speeding-up cuts at the end of a build keep the plate and change only the camera, and each shot used to start
 * its camera move afresh: the same move replayed on every beat, which the user saw as a twitch (“快速循环一个动作，看起来
 * 就和抽搐了一样”; the outro of a two-bar build cut eight times onto the one camera its plate has). Now consecutive
 * shots that would look the same (same plate and camera, same kind of section, one of them under a bar) are one shot,
 * and a run of shorter shots on one plate shares one clock for its moves (Shot.run). `rushed`: the shots cut short
 * (the speeding-up cuts of a build, a shot under a bar), which only change the camera.
 */
function joinRuns(shots: Shot[], rushed: ReadonlySet<Shot>): void {
  const short = (s: Shot) => rushed.has(s);
  // (Whether a shot was cut short, kept through the merging.)
  const hurried = shots.map(short);
  for (let i = shots.length - 1; i > 0; i--) {
    const a = shots[i - 1], b = shots[i];
    if (a.scene === b.scene && a.variant === b.variant && a.section.label === b.section.label && (hurried[i - 1] || hurried[i])) {
      a.end = b.end;
      hurried[i - 1] = true;
      shots.splice(i, 1);
      hurried.splice(i, 1);
    }
  }
  for (let i = 0; i < shots.length;) {
    let j = i + 1;
    while (j < shots.length && shots[j].scene === shots[i].scene && shots[j].section === shots[i].section && short(shots[j])) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) shots[k].run = { start: shots[i].start, end: shots[j - 1].end };
    i = j;
  }
}

/**
 * The opening cards over the intro's first two bars (one bar if that is all there is before anything else starts);
 * none when the song opens straight into something else.
 */
function placeOpening(shots: Shot[], music: Music, songSeed: number): Shot[] {
  const first = music.a.sections[0], downs = music.downbeats;
  if (!first || first.label !== 'intro' || !shots.length) return shots;
  const inIntro = Array.from(downs).filter(d => d > 0.3 && d <= first.end + 0.05);
  const end = inIntro.length >= 3 ? inIntro[2] : inIntro.length >= 2 ? inIntro[1] : NaN;
  if (!(end > 1.5)) return shots;
  const out: Shot[] = [{ scene: 'cards', start: 0, end, section: first, sectionIndex: 0, variant: 'stack', seed: (songSeed * 131 + 7) >>> 0 }];
  // (What is left of a shot the cards cut into, under SLIVER seconds, goes to the shot after it.)
  let early = false;
  shots.forEach((s, k) => {
    if (s.end <= end + 1e-3) return;
    const next = shots[k + 1];
    if (s.start < end && s.end - end < SLIVER && next && next.section === s.section) { early = true; return; }
    out.push(s.start < end || early ? { ...s, start: end } : s);
    early = false;
  });
  return out;
}

/**
 * The song's armillary gets two shots of its own (scene id 'crystal', the figure it replaced): the last bar or two
 * before each drop (bullet time round it, then the push down its rings, in the styles that punch into drops), and
 * the song's last bars (its rings closing up; not in ink, whose paper it would black out).
 */
/** Seconds under which what a carved-in shot leaves of another goes to its neighbour: a cut so soon reads as a flash. */
const SLIVER = 1.2;
/** Shots that keep their own timing (never lengthened to take in a sliver). */
const TIMED: ReadonlySet<SceneId> = new Set<SceneId>(['cards', 'crystal', 'canvas']);

/**
 * When the closing fade runs: it ends where the sound does (the last moment within 40 dB of the song's loud level: a
 * file often ends in seconds of silence) and takes the 3 seconds before it, or a tenth of a short song.
 */
function endFade(music: Music): [number, number] {
  const { rms, fps } = music.a.env, n = rms.length;
  let to = music.duration;
  if (n) {
    const sorted = Float32Array.from(rms).sort(), loud = sorted[Math.floor(0.95 * (n - 1))];
    let k = n - 1;
    while (k > 0 && rms[k] < loud * 0.01) k--;
    to = Math.min(music.duration, (k + 1) / fps);
  }
  const len = Math.min(3, Math.max(0.5, 0.1 * to));
  return [to - len, to];
}

/** Puts a shot of its own over [from, to), trimming the shots it overlaps. (Also the films' cuts, film/reel.ts.) */
export function carve(shots: Shot[], music: Music, scene: SceneId, from: number, to: number, sectionIndex: number, variant: string, songSeed: number): void {
  if (to - from < 0.8) return;
  const out: Shot[] = [];
  for (const s of shots) {
    if (s.end <= from + 1e-3 || s.start >= to - 1e-3) { out.push(s); continue; }
    // Shots overlapping the new one keep what lies outside it; a sliver before it goes to the shot before.
    const prev = out[out.length - 1];
    if (s.start < from - 0.05 && from - s.start < SLIVER && prev && Math.abs(prev.end - s.start) < 1e-3 && prev.section === s.section && !TIMED.has(prev.scene)) prev.end = from;
    else if (s.start < from - 0.05) out.push({ ...s, end: from });
    if (s.end > to + 0.05) out.push({ ...s, start: to });
  }
  out.push({ scene, start: from, end: to, section: music.a.sections[sectionIndex], sectionIndex, variant, seed: (songSeed * 131 + Math.round(from * 1000)) >>> 0 });
  out.sort((a, b) => a.start - b.start);
  shots.length = 0;
  shots.push(...out);
}

/**
 * The canvas over the end of the song: from the start of a closing outro (if it is between 6 and 45 seconds long),
 * else the last 12 seconds or so, in one shot — the brush finishes and the camera rises over the whole picture.
 */
function placeFinale(shots: Shot[], music: Music, songSeed: number): void {
  const sections = music.a.sections, downs = music.downbeats;
  if (!sections.length) return;
  const end = sections[sections.length - 1].end, outro = music.ending;
  const from = Number.isFinite(outro) && end - outro >= 6 && end - outro <= 45 ? outro : downs[Math.max(0, lastIndex(downs, end - 12))] ?? end - 12;
  const si = Math.max(0, sections.findIndex(s => from >= s.start - 0.05 && from < s.end));
  const variants = ['chase', 'high', 'side'];
  carve(shots, music, 'canvas', from, end, si, variants[Math.floor(rng((songSeed ^ 0xca5) >>> 0)() * variants.length)], songSeed);
}

/** `ending`: the armillary also closes up over the last bars (not when the canvas closes the song). */
function placeArmillary(shots: Shot[], music: Music, style: Style, songSeed: number, ending = true): Shot[] {
  const sections = music.a.sections, downs = music.downbeats;
  const armillary = (from: number, to: number, sectionIndex: number, variant: string) => carve(shots, music, 'crystal', from, to, sectionIndex, variant, songSeed);
  if (style.transitions.dropPunch) {
    sections.forEach((s, i) => {
      const next = sections[i + 1];
      if (!next || next.label !== 'drop' || s.label === 'drop') return;
      const last = lastIndex(downs, s.end - 0.1);
      if (last < 0 || downs[last] <= s.start + 0.1) return; // a section of one bar keeps its own
      // The run-in (line up, step back, push in) takes two bars, unless one bar is already long.
      const two = last > 0 && downs[last - 1] > s.start + 0.1 && s.end - downs[last] < 3;
      armillary(downs[two ? last - 1 : last], s.end, i, 'orbit');
    });
  }
  if (ending && style.id !== 'ink' && sections.length) {
    const end = sections[sections.length - 1].end, bars = downs.length >= 5 ? 4 : 2;
    const from = downs[Math.max(0, lastIndex(downs, end - 0.1) - bars + 1)];
    const si = Math.max(0, sections.findIndex(s => from >= s.start && from < s.end));
    if (from !== undefined && end - from > 2) armillary(from, end, si, 'gather');
  }
  return shots;
}

/**
 * How a shot comes in: a transition from the one before (kind 0 = a cut), how long it runs before and after the cut
 * (seconds; only the ones that carry motion through the cut start before it), its shape and how far it moves.
 */
interface Cut { kind: TransitionKind | 0; pre: number; post: number; center: [number, number]; angle: number; amount: number; whip: [number, number] }

/**
 * Stutters: where the singer chops a word and repeats it three times or more, each short (≤ 0.45 s), or sings the
 * same short line twice or more back to back. From the second time on each repeat flashes back to the moment of the
 * first (see Director.flashback). [start, end, repeat length], seconds.
 */
function findStutters(lines: LyricLine[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const l of lines) {
    const w = l.words;
    for (let i = 0; i < w.length;) {
      let j = i + 1;
      while (j < w.length && norm(w[j].text) === norm(w[i].text) && w[j].end - w[j].start <= 0.45) j++;
      if (j - i >= 3 && w[i].end - w[i].start <= 0.45 && norm(w[i].text)) {
        const u = (w[j - 1].start - w[i].start) / (j - 1 - i);
        if (u > 0.08) out.push([w[i].start, w[j - 1].end, u]);
      }
      i = j;
    }
  }
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    const short = (k: number) => lines[k].end - lines[k].start <= 1.5;
    while (j < lines.length && short(i) && short(j) && norm(lines[j].text) === norm(lines[i].text) && lines[j].start - lines[j - 1].end <= 0.35) j++;
    if (j - i >= 2) out.push([lines[i].start, lines[j - 1].end, (lines[j - 1].start - lines[i].start) / (j - 1 - i)]);
    i = j;
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Which sections are redrawn in another medium (src/render/looks.ts), so the song doesn't stay in one world. The
 * first verse and chorus keep the plates' own look (the song establishes itself); later verses and choruses, the
 * bridges and breaks, sometimes the intro and a later build, change medium. Never the drops (the push tunnel is the
 * climax), the ink style (its paper is its medium) or two sections in a row in the same look. Ballads only print
 * (riso), and less often; no look more than twice in a song. `off`: looks the user turned off.
 */
export function planLooks(sections: Section[], style: Style, songSeed: number, off: ReadonlySet<string> = new Set()): Array<LookId | null> {
  const out: Array<LookId | null> = sections.map(() => null);
  if (style.id === 'ink') return out;
  const random = rng((songSeed ^ 0x3c6ef372) >>> 0);
  const ballad = style.look === 'ballad';
  const seen = new Map<string, number>();
  let prev: LookId | null = null;
  const count = new Map<LookId, number>();
  sections.forEach((s, i) => {
    const nth = seen.get(s.label) ?? 0;
    seen.set(s.label, nth + 1);
    let options: LookId[] = [], chance = 0;
    switch (s.label) {
      case 'intro': options = ['hibit', 'ascii', 'vhs']; chance = i === 0 ? 0.45 : 0; break;
      case 'verse': options = ['riso', 'hibit']; chance = nth >= 1 ? 0.85 : 0; break;
      case 'chorus': options = ['hibit', 'riso']; chance = nth >= 1 ? 0.6 : 0; break;
      case 'bridge': case 'break': options = ['ascii', 'riso', 'vhs']; chance = 0.85; break;
      case 'build': case 'pre': options = ['ascii']; chance = nth >= 1 ? 0.5 : 0; break;
      case 'outro': options = ['riso', 'vhs']; chance = 0.35; break;
    }
    // (A ballad: only the print and the tape, the tape for its openings, bridges and endings.)
    if (ballad) { options = options.filter(o => o === 'riso' || o === 'vhs'); chance *= 0.7; }
    options = options.filter(o => !off.has(o) && o !== prev && (count.get(o) ?? 0) < 2);
    const roll = random(), pick = random();
    const look = options.length && roll < chance ? options[Math.floor(pick * options.length)] : null;
    if (look) count.set(look, (count.get(look) ?? 0) + 1);
    out[i] = look;
    prev = look;
  });
  return out;
}

/**
 * Plates that get the tube without the characters: the ones that print their words into their own surface
 * (LyricLayer; the words can't be drawn apart), and the soft ones that fill the frame with haze (clouds, bokeh), which
 * characters turn into a wall of the same glyph.
 */
const NO_CHARACTERS: ReadonlySet<SceneId> = new Set<SceneId>(['flip', 'halftone', 'shatter', 'ink', 'clouds', 'bokeh']);

/**
 * Where the picture goes to letterbox (2.39:1 bars in the cover's ink, under the overlay): the opening and the end of
 * a song, and its pauses — a ballad's bridge, the other styles' breaks. Neighbouring sections run together.
 */
function letterboxed(music: Music, style: Style): Array<[number, number]> {
  // (Ink first: it is drawn with the ballad look too, and used to fall into the ballad's bridges.)
  const labels = style.id === 'ink' ? ['intro', 'outro'] : style.look === 'ballad' ? ['intro', 'bridge', 'outro'] : ['intro', 'break', 'outro'];
  const out: Array<[number, number]> = [];
  for (const s of music.a.sections) {
    if (!labels.includes(s.label)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s.start) < 0.05) last[1] = s.end;
    else out.push([s.start, s.end]);
  }
  return out;
}

/** Plates that show the cover itself large (its white is the picture's white; the canvas paints it). */
const COVER_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['flip', 'shatter', 'align', 'canvas']);

const { zoom, spin, whip } = TransitionKind;
/**
 * The way each plate moves, so a cut carries its motion on into the next shot: flights push on through, turning
 * plates spin on, flat pages whip across.
 */
const MOTION: Record<SceneId, TransitionKind[]> = {
  tunnel: [zoom], drive: [zoom], relief: [zoom], bokeh: [zoom], particles: [zoom, spin],
  kaleido: [spin], rings: [spin], shatter: [spin, zoom], flip: [whip, spin],
  poster: [whip], halftone: [whip, zoom], ridges: [whip, zoom], diorama: [whip, zoom], ink: [TransitionKind.ink],
  crystal: [zoom, spin], cards: [zoom], debug: [whip, zoom], scope: [zoom, whip], subdivide: [spin, zoom], align: [whip, spin],
  vinyl: [spin, zoom], clouds: [zoom], city: [zoom], aurora: [zoom], canvas: [zoom], pillars: [spin, zoom],
  ripple: [spin, zoom], channel: [zoom], orb: [spin, zoom],
  menger: [zoom], sierpinski: [zoom], cantor: [zoom], papercut: [spin, zoom], rain: [TransitionKind.matte, zoom], lanterns: [zoom], neon: [zoom, whip], kinetic: [whip], blackhole: [spin, zoom], cubes: [zoom, spin], dots: [whip, zoom],
};
const SOFT: TransitionKind[] = [zoom, TransitionKind.matte, TransitionKind.iris, spin];

export interface Frame {
  scene: MvScene;
  fx: Fx;
  shot: Shot;
  transition: Transition | null;
}

export class Director {
  private starts: Float64Array;
  private cuts: Cut[];
  readonly overlay: MgOverlay;
  /** The song's armillary as the overlay's badge (its notation goes on the HUD). */
  readonly sigil: Armillary | null;
  constructor(
    readonly style: Style,
    readonly shots: Shot[],
    readonly scenes: Partial<Record<SceneId, MvScene>>,
    readonly music: Music,
    readonly lyrics: LyricTrack,
    readonly palette: Palette,
    sigil?: ArmillarySpec,
    cover?: THREE.Texture,
    /**
     * Nothing over the plates' own picture: no flashes, punches, glitches or whips at the cuts, no blackout before a
     * drop, no post-effect moments, only the song's name in the overlay (oscilloscope music, where the picture is the
     * song's own and anything laid over it spoils it).
     */
    readonly pure = false,
    /** Each section's look (planLooks). */
    readonly looks: Array<LookId | null> = [],
  ) {
    this.starts = Float64Array.from(shots, s => s.start);
    // Each plate's lens (depth of field, motion blur), read by the engine's ShotPass off its scene.
    for (const [id, s] of Object.entries(scenes)) if (s) s.scene.userData.lens = PLATE_LENS[id as SceneId];
    this.cuts = this.planCuts();
    this.sigil = sigil && cover ? new Armillary(sigil, palette, cover) : null;
    this.overlay = new MgOverlay(palette, style, music, this.sigil);
    this.overlay.quiet = pure;
    this.stutters = findStutters(lyrics.lines);
    this.boxes = pure ? [] : letterboxed(music, style);
    this.snares = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.6), h => h[0]);
    this.endFade = endFade(music);
    this.stops = pure ? [] : findStops(music);
    this.pushes = pure ? [] : findPushes(music, this.stops);
    this.pushTimes = Float64Array.from(this.pushes, p => p.at);
  }

  /** Where the sound falls off a cliff and the plates' time stands still (moments.ts). */
  readonly stops: Stop[];
  /** Spikes that push the frame in (moments.ts), and the stops' ends. */
  readonly pushes: Push[];
  private pushTimes: Float64Array;
  /** The cameras pushed in last frame: their zoom is put back before the next. */
  private zoomed = new Set<THREE.PerspectiveCamera>();

  /** Stretches of the song in letterbox (letterboxed). */
  private boxes: Array<[number, number]>;
  private snares: Float64Array;
  /** The picture fades to ink over [from, to): the song's last few seconds of sound (endFade). */
  private endFade: [number, number];
  private stutters: Array<[number, number, number]>;
  /** The stutter whose first moment the engine holds for its flashbacks (−1: none). */
  private remembered = -1;

  shotAt(t: number): Shot {
    return this.shots[Math.max(0, lastIndex(this.starts, t))];
  }

  /**
   * One transition per cut, decided up front so a frame is a pure function of t. Cuts flow: the ones inside a
   * section carry the outgoing plate's own motion on through the cut (a flight pushes on through, a turning plate
   * spins on, a flat page whips across), starting half their length before the beat so they move fastest on it.
   * Pulse: into a louder section a shape grows from the middle (a drop keeps its blackout and punch), except out of
   * the armillary's and the tunnel's run-ins, which push on through into the next plate; other section
   * changes pass through the cover's shapes or carry on moving; the speeding-up cuts before a big section stay hard.
   * Ballad: the same moves, slower and shorter, and sections flow into each other instead of dipping to ink.
   * A cut that stays on the same plate (only the camera changes) whips the camera instead.
   */
  private planCuts(): Cut[] {
    const out: Cut[] = [];
    let last: TransitionKind | 0 = 0;
    const ballad = this.style.look === 'ballad';
    const tr = this.style.transitions;
    this.shots.forEach((shot, i) => {
      const random = rng((shot.seed ^ 0x5bd1e995) >>> 0);
      const beat = this.music.visual.beatDuration(shot.start + 0.01);
      const cut: Cut = { kind: 0, pre: 0, post: 0, center: [0.5, 0.5], angle: 0, amount: ballad ? 0.45 : 1, whip: [0, 0] };
      const prev = this.shots[i - 1];
      out.push(cut);
      if (!prev) return;
      const hurried = prev.end - prev.start < this.music.barDuration(prev.start) * 0.9;
      if (prev.scene === shot.scene) {
        // (The speeding-up cuts of a build stay hard: a whip on every beat would blur them into mush.)
        if (!hurried) {
          const a = random() * Math.PI * 2;
          cut.whip = [Math.cos(a), Math.sin(a) * 0.6];
        }
        return;
      }
      const changes = prev.section !== shot.section;
      const louder = changes && shot.section.energy > prev.section.energy + 0.1;
      const pick = (from: TransitionKind[]) => {
        const choices = from.filter(k => k !== last);
        return choices.length ? choices[Math.floor(random() * choices.length)] : from[0];
      };
      // The outgoing plate's own way of moving most of the time, now and then another.
      const moving = () => pick(random() < 0.75 ? MOTION[prev.scene] : [zoom, spin, whip]);
      /** Beats a transition runs; the moving ones are split evenly around the cut. */
      const run = (kind: TransitionKind, beats: number) => {
        cut.kind = kind;
        if (THROUGH_CUT.has(kind)) cut.pre = cut.post = (beat * beats) / 2;
        else cut.post = beat * beats;
      };
      if (ballad) {
        if (changes) run(tr.between ?? (random() < 0.5 ? TransitionKind.matte : zoom), 2);
        else run(pick(tr.within ?? SOFT), 1.5);
      } else if (changes) {
        // Out of the armillary's push down its rings, the lens flies on through into the drop's plate (half a beat
        // either side of the drop's first beat): the push goes on into the drop instead of stopping at a cut. So out
        // of the tunnel's whip into a louder section (tunnel.ts: it used to open onto the cover rushing at the camera;
        // the user wanted the push to carry on into the next plate).
        const armPush = shot.section.label === 'drop' && prev.scene === 'crystal' && prev.variant === 'orbit';
        const tunnelPush = prev.scene === 'tunnel' && shot.section.energy > prev.section.energy + 0.08;
        if (armPush || tunnelPush) { run(zoom, 1); last = zoom; return; }
        if (shot.section.label === 'drop') return;
        if (louder) run(random() < 0.5 ? TransitionKind.iris : TransitionKind.triangle, 0.5);
        else if (tr.between) run(tr.between, 1);
        else run(random() < 0.5 ? TransitionKind.matte : moving(), 1);
      } else {
        if (hurried) return; // the speeding-up cuts stay hard
        const k = tr.within ? pick(tr.within) : moving();
        run(k, THROUGH_CUT.has(k) ? (shot.section.energy > 0.8 ? 0.75 : 1) : shot.section.energy > 0.8 ? 0.25 : 0.5);
      }
      if (cut.kind === TransitionKind.iris || cut.kind === TransitionKind.triangle) {
        cut.center = random() < 0.6 ? [0.5, 0.5] : [0.3 + random() * 0.4, 0.35 + random() * 0.3];
      }
      cut.angle = cut.kind === spin ? (random() < 0.5 ? -1 : 1) : [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, (-3 * Math.PI) / 4][Math.floor(random() * 6)];
      last = cut.kind;
    });
    return out;
  }

  /**
   * Flashbacks where the voice stutters (findStutters). The frame at the first time is kept; on each repeat it comes
   * back over the picture — still, in the ink → signal duotone, only where it is lighter — holds a moment and fades
   * into the present, which runs on underneath. (Drawn a touch bigger, its words doubled the ones on screen.) (It used to loop the whole picture back with the voice; the
   * user: on loud songs that looked like a twitch, “也许可以做个闪回的效果”.) No white flash with it. Chops shorter
   * than a quarter second flash back every other time or less, never more than about four times a second.
   */
  private flashback(t: number, fx: Fx): void {
    if (this.remembered >= 0 && t < this.stutters[this.remembered][0]) this.remembered = -1;
    const soft = this.style.look === 'ballad';
    for (let i = 0; i < this.stutters.length; i++) {
      const [s, e, u] = this.stutters[i];
      if (t < s || t >= e + 0.8) continue;
      if (this.remembered !== i) { fx.remember = true; this.remembered = i; }
      const period = u * Math.max(1, Math.ceil(0.24 / u));
      const n = Math.min(Math.floor((t - s) / period), Math.floor((e - s - 1e-3) / period));
      if (n < 1) return;
      const age = t - s - n * period, line = u > 0.8;
      const hold = line ? 0.25 : period * 0.35, tau = line ? 0.3 : period * 0.25;
      const a = age < hold ? 1 : Math.exp(-(age - hold) / tau);
      fx.memory = Math.max(fx.memory, (soft ? 0.55 : 0.9) * a);
      return;
    }
  }

  frame(t: number, dt: number, aspect: number): Frame {
    const i = Math.max(0, lastIndex(this.starts, t));
    const shot = this.shots[i];
    const prev = this.shots[i - 1];
    const following = this.shots[i + 1];
    const scene = this.scenes[shot.scene]!;
    const { transitions: tr, fx: base } = this.style;
    const fx = Object.assign(defaultFx(), base);
    fx.cut = shot.start;
    const since = t - shot.start;
    const beat = 60 / Math.max(40, this.music.at(t).bpm);
    const next = this.music.a.sections[shot.sectionIndex + 1];
    // (A push on through into the drop — the armillary's bullet time, the tunnel's whip — takes the blackout's place.)
    const pushOn = !!following && following.section !== shot.section && this.cuts[i + 1].kind === zoom;
    const beforeDrop = tr.dropPunch && next && next.label === 'drop' && next.start - t < beat * 0.5 && shot.scene !== 'crystal' && !pushOn;
    const cut = this.cuts[i];

    if (this.pure) {
      // (Nothing at the cuts.)
    } else if (prev && prev.section !== shot.section && shot.section.energy > prev.section.energy + 0.1) {
      const jump = Math.min(1, (shot.section.energy - prev.section.energy) * 2.2);
      // (The user: “有些时候的闪光效果太重了” — a lift of light, not a white-out.)
      // An impact frame (three frames of the cover's ink and signal colour, swapped every other section) marks the
      // entry: a change of colour and shape, not of light.
      if (tr.flash && jump > 0.3 && since < 0.05) { fx.impact = 1; fx.impactInvert = shot.sectionIndex % 2; }
      if (tr.dropPunch && shot.section.label === 'drop') fx.zoom = Math.exp(-since / 0.35) * 0.9;
    } else if (tr.glitch && prev && shot.section.energy > 0.55 && since < 0.12 && !cut.kind && !(shot.run && shot.run.start < shot.start)) {
      // (Not on the cuts inside a run: a glitch on every beat is a twitch of its own.)
      fx.glitch = Math.exp(-since / 0.045) * (0.5 + shot.section.energy * 0.5);
    }
    // A cut on the same plate: the camera whips into the new setup.
    if (!this.pure && (cut.whip[0] || cut.whip[1])) {
      const w = Math.pow(1 - clamp01(since / (beat * 0.35)), 2) * (this.style.look === 'ballad' ? 0.03 : 0.09);
      fx.smearX = cut.whip[0] * w;
      fx.smearY = cut.whip[1] * w;
    }

    // Scenes see a shot inside a run as the whole run (Shot.run): its moves carry on across the cuts.
    const timed = (s: Shot): Shot => (s.run ? { ...s, start: s.run.start, end: s.run.end } : s);
    const own = timed(shot);
    // (Through a time stop the plate's time stands, then catches up — while the shot it began in is on screen.)
    const pt = this.plateTime(t, shot);
    const ctx: FrameCtx = { t: pt, dt, music: this.music, lyrics: this.lyrics, palette: this.palette, shot: own, shotT: pt - own.start, aspect, fx };
    scene.update(ctx);

    // Both shots keep moving under a transition; only the one on screen (the shot at t) sets the post effects and
    // shows its words. After the cut the outgoing shot runs on beneath the new one; before a cut that carries motion
    // through it, the next shot is already there, held on its first frame until its beat.
    let transition: Transition | null = null;
    let drawn = scene;
    const nextCut = following ? this.cuts[i + 1] : undefined;
    const join = (c: Cut, into: Shot) => ({
      kind: c.kind as TransitionKind, progress: (t - (into.start - c.pre)) / (c.pre + c.post), center: c.center,
      angle: c.angle, amount: c.amount, edge: this.palette.signal, seed: into.seed,
    });
    if (cut.kind && prev && since < cut.post) {
      const from = this.scenes[prev.scene]!;
      const before = timed(prev);
      from.update({ ...ctx, t, shot: before, shotT: t - before.start, fx: defaultFx() });
      transition = { from, hide: 'from', ...join(cut, shot) };
    } else if (nextCut && nextCut.kind && following && following.start - t < nextCut.pre) {
      drawn = this.scenes[following.scene]!;
      const after = timed(following);
      drawn.update({ ...ctx, t: following.start, shot: after, shotT: following.start - after.start, fx: defaultFx() });
      transition = { from: scene, hide: 'to', ...join(nextCut, following) };
    }

    // Dips to ink around cuts: full at section changes, half inside a section — unless a transition joins them.
    if (tr.dip > 0) {
      const depth = (a: Shot | undefined, b: Shot | undefined, c: Cut | undefined) => (!a || !b ? 0 : a.section !== b.section ? 1 : c && c.kind ? 0 : 0.55);
      const outOf = following ? depth(shot, following, this.cuts[i + 1]) * (1 - smooth((following.start - t) / tr.dip)) : 0;
      const into = depth(prev, shot, cut) * (1 - smooth(since / tr.dip));
      fx.fade = Math.max(fx.fade, outOf, into);
    }
    if (beforeDrop && !this.pure) fx.fade = 1;
    // The song's end: the whole picture, words and credits too, fades to ink as the sound ends.
    const [fadeFrom, fadeTo] = this.endFade;
    if (t > fadeFrom) fx.fade = Math.max(fx.fade, smooth((t - fadeFrom) / (fadeTo - fadeFrom)));
    for (const [a, b] of this.boxes) {
      if (t < a || t >= b) continue;
      // The bars slide in over a bar and out over a bar (not at the very start or end of the song).
      const ramp = Math.min(this.music.barDuration(t), (b - a) / 4);
      const din = a <= 0.1 ? 1 : smooth((t - a) / ramp), dout = b >= this.music.a.duration - 0.1 ? 1 : smooth((b - t) / ramp);
      fx.letterbox = Math.min(din, dout);
    }
    // A plate on paper: trails and the duotone would grey its darks, and the overlay's glowing lines would vanish.
    const bg = scene.scene.background;
    const light = bg instanceof THREE.Color && bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 > 0.45;
    // A light cover shown whole (tiles, shards, the aligned cover, the canvas) is mostly near-white: held a step down and
    // without most of the glow it stays a picture instead of washing out (the user: “过曝+歌词看不清”).
    if (this.palette.light && COVER_PLATES.has(shot.scene) && this.style.id !== 'ink') { fx.exposure *= 0.72; fx.bloom *= 0.12; fx.flash *= 0.5; fx.vignette = Math.max(fx.vignette, 0.55); }
    if (!light && !this.pure) this.grade(t, shot, fx, beat);
    if (!this.pure) this.flashback(t, fx);
    if (!this.pure) this.moments(t, shot, scene, fx);
    if (!this.pure && !light) this.applyLook(shot, fx);
    this.overlay.update(t, shot, fx, light);
    return { scene: drawn, fx, shot, transition };
  }

  /** The plate's time at t: held through a time stop begun in this shot, then catching up (moments.ts). */
  private plateTime(t: number, shot: Shot): number {
    const s = stopAt(this.stops, t);
    return s && this.shotAt(s.at) === shot ? plateTime(this.stops, t) : t;
  }

  /**
   * Time stops and pushes (moments.ts). Through a stop the held frame drains to the cover's duotone and creeps in;
   * when the sound comes back the colour returns at once and the frame pushes in. A push is a lunge of the lens
   * (its zoom: the overlay stays put) up in 50 ms and back over a few tenths, a radial blur, and ribbons of light
   * rushing out of the middle (the overlay). Ballads get half of it and no ribbons; not on the opening cards or the
   * armillary, which are moments of their own.
   */
  private moments(t: number, shot: Shot, scene: MvScene, fx: Fx): void {
    for (const cam of this.zoomed) { cam.zoom = 1; cam.updateProjectionMatrix(); }
    this.zoomed.clear();
    this.overlay.rush = null;
    if (shot.scene === 'cards' || shot.scene === 'crystal') return;
    const soft = this.style.look === 'ballad';
    let zoom = 1;
    const s = stopAt(this.stops, t);
    if (s && this.shotAt(s.at) === shot) {
      const drain = soft ? 0.5 : 0.85, held = Math.max(0.5, s.end - s.at);
      if (t < s.end) {
        const age = t - s.at, k = outExpo(age / 0.08);
        fx.duotone = Math.max(fx.duotone, drain * k);
        fx.ca = Math.max(fx.ca, 0.35 * k);
        zoom *= 1 + 0.035 * smooth(age / held);
      } else {
        const after = t - s.end;
        fx.duotone = Math.max(fx.duotone, drain * Math.exp(-after / 0.07));
        zoom *= 1 + 0.035 * (1 - smooth(after / 0.5));
      }
    }
    const i = lastIndex(this.pushTimes, t);
    if (i >= 0 && t - this.pushTimes[i] < 0.8) {
      const p = this.pushes[i], age = t - p.at, k = p.strength * (soft ? 0.5 : 1);
      zoom *= 1 + 0.11 * k * punch(age, 0.2, 0.05);
      fx.zoom = Math.max(fx.zoom, 0.9 * k * punch(age, 0.11, 0.03));
      if (!soft) this.overlay.rush = { age, k, seed: Math.round(p.at * 1000) };
    }
    if (Math.abs(zoom - 1) > 1e-4) {
      scene.camera.zoom = zoom;
      scene.camera.updateProjectionMatrix();
      this.zoomed.add(scene.camera);
    }
  }

  /**
   * The section's look on this shot. Not on the opening cards or the armillary (they are the song's own marks), nor on
   * the canvas (a medium of its own: printed over, its bare weave turned to a field of noise). Some
   * plates are on the tube without the characters (NO_CHARACTERS).
   * Trails, the duotone and the negative fight the media (a print has no glow), so they are left out under one.
   */
  private applyLook(shot: Shot, fx: Fx): void {
    const look = shot.look ?? this.looks[shot.sectionIndex];
    if (!look || shot.scene === 'cards' || shot.scene === 'crystal' || shot.scene === 'canvas') return;
    if (look === 'riso') { fx.riso = 1; fx.bloom *= 0.5; }
    else if (look === 'hibit') { fx.hibit = 1; }
    else if (look === 'vhs') { fx.vhs = 1; }
    else { fx.crt = 1; if (!NO_CHARACTERS.has(shot.scene)) fx.ascii = 1; }
    fx.echo = Math.min(fx.echo, look === 'hibit' ? 0.5 : 0);
    fx.duotone = 0;
    fx.invert = 0;
    fx.scan = 0;
    fx.grain = look === 'riso' ? 0 : fx.grain;
    fx.vignette = look === 'riso' ? 0 : fx.vignette;
    // A print or a screen is not film (the look keeps the plain picture's grain where it has any).
    fx.film = 0;
  }

  /**
   * Post-effect moments laid over the scenes' own settings, by section and beat. Pulse: drops trail light behind
   * the line plates and flash a negative on strong snares in their second half; the last
   * bar of a build pulses gently on the eighths; a drop resolves out of big pixels on its first beat; breaks turn duotone
   * (the cover's ink → signal), bridges half so; choruses trail a little after each bar's hit. Ballad: long soft
   * trails in choruses, a light duotone in bridges; no negatives, strobes or mirrors.
   */
  private grade(t: number, shot: Shot, fx: Fx, beat: number): void {
    const m = this.music, sec = shot.section, info = m.at(t);
    const ballad = this.style.look === 'ballad';
    const random = rng((shot.seed ^ 0x27d4eb2f) >>> 0);
    const intoSec = t - sec.start;
    if (ballad) {
      if (sec.label === 'chorus' || sec.label === 'drop') fx.echo = Math.max(fx.echo, shot.scene === 'bokeh' || shot.scene === 'kaleido' ? 0.86 : 0.7);
      if (sec.label === 'bridge' || sec.label === 'break') fx.duotone = Math.max(fx.duotone, 0.45);
      return;
    }
    const next = m.a.sections[shot.sectionIndex + 1];
    // Trails suit sparse bright lines; on a frame full of shards they only wash it grey.
    const sparse = shot.scene === 'drive' || shot.scene === 'tunnel' || shot.scene === 'rings' || shot.scene === 'kaleido';
    switch (sec.label) {
      case 'drop': {
        if (sparse && random() < 0.7) fx.echo = Math.max(fx.echo, 0.78);
        // (No mirror any more: folding any plate into a two- or four-way symmetry meant nothing and spoiled the picture.)
        // Resolve out of big pixels on the drop's first beat — not after a push on through (the armillary's, the
        // tunnel's), which lands the drop on its kick, and not while a line is being sung over it (the pixels turned
        // the words into blocks; decided once for the beat, so it never switches off halfway).
        const into = this.shots.findIndex(s => Math.abs(s.start - sec.start) < 0.05);
        const pushedIn = into > 0 && this.cuts[into].kind === zoom;
        const sungOver = this.lyrics.visible(sec.start + beat * 0.5).some(s => s.exit < 0.5);
        if (intoSec < beat && !pushedIn && !sungOver) fx.pixel = Math.max(fx.pixel, 48 * Math.pow(1 - intoSec / beat, 2));
        // A quarter negative on the first strong snare of each four-bar phrase, in the second half (once, not a strobe;
        // half a negative turned the whole frame flat grey for a few frames).
        if (intoSec > (sec.end - sec.start) / 2) {
          const i = lastIndex(this.snares, t), age = i >= 0 ? t - this.snares[i] : 99;
          const phrase = (x: number) => Math.floor(m.at(x).bar / 4);
          const first = i >= 0 && (i === 0 || phrase(this.snares[i - 1]) !== phrase(this.snares[i]));
          if (first && age < 0.08) fx.invert = Math.max(fx.invert, 0.25 * (1 - age / 0.08));
        }
        break;
      }
      case 'build': case 'pre': {
        if (next && next.energy > sec.energy + 0.08 && sec.end - t < m.barDuration(t) && shot.scene !== 'crystal') {
          const eighth = info.pos * 2 - Math.floor(info.pos * 2);
          fx.exposure *= 1 + 0.1 * Math.cos(eighth * Math.PI * 2);
          fx.scan = Math.max(fx.scan, 0.3);
        }
        break;
      }
      case 'break': fx.duotone = Math.max(fx.duotone, 0.6); fx.scan = Math.max(fx.scan, 0.15); break;
      case 'bridge': fx.duotone = Math.max(fx.duotone, 0.4); break;
      case 'chorus': {
        // From the bar's hit (none where the bar starts on no drum).
        const sinceDown = Accents.of(m).sinceBar(t);
        if (sparse && sinceDown < beat) fx.echo = Math.max(fx.echo, 0.6 * (1 - sinceDown / beat));
        break;
      }
    }
  }
}
