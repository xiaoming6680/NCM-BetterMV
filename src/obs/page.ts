// The OBS page: the MV alone, for a browser source in OBS at http://127.0.0.1:32109/, so a stream shows the picture and
// none of NetEase's window. The plugin sends the song it prepared and where NetEase is playing to the local server
// (src/obs/helper/BetterMVObs.cs), which serves this page and pushes the play state to it; the page draws the same MV
// with the same renderer, style and seed, its clock running on from the plugin's last stamp. No sound: OBS takes
// NetEase's own. It tells the server whether OBS shows it, so the plugin can stop drawing its own MV page meanwhile.
import { MvPlayer } from '../app/player.ts';
import { styleFor, yieldToPage, type PreparedSong } from '../app/prepare.ts';
import { loadFonts } from '../render/text.ts';
import type { SceneId } from '../scenes/types.ts';
import type { LookId } from '../director/director.ts';
import { OBS_VERSION, readSong, type ObsPlan, type ObsState } from './snapshot.ts';

/** A playing state is run on by the clock for at most this long without a newer one (the plugin sends one a second). */
const STALE_MS = 5000;
/** Without the server this long (NetEase closed), the picture goes to black. */
const GONE_MS = 3000;
/** Song-time errors beyond this are taken at once (a seek); smaller ones are eased out. */
const JUMP = 0.25;

/** Inside OBS (its browser source adds window.obsstudio): no notes on screen, they would go out on the stream. */
const inObs = 'obsstudio' in window;
const stage = document.getElementById('stage')!;
const waitEl = document.getElementById('wait')!;
const noteEl = document.getElementById('note')!;

let state: ObsState | null = null;
/** When the push channel was last open (performance.now), or 0 while it is. */
let lostAt = 0;
/** This page, to the server: which connection is whose visibility report. */
const id = Math.random().toString(36).slice(2, 10);
// (OBS hides the page of a source it doesn't show, so its visibility state is right from the start; its own event
// says the same, sooner.)
let visible = document.visibilityState === 'visible';

const events = new EventSource(`/events?id=${id}&obs=${inObs ? 1 : 0}&visible=${visible ? 1 : 0}`);
events.addEventListener('state', e => {
  const s = JSON.parse((e as MessageEvent).data) as ObsState;
  if (s?.v === OBS_VERSION) state = s;
});
// (Reconnecting after NetEase was restarted: the server is new and has to be told again.)
events.onopen = () => { lostAt = 0; report(); };
events.onerror = () => { if (!lostAt) lostAt = performance.now(); };

/**
 * Tells the server what went wrong (kept there: the plugin's settings show it). With ?debug in the address, every step
 * of loading a song too.
 */
const debug = new URLSearchParams(location.search).has('debug');
function diag(msg: string, step = false): void {
  if (step && !debug) return;
  void fetch(`/log?obs=${inObs ? 1 : 0}&msg=${encodeURIComponent(msg.slice(0, 300))}`).catch(() => {});
}
window.addEventListener('error', e => diag('出错：' + (e.message || e.type)));
window.addEventListener('unhandledrejection', e => diag('出错：' + String((e.reason as Error)?.message ?? e.reason)));

function report(): void {
  void fetch(`/presence?id=${id}&visible=${visible ? 1 : 0}`).catch(() => {});
}
// OBS: shown in its preview or programme, or not (a source in a scene not on screen still runs).
window.addEventListener('obsSourceVisibleChanged', e => { visible = !!(e as CustomEvent).detail?.visible; report(); });
document.addEventListener('visibilitychange', () => { visible = document.visibilityState === 'visible'; report(); });

/** Milliseconds the last song took to read, unpack, plan and warm (for tools). */
const timing = { read: 0, unpack: 0, plan: 0, warm: 0 };

