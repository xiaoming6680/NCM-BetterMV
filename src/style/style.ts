// A style is a whole visual language: which scenes, which cameras, how fast to cut, how cuts land.
// The plugin picks one per song from the analysis (drums, drops, tempo); the user can override it.
import type { Analysis, Section } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import { TransitionKind } from '../render/shots.ts';

export type StyleId = 'pulse' | 'ballad' | 'word' | 'ink';

/** A plate the director may cut to, with the camera setups it offers. */
export interface Plate { scene: SceneId; variants: string[] }

/** What about a song changes its plates: a flat graphic cover (paper-cut suits it), and whether it has lyrics. */
export interface SongTraits { graphic: boolean; lyrics: boolean }

/** Plates built around the sung words. A song without lyrics (pure music) never gets them. */
export const LYRIC_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['poster', 'typewall']);

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
  /** Bars per shot before any speeding up. */
  baseBars(section: Section): number;
  /** Bars the section's opening (hero) shot holds before the rotation starts, when longer than baseBars. */
  heroBars?(section: Section): number | undefined;
  /** Cuts speed up towards a louder section (bars → single bars → beats). */
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
}

const P = (scene: SceneId, ...variants: string[]): Plate => ({ scene, variants });

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
  baseBars: s => {
    switch (s.label) {
      case 'build': case 'pre': case 'chorus': case 'drop': return 2;
      default: return 4;
    }
  },
  // A drop opens on the push tunnel and stays in it long enough to pick up speed.
  heroBars: s => (s.label === 'drop' ? 4 : undefined),
  accelerate: true,
  transitions: { flash: true, glitch: true, dropPunch: true, dip: 0 },
  fx: { bloom: 0.35, grain: 0.04, vignette: 0.5 },
};

function pulsePool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [P('relief', 'rise'), P('rings', 'front', 'tilt'), P('ridges', 'front', 'drift'), P('particles', 'hold'), P('scope', 'wave', 'xy')];
    case 'outro': return [P('relief', 'rise'), P('rings', 'tilt'), P('ridges', 'drift'), P('particles', 'hold', 'vortex'), P('scope', 'xy', 'wave')];
    // Builds run down the tunnel and burst out through the cover into the chorus/drop.
    case 'build': case 'pre': return [P('tunnel', 'rush', 'roll', 'wall')];
    case 'chorus': return [
      P('shatter', 'wall', 'wall-close', 'wall-dutch', 'wall-edge'), P('kaleido', 'petal', 'spiral'), P('poster', 'stack', 'slab', 'split'),
      P('halftone', 'in', 'fine'), P('flip', 'wave', 'burst'), P('particles', 'burst', 'vortex'), P('debug', 'orbit', 'low', 'top'), P('align', 'swing'),
    ];
    // Drops (the climaxes) push down the tunnel of the user's 《游戏是你的解药吗？》, then rotate.
    case 'drop': return [
      P('drive', 'push', 'roll'), P('shatter', 'swarm-a', 'swarm-d', 'swarm-b', 'swarm-c'), P('particles', 'burst', 'vortex'),
      P('kaleido', 'spiral', 'petal'), P('halftone', 'fine'), P('flip', 'burst'), P('debug', 'low', 'orbit', 'top'),
    ];
    case 'break': return [P('poster', 'slab', 'stack'), P('ridges', 'front', 'low'), P('rings', 'front'), P('halftone', 'pan'), P('scope', 'wave', 'xy')];
    case 'bridge': return [P('poster', 'split', 'stack'), P('ridges', 'drift', 'low'), P('kaleido', 'petal'), P('halftone', 'pan', 'out'), P('rings', 'tilt'), P('debug', 'top', 'orbit'), P('subdivide', 'ball')];
    default: return [
      P('relief', 'fly', 'crane', 'side', 'dive', 'low'), P('ridges', 'front', 'low', 'drift'), P('poster', 'stack', 'split', 'slab'),
      P('halftone', 'pan', 'in'), P('flip', 'wave'), P('rings', 'tilt', 'front'), P('particles', 'hold'), P('subdivide', 'ball'), P('align', 'swing'),
    ];
  }
}

export const BALLAD: Style = {
  id: 'ballad',
  name: '抒情',
  look: 'ballad',
  glyph: '○',
  pool: (s, song) => forSong(balladPool(s, song), song, [P('rings', 'front', 'tilt'), P('bokeh', 'rise')]),
  baseBars: s => (s.label === 'intro' || s.label === 'outro' ? 4 : 2),
  accelerate: false,
  transitions: { flash: false, glitch: false, dropPunch: false, dip: 0 },
  fx: { bloom: 0.5, grain: 0.055, vignette: 0.6 },
};

// Paper-cut only suits flat graphic covers; photos and paintings get the slow ring tunnel instead.
function balladPool(s: Section, song: SongTraits): Plate[] {
  const quiet = song.graphic ? P('diorama', 'drift', 'push', 'truck', 'tilt') : P('tunnel', 'rush', 'wall', 'roll');
  switch (s.label) {
    case 'intro': return [P('bokeh', 'haze'), P('particles', 'hold'), P('scope', 'xy')];
    case 'outro': return [song.graphic ? P('diorama', 'pullback') : P('tunnel', 'roll')];
    case 'chorus': case 'drop': return [P('bokeh', 'focus', 'orbit', 'rise'), P('particles', 'rain', 'vortex'), P('kaleido', 'petal', 'spiral'), P('flip', 'wave'), P('poster', 'stack', 'split'), P('align', 'swing')];
    case 'bridge': case 'break': return [P('poster', 'split', 'stack'), P('bokeh', 'rise'), P('ridges', 'drift'), P('halftone', 'pan'), P('rings', 'front'), P('subdivide', 'ball')];
    default: return [quiet, P('poster', 'stack', 'split', 'slab'), P('halftone', 'in', 'pan'), P('rings', 'tilt', 'front'), P('ridges', 'front', 'drift'), P('flip', 'wave'), P('subdivide', 'ball')];
  }
}

