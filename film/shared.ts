// What the films share (film/main.ts, the promo; film/reel.ts, the reel): a song loaded the way the plugin loads it, the
// plugin's waiting view on a film's clock, words in the manner of a keynote, and the bar arithmetic. Every frame of a
// film is a pure function of its time, so film/render.ts can shoot it frame by frame.
import { parseWiki } from '../src/meta/wiki.ts';
import { parseChorus } from '../src/plugin/source.ts';
import { prepareSong, type PreparedSong } from '../src/app/prepare.ts';
import type { MvPlayer } from '../src/app/player.ts';
import { clamp01, inOutCubic, smooth } from '../src/scenes/types.ts';

export const W = 1280, H = 720;

export const tick = () => new Promise<void>(r => setTimeout(r, 0));
export const k = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const html = (parent: HTMLElement, cls: string, inner = ''): HTMLDivElement => {
  const e = document.createElement('div');
  e.className = cls;
  if (inner) e.innerHTML = inner;
  parent.appendChild(e);
  return e;
};
// display, not visibility: a hidden box hides everything in it, whatever its children were last set to.
export const show = (e: HTMLElement, on: boolean) => { const d = on ? '' : 'none'; if (e.style.display !== d) e.style.display = d; };
export const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败 ' + url));
    img.src = url;
  });
}

export interface Song { id: number; prepared: PreparedSong; name: string; artists: string[] }
/** `audio`: a file of the song's elsewhere (the dev server's /media/…), for a song NetEase no longer has cached. */
export async function loadSong(id: number, audio?: string): Promise<Song> {
  const [detail, wikiDoc, chorusDoc, lyric, audioBuf, img] = await Promise.all([
    fetch(`/ncm/detail/${id}`).then(r => r.json()),
    fetch(`/ncm/wiki/${id}`).then(r => r.json()).catch(() => null),
    fetch(`/ncm/chorus/${id}`).then(r => r.json()).catch(() => null),
    fetch(`/ncm/lyric/${id}`).then(r => r.json()),
    fetch(audio ?? `/ncm/audio/${id}`).then(r => { if (!r.ok) throw new Error(`${id} 不在网易云缓存里`); return r.arrayBuffer(); }),
    loadImage(`/ncm/cover/${id}`),
  ]);
  const prepared = await prepareSong(
    { id, name: detail?.name, artists: detail?.artists, audio: audioBuf, lyric, wiki: wikiDoc ? parseWiki(wikiDoc) : undefined, chorus: parseChorus(chorusDoc, id), cover: img },
    { pause: tick },
  );
  return { id, prepared, name: detail?.name ?? '', artists: detail?.artists ?? [] };
}

