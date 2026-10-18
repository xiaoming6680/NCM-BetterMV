// A style is a whole visual language: which scenes, which cameras, how fast to cut, how cuts land.
// The plugin picks one per song from the analysis (drums, drops, tempo); the user can override it.
import type { Analysis, Section } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import { TransitionKind } from '../render/shots.ts';
import type { Finish } from '../render/engine.ts';

export type StyleId = 'pulse' | 'ballad' | 'word' | 'ink';

/** A plate the director may cut to, with the camera setups it offers. */
export interface Plate { scene: SceneId; variants: string[] }

/** What about a song changes its plates: a flat graphic cover (paper-cut suits it), and whether it has lyrics. */
export interface SongTraits { graphic: boolean; lyrics: boolean }

/** Plates built around the sung words. A song without lyrics (pure music) never gets them. */
export const LYRIC_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['poster', 'typewall', 'neon', 'kinetic']);

export interface Style {
  id: StyleId;
  /** Name shown to users. */
  name: string;
  /** How the plates the styles share are drawn: hard and glowing on the beat, or soft and slow. */
  look: 'pulse' | 'ballad';
  /** The mark before the bar counter. */
  glyph: string;
  /**
   * Plates a section rotates through, a new one every `baseBars` (the idea of the user's 《三角》: one motif
   * retold in many visual languages). Consecutive shots never repeat a plate while the pool has others.
   */
  pool(section: Section, song: SongTraits): Plate[];
  /** Bars per shot before any speeding up; `bar`: seconds a bar lasts at the section's start (see holdBars). */
  baseBars(section: Section, bar: number): number;
  /** Bars the section's opening (hero) shot holds before the rotation starts, when longer than baseBars. */
  heroBars?(section: Section, bar: number): number | undefined;
  /** Cuts speed up out of a build into a louder section (its last two bars a shot each, the last one halved). */
  accelerate: boolean;
  transitions: {
    /** Flash into a louder section. */
    flash: boolean;
    /** Slice glitch on cuts inside loud sections. */
    glitch: boolean;
    /** Black out the last half beat before a drop, zoom-punch into it. */
    dropPunch: boolean;
    /** Seconds of dip to ink around a cut between sections (0 = hard cut). */
    dip: number;
    /** Ways a cut inside a section may land (default: the house wipes for pulse, soft ones for ballad). */
    within?: TransitionKind[];
    /** How a new section comes in when the style doesn't dip or punch into it. */
    between?: TransitionKind;
  };
  fx: { bloom: number; grain: number; vignette: number };
  /** The finish on every frame (src/render/engine.ts FinishShader): grade, halation, lens, sharpening. */
  finish: Finish;
}

const P = (scene: SceneId, ...variants: string[]): Plate => ({ scene, variants });

/**
 * Bars a shot holds to last about `seconds`: 2, 4 or 8 (the nearest by ratio), so cuts keep to the phrases. Shots
 * used to be two or four bars whatever the tempo — a plate every 3.7 s in a 130 BPM chorus, a new world 10–12 times
 * a minute in every style (the user: “切换的过于频繁了”); now a chorus holds a plate about 8 s, a verse about 12.
 */
export function holdBars(seconds: number, bar: number, min = 2, max = 8): number {
  const n = 2 ** Math.round(Math.log2(Math.max(1e-3, seconds / Math.max(0.2, bar))));
  return Math.max(min, Math.min(max, n));
}

/** Without lyrics the word plates drop out; a pool left with a single plate is topped up from `fill`. */
function forSong(pool: Plate[], song: SongTraits, fill: Plate[]): Plate[] {
  if (song.lyrics) return pool;
  const out = pool.filter(p => !LYRIC_PLATES.has(p.scene));
  for (const f of fill) if (out.length < 2 && !out.some(p => p.scene === f.scene)) out.push(f);
  return out;
}

