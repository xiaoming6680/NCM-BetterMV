// Turns the analysis into shots for a style: which scene, which camera, cut on which beat, how each cut lands.
// With `accelerate`, cuts speed up towards a louder section (bars → single bars → every beat); consecutive
// shots never reuse a camera.
import * as THREE from 'three';
import type { Music } from './music.ts';
import type { LyricTrack } from './lyrics.ts';
import type { FrameCtx, MvScene, SceneId, Shot } from '../scenes/types.ts';
import { clamp01, rng, smooth } from '../scenes/types.ts';
import type { Palette } from '../render/palette.ts';
import { defaultFx, type Fx } from '../render/engine.ts';
import { THROUGH_CUT, TransitionKind, type Transition } from '../render/shots.ts';
import { MgOverlay } from './overlay.ts';
import { Crystal, type CrystalSpec } from '../sigil/crystal.ts';
import { SECTION_LABELS, type LyricLine, type Section } from '../types.ts';
import { norm } from './lyrics.ts';
import { STYLES, type Plate, type SongTraits, type Style } from '../style/style.ts';
import { lastIndex } from './music.ts';

/** Cut times inside a section, on downbeats (and on beats at the end of a build). */
function cutTimes(music: Music, style: Style, section: Section, next: Section | undefined): number[] {
  const beats = Array.from(music.beats).filter(b => b > section.start + 0.05 && b < section.end - 0.05);
  const downs = Array.from(music.downbeats).filter(d => d > section.start + 0.05 && d < section.end - 0.05);
  const cuts = [section.start];
  const per = style.baseBars(section);
  const hero = style.heroBars?.(section) ?? per;
  const rising = style.accelerate && !!next && next.energy > section.energy + 0.08 && section.label !== 'intro';
  const accelFrom = rising ? Math.max(0, downs.length + 1 - 4) : Infinity;
  for (let i = 0; i < downs.length; i++) {
    const bar = i + 1;
    if (bar >= accelFrom || (bar >= hero && bar % per === 0)) cuts.push(downs[i]);
  }
  if (rising) {
    const lastTwo = downs.length >= 2 ? downs[downs.length - 2] : section.start;
    for (const b of beats) if (b > lastTwo + 0.05 && !cuts.some(c => Math.abs(c - b) < 0.05)) cuts.push(b);
  }
  cuts.sort((a, b) => a - b);
  cuts.push(section.end);
  return cuts;
}

const TAKE_TURNS = new Set(['verse', 'break', 'bridge']);

/**
 * The plates a section may use once the ones the user turned off (the settings page) are taken out. A section left
 * with none borrows the plates this song's other sections use, then any style's (each borrowing section opening on a
 * different one); only when every plate is off does it keep its own.
 */