/** A song's name as NetEase writes it, without what follows in brackets (features, “from the series …”). */
export const shortName = (name: string) => name.replace(/\s*[(（[].*$/, '').trim() || name;

/** The index of the time in `ts` nearest t. */
export function nearest(ts: number[], t: number): number {
  let i = 0;
  for (let j = 1; j < ts.length; j++) if (Math.abs(ts[j] - t) < Math.abs(ts[i] - t)) i = j;
  return i;
}
/** The downbeat nearest t, moved by n bars (past either end, by the mean bar). */
export function downbeat(downbeats: number[], t: number, n = 0): number {
  const at = nearest(downbeats, t) + n;
  if (at < downbeats.length && at >= 0) return downbeats[at];
  const bar = downbeats.length > 1 ? (downbeats[downbeats.length - 1] - downbeats[0]) / (downbeats.length - 1) : 2;
  return at < 0 ? downbeats[0] + at * bar : downbeats[downbeats.length - 1] + (at - downbeats.length + 1) * bar;
}

/** The soundtrack, for film/render.ts: a song's audio from `from` (song time) laid at film time T0 to T1. */
export interface AudioPart { id: number; from: number; T0: number; T1: number; fadeIn?: number; fadeOut?: number; level?: number; url?: string }
export interface Sfx { kind: 'click' | 'swell' | 'down' | 'whoosh' | 'key' | 'tick'; T: number; dur?: number }

/** The size of a player's stage while it is off: next to nothing (see fit). */
export const OFF = [64, 36] as const;
/**
 * Sizes a player's stage, and with it its renderer's buffers: the frame, a tile, or OFF while it is not shown. (A
 * player that has drawn at the frame's size holds about a gigabyte of buffers; with every song's player kept at that
 * size, the reel's GPU process ran out of memory as its fourth or fifth song came in — every context lost at once, the
 * rest of the film white.) After a resize the player starts over: draw() runs it up again.
 */
export function fit(p: { stage: HTMLDivElement; player: MvPlayer; lastDraw: number; size?: string }, w: number, h: number): void {
  const size = `${w}x${h}`;
  if (p.size === size) return;
  p.size = size;
  p.stage.style.width = `${w}px`;
  p.stage.style.height = `${h}px`;
  // (The engine measures its box, and a box that is display: none measures nothing: it would take the window's size.)
  const off = p.stage.style.display === 'none';
  if (off) p.stage.style.display = '';
  p.player.resize();
  if (off) p.stage.style.display = 'none';
  // (Freed buffers are only given back once the context's commands go through, and a player that is off sends none:
  // without this the memory came back only when the grid drew them all again.)
  p.player.engine.renderer.getContext().flush();
  p.lastDraw = -1e9;
}

/** Counts the players' lost WebGL contexts, so film/render.ts stops on one rather than shooting white frames. */
export function watchContexts(players: MvPlayer[]): () => number {
  let lost = 0;
  for (const p of players) p.engine.renderer.domElement.addEventListener('webglcontextlost', () => lost++);
  return () => lost;
}

/** Song time s on a player, `dt` after its last frame; after a jump, a second of run-up first (trails, eases). */
export function draw(p: { player: MvPlayer; lastDraw: number }, s: number, dt = 1 / 60): void {
  if (Math.abs(s - p.lastDraw - dt) > 1e-3) for (let i = 60; i >= 1; i--) p.player.frame(s - i * dt, dt);
  p.lastDraw = s;
  p.player.frame(s, dt);
}

/** The plugin's waiting view (src/plugin/ui.ts, .bmv-load) on the film's clock: artwork, name, the line of sections. */
export interface Card { root: HTMLDivElement; bd: HTMLDivElement[]; art: HTMLDivElement; title: HTMLDivElement; artist: HTMLDivElement; line: HTMLDivElement; fill: HTMLDivElement; lit: HTMLDivElement }
/**
 * The cover drawn into a canvas in `parent` (square, `size` pixels): a canvas is painted the frame it is shown, where a
 * CSS background of a box that was display: none is only decoded then — the first frames of a card with a large cover
 * (赴大荒's, 1.7 MB) came out without it.
 */
export function coverCanvas(parent: HTMLElement, img: HTMLImageElement, size: number): void {
  const c = document.createElement('canvas'), side = Math.min(img.naturalWidth, img.naturalHeight);
  c.width = c.height = size;
  c.className = 'img';
  c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  parent.appendChild(c);
}
export function makeCard(frame: HTMLElement, song: Song): Card {
  const p = song.prepared, img = p.cover.image as HTMLImageElement;
  const root = html(frame, 'card');
  const back = html(root, 'bd');
  const bd = [html(back, 'bd1'), html(back, 'bd2')];
  for (const b of bd) coverCanvas(b, img, 256);
  html(back, 'vig');
  const box = html(root, 'box');
  const art = html(box, 'art');
  coverCanvas(art, img, 1024);
  const title = html(box, 'title', esc(shortName(song.name)));
  const artist = html(box, 'artist', esc(song.artists.slice(0, 3).join(' / ')));
  const line = html(box, 'line');
  const segs = (cls: string) => {
    const e = html(line, cls), d = p.analysis.duration;
    for (const s of p.analysis.sections) {
      const i = document.createElement('i');
      if (s.label === 'chorus' || s.label === 'drop') i.className = 'loud';
      i.style.left = `calc(${(s.start / d) * 100}% + 1px)`;
      i.style.width = `calc(${((s.end - s.start) / d) * 100}% - 2px)`;
      e.appendChild(i);
    }
    return e;
  };
  segs('segs');
  const fill = html(line, 'fill');
  const lit = segs('segs lit');
  fill.appendChild(lit);
  root.style.setProperty('--song', p.palette.css.signal);
  show(root, false);
  return { root, bd, art, title, artist, line, fill, lit };
}

/**
 * A song's waiting view at film time t: up at Tc over what was playing, its line filling as the song is read, its
 * cover opening (over R seconds) into the MV on the downbeat T0.
 */
export function cardAt(c: Card, t: number, Tc: number, T0: number, R: number): void {
  const on = t >= Tc && t < T0 + 0.45;
  show(c.root, on);
  if (!on) return;
  const u = t - Tc;
  // The cover's colours, turning slowly; up at once over the last song, away as the MV opens.
  const bin = smooth(k(u, 0, 0.14)), bout = inOutCubic(k(t, T0 - 0.6 * R, T0 + 0.35));
  (c.root.firstElementChild as HTMLElement).style.opacity = String(bin * (1 - bout));
  c.bd[0].style.transform = `scale(5.4) rotate(${(t * 360) / 56}deg)`;
  c.bd[1].style.transform = `scale(5.4) rotate(${(-t * 360) / 74}deg)`;
  // The artwork: up from a little smaller; then it opens to the whole frame as it fades, the MV under it.
  const ain = inOutCubic(k(u, 0.02, 0.22)), open = inOutCubic(k(t, T0 - R, T0 + 0.32));
  const size = c.art.offsetWidth || 1, full = (Math.max(W, H) * 1.15) / size;
  c.art.style.transform = `scale(${(0.94 + 0.06 * ain) * (1 + (full - 1) * open)})`;
  c.art.style.opacity = String(ain * (1 - smooth(k(t, T0 - R * 0.35, T0 + 0.3))));
  c.art.style.borderRadius = `${14 / (1 + (full - 1) * open * 0.6)}px`;
  // The name and the line: in right after the artwork, out as it opens.
  const txt = (d: number) => smooth(k(u, 0.05 + d, 0.2 + d)) * (1 - smooth(k(t, T0 - R - 0.06, T0 - R + 0.06)));
  for (const [e, d] of [[c.title, 0], [c.artist, 0.03], [c.line, 0.05]] as const) {
    const v = txt(d);
    e.style.opacity = String(v);
    e.style.transform = `translateY(${(1 - v) * 6}px)`;
  }
  // The line of the song's sections fills as the song is read (the plugin's own progress).
  const f = inOutCubic(k(u, 0.06, Math.max(0.12, T0 - R - Tc)));
  c.fill.style.transform = `translateX(${(f - 1) * 100}%)`;
  c.lit.style.transform = `translateX(${(1 - f) * 100}%)`;
}

/** Words in the manner of a keynote: in from a soft blur, out quickly the same way. */
export function appear(e: HTMLElement, t: number, t0: number, t1: number): void {
  const on = t >= t0 && t < t1 + 0.3;
  show(e, on);
  if (!on) return;
  const a = inOutCubic(k(t, t0, t0 + 0.55)), b = inOutCubic(k(t, t1, t1 + 0.22)), v = a * (1 - b);
  e.style.opacity = String(v);
  e.style.filter = v < 0.999 ? `blur(${(1 - v) * 14}px)` : '';
  e.style.transform = `scale(${1.04 - 0.04 * a + 0.03 * b})`;
}