export const PULSE: Style = {
  id: 'pulse',
  name: '律动',
  look: 'pulse',
  glyph: '△',
  pool: (s, song) => forSong(pulsePool(s), song, [P('kaleido', 'petal', 'spiral'), P('flip', 'wave', 'burst')]),
  baseBars: (s, bar) => {
    switch (s.label) {
      case 'build': case 'pre': case 'chorus': case 'drop': return holdBars(8, bar);
      default: return holdBars(12, bar);
    }
  },
  // A drop opens on the push tunnel (or the spectrum tube) and stays in it long enough to pick up speed.
  heroBars: (s, bar) => (s.label === 'drop' ? holdBars(14, bar, 4) : undefined),
  accelerate: true,
  transitions: { flash: true, glitch: true, dropPunch: true, dip: 0 },
  fx: { bloom: 0.35, grain: 0.04, vignette: 0.5 },
  finish: { contrast: 1.2, halation: 0.6, lens: 2.5, sharpen: 0.6, tone: 1.3, grain: 2.2, shutter: 1 / 48 },
};

function pulsePool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [P('relief', 'rise'), P('city', 'high', 'horizon'), P('pillars', 'orbit', 'top'), P('rings', 'front', 'tilt'), P('ridges', 'front', 'drift'), P('particles', 'hold'), P('scope', 'wave', 'xy'), P('vinyl', 'top', 'tilt'), P('aurora', 'wide'), P('ripple', 'face', 'tilt'), P('orb', 'wide', 'orbit'), P('blackhole', 'edge', 'tilt', 'top'), P('dots', 'flat', 'tilt')];
    case 'outro': return [P('relief', 'rise'), P('aurora', 'wide', 'lake'), P('rings', 'tilt'), P('ridges', 'drift'), P('particles', 'hold', 'vortex'), P('scope', 'xy', 'wave'), P('clouds', 'over'), P('ripple', 'face', 'tilt')];
    // Builds run down the tunnel and burst out through the cover into the chorus/drop.
    case 'build': case 'pre': return [P('tunnel', 'rush', 'roll', 'wall')];
    // The city powers up on a chorus's first downbeat; choruses take turns opening on it and on the light pillars.
    case 'chorus': return [
      P('city', 'canyon', 'glide', 'horizon'), P('pillars', 'orbit', 'top', 'low'), P('canvas', 'high', 'chase', 'front'),
      P('kaleido', 'petal', 'spiral'), P('poster', 'stack', 'slab', 'split'), P('kinetic', 'flat', 'tilt'), P('halftone', 'in', 'fine'), P('flip', 'wave', 'burst'), P('particles', 'burst', 'vortex'), P('debug', 'orbit', 'low', 'top'),
      P('ripple', 'tilt', 'face', 'low'), P('orb', 'orbit', 'close'), P('channel', 'axis', 'roll', 'wall'), P('blackhole', 'edge', 'tilt', 'top'), P('cubes', 'flow', 'roll', 'side'), P('dots', 'flat', 'tilt'),
      P('menger', 'glide', 'look'), P('sierpinski', 'glide', 'look'), P('cantor', 'glide', 'look'),
    ];
    // Drops (the climaxes) take turns opening on the push tunnel of the user's 《游戏是你的解药吗？》 and on the
    // spectrum tube, then go round the strongest plates: the sound made visible, the city, the black hole, the cubes.
    case 'drop': return [
      P('drive', 'push', 'roll'), P('channel', 'axis', 'roll', 'wall'),
      P('ripple', 'tilt', 'low'), P('orb', 'close', 'orbit'), P('city', 'canyon', 'glide'), P('kinetic', 'flat', 'tilt'), P('blackhole', 'edge', 'tilt', 'top'), P('cubes', 'flow', 'roll', 'side'),
      P('pillars', 'top', 'orbit'), P('particles', 'burst', 'vortex'), P('kaleido', 'spiral', 'petal'),
      P('menger', 'glide', 'look'), P('sierpinski', 'glide'),
    ];
    case 'break': return [P('aurora', 'wide', 'lake'), P('poster', 'slab', 'stack'), P('kinetic', 'flat', 'tilt'), P('pillars', 'orbit', 'low'), P('clouds', 'over', 'skim'), P('ridges', 'front', 'low'), P('rings', 'front'), P('halftone', 'pan'), P('scope', 'wave', 'xy'), P('vinyl', 'groove', 'top'), P('ripple', 'face', 'tilt'), P('orb', 'wide', 'orbit'), P('cantor', 'glide', 'look'), P('blackhole', 'edge', 'tilt', 'top'), P('dots', 'flat', 'tilt')];
    case 'bridge': return [P('aurora', 'lake', 'wide'), P('poster', 'split', 'stack'), P('kinetic', 'flat', 'tilt'), P('canvas', 'high', 'side'), P('pillars', 'orbit', 'top'), P('clouds', 'rise', 'skim'), P('ridges', 'drift', 'low'), P('kaleido', 'petal'), P('halftone', 'pan', 'out'), P('rings', 'tilt'), P('debug', 'top', 'orbit'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt'), P('orb', 'wide'), P('cantor', 'glide'), P('menger', 'look'), P('blackhole', 'edge', 'tilt', 'top'), P('dots', 'flat', 'tilt')];
    default: return [
      P('relief', 'fly', 'crane', 'side', 'dive', 'low'), P('city', 'horizon', 'canyon', 'glide', 'high'), P('canvas', 'chase', 'high', 'side', 'front'), P('pillars', 'low', 'orbit'),
      P('ridges', 'front', 'low', 'drift'), P('poster', 'stack', 'split', 'slab'), P('kinetic', 'flat', 'tilt'), P('dots', 'flat', 'tilt'),
      P('halftone', 'pan', 'in'), P('flip', 'wave'), P('rings', 'tilt', 'front'), P('particles', 'hold'), P('subdivide', 'ball'),
      P('vinyl', 'tilt', 'groove', 'top'), P('ripple', 'face', 'tilt', 'low'), P('orb', 'orbit', 'wide'), P('channel', 'axis', 'wall'),
      P('menger', 'glide', 'look'), P('cantor', 'glide'),
    ];
  }
}

