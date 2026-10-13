// BetterMV 的效果版宣传片（docs/FILM.md“效果版”）。The promo (film/main.ts) showed a plate or two per song; the user:
// “展示的效果太少了，并且这些效果不够吸引人”“我们的效果非常多，可以讲解一些插件独有的设计”. So the same opening line over
// the same first drop, then song after song, each changing plates bar by bar inside its own section (the plugin's real
// player, its plates carved into the song's plan where the film wants them, all of them plates the plugin draws in that
// kind of section), and a few of its designs in a heading and a line: the song read before it plays (the opening card),
// each song's armillary, colours only from the cover, the words in the picture, four looks, every play arranged anew
// (the same bars played three times side by side), the count of it all over the grid. No words about getting it.
// Every frame is a pure function of film time t (window.PROMO.renderAt), so film/render.ts --reel can shoot it.
//   /film/reel.html · ?t=20 preview from 20 s · ?render (the clock is film/render.ts's) · ?clean without the words
//   over the parts (the cover's wall of frames)
import { loadFonts } from '../src/render/text.ts';
import { styleFor } from '../src/app/prepare.ts';
import { MvPlayer } from '../src/app/player.ts';
import { carve } from '../src/director/director.ts';
import type { Music } from '../src/director/music.ts';
import { inOutCubic, smooth, type LookId, type SceneId, type Shot } from '../src/scenes/types.ts';
import { appear, cardAt, downbeat, draw, esc, fit, H, html, k, loadSong, makeCard, nearest, OFF, shortName, show, tick, W, watchContexts, type AudioPart, type Card, type Sfx, type Song } from './shared.ts';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render'), CLEAN = q.has('clean');
const frame = document.getElementById('frame') as HTMLDivElement;

/** A plate over some bars of a part (`plan`: the plugin's own plan there), in order from the part's downbeat. */
type Plate = [scene: SceneId | 'plan', variant: string, bars: number, look?: LookId];
/** Words over a part: from `at` bars after its downbeat (`card`: from its waiting view) for `bars` bars. */
interface Caption { title: string; line?: string; at: number | 'card'; bars: number }
/**
 * The film in appearances of songs, in order (as in film/main.ts): whole bars from a downbeat, `bar` bars after the
 * start of the n-th section labelled `label`, coming in `lead` beats early with the plugin's waiting view (0: none —
 * the first part, or the song going on after a jump). `seed` fixes the plugin's draw of plates and cameras; `plates`
 * put the film's own over the bars. `split`: over those bars, the song played three times side by side — this play and
 * two others, each with the plate another seed's plan has there. `level`: LUFS in the mix.
 */