function allowed(pool: Plate[], off: ReadonlySet<SceneId>, sections: Section[], index: number, style: Style, song: SongTraits): Plate[] {
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

/** `off`: plates the user turned off in the settings (the crystal's and the opening's own shots included). */
export function planShots(music: Music, style: Style, songSeed: number, song: SongTraits, off: ReadonlySet<SceneId> = new Set()): Shot[] {
  const shots: Shot[] = [];
  const sections = music.a.sections;
  let prevScene = '', prevVariant = '';
  const used = new Map<string, number>(); // plate -> times used, so the rotation reaches every plate
  const seen = new Map<string, number>(); // label -> sections so far with it
  const barLen = (t: number) => (60 / Math.max(40, music.at(t).bpm)) * music.meter;
  sections.forEach((section, sectionIndex) => {
    const pool = allowed(style.pool(section, song), off, sections, sectionIndex, style, song);
    const cuts = cutTimes(music, style, section, sections[sectionIndex + 1]);
    const random = rng((songSeed ^ (sectionIndex * 2654435761)) >>> 0);
    // Verses, breaks and bridges take turns opening on their first two plates; the others always open on their
    // signature (the chorus wall, the drop's push, the build's tunnel…).
    const nth = seen.get(section.label) ?? 0;
    seen.set(section.label, nth + 1);
    const hero = pool[TAKE_TURNS.has(section.label) ? nth % Math.min(2, pool.length) : 0];
    let plate = hero;
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] < 0.12) continue;
      // Shots shorter than a bar (the end of a build) keep the plate and only change the camera.
      const short = cuts[i + 1] - cuts[i] < barLen(cuts[i]) * 0.9;
      if (i === 0) plate = hero; // a section opens on its hero plate
      else if (!short) {
        // The least-used plate that isn't the one just shown; ties broken by the seeded shuffle.
        const order = pool.map(p => ({ p, r: random() }))
          .filter(o => pool.length === 1 || o.p.scene !== prevScene)
          .sort((a, b) => (used.get(a.p.scene) ?? 0) - (used.get(b.p.scene) ?? 0) || a.r - b.r);
        plate = order.length ? order[0].p : pool[0];
      }
      const variants = plate.variants;
      let variant = variants[Math.floor(random() * variants.length)];
      if (plate.scene === prevScene && variant === prevVariant && variants.length > 1) variant = variants[(variants.indexOf(variant) + 1) % variants.length];
      used.set(plate.scene, (used.get(plate.scene) ?? 0) + 1);
      prevScene = plate.scene;
      prevVariant = variant;
      shots.push({ scene: plate.scene, start: cuts[i], end: cuts[i + 1], section, sectionIndex, variant, seed: (songSeed * 131 + shots.length * 7919) >>> 0 });
    }
  });
  joinRuns(shots, barLen);
  if (!off.has('crystal')) placeCrystal(shots, music, style, songSeed);
  return off.has('cards') ? shots : placeOpening(shots, music, songSeed);
}

/**
 * The speeding-up cuts at the end of a build keep the plate and change only the camera, and each shot used to start
 * its camera move afresh: the same move replayed on every beat, which the user saw as a twitch (“快速循环一个动作，看起来
 * 就和抽搐了一样”; the outro of a two-bar build cut eight times onto the one camera its plate has). Now consecutive
 * shots that would look the same (same plate and camera, same kind of section, one of them under a bar) are one shot,
 * and a run of shorter shots on one plate shares one clock for its moves (Shot.run).
 */
function joinRuns(shots: Shot[], barLen: (t: number) => number): void {
  const short = (s: Shot) => s.end - s.start < barLen(s.start) * 0.9;
  // (Whether a shot was cut under a bar, kept through the merging: joined pieces can add up to a bar.)
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
  for (const s of shots) {
    if (s.end <= end + 1e-3) continue;
    out.push(s.start < end ? { ...s, start: end } : s);
  }
  return out;
}

/**
 * The song's crystal gets two shots of its own: the last bar before each drop (bullet time round it, in the styles
 * that punch into drops), and the song's last bars (its shards gathering; not in ink, whose paper it would black out).
 */
/** Puts a shot of its own over [from, to), trimming the shots it overlaps. */
function carve(shots: Shot[], music: Music, scene: SceneId, from: number, to: number, sectionIndex: number, variant: string, songSeed: number): void {
  if (to - from < 0.8) return;
  const out: Shot[] = [];
  for (const s of shots) {
    if (s.end <= from + 1e-3 || s.start >= to - 1e-3) { out.push(s); continue; }
    // Shots overlapping the new one keep what lies outside it.
    if (s.start < from - 0.05) out.push({ ...s, end: from });
    if (s.end > to + 0.05) out.push({ ...s, start: to });
  }
  out.push({ scene, start: from, end: to, section: music.a.sections[sectionIndex], sectionIndex, variant, seed: (songSeed * 131 + Math.round(from * 1000)) >>> 0 });
  out.sort((a, b) => a.start - b.start);
  shots.length = 0;
  shots.push(...out);
}