export const BALLAD: Style = {
  id: 'ballad',
  name: '抒情',
  look: 'ballad',
  glyph: '○',
  pool: (s, song) => forSong(balladPool(s, song), song, [P('rings', 'front', 'tilt'), P('bokeh', 'rise')]),
  baseBars: (s, bar) => holdBars(s.label === 'intro' || s.label === 'outro' ? 14 : 10, bar),
  accelerate: false,
  transitions: { flash: false, glitch: false, dropPunch: false, dip: 0 },
  fx: { bloom: 0.5, grain: 0.055, vignette: 0.6 },
  finish: { contrast: 1.12, halation: 0.7, lens: 2, sharpen: 0.4, tone: 1.3, grain: 2, shutter: 1 / 40 },
};

// Paper-cut only suits flat graphic covers; photos and paintings get the slow ring tunnel instead.
function balladPool(s: Section, song: SongTraits): Plate[] {
  const quiet = song.graphic ? P('diorama', 'drift', 'push', 'truck', 'tilt') : P('tunnel', 'rush', 'wall', 'roll');
  switch (s.label) {
    case 'intro': return [P('bokeh', 'haze'), P('rain', 'pane', 'clear'), P('lanterns', 'wide'), P('aurora', 'wide', 'lake'), P('pillars', 'orbit', 'top'), P('clouds', 'over'), P('particles', 'hold'), P('scope', 'xy'), P('ripple', 'face'), P('blackhole', 'top', 'edge')];
    case 'outro': return [song.graphic ? P('diorama', 'pullback') : P('tunnel', 'roll'), P('lanterns', 'rise', 'wide'), P('aurora', 'wide'), P('rain', 'clear')];
    // Choruses take turns opening under the aurora (looking up into it) and among the lanterns the words send up.
    case 'chorus': case 'drop': return [P('aurora', 'up', 'wide'), P('lanterns', 'shore', 'rise', 'wide'), P('bokeh', 'focus', 'orbit', 'rise'), P('rain', 'pane', 'close'), P('pillars', 'orbit', 'top'), P('canvas', 'high', 'chase', 'side'), P('clouds', 'rise', 'over', 'skim'), P('city', 'horizon', 'high'), P('particles', 'rain', 'vortex'), P('kaleido', 'petal', 'spiral'), P('flip', 'wave'), P('poster', 'stack', 'split'), P('ripple', 'face', 'tilt'), P('orb', 'orbit', 'wide'), P('sierpinski', 'glide'), P('cantor', 'glide', 'look'), P('blackhole', 'edge', 'top')];
    case 'bridge': case 'break': return [P('city', 'high', 'horizon'), P('poster', 'split', 'stack'), P('rain', 'clear', 'pane'), P('lanterns', 'wide', 'rise'), P('canvas', 'high', 'side'), P('pillars', 'orbit', 'low'), P('clouds', 'over', 'rise'), P('aurora', 'lake'), P('bokeh', 'rise'), P('ridges', 'drift'), P('halftone', 'pan'), P('rings', 'front'), P('subdivide', 'ball'), P('orb', 'wide', 'orbit'), P('menger', 'glide')];
    // Verses take turns opening in the quiet plate and at the rainy window, where the lines are written in the fog.
    default: return [quiet, P('rain', 'pane', 'close', 'clear'), P('lanterns', 'shore', 'wide'), P('vinyl', 'top', 'tilt'), P('canvas', 'high', 'side', 'chase'), P('pillars', 'low', 'orbit'), P('aurora', 'lake', 'wide'), P('poster', 'stack', 'split', 'slab'), P('halftone', 'in', 'pan'), P('rings', 'tilt', 'front'), P('ridges', 'front', 'drift'), P('flip', 'wave'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt')];
  }
}

/**
 * 字 (rap): the words are the picture. Verses take turns opening on the type wall and walking down the street of neon
 * signs (each chunk a sign that strikes on as it is rapped), between halftone prints and posters; builds slam one
 * word at a time; choruses cut about every eight seconds between walls of words, the neon street, kinetic type,
 * posters and prints.
 */
export const WORD: Style = {
  id: 'word',
  name: '字',
  look: 'pulse',
  glyph: '□',
  pool: (s, song) => forSong(wordPool(s), song, [P('halftone', 'pan', 'in', 'out'), P('ridges', 'front', 'low')]),
  baseBars: (s, bar) => holdBars(s.label === 'intro' || s.label === 'outro' ? 12 : 8, bar),
  heroBars: (s, bar) => (s.label === 'verse' || s.label === 'chorus' ? holdBars(14, bar, 4) : undefined),
  accelerate: true,
  transitions: {
    flash: true, glitch: true, dropPunch: true, dip: 0,
    within: [TransitionKind.whip, TransitionKind.slices, TransitionKind.whip, TransitionKind.zoom, TransitionKind.wipe],
  },
  fx: { bloom: 0.3, grain: 0.05, vignette: 0.45 },
  finish: { contrast: 1.2, halation: 0.45, lens: 1.8, sharpen: 0.6, tone: 1, grain: 2, shutter: 1 / 60 },
};

function wordPool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [P('halftone', 'out', 'in'), P('neon', 'walk', 'up'), P('ridges', 'front', 'low'), P('city', 'high', 'horizon'), P('vinyl', 'top'), P('scope', 'wave'), P('dots', 'flat', 'tilt')];
    case 'outro': return [P('halftone', 'out'), P('neon', 'up', 'walk'), P('ridges', 'drift'), P('city', 'horizon'), P('vinyl', 'top', 'tilt')];
    case 'build': case 'pre': return [P('typewall', 'solo'), P('tunnel', 'rush', 'roll'), P('kinetic', 'flat', 'tilt')];
    case 'chorus': return [
      P('typewall', 'stack', 'split'), P('kinetic', 'flat', 'tilt'), P('city', 'canyon', 'glide', 'horizon'), P('neon', 'walk', 'low', 'up'), P('pillars', 'orbit', 'top', 'low'), P('poster', 'slab', 'stack', 'split'), P('halftone', 'fine', 'in'), P('vinyl', 'groove', 'top', 'tilt'),
      P('flip', 'burst', 'wave'), P('debug', 'orbit', 'top'),
      P('ripple', 'tilt', 'face'), P('channel', 'axis', 'roll'), P('cubes', 'flow', 'roll', 'side'), P('blackhole', 'edge', 'tilt', 'top'), P('dots', 'flat', 'tilt'),
    ];
    case 'drop': return [P('drive', 'push', 'roll'), P('channel', 'axis', 'roll'), P('typewall', 'stack', 'solo'), P('kinetic', 'flat', 'tilt'), P('halftone', 'fine'), P('ripple', 'tilt', 'low'), P('cubes', 'flow', 'roll', 'side'), P('blackhole', 'edge', 'tilt', 'top')];
    case 'break': case 'bridge': return [P('halftone', 'pan', 'out'), P('neon', 'low', 'up'), P('kinetic', 'flat', 'tilt'), P('ridges', 'front', 'drift'), P('poster', 'split', 'slab'), P('city', 'high', 'horizon'), P('vinyl', 'groove', 'top'), P('pillars', 'orbit'), P('scope', 'wave', 'xy')];
    // Verses take turns opening on the wall of words and walking down the street of neon signs.
    default: return [P('typewall', 'split', 'stack', 'solo'), P('neon', 'walk', 'low', 'up'), P('kinetic', 'flat', 'tilt'), P('dots', 'flat', 'tilt'), P('city', 'horizon', 'canyon', 'glide', 'high'), P('pillars', 'low', 'orbit'), P('canvas', 'chase', 'high', 'side'), P('vinyl', 'top', 'tilt', 'groove'), P('halftone', 'pan', 'in', 'fine'), P('poster', 'stack', 'slab', 'split'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt')];
  }
}

/**
 * 墨 (国风 / 古风): the cover painted in ink on rice paper, the words in vertical columns, the view travelling
 * along it like a scroll; around it the plates that have a version of their own on paper — ranges of ink mountains
 * (ridges), a sea of clouds with a red sun and far peaks (clouds), the song writing its cover with a brush (canvas),
 * a window flower cut from red paper (papercut) — and soft light. Long shots, soft dissolves, ink seeping in at
 * the cuts.
 */
export const INK: Style = {
  id: 'ink',
  name: '墨',
  look: 'ballad',
  glyph: '〇',
  pool: (s, song) => forSong(inkPool(s, song), song, [P('ink', 'scroll', 'mist'), P('bokeh', 'rise', 'haze')]),
  baseBars: (s, bar) => holdBars(s.label === 'chorus' || s.label === 'drop' ? 10 : 14, bar),
  accelerate: false,
  // Ink seeps in from a blot, or the cover's own shapes, or a round moon gate opens; sections change by seeping.
  transitions: {
    flash: false, glitch: false, dropPunch: false, dip: 0,
    within: [TransitionKind.ink, TransitionKind.matte, TransitionKind.iris], between: TransitionKind.ink,
  },
  fx: { bloom: 0.3, grain: 0.04, vignette: 0.45 },
  finish: { contrast: 1.08, halation: 0, lens: 0.8, sharpen: 0.4, tone: 0.8, grain: 1.6, shutter: 1 / 40 },
};

function inkPool(s: Section, song: SongTraits): Plate[] {
  switch (s.label) {
    case 'intro': return [P('ink', 'bloom'), P('clouds', 'over'), P('ridges', 'front', 'drift'), P('bokeh', 'haze')];
    case 'outro': return [P('ink', 'mist', 'scroll'), P('ridges', 'drift', 'front'), P('clouds', 'over')];
    // Choruses take turns opening on the ink spreading and on climbing out of the clouds into the light.
    // (No particles: they are drawn on black, which tore the paper open in the middle of a song.)
    case 'chorus': case 'drop': return [P('ink', 'bloom', 'scroll'), P('clouds', 'rise', 'over', 'skim'), P('papercut', 'bloom', 'turn'), P('canvas', 'high', 'chase', 'side'), P('bokeh', 'focus', 'orbit')];
    case 'bridge': case 'break': return [P('clouds', 'skim', 'over'), P('ink', 'mist'), P('ridges', 'drift', 'low'), P('papercut', 'turn'), P('bokeh', 'rise')];
    default: return [
      P('ink', 'scroll', 'mist'), P('ridges', 'front', 'drift', 'low'), P('canvas', 'chase', 'side', 'high'), P('papercut', 'turn'),
      song.graphic ? P('diorama', 'drift', 'truck') : P('bokeh', 'rise', 'focus'),
    ];
  }
}

export const STYLES: Record<StyleId, Style> = { pulse: PULSE, ballad: BALLAD, word: WORD, ink: INK };

export interface StyleChoice {
  style: Style;
  /** Why, in a few words (for the debug line and the settings page). */
  reason: string;
  features: { bpm: number; drumsPerSecond: number; drops: number };
}

const WORD_GENRES = /说唱|嘻哈|饶舌|Rap|Hip[\s-]?Hop|Drill|Grime/i;
const INK_GENRES = /国风|古风|中国风|戏腔|戏曲|民族/;
const PULSE_GENRES = /电子|舞曲|电音|浩室|陷阱|Trap|Dubstep|Techno|Trance|摇滚|金属|朋克|Phonk/i;
const BALLAD_GENRES = /民谣|古典|轻音乐|新世纪|纯音乐|氛围|爵士|蓝调/;
const CALM_TAGS = /治愈|平静|伤感|悲伤|苦情|抑郁|浪漫|放松|安静|冥想|助眠|思念|孤独|温暖|感动|怀旧|深夜|失恋|抒情|慵懒/;
const LIVELY_TAGS = /活力|燃|热血|兴奋|激昂|欢快|狂欢|律动|派对|夜店|运动|有氧|动感|嗨/;

/**
 * NetEase's genre and mood tags first (they are curated and reliable); the audio when they don't decide (no genre,
 * or one none of the lists name with no mood tags or mixed ones): drops or a steady drum pulse mean pulse, anything
 * else gets the ballad language. Rap gets the word style when it has lyrics to set; 国风 gets the ink style unless it
 * is dance music.
 */
export function chooseStyle(a: Analysis, wiki?: { genres: string[]; tags: string[]; bpm?: number }, hasLyrics = true): StyleChoice {
  const strong = (hits: Array<[number, number]>) => hits.filter(h => h[1] > 0.3).length;
  const drumsPerSecond = (strong(a.hits.kick) + 0.5 * strong(a.hits.snare)) / Math.max(1, a.duration);
  const drops = a.sections.filter(s => s.label === 'drop').length;
  const bpm = wiki?.bpm ?? a.bpm;
  const features = { bpm: Math.round(bpm), drumsPerSecond: +drumsPerSecond.toFixed(2), drops };
  const genres = wiki?.genres.join(' ') ?? '';
  const tags = wiki?.tags.join(' ') ?? '';
  if (genres) {
    const genre = wiki!.genres[0].split('-').pop();
    const byGenre = `曲风：${genre}`;
    if (WORD_GENRES.test(genres) && hasLyrics) return { style: WORD, reason: byGenre, features };
    if (INK_GENRES.test(genres) && !PULSE_GENRES.test(genres)) return { style: INK, reason: byGenre, features };
    if (BALLAD_GENRES.test(genres) && !PULSE_GENRES.test(genres)) return { style: BALLAD, reason: byGenre, features };
    if (PULSE_GENRES.test(genres) || WORD_GENRES.test(genres)) return { style: PULSE, reason: byGenre, features };
    // Pop and the rest: mood tags, then the audio. (Not the wiki's BPM: it is often half the tempo people cite, and
    // put 170–190 BPM rhythm-game songs tagged 平静 and 活力 at once among the ballads.)
    const calm = CALM_TAGS.test(tags), lively = LIVELY_TAGS.test(tags);
    if (calm && !lively) return { style: BALLAD, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    if (lively && !calm) return { style: PULSE, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    return byAudio(`${genre}，`);
  }
  return byAudio('');

  function byAudio(prefix: string): StyleChoice {
    if (drops > 0) return { style: PULSE, reason: `${prefix}含 drop`, features };
    if (drumsPerSecond >= 1.6) return { style: PULSE, reason: `${prefix}鼓点密集`, features };
    return { style: BALLAD, reason: `${prefix}鼓点稀疏、无 drop`, features };
  }
}