/** A song file from the server, unpacked. */
async function fetchSong(file: string): Promise<PreparedSong> {
  const t0 = performance.now();
  const r = await fetch(`/song/${encodeURIComponent(file)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('服务里没有这首歌（' + r.status + '）');
  const data = await r.arrayBuffer();
  const t1 = performance.now();
  const song = await readSong(data);
  timing.read = Math.round(t1 - t0);
  timing.unpack = Math.round(performance.now() - t1);
  return song;
}

// Over the picture whenever it isn't the song playing: while a song is prepared (in NetEase) and loaded (here), the
// cover, alive, and the song's name; black when nothing plays.
function wait(on: boolean, song: ObsState['song']): void {
  waitEl.classList.toggle('is-on', on);
  waitEl.classList.toggle('has-song', on && !!song);
  if (!on || !song) return;
  const cover = song.cover ? `url("${song.cover.replace(/^http:/, 'https:').replace(/\?.*$/, '')}?param=600y600")` : '';
  if (waitEl.dataset.id !== String(song.id)) {
    waitEl.dataset.id = String(song.id);
    for (const el of waitEl.querySelectorAll<HTMLElement>('.bd, .art')) el.style.backgroundImage = cover;
    waitEl.querySelector('.title')!.textContent = song.name;
    waitEl.querySelector('.artist')!.textContent = song.artists.join(' / ');
  }
}

function note(text: string | null): void {
  const t = inObs ? '' : text ?? '';
  if (noteEl.textContent !== t) noteEl.textContent = t;
}

const planKey = (p: ObsPlan | null) => (p ? `${p.style}|${p.off.join(',')}|${p.lyricDelay}|${p.seed}` : '');

let player: MvPlayer | null = null;
/** The song file on the player, the one being loaded, and the plan it was loaded with. */
let shown: string | null = null;
let loading: string | null = null;
let planned = '';
/** The player has the song and its plates are warm: frames go to the screen. */
let ready = false;
/** A song that failed to load, and when (tried again a few seconds later). */
let failed: { file: string; at: number } | null = null;

async function show(file: string, plan: ObsPlan): Promise<void> {
  loading = file;
  ready = false;
  try {
    diag(`读取 ${file}`, true);
    const song = await fetchSong(file);
    diag(`已读取 ${timing.read} ms，解包 ${timing.unpack} ms`, true);
    if (state?.file !== file) return;
    let t = performance.now();
    player ??= new MvPlayer(stage, 1);
    load(song, plan);
    shown = file;
    timing.plan = Math.round(performance.now() - t);
    diag(`已建场景 ${timing.plan} ms`, true);
    t = performance.now();
    await player.warm(yieldToPage, () => shown !== file);
    timing.warm = Math.round(performance.now() - t);
    diag(`已预热 ${timing.warm} ms`, true);
    if (shown === file) { ready = true; failed = null; }
  } catch (e) {
    console.warn('[BetterMV OBS]', e);
    const where = String((e as Error)?.stack ?? '').split('\n')[1]?.trim();
    diag('无法加载歌曲：' + ((e as Error)?.message || e) + (where ? ' @ ' + where : ''));
    failed = { file, at: performance.now() };
  } finally {
    if (loading === file) loading = null;
  }
}

function load(song: PreparedSong, plan: ObsPlan): void {
  planned = planKey(plan);
  player!.load(song, styleFor(song, plan.style), new Set(plan.off as Array<SceneId | LookId>), undefined, undefined, plan.lyricDelay, plan.seed);
}

/** Song time to draw: the plugin's stamp run on by the wall clock, minus the sound's latency. Eased, not stepped. */
let lead = 0;
let leadSet = false;
function songTime(now: number): number {
  const s = state!;
  const target = s.t + (s.playing ? Math.min(Date.now() - s.at, STALE_MS) / 1000 : 0) - s.delay;
  if (!s.playing || Date.now() - s.at > STALE_MS) { leadSet = false; return target; }
  const t = lead + now / 1000, error = target - t;
  if (!leadSet || Math.abs(error) > JUMP) { lead = target - now / 1000; leadSet = true; return target; }
  lead += error * 0.05;
  return t;
}

let last = 0;
/** The song time last drawn. */
let drawn = 0;
/** For checking frames without the clock (tools, comparisons with the MV page): song time held on screen, or null. */
let held: number | null = null;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  const gone = lostAt > 0 && now - lostAt > GONE_MS;
  if (!state || gone) {
    wait(held === null, null);
    note(gone ? '连接已断开，网易云音乐打开后自动恢复' : '等待网易云音乐播放');
    return;
  }
  const { file, plan } = state;
  note(!state.song ? '等待网易云音乐播放' : failed?.file === file ? '无法读取这首歌，稍后重试' : null);
  if (file && plan && file !== shown && file !== loading && !(failed?.file === file && now - failed.at < 3000)) void show(file, plan);
  // A settings change in NetEase (style, plates, lyric delay, a new arrangement): the song planned anew.
  else if (file && plan && file === shown && ready && planKey(plan) !== planned && player?.song) {
    load(player.song, plan);
    void player.warm(yieldToPage);
  }
  const live = ready && file === shown && !!player?.song && player.song.id === state.song?.id;
  wait(!live && held === null, state.song);
  if (held !== null) player?.frame(held, 1 / 60);
  else if (live) player!.frame(drawn = songTime(now), dt);
}

(window as any).bmvObs = {
  get state() { return state; }, get player() { return player; }, get ready() { return ready; }, get time() { return drawn; }, timing,
  renderAt: (t: number) => player?.frame(t, 1 / 60),
  hold: (t: number | null) => { held = t; },
};

window.addEventListener('resize', () => player?.resize());
loadFonts('fonts/').catch(e => console.warn('[BetterMV OBS] 字体', e)).finally(() => requestAnimationFrame(frame));