interface Cut {
  id: number; label: string; n?: number; bar?: number; bars: number; seed: number; lead: number; level?: number;
  /** The song's audio from a file (the dev server's /media/…) when NetEase no longer has it cached. */
  audio?: string;
  plates?: Plate[]; captions?: Caption[];
  split?: { at: number; bars: number; others: Array<{ seed: number; scene: SceneId; variant: string }> };
}
const CUTS: Cut[] = [
  // If The Sun Burns Out Tonight (VALORANT): the armillary before its first drop under the line, then the push tunnel.
  { id: 3437356861, label: 'drop', bar: -2, bars: 4, seed: 364, lead: 0 },
  // Clarity (BUNT. Remix) (VALORANT), the drop the user's own 《游戏是你的解药吗？》 was cut to (the user: “选类似之前
  // remix版clarity的歌曲”, “可以把Clarity（BUNT. Remix）加进去的”); NetEase no longer has it cached, so from the file
  // the user downloaded. Its last chorus, the armillary's run-in, the drop: the spectrum tube, the sound wave.
  {
    id: 3359522924, audio: '/media/VipSongsDownload/unlock/' + encodeURIComponent('Zedd,VALORANT,Foxes - Clarity (BUNT. Remix).flac'),
    label: 'drop', n: 3, bar: -4, bars: 7, seed: 1, lead: 1,
    plates: [['plan', '', 4], ['channel', 'axis', 2], ['ripple', 'tilt', 1]],
    captions: [
      { title: '先读懂整首歌', line: '速度、拍号、段落和高潮', at: 0, bars: 2 },
      { title: '每首歌一架浑天仪', line: '环数、刻度和转速都来自这首歌', at: 2, bars: 2 },
    ],
  },
  // Good Things Fall Apart (ILLENIUM): its cover's fire in the night city; then four plates in the four looks.
  {
    id: 1365046574, label: 'chorus', n: 3, bars: 3, seed: 1, lead: 1,
    plates: [['city', 'canyon', 1], ['kaleido', 'petal', 0.5, 'riso'], ['orb', 'orbit', 0.5, 'hibit'], ['flip', 'wave', 0.5, 'vhs'], ['pillars', 'orbit', 0.5, 'ascii']],
    captions: [
      { title: '颜色只取自封面', line: '黑白的封面，就是黑白的 MV', at: 'card', bars: 1 },
      { title: '四种画风', line: '孔版印刷、像素、录像带、字符', at: 1, bars: 2 },
    ],
  },
  // Can You Hear Me: the Sierpinski fractal.
  { id: 1329940346, label: 'drop', bar: 4, bars: 2, seed: 17, lead: 1 },
  // Mine (Illenium Remix): the words in the picture, the poster's and the painting's.
  {
    id: 30780496, label: 'chorus', bars: 2, seed: 1, lead: 1,
    plates: [['poster', 'stack', 1], ['canvas', 'chase', 1]],
    captions: [{ title: '歌词长在画面里', line: '逐字出现，唱得越久，字越大', at: 0, bars: 2 }],
  },
  // The Place (Au5 Remix): the shards, the Menger sponge, the light pillars.
  { id: 29755251, label: 'drop', n: 2, bars: 3, seed: 1, lead: 1, plates: [['shatter', 'swarm-a', 1], ['menger', 'glide', 1], ['pillars', 'top', 1]] },
  // If The Sun Burns Out Tonight again, its last drop: the tunnel; the same bars played three times; the grid; the name
  // over its outro.
  {
    id: 3437356861, label: 'drop', n: 3, bar: 2, bars: 6, seed: 364, lead: 1, level: -12.5,
    split: { at: 2, bars: 2, others: [{ seed: 5, scene: 'particles', variant: 'vortex' }, { seed: 104, scene: 'kaleido', variant: 'petal' }] },
    captions: [
      { title: '每次播放都重新编排', line: '同一首歌，场景、镜头和画风每次都不一样', at: 2, bars: 2 },
      { title: '37 个场景，4 种风格，4 种画风', line: '每一首歌，都有自己的 MV', at: 4, bars: 2 },
    ],
  },
];
/** The line over the first song until this bar of it (the drop), when the picture snaps into focus. */
const WORDS_BARS = 2;
/** The grid: over the last appearance's last bars. */
const GRID_BARS = 2;
/** After the last appearance (the song's own outro under the name), then black. */
const TAIL = 4.8;

/** A song's player on a stage of its own (shared by its appearances), its place in the closing grid. */
interface Player { song: Song; stage: HTMLDivElement; player: MvPlayer; lastDraw: number; size?: string; tile: { x: number; y: number; w: number; h: number }; label: HTMLDivElement; slot: number }
/** One appearance: its bars in song time, where they fall in film time, its waiting view. */
interface Part { cut: Cut; p: Player; s0: number; s1: number; T0: number; T1: number; Tc: number; card: Card | null }
/** A plate the film carves into a song's plan. */
interface Carve { scene: SceneId; variant: string; from: number; to: number; look?: LookId }

