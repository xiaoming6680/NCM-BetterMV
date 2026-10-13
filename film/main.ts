// BetterMV 的宣传片（docs/FILM.md）：“我让网易云的每一首歌，都有了自己的 MV”。
// Songs with tension, each in the plugin's own MV (the real player: its plates, lyrics, motion layer and finish). It
// opens on the armillary before a drop with the line over it, out of focus; the drop lands and the picture snaps into
// focus. Then one climax after another, each song brought in on the beat before its own climax the way the plugin
// brings in a song (its cover, its name and the line of its sections; the cover opening into the MV on the downbeat).
// The first song comes back for its last drop; on the drop's last bars the view pulls back to all of them playing side
// by side, then the name comes up over black while the song's own ending sounds. No words about where to get it.
// Every frame is a pure function of film time t (window.PROMO.renderAt), so film/render.ts can shoot it frame by frame.
//   /film/ · ?t=20 preview from 20 s · ?render (the clock is film/render.ts's)
import { loadFonts } from '../src/render/text.ts';
import { styleFor } from '../src/app/prepare.ts';
import { MvPlayer } from '../src/app/player.ts';
import { inOutCubic, smooth } from '../src/scenes/types.ts';
import { appear, cardAt, downbeat, draw, esc, H, html, k, loadSong, makeCard, nearest, shortName, show, tick, W, watchContexts, type AudioPart, type Card, type Sfx, type Song } from './shared.ts';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render');
const frame = document.getElementById('frame') as HTMLDivElement;

/**
 * The film in appearances of songs, in order. Each plays whole bars from a downbeat: `bar` bars after the start of the
 * n-th section labelled `label` (by the plugin's own analysis), for `bars` bars, coming in `lead` beats early with its
 * waiting view (0: the first, under the line). `seed` fixes the plugin's draw of plates and cameras (it draws a new one
 * every play) to one that puts a good plate there; a song that comes back keeps its seed. `level`: LUFS in the mix.
 */
interface Cut { id: number; label: string; n?: number; bar?: number; bars: number; seed: number; lead: number; level?: number }
const CUTS: Cut[] = [
  // If The Sun Burns Out Tonight (VALORANT): the armillary before its first drop under the line, then the drop.
  { id: 3437356861, label: 'drop', bar: -2, bars: 4, seed: 364, lead: 0 },
  { id: 1300995139, label: 'drop', n: 2, bars: 2, seed: 1, lead: 1 },     // 筝鸣: its second drop, the spectrum tube
  { id: 2124415181, label: 'drop', bars: 2, seed: 3, lead: 1 },           // 赴大荒 (墨): the ink on rice paper
  { id: 3444858995, label: 'chorus', bars: 1, seed: 1, lead: 1 },         // Know My Name (字): the wall of words
  { id: 1329940346, label: 'drop', bar: 4, bars: 2, seed: 17, lead: 1 },  // Can You Hear Me: the Sierpinski fractal
  { id: 441489207, label: 'drop', bar: 8, bars: 2, seed: 2, lead: 1 },    // Shelter (Pure 100% Remix): the kaleidoscope
  // If The Sun Burns Out Tonight again: its last drop, to where the song's outro begins (the tunnel again, the orb; in
  // the grid, the armillary closing up).
  { id: 3437356861, label: 'drop', n: 3, bars: 8, seed: 364, lead: 1, level: -12.5 },
];
/** The line over the first song until this bar of it (the drop), when the picture snaps into focus. */
const WORDS_BARS = 2;
/** The grid: over the last appearance's last bars. */
const GRID_BARS = 2;
/** After the last appearance (the song's own outro under the name), then black. */
const TAIL = 4.8;

// ---------- the film ----------
/** A song's player, on a stage of its own (shared by its appearances), and its place in the closing grid. */
interface Player { song: Song; stage: HTMLDivElement; player: MvPlayer; lastDraw: number; tile: { x: number; y: number; w: number; h: number }; label: HTMLDivElement; slot: number }
/** One appearance: its bars in song time, where they fall in film time, and its waiting view. */
interface Part { cut: Cut; p: Player; s0: number; s1: number; T0: number; T1: number; Tc: number; card: Card | null }