/**
 * 字 (rap): the words are the picture. Verses stand on the type wall between halftone prints and posters; builds
 * slam one word at a time; choruses cut every two bars between walls of words, posters, prints and shards.
 */
export const WORD: Style = {
  id: 'word',
  name: '字',
  look: 'pulse',
  glyph: '□',
  pool: (s, song) => forSong(wordPool(s), song, [P('halftone', 'pan', 'in', 'out'), P('ridges', 'front', 'low')]),
  baseBars: s => (s.label === 'intro' || s.label === 'outro' ? 4 : 2),
  heroBars: s => (s.label === 'verse' || s.label === 'chorus' ? 4 : undefined),
  accelerate: true,
  transitions: {
    flash: true, glitch: true, dropPunch: true, dip: 0,
    within: [TransitionKind.whip, TransitionKind.slices, TransitionKind.whip, TransitionKind.zoom, TransitionKind.wipe],
  },
  fx: { bloom: 0.3, grain: 0.05, vignette: 0.45 },
};

function wordPool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [P('halftone', 'out', 'in'), P('ridges', 'front', 'low'), P('scope', 'wave')];
    case 'outro': return [P('halftone', 'out'), P('ridges', 'drift')];
    case 'build': case 'pre': return [P('typewall', 'solo'), P('tunnel', 'rush', 'roll')];
    case 'chorus': return [
      P('typewall', 'stack', 'split'), P('poster', 'slab', 'stack', 'split'), P('halftone', 'fine', 'in'),
      P('shatter', 'wall', 'wall-close', 'wall-dutch'), P('flip', 'burst', 'wave'), P('debug', 'orbit', 'top'), P('align', 'swing'),
    ];
    case 'drop': return [P('drive', 'push', 'roll'), P('typewall', 'stack', 'solo'), P('halftone', 'fine'), P('shatter', 'swarm-a', 'swarm-b')];
    case 'break': case 'bridge': return [P('halftone', 'pan', 'out'), P('ridges', 'front', 'drift'), P('poster', 'split', 'slab'), P('scope', 'wave', 'xy')];
    default: return [P('typewall', 'split', 'stack', 'solo'), P('halftone', 'pan', 'in', 'fine'), P('poster', 'stack', 'slab', 'split'), P('subdivide', 'ball')];
  }
}

/**
 * 墨 (国风 / 古风): the cover painted in ink on rice paper, the words in vertical columns, the view travelling
 * along it like a scroll; between the paintings, soft light and falling points. Long shots, soft dissolves, ink
 * seeping in at the cuts.
 */
export const INK: Style = {
  id: 'ink',
  name: '墨',
  look: 'ballad',
  glyph: '〇',
  pool: (s, song) => forSong(inkPool(s, song), song, [P('ink', 'scroll', 'mist'), P('bokeh', 'rise', 'haze')]),
  baseBars: s => (s.label === 'chorus' || s.label === 'drop' ? 2 : 4),
  accelerate: false,
  // Ink seeps in from a blot, or the cover's own shapes, or a round moon gate opens; sections change by seeping.
  transitions: {
    flash: false, glitch: false, dropPunch: false, dip: 0,
    within: [TransitionKind.ink, TransitionKind.matte, TransitionKind.iris], between: TransitionKind.ink,
  },
  fx: { bloom: 0.3, grain: 0.04, vignette: 0.45 },
};

function inkPool(s: Section, song: SongTraits): Plate[] {
  switch (s.label) {
    case 'intro': return [P('ink', 'bloom'), P('bokeh', 'haze')];
    case 'outro': return [P('ink', 'mist', 'scroll')];
    case 'chorus': case 'drop': return [P('ink', 'bloom', 'scroll'), P('particles', 'rain', 'vortex'), P('bokeh', 'focus', 'orbit')];
    case 'bridge': case 'break': return [P('ink', 'mist'), P('bokeh', 'rise'), P('particles', 'rain')];
    default: return [P('ink', 'scroll', 'mist'), song.graphic ? P('diorama', 'drift', 'truck') : P('bokeh', 'rise', 'focus'), P('particles', 'hold', 'rain')];
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
const CALM_TAGS = /治愈|平静|伤感|浪漫|放松|安静|思念|孤独|温暖|感动|怀旧|深夜|失恋|抒情|慵懒/;
const LIVELY_TAGS = /活力|燃|兴奋|激昂|律动|派对|运动|动感|嗨/;

/**
 * NetEase's genre and mood tags first (they are curated and reliable); the audio only when a song has none:
 * drops or a steady drum pulse mean pulse, anything else gets the ballad language. Rap gets the word style when it
 * has lyrics to set; 国风 gets the ink style unless it is dance music.
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
    // Pop and the rest: mood tags, then tempo.
    const calm = CALM_TAGS.test(tags), lively = LIVELY_TAGS.test(tags);
    if (calm && !lively) return { style: BALLAD, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    if (lively && !calm) return { style: PULSE, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    return bpm < 100 ? { style: BALLAD, reason: `${genre}，${Math.round(bpm)} BPM`, features } : { style: PULSE, reason: `${genre}，${Math.round(bpm)} BPM`, features };
  }
  if (drops > 0) return { style: PULSE, reason: '有 drop', features };
  if (drumsPerSecond >= 1.6) return { style: PULSE, reason: '鼓点密', features };
  return { style: BALLAD, reason: '鼓点稀、没有 drop', features };
}