/** The time `bars` bars after the downbeat s0 (whole bars on the downbeats, the rest on the beats). */
function barsAfter(a: { downbeats: number[]; beats: number[]; meter: number }, s0: number, bars: number): number {
  const whole = Math.floor(bars + 1e-6), rest = bars - whole, d = downbeat(a.downbeats, s0, whole);
  if (rest < 1e-6) return d;
  const bi = nearest(a.beats, d), n = Math.round(rest * a.meter);
  return a.beats[bi + n] ?? d + (rest * 60 * a.meter) / 120;
}

async function main(): Promise<void> {
  const status = html(frame, 'note', '加载中…');
  await loadFonts('/fonts/');
  await document.fonts.load('900 64px PF');
  await document.fonts.load('600 40px PF');

  // ---------- the songs ----------
  const songs = new Map<number, Song>();
  for (const c of CUTS) {
    if (songs.has(c.id)) continue;
    status.textContent = `分析 ${songs.size + 1} / ${new Set(CUTS.map(x => x.id)).size}…`;
    songs.set(c.id, await loadSong(c.id, c.audio));
  }

  // ---------- where each appearance's bars are (song time), and the plates carved into each song's plan ----------
  const spans = CUTS.map(cut => {
    const a = songs.get(cut.id)!.prepared.analysis;
    const secs = a.sections.filter(s => s.label === cut.label);
    const sec = secs[Math.min(secs.length, cut.n ?? 1) - 1] ?? a.sections[0];
    const s0 = downbeat(a.downbeats, sec.start, cut.bar ?? 0);
    return { s0, s1: barsAfter(a, s0, cut.bars) };
  });
  const carves = new Map<number, Carve[]>();
  CUTS.forEach((cut, i) => {
    const a = songs.get(cut.id)!.prepared.analysis;
    let at = 0;
    for (const [scene, variant, bars, look] of cut.plates ?? []) {
      const from = barsAfter(a, spans[i].s0, at), to = barsAfter(a, spans[i].s0, at + bars);
      if (scene !== 'plan') (carves.get(cut.id) ?? carves.set(cut.id, []).get(cut.id)!).push({ scene, variant, from, to, look });
      at += bars;
    }
  });
  // The song time each song is seen in, with room for its lead-in and the run-up before it (see retake).
  const seen = new Map<number, Array<[number, number]>>();
  CUTS.forEach((cut, i) => (seen.get(cut.id) ?? seen.set(cut.id, []).get(cut.id)!).push([spans[i].s0 - 3, spans[i].s1 + 0.5]));
  const retake = (id: number, list: Carve[], seed: number) => (shots: Shot[], music: Music): Shot[] => {
    for (const c of list) {
      // The section the shot's middle is in: by its start, a shot carved right on a drop's downbeat fell in the section
      // before (a few ms off its end), and the director blacked the whole shot out as “the last half beat before a drop”.
      const mid = (c.from + c.to) / 2, si = Math.max(0, music.a.sections.findIndex(s => mid >= s.start && mid < s.end));
      carve(shots, music, c.scene, c.from, c.to, si, c.variant, seed);
      if (c.look) { const sh = shots.find(s => Math.abs(s.start - c.from) < 1e-3 && s.scene === c.scene); if (sh) sh.look = c.look; }
    }
    // Only the plates the film shows are built: a shot it never shows takes the plate of one it does. (A player builds
    // every plate of its song's whole plan; the reel's eight players held over 4 GB that way, and with the machine's
    // memory nearly all taken the GPU process could not allocate and every context was lost.)
    const shown = (s: { start: number; end: number }) => seen.get(id)!.some(([a, b]) => s.start < b && s.end > a);
    const stand = shots.find(shown);
    if (stand) for (const s of shots) if (!shown(s)) { s.scene = stand.scene; s.variant = stand.variant; s.run = undefined; s.look = undefined; }
    return shots;
  };

  // ---------- the players: each song on a stage of its own; two more plays of the last song for the split ----------
  const players = new Map<number, Player>();
  for (const c of CUTS) {
    if (players.has(c.id)) continue;
    const song = songs.get(c.id)!, stage = html(frame, 'stage'), player = new MvPlayer(stage, 1.5);
    // (No looks of the plugin's own drawing: the film shows them where it says so, the plates' `look`.)
    player.load(song.prepared, styleFor(song.prepared, 'auto'), new Set(), undefined, 'none', 0, c.seed, retake(c.id, carves.get(c.id) ?? [], c.seed));
    players.set(c.id, { song, stage, player, lastDraw: -1e9, tile: { x: 0, y: 0, w: W, h: H }, label: html(frame, 'tilename'), slot: 0 });
  }
  const lastCut = CUTS[CUTS.length - 1];
  // The split's places: three in a row, the last song's own play in the middle.
  const splitTiles = (() => {
    const gap = 20, tw = 384, th = (tw * 9) / 16, x0 = (W - (3 * tw + 2 * gap)) / 2, y = (H - th) / 2 - 44;
    return [0, 1, 2].map(i => ({ x: x0 + i * (tw + gap), y, w: tw, h: th }));
  })();
  // (The two other plays are drawn at their tile's size, not the frame's — see fit().)
  const others: Player[] = (lastCut.split?.others ?? []).map((o, i) => {
    const tl = splitTiles[i ? 2 : 0], song = songs.get(lastCut.id)!, stage = html(frame, 'stage');
    const player = new MvPlayer(stage, 1.5);
    player.load(song.prepared, styleFor(song.prepared, 'auto'), new Set(), { scene: o.scene, variants: [o.variant] }, 'none', 0, o.seed);
    return { song, stage, player, lastDraw: -1e9, tile: tl, label: html(frame, 'tilename'), slot: 0 };
  });

  // ---------- the appearances: when each plays (film time) ----------
  const parts: Part[] = [];
  let T = 0;
  CUTS.forEach((cut, i) => {
    const p = players.get(cut.id)!, a = p.song.prepared.analysis, { s0, s1 } = spans[i];
    // The waiting view takes the beats before the downbeat the song comes in on (its own lead-in under it).
    const bi = nearest(a.beats, s0);
    const lead = cut.lead ? s0 - (a.beats[bi - cut.lead] ?? s0 - (cut.lead * 60) / Math.max(40, a.bpm)) : 0;
    const Tc = T, T0 = T + lead, T1 = T0 + (s1 - s0);
    T = T1;
    parts.push({ cut, p, s0, s1, T0, T1, Tc, card: cut.lead ? makeCard(frame, p.song) : null });
  });
  const first = parts[0], last = parts[parts.length - 1], hero = last.p;
  const la = hero.song.prepared.analysis;
  const filmAt = (part: Part, bars: number) => part.T0 + (barsAfter(part.p.song.prepared.analysis, part.s0, bars) - part.s0);
  // The split and the grid over the last part's bars; the name as the song's outro begins; black at the end.
  const S0 = last.cut.split ? filmAt(last, last.cut.split.at) : Infinity, S1 = last.cut.split ? filmAt(last, last.cut.split.at + last.cut.split.bars) : Infinity;
  const M0 = last.T1 - (downbeat(la.downbeats, last.s1) - downbeat(la.downbeats, last.s1, -GRID_BARS)), END = last.T1 + TAIL;

  // The grid's places: two rows of 16:9 tiles (3 + 3, or 4 + 3 for seven songs), the last song (playing on) in the
  // middle of the lower row; the others in the order they came.
  const songsInOrder = [...players.values()];
  {
    const count = songsInOrder.length, top = count <= 6 ? Math.ceil(count / 2) : 4, bottom = count - top;
    const gap = 20, tw = top === 3 ? 300 : 272, th = (tw * 9) / 16, lab = 40, rowH = th + lab;
    const y0 = (H - (2 * rowH + gap)) / 2 - 24;
    const heroSlot = top + Math.floor(bottom / 2);
    const slots = Array.from({ length: count }, (_, i) => i).filter(i => i !== heroSlot);
    songsInOrder.filter(p => p !== hero).forEach((p, i) => { p.slot = slots[i] ?? i; });
    hero.slot = heroSlot;
    for (const p of songsInOrder) {
      const row = p.slot < top ? 0 : 1, col = row ? p.slot - top : p.slot, n = row ? bottom : top;
      const x0 = (W - (n * tw + (n - 1) * gap)) / 2;
      p.tile = { x: x0 + col * (tw + gap), y: y0 + row * (rowH + gap), w: tw, h: th };
      p.label.innerHTML = `<b>${esc(shortName(p.song.name))}</b><span>${esc(p.song.artists.slice(0, 2).join(' / '))}</span>`;
      p.label.style.cssText = `left:${p.tile.x}px;top:${p.tile.y + th + 9}px;width:${tw}px`;
      show(p.label, false);
    }
  }
  const splitNames = ['第一次播放', '第二次播放', '第三次播放'].map((name, i) => {
    const e = html(frame, 'tilename', `<b>${name}</b><span>${esc(shortName(hero.song.name))}</span>`);
    const tl = splitTiles[i];
    e.style.cssText = `left:${tl.x}px;top:${tl.y + tl.h + 10}px;width:${tl.w}px`;
    show(e, false);
    return e;
  });
  const heroSplit = splitTiles[1];

  // The line over the first song, out of focus until its drop.
  const words = html(frame, 'words');
  const w1 = html(words, 'w1', '我让网易云的每一首歌');
  const w2 = html(words, 'w2', '都有了自己的 <span class="g">MV</span>');
  const fa = first.p.song.prepared.analysis;
  const fb = fa.beats.filter(b => b >= first.s0 - 0.01);
  const beatT = (n: number) => first.T0 + ((fb[n] ?? first.s0 + n * 0.6) - first.s0);
  const dropAt = first.T0 + (downbeat(fa.downbeats, first.s0, WORDS_BARS) - first.s0);
  const w1At = beatT(0) + 0.2, w2At = beatT(Math.min(4, fa.meter)) - 0.1, wordsOut = dropAt - 0.22;

  // The words over the parts.
  const shade = html(frame, 'capshade');
  const caps = CLEAN ? [] : parts.flatMap(part => (part.cut.captions ?? []).map(c => {
    const t0 = c.at === 'card' ? part.Tc + 0.15 : filmAt(part, c.at) + 0.1;
    const t1 = c.at === 'card' ? part.T0 + (filmAt(part, c.bars) - part.T0) - 0.25 : filmAt(part, c.at + c.bars) - 0.25;
    const e = html(frame, 'cap', `<div class="t">${esc(c.title)}</div>${c.line ? `<div class="l">${esc(c.line)}</div>` : ''}`);
    show(e, false);
    return { e, t0, t1 };
  }));

  // The end: the name.
  const endName = html(frame, 'endname', '<img src="/film/logo.svg" alt=""><span>BetterMV</span>');
  const endLine = html(frame, 'endline', '网易云音乐插件');
  // (The repository, small, under it — the user: “宣传片最好提到一嘴仓库”.)
  const endRepo = html(frame, 'endrepo', 'github.com/xiaoming6680/NCM-BetterMV');
  const fade = html(frame, 'fade');

  status.textContent = '准备画面…';
  // (Warmed small: the shaders are the same at any size, and no player holds the frame's buffers before it is shown.)
  for (const p of [...songsInOrder, ...others]) { fit(p, ...OFF); await p.player.warm(tick); }
  for (const p of [...songsInOrder, ...others]) show(p.stage, false);
  const lost = watchContexts([...songsInOrder, ...others].map(p => p.player));
  status.remove();

  // ---------- sound: each appearance at its loudness, switched on the bar line into the next one's lead-in ----------
  const audio: AudioPart[] = [], sfx: Sfx[] = [];
  parts.forEach((part, i) => {
    const next = parts[i + 1], lead = part.T0 - part.Tc;
    // (A song played from its start has nothing before it: its lead-in is silence.)
    const from = Math.max(0, part.s0 - lead), T0 = part.Tc + (from - (part.s0 - lead));
    audio.push({
      id: part.p.song.id, url: part.cut.audio, from, T0, T1: next ? next.Tc + 0.04 : END - 0.1,
      fadeIn: i ? 0.03 : 0.02, fadeOut: next ? (next.card ? 0.06 : 0.03) : 2.4, level: part.cut.level ?? -13,
    });
    // (A soft reversed cymbal under each lead-in, and into a jump, peaking on the downbeat.)
    if (i) sfx.push({ kind: 'swell', T: part.T0, dur: Math.max(0.45, lead + 0.15) });
  });

  // ---------- one frame ----------
  /** The cover opens over this long before the downbeat (at most half the lead-in). */
  const opening = (part: Part) => Math.min(0.32, 0.55 * (part.T0 - part.Tc));
  /** The stagger of the grid's tiles coming up, round from the middle of the lower row. */
  const delay = (p: Player) => [0.2, 0.1, 0.12, 0.22, 0.05, 0, 0.08][p.slot] ?? 0;
  /** Where a player stands: a tile's place as a transform of its full-frame stage. */
  const place = (tl: { x: number; y: number; w: number; h: number }, f: number) => `translate(${tl.x + (tl.w - W * f) / 2}px,${tl.y + (tl.h - H * f) / 2}px) scale(${f})`;
  const between = (a: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }, g: number) => ({ x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g, w: a.w + (b.w - a.w) * g, h: (a.w + (b.w - a.w) * g) * 9 / 16 });
  const full = { x: 0, y: 0, w: W, h: H };

  function renderAt(t: number): void {
    const gridOn = t >= M0 - 0.02, splitOn = t >= S0 - 0.02 && t < S1 + 0.6, out = inOutCubic(k(t, last.T1 - 0.3, last.T1 + 0.4));
    // Which appearance is on (full frame): from its cover's opening until the next one's waiting view (or jump).
    let on: Part | null = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], next = parts[i + 1];
      if (t >= part.T0 - (part.card ? opening(part) : 0) - 1e-6 && (!next || t < next.Tc + (next.card ? 0.14 : 0))) on = part;
    }
    for (const p of songsInOrder) {
      const part = on && on.p === p ? on : null;
      const inGrid = gridOn && t < last.T1 + 0.45 && (p === hero || t >= M0 + 0.1 + delay(p));
      const visible = gridOn ? inGrid : !!part;
      show(p.stage, visible);
      if (!visible) { fit(p, ...OFF); continue; }
      // (In the grid the others are drawn at their tile's size; the last song goes on at the frame's, moving into it.)
      if (inGrid && p !== hero) fit(p, p.tile.w, p.tile.h);
      else fit(p, W, H);
      // Song time: the appearance's; in the grid the others play their longest appearance again, slowed where it is
      // shorter than the grid, so each stays on the plates it showed.
      const own = parts.filter(x => x.p === p).sort((x, y) => (y.s1 - y.s0) - (x.s1 - x.s0))[0];
      let s: number, dt = 1 / 60;
      if (p === hero && gridOn) s = last.s0 + (t - last.T0);
      else if (part) s = part.s0 + (t - part.T0);
      else {
        const g0 = M0 + 0.1 + delay(p), rate = Math.min(1, (own.s1 - own.s0 - 0.4) / (last.T1 + 0.45 - g0));
        s = own.s0 + 0.25 + (t - g0) * rate;
        dt = rate / 60;
      }
      draw(p, s, dt);
      p.player.hud.visible = !gridOn && !splitOn && !!part && t >= part.T0 + 0.25;
      let tf = '', filter = '', clip = '', opacity = 1;
      if (p === hero && (splitOn || gridOn)) {
        // The last song: into the middle of the split, then to its place in the grid.
        const g1 = inOutCubic(k(t, S0, S0 + 0.7)), g2 = inOutCubic(k(t, M0, M0 + 0.9));
        const tl = between(between(full, heroSplit, g1), p.tile, g2), f = tl.w / W;
        tf = place(tl, f);
        clip = f < 0.999 ? `inset(0 round ${12 / f}px)` : '';
        opacity = 1 - (gridOn ? out : 0);
      } else if (inGrid) {
        const a = smooth(k(t, M0 + 0.1 + delay(p), M0 + 0.6 + delay(p))), f = 0.94 + 0.06 * inOutCubic(a), tl = p.tile;
        tf = `translate(${tl.x + (tl.w * (1 - f)) / 2}px,${tl.y + (tl.h * (1 - f)) / 2}px) scale(${f})`;
        clip = `inset(0 round ${12 / f}px)`;
        opacity = a * (1 - out);
      } else if (part) {
        const idx = parts.indexOf(part), next = parts[idx + 1];
        if (next && next.card && t >= next.Tc) {
          // Going under the next song's waiting view: settling back, softening, at once (it comes in on a beat).
          const g = smooth(k(t, next.Tc, next.Tc + 0.12));
          tf = `translate(${(W * 0.03 * g) / 2}px,${(H * 0.03 * g) / 2}px) scale(${1 - 0.03 * g})`;
          filter = `blur(${10 * g}px) brightness(${1 - 0.5 * g})`;
        } else if (part.card && t < part.T0 + 0.3) {
          // Coming in under its opening cover: from a little closer, as if the cover were the MV seen near.
          const g = inOutCubic(k(t, part.T0 - opening(part), part.T0 + 0.3)), f = 1.08 - 0.08 * g;
          tf = `translate(${(W * (1 - f)) / 2}px,${(H * (1 - f)) / 2}px) scale(${f})`;
        } else if (part === first && t < dropAt + 0.2) {
          // Under the line: out of focus and dark, up out of black; on the drop, into focus at once.
          const g = 1 - smooth(k(t, dropAt - 0.04, dropAt + 0.16)), up = smooth(k(t, 0, 0.8));
          filter = g > 0.001 ? `blur(${14 * g}px) brightness(${(1 - 0.55 * g) * up})` : '';
          const f = 1 + 0.06 * g;
          tf = `translate(${(W * (1 - f)) / 2}px,${(H * (1 - f)) / 2}px) scale(${f})`;
        }
      }
      p.stage.style.transform = tf;
      p.stage.style.filter = filter;
      p.stage.style.clipPath = clip;
      p.stage.style.opacity = opacity < 0.999 ? String(opacity) : '';
      p.stage.style.zIndex = p === hero && (gridOn || splitOn) ? '3' : part ? '2' : '1';
    }

    // The split's other plays: up beside the last song's, away as the grid comes.
    others.forEach((p, i) => {
      const a = smooth(k(t, S0 + 0.15 + i * 0.08, S0 + 0.7 + i * 0.08)) * (1 - smooth(k(t, M0 - 0.1, M0 + 0.35)));
      const visible = splitOn && a > 0.001;
      show(p.stage, visible);
      fit(p, ...(visible ? [p.tile.w, p.tile.h] as const : OFF));
      if (!visible) return;
      draw(p, last.s0 + (t - last.T0));
      p.player.hud.visible = false;
      const f = 0.94 + 0.06 * inOutCubic(a), tl = p.tile;
      p.stage.style.transform = `translate(${tl.x + (tl.w * (1 - f)) / 2}px,${tl.y + (tl.h * (1 - f)) / 2}px) scale(${f})`;
      p.stage.style.clipPath = `inset(0 round ${12 / f}px)`;
      p.stage.style.opacity = String(a);
      p.stage.style.zIndex = '2';
    });
    splitNames.forEach((e, i) => {
      const a = smooth(k(t, S0 + 0.45 + i * 0.06, S0 + 0.9 + i * 0.06)) * (1 - smooth(k(t, M0 - 0.2, M0 + 0.15)));
      show(e, a > 0.001);
      e.style.opacity = String(a);
      e.style.transform = `translateY(${(1 - a) * 6}px)`;
    });

    // The waiting views.
    for (const part of parts) if (part.card) cardAt(part.card, t, part.Tc, part.T0, opening(part));

    // The line over the first song.
    const wOn = t < wordsOut + 0.3;
    show(words, wOn);
    if (wOn) { appear(w1, t, w1At, wordsOut); appear(w2, t, w2At, wordsOut); }

    // The words over the parts, and the shade under them.
    let shadeOn = 0;
    for (const c of caps) {
      appear(c.e, t, c.t0, c.t1);
      shadeOn = Math.max(shadeOn, smooth(k(t, c.t0 - 0.2, c.t0 + 0.4)) * (1 - smooth(k(t, c.t1, c.t1 + 0.4))));
    }
    show(shade, shadeOn > 0.001);
    shade.style.opacity = String(shadeOn);

    // The grid's names.
    for (const p of songsInOrder) {
      const a = smooth(k(t, M0 + 0.5 + delay(p), M0 + 1.0 + delay(p))) * (1 - out);
      show(p.label, a > 0.001);
      p.label.style.opacity = String(a);
      p.label.style.transform = `translateY(${(1 - a) * 6}px)`;
    }

    // The name, then black.
    const n = inOutCubic(k(t, last.T1 + 0.15, last.T1 + 0.95));
    show(endName, n > 0.001);
    show(endLine, n > 0.001);
    endName.style.opacity = String(n);
    endName.style.transform = `translateY(${(1 - n) * 10}px) scale(${0.985 + 0.015 * n})`;
    const l = inOutCubic(k(t, last.T1 + 0.4, last.T1 + 1.15));
    endLine.style.opacity = String(l * 0.62);
    endLine.style.transform = `translateY(${(1 - l) * 8}px)`;
    const rp = inOutCubic(k(t, last.T1 + 0.75, last.T1 + 1.5));
    show(endRepo, rp > 0.001);
    endRepo.style.opacity = String(rp * 0.5);
    endRepo.style.transform = `translateY(${(1 - rp) * 8}px)`;
    fade.style.opacity = String(inOutCubic(k(t, END - 0.7, END)));
  }

  Object.assign((window as any).PROMO, {
    duration: END, fps: 60, size: [W, H], audio, sfx,
    marks: Object.fromEntries([
      ...parts.map((p, i) => [`${i + 1}-${shortName(p.p.song.name)}`, p.T0]),
      ['drop', dropAt], ['split', S0], ['grid', M0], ['name', last.T1], ['end', END],
    ]),
    renderAt: (t: number) => new Promise<void>(r => { renderAt(t); requestAnimationFrame(() => r()); }),
    lost,
    // (For looking into a frame from the console.)
    players: songsInOrder.map(p => p.player),
  });

  if (!RENDER) {
    let start = performance.now() - Number(q.get('t') ?? 0) * 1000;
    const loop = () => { renderAt(((performance.now() - start) / 1000) % END); requestAnimationFrame(loop); };
    window.addEventListener('keydown', e => { if (e.code === 'KeyR') start = performance.now(); });
    requestAnimationFrame(loop);
  }
}

const ready = main().catch(e => {
  console.error(e);
  html(frame, 'note', '出错：' + (e?.message ?? e)).style.color = '#f66';
  throw e;
});
(window as any).PROMO = { ready };