async function main(): Promise<void> {
  const status = html(frame, 'note', '加载中…');
  await loadFonts('/fonts/');
  await document.fonts.load('900 64px PF');

  // ---------- the songs, each on a stage of its own ----------
  const players = new Map<number, Player>();
  for (const c of CUTS) {
    if (players.has(c.id)) continue;
    status.textContent = `分析 ${players.size + 1} / ${new Set(CUTS.map(x => x.id)).size}…`;
    const song = await loadSong(c.id);
    const stage = html(frame, 'stage');
    const player = new MvPlayer(stage, 1.5);
    player.load(song.prepared, styleFor(song.prepared, 'auto'), new Set(), undefined, undefined, 0, c.seed);
    players.set(c.id, { song, stage, player, lastDraw: -1e9, tile: { x: 0, y: 0, w: W, h: H }, label: html(frame, 'tilename'), slot: 0 });
  }

  // ---------- the appearances: when each plays (film time) ----------
  const parts: Part[] = [];
  let T = 0;
  for (const cut of CUTS) {
    const p = players.get(cut.id)!, a = p.song.prepared.analysis;
    const secs = a.sections.filter(s => s.label === cut.label);
    const sec = secs[Math.min(secs.length, cut.n ?? 1) - 1] ?? a.sections[0];
    const s0 = downbeat(a.downbeats, sec.start, cut.bar ?? 0), s1 = downbeat(a.downbeats, s0, cut.bars);
    // The waiting view takes the beats before the downbeat the song comes in on (its own lead-in under it).
    const bi = nearest(a.beats, s0);
    const lead = cut.lead ? s0 - (a.beats[Math.max(0, bi - cut.lead)] ?? s0 - 0.6 * cut.lead) : 0;
    const Tc = T, T0 = T + lead, T1 = T0 + (s1 - s0);
    T = T1;
    parts.push({ cut, p, s0, s1, T0, T1, Tc, card: cut.lead ? makeCard(frame, p.song) : null });
  }
  const first = parts[0], last = parts[parts.length - 1], hero = last.p;
  const barOf = (part: Part) => { const d = part.p.song.prepared.analysis.downbeats; return downbeat(d, part.s1) - downbeat(d, part.s1, -1); };
  // The grid on the last bars; the name as the song's outro begins; black at the end.
  const M0 = last.T1 - GRID_BARS * barOf(last), END = last.T1 + TAIL;

  // The grid's places: 3 × 2 of 16:9 tiles, the last song (playing on) in the middle of the lower row; the others in the
  // order they came.
  {
    const cols = 3, gap = 22, tw = 344, th = tw * 9 / 16, lab = 44;
    const gw = cols * tw + (cols - 1) * gap, gh = 2 * (th + lab) + gap;
    const x0 = (W - gw) / 2, y0 = (H - gh) / 2 - 6;
    const others = [...players.values()].filter(p => p !== hero);
    const slots = [0, 1, 2, 3, 5];
    others.forEach((p, i) => { p.slot = slots[i] ?? i; });
    hero.slot = 4;
    for (const p of players.values()) {
      const c = p.slot % cols, r = Math.floor(p.slot / cols);
      p.tile = { x: x0 + c * (tw + gap), y: y0 + r * (th + lab + gap), w: tw, h: th };
      p.label.innerHTML = `<b>${esc(shortName(p.song.name))}</b><span>${esc(p.song.artists.slice(0, 2).join(' / '))}</span>`;
      p.label.style.cssText = `left:${p.tile.x}px;top:${p.tile.y + th + 10}px;width:${tw}px`;
      show(p.label, false);
    }
  }

  // The line over the first song, out of focus until its drop.
  const words = html(frame, 'words');
  const w1 = html(words, 'w1', '我让网易云的每一首歌');
  const w2 = html(words, 'w2', '都有了自己的 <span class="g">MV</span>');
  const fa = first.p.song.prepared.analysis;
  const fb = fa.beats.filter(b => b >= first.s0 - 0.01);
  const beatT = (n: number) => first.T0 + ((fb[n] ?? first.s0 + n * 0.6) - first.s0);
  const dropAt = first.T0 + (downbeat(fa.downbeats, first.s0, WORDS_BARS) - first.s0);
  const w1At = beatT(0) + 0.2, w2At = beatT(Math.min(4, fa.meter)) - 0.1, wordsOut = dropAt - 0.22;

  // The end: the name.
  const endName = html(frame, 'endname', '<img src="/film/logo.svg" alt=""><span>BetterMV</span>');
  const endLine = html(frame, 'endline', '网易云音乐插件');
  // (The repository, small, under it — the user: “宣传片最好提到一嘴仓库”.)
  const endRepo = html(frame, 'endrepo', 'github.com/xiaoming6680/NCM-BetterMV');
  const fade = html(frame, 'fade');

  status.textContent = '准备画面…';
  for (const p of players.values()) await p.player.warm(tick);
  for (const p of players.values()) show(p.stage, false);
  const lost = watchContexts([...players.values()].map(p => p.player));
  status.remove();

  // ---------- sound: each appearance at its loudness, switched on the bar line into the next song's lead-in ----------
  const audio: AudioPart[] = [], sfx: Sfx[] = [];
  parts.forEach((part, i) => {
    const next = parts[i + 1], lead = part.T0 - part.Tc;
    audio.push({
      id: part.p.song.id, from: part.s0 - lead, T0: part.Tc, T1: next ? next.Tc + 0.04 : END - 0.1,
      fadeIn: i ? 0.03 : 0.02, fadeOut: next ? 0.06 : 2.4, level: part.cut.level ?? -13,
    });
    // (A soft reversed cymbal under each lead-in, peaking on the downbeat.)
    if (i) sfx.push({ kind: 'swell', T: part.T0, dur: Math.max(0.45, lead + 0.15) });
  });

  // ---------- one frame ----------
  /** The cover opens over this long before the downbeat (at most half the lead-in). */
  const opening = (part: Part) => Math.min(0.32, 0.55 * (part.T0 - part.Tc));
  /** The stagger of the grid's tiles coming up, round from the middle of the lower row. */
  const delay = (p: Player) => [0.2, 0.1, 0.25, 0.05, 0, 0.15][p.slot] ?? 0;

  function renderAt(t: number): void {
    const gridOn = t >= M0 - 0.02, out = inOutCubic(k(t, last.T1 - 0.3, last.T1 + 0.4));
    // Which appearance is on (full frame): from its cover's opening until the next one's waiting view is up.
    let on: Part | null = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], next = parts[i + 1];
      if (t >= part.T0 - (part.card ? opening(part) : 0) - 1e-6 && (!next || t < next.Tc + 0.14)) on = part;
    }
    for (const p of players.values()) {
      // The appearance this player shows now: on in full frame (the latest whose window holds t), or in the grid.
      const part = on && on.p === p && !(gridOn && p !== hero) ? on : null;
      const inGrid = gridOn && t < last.T1 + 0.45 && (p === hero || t >= M0 + 0.1 + delay(p));
      // (Once the grid is up, only the grid: the last song's own picture is not to come back full frame under the name.)
      const visible = gridOn ? inGrid : !!part;
      show(p.stage, visible);
      if (!visible) continue;
      // Song time: the appearance's; in the grid the others play their first appearance again, slowed where it is
      // shorter than the grid, so that each stays on the plate it showed (the next one would be new in a small tile).
      const own = parts.find(x => x.p === p)!;
      let s: number, dt = 1 / 60;
      if (part) s = part.s0 + (t - part.T0);
      else if (p === hero) s = last.s0 + (t - last.T0);
      else {
        const g0 = M0 + 0.1 + delay(p), rate = Math.min(1, (own.s1 - own.s0 - 0.4) / (last.T1 + 0.45 - g0));
        s = own.s0 + 0.25 + (t - g0) * rate;
        dt = rate / 60;
      }
      draw(p, s, dt);
      p.player.hud.visible = !gridOn && !!part && t >= part.T0 + 0.25;
      let tf = '', filter = '', clip = '', opacity = 1;
      if (inGrid) {
        const tl = p.tile, sc = tl.w / W;
        if (p === hero) {
          const g = inOutCubic(k(t, M0, M0 + 0.95)), f = 1 + (sc - 1) * g;
          tf = `translate(${tl.x * g}px,${tl.y * g}px) scale(${f})`;
          clip = `inset(0 round ${(12 / f) * g}px)`;
        } else {
          const a = smooth(k(t, M0 + 0.1 + delay(p), M0 + 0.6 + delay(p)));
          const f = sc * (0.94 + 0.06 * inOutCubic(a));
          tf = `translate(${tl.x + (tl.w - W * f) / 2}px,${tl.y + (tl.h - H * f) / 2}px) scale(${f})`;
          clip = `inset(0 round ${12 / f}px)`;
          opacity = a;
        }
        opacity *= 1 - out;
      } else if (part) {
        const idx = parts.indexOf(part), next = parts[idx + 1];
        if (next && t >= next.Tc) {
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
      p.stage.style.zIndex = p === hero && inGrid ? '3' : part ? '2' : '1';
    }

    // The waiting views.
    for (const part of parts) if (part.card) cardAt(part.card, t, part.Tc, part.T0, opening(part));

    // The line over the first song.
    const wOn = t < wordsOut + 0.3;
    show(words, wOn);
    if (wOn) { appear(w1, t, w1At, wordsOut); appear(w2, t, w2At, wordsOut); }

    // The grid's names.
    for (const p of players.values()) {
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
      ['drop', dropAt], ['grid', M0], ['name', last.T1], ['end', END],
    ]),
    renderAt: (t: number) => new Promise<void>(r => { renderAt(t); requestAnimationFrame(() => r()); }),
    lost,
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