function placeCrystal(shots: Shot[], music: Music, style: Style, songSeed: number): Shot[] {
  const sections = music.a.sections, downs = music.downbeats;
  const crystal = (from: number, to: number, sectionIndex: number, variant: string) => carve(shots, music, 'crystal', from, to, sectionIndex, variant, songSeed);
  if (style.transitions.dropPunch) {
    sections.forEach((s, i) => {
      const next = sections[i + 1];
      if (!next || next.label !== 'drop' || s.label === 'drop') return;
      const last = lastIndex(downs, s.end - 0.1);
      if (last < 0 || downs[last] <= s.start + 0.1) return; // a section of one bar keeps its own
      crystal(downs[last], s.end, i, 'orbit');
    });
  }
  if (style.id !== 'ink' && sections.length) {
    const end = sections[sections.length - 1].end, bars = downs.length >= 5 ? 4 : 2;
    const from = downs[Math.max(0, lastIndex(downs, end - 0.1) - bars + 1)];
    const si = Math.max(0, sections.findIndex(s => from >= s.start && from < s.end));
    if (from !== undefined && end - from > 2) crystal(from, end, si, 'gather');
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

/** Plates that show the cover itself large (its white is the picture's white). */
const COVER_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['flip', 'shatter', 'align']);

const { zoom, spin, whip } = TransitionKind;
/**
 * The way each plate moves, so a cut carries its motion on into the next shot: flights push on through, turning
 * plates spin on, flat pages whip across.
 */
const MOTION: Record<SceneId, TransitionKind[]> = {
  tunnel: [zoom], drive: [zoom], relief: [zoom], bokeh: [zoom], particles: [zoom, spin],
  kaleido: [spin], rings: [spin], shatter: [spin, zoom], flip: [whip, spin],
  poster: [whip], typewall: [whip], halftone: [whip, zoom], ridges: [whip, zoom], diorama: [whip, zoom], ink: [TransitionKind.ink],
  crystal: [zoom, spin], cards: [zoom], debug: [whip, zoom], scope: [zoom, whip], subdivide: [spin, zoom], align: [whip, spin],
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
  /** The song's crystal as the overlay's badge (its notation goes on the HUD). */
  readonly crystal: Crystal | null;
  constructor(
    readonly style: Style,
    readonly shots: Shot[],
    readonly scenes: Partial<Record<SceneId, MvScene>>,
    readonly music: Music,
    readonly lyrics: LyricTrack,
    readonly palette: Palette,
    crystal?: CrystalSpec,
    cover?: THREE.Texture,
  ) {
    this.starts = Float64Array.from(shots, s => s.start);
    this.cuts = this.planCuts();
    this.crystal = crystal && cover ? new Crystal(crystal, palette, cover) : null;
    this.overlay = new MgOverlay(palette, style, music, this.crystal);
    this.snares = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.6), h => h[0]);
    this.stutters = findStutters(lyrics.lines);
  }

  private snares: Float64Array;
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
   * Pulse: into a louder section a shape grows from the middle (a drop keeps its blackout and punch); other section
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
      const beat = 60 / Math.max(40, this.music.at(shot.start + 0.01).bpm);
      const cut: Cut = { kind: 0, pre: 0, post: 0, center: [0.5, 0.5], angle: 0, amount: ballad ? 0.45 : 1, whip: [0, 0] };
      const prev = this.shots[i - 1];
      out.push(cut);
      if (!prev) return;
      const hurried = prev.end - prev.start < beat * this.music.meter * 0.9;
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
    const since = t - shot.start;
    const beat = 60 / Math.max(40, this.music.at(t).bpm);
    const next = this.music.a.sections[shot.sectionIndex + 1];
    // (The crystal's bullet time takes the blackout's place.)
    const beforeDrop = tr.dropPunch && next && next.label === 'drop' && next.start - t < beat * 0.5 && shot.scene !== 'crystal';
    const cut = this.cuts[i];

    if (prev && prev.section !== shot.section && shot.section.energy > prev.section.energy + 0.1) {
      const jump = Math.min(1, (shot.section.energy - prev.section.energy) * 2.2);
      // (The user: “有些时候的闪光效果太重了” — a lift of light, not a white-out.)
      if (tr.flash && jump > 0.3) fx.flash = 0.32 * Math.exp(-since / 0.07) * jump;
      if (tr.dropPunch && shot.section.label === 'drop') fx.zoom = Math.exp(-since / 0.35) * 0.9;
    } else if (tr.glitch && prev && shot.section.energy > 0.55 && since < 0.12 && !cut.kind && !(shot.run && shot.run.start < shot.start)) {
      // (Not on the cuts inside a run: a glitch on every beat is a twitch of its own.)
      fx.glitch = Math.exp(-since / 0.045) * (0.5 + shot.section.energy * 0.5);
    }
    // A cut on the same plate: the camera whips into the new setup.
    if (cut.whip[0] || cut.whip[1]) {
      const w = Math.pow(1 - clamp01(since / (beat * 0.35)), 2) * (this.style.look === 'ballad' ? 0.03 : 0.09);
      fx.smearX = cut.whip[0] * w;
      fx.smearY = cut.whip[1] * w;
    }

    // Scenes see a shot inside a run as the whole run (Shot.run): its moves carry on across the cuts.
    const timed = (s: Shot): Shot => (s.run ? { ...s, start: s.run.start, end: s.run.end } : s);
    const own = timed(shot);
    const ctx: FrameCtx = { t, dt, music: this.music, lyrics: this.lyrics, palette: this.palette, shot: own, shotT: t - own.start, aspect, fx };
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
      from.update({ ...ctx, shot: before, shotT: t - before.start, fx: defaultFx() });
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
    if (beforeDrop) fx.fade = 1;
    // A plate on paper: trails and the duotone would grey its darks, and the overlay's glowing lines would vanish.
    const bg = scene.scene.background;
    const light = bg instanceof THREE.Color && bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 > 0.45;
    // A light cover shown whole (tiles, shards, the aligned cover) is mostly near-white: held a step down and
    // without most of the glow it stays a picture instead of washing out (the user: “过曝+歌词看不清”).
    if (this.palette.light && COVER_PLATES.has(shot.scene)) { fx.exposure *= 0.72; fx.bloom *= 0.12; fx.flash *= 0.5; fx.vignette = Math.max(fx.vignette, 0.55); }
    if (!light) this.grade(t, shot, fx, beat);
    this.flashback(t, fx);
    this.overlay.update(t, shot, fx, light);
    return { scene: drawn, fx, shot, transition };
  }

  /**
   * Post-effect moments laid over the scenes' own settings, by section and beat. Pulse: drops trail light behind
   * the line plates, flash a negative on strong snares in their second half and mirror some unsung shots; the last
   * bar of a build pulses gently on the eighths; a drop resolves out of big pixels on its first beat; breaks turn duotone
   * (the cover's ink → signal), bridges half so; choruses trail a little after each downbeat. Ballad: long soft
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
        // A mirror would turn the words backwards: only while no line is on screen.
        const mirrorShot = shot.scene !== 'drive' && shot.scene !== 'tunnel' && random() < 0.3;
        if (mirrorShot && this.lyrics.visible(t).length === 0) fx.mirror = random() < 0.5 ? 3 : 1;
        // Resolve out of big pixels on the drop's first beat.
        if (intoSec < beat) fx.pixel = Math.max(fx.pixel, 48 * Math.pow(1 - intoSec / beat, 2));
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
        if (next && next.energy > sec.energy + 0.08 && sec.end - t < beat * m.meter && shot.scene !== 'crystal') {
          const eighth = info.pos * 2 - Math.floor(info.pos * 2);
          fx.exposure *= 1 + 0.1 * Math.cos(eighth * Math.PI * 2);
          fx.scan = Math.max(fx.scan, 0.3);
        }
        break;
      }
      case 'break': fx.duotone = Math.max(fx.duotone, 0.6); fx.scan = Math.max(fx.scan, 0.15); break;
      case 'bridge': fx.duotone = Math.max(fx.duotone, 0.4); break;
      case 'chorus': {
        const sinceDown = (info.inBar % m.meter) * beat;
        if (sparse && sinceDown < beat) fx.echo = Math.max(fx.echo, 0.6 * (1 - sinceDown / beat));
        break;
      }
    }
  }
}
