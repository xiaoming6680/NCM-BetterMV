// BetterMV plugin entry. Opens a full-window MV for the song NetEase is playing: gathers the song (cached audio,
// lyrics, wiki, cover), analyses it in slices between frames, then renders at the time NetEase reports.
import { loadFonts } from '../render/text.ts';
import { prepareSong, styleFor, Cancelled, type PreparedSong } from '../app/prepare.ts';
import { MvPlayer } from '../app/player.ts';
import { findClient, playingSong, seek, setVolume, skip, togglePlay, volume, type Client } from './client.ts';
import { ProgressClock } from './clock.ts';
import { fetchLyric, fetchWiki, getAudio, loadCover } from './source.ts';
import { alignSong, applyAlignment, cachedAlignment, checkPack, needsAlignment } from './aligner.ts';
import { loadConfig, mvButton, Overlay, pixelRatio, settingsView, type BarSection, type Config } from './ui.ts';
import type { SectionLabel } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';

const KEY = '__betterMv';
const SECTION: Record<SectionLabel, string> = { intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏' };
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

async function readPluginFile(rel: string): Promise<ArrayBuffer> {
  const base = plugin.pluginPath.replace(/[\\/]+$/, '');
  return (await betterncm.fs.readFile(`${base}/${rel}`)).arrayBuffer();
}

// Settings exist before the client is found, so the settings page is registered at load time.
const config: Config = loadConfig();
const listeners: Array<(c: Config) => void> = [];
// Each scene's sketch for the settings page (previews/<scene>.webp in the plugin folder), read once.
const sketches = new Map<SceneId, Promise<string | null>>();
const sketch = (id: SceneId) => {
  let url = sketches.get(id);
  if (!url) {
    url = readPluginFile(`previews/${id}.webp`).then(b => URL.createObjectURL(new Blob([b], { type: 'image/webp' })), () => null);
    sketches.set(id, url);
  }
  return url;
};
const changed = (c: Config) => listeners.forEach(fn => fn(c));
plugin.onConfig(() => settingsView(config, changed, sketch));
void checkPack();

function start(client: Client): void {
  const clock = new ProgressClock();
  clock.offset = config.latencyMs / 1000;
  client.bridge.appendRegisterCall('PlayProgress', 'audioplayer', clock.onProgress);
  client.bridge.appendRegisterCall('PlayState', 'audioplayer', clock.onState);

  let player: MvPlayer | null = null;
  let fonts: Promise<void> | null = null;
  let preparing: { id: number; cancelled: boolean } | null = null;
  const ready = new Map<number, PreparedSong>();
  /** Songs whose word times are being found by the aligner pack, or were. */
  const aligned = new WeakMap<PreparedSong, 'aligning' | 'aligned'>();
  let raf = 0;
  let last = 0;

  const overlay = new Overlay({
    onClose: () => close(),
    // The picture stops (or jumps) on the click, not when NetEase's events catch up.
    onTogglePlay: () => {
      const playing = clock.playing;
      if (playing) clock.pause();
      togglePlay(client.store, playing);
    },
    onPrev: () => skip(client.store, -1),
    onNext: () => skip(client.store, 1),
    onVolume: v => setVolume(client.store, v),
    onSeek: s => {
      const to = Math.min(Math.max(0, s), duration() - 0.5);
      clock.seek(to);
      seek(client.store, to);
    },
    // What NetEase's own title bar calls (its window has no system frame).
    onDragWindow: () => { try { void Promise.resolve(client.bridge.call('winhelper.dragWindow')).catch(() => {}); } catch { /* no such call */ } },
    onToggleMaximize: () => client.store.dispatch({ type: client.store.getState()?.app?.isMaxWindow ? 'app/restoreWindow' : 'app/maximizeWindow' }),
    // The same settings, in a panel on the MV page (tried out while watching).
    settings: () => settingsView(config, changed, sketch, true),
  });
  overlay.showControls = config.controls;
  const duration = () => player?.song?.duration || playingSong(client.store)?.duration || 0;
  // What the loaded MV was planned with: a settings change replans it only when the style or the scenes changed.
  let plannedWith = '';
  const planKey = (c: Config) => `${c.style}|${c.off.join(',')}`;
  const plan = (song: PreparedSong, c: Config) => {
    plannedWith = planKey(c);
    player!.load(song, styleFor(song, c.style), new Set(c.off));
  };
  /** The line under the progress bar: the song and the style it is shown in (and why, when chosen automatically). */
  const describe = (song: PreparedSong) => {
    const words = aligned.get(song);
    overlay.info(`${song.name} — ${(song.artists ?? []).join(' / ')} · ${player!.style!.name}${config.style === 'auto' ? `（${song.choice.reason}）` : ''}` +
      (words === 'aligning' ? ' · 歌词对齐中' : words === 'aligned' ? ' · 歌词已对齐' : ''));
  };
  let replan = 0;
  let button: HTMLButtonElement | null = config.button ? mvButton(() => open()) : null;

  function loop(now: number): void {
    raf = 0;
    if (!overlay.visible || !player) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    // Only draw the song the MV was made for; while NetEase switches songs the last frame stays.
    if (player.song && (clock.songId === player.song.id || !clock.playId)) player.frame(clock.now(), dt);
    overlay.progress(clock.time(), duration(), clock.playing);
    overlay.volume(volume(client.store));
    player.hud.visible = !(overlay.awake && overlay.showControls);
    raf = requestAnimationFrame(loop);
  }

  async function prepareCurrent(): Promise<void> {
    const song = playingSong(client.store);
    if (!song) { overlay.status('请先在网易云音乐中播放歌曲'); return; }
    // Already showing this song (reopened after closing): just take the loading note away.
    if (player?.song?.id === song.id) { overlay.status(null); return; }
    if (preparing?.id === song.id) return;
    if (preparing) preparing.cancelled = true;
    const job = { id: song.id, cancelled: false };
    preparing = job;
    overlay.setBackdrop(song.cover || null);
    overlay.setStructure([], '#ffffff');
    overlay.info(`${song.name} — ${song.artists.join(' / ')}`);
    try {
      let prepared = ready.get(song.id);
      if (!prepared) {
        overlay.status('正在读取歌曲…');
        const [audio, lyric, wiki, cover] = await Promise.all([
          getAudio(client, song.id, () => job.cancelled), fetchLyric(song.id), fetchWiki(song.id), loadCover(song.cover),
        ]);
        if (job.cancelled) return;
        let wordsFromPack = false;
        prepared = await prepareSong(
          { id: song.id, name: song.name, artists: song.artists, audio, lyric, wiki, cover },
          {
            pause: nextFrame,
            cancelled: () => job.cancelled,
            onProgress: (stage, p) => overlay.status(stage === 'decode' ? '正在解码…' : `正在分析 ${Math.round(p * 100)}%`),
            // Word times found before (aligner pack) go in before the analysis reads the lyrics.
            refineLines: async lines => {
              const r = await cachedAlignment(song.id, lines);
              wordsFromPack = !!r && applyAlignment(lines, r) > 0;
            },
          },
        );
        ready.set(song.id, prepared);
        if (wordsFromPack) aligned.set(prepared, 'aligned');
        else if (needsAlignment(prepared.lines) && await checkPack()) {
          // First time: the MV starts with the estimate; the found times replace it in place when the pack is done.
          const target = prepared;
          aligned.set(target, 'aligning');
          void alignSong(song.id, target.lines, target.duration, audio).then(r => {
            const n = r ? applyAlignment(target.lines, r) : 0;
            if (n) aligned.set(target, 'aligned'); else aligned.delete(target);
            if (player?.song === target) describe(target);
          });
        }
        while (ready.size > 3) ready.delete(ready.keys().next().value as number);
      }
      if (job.cancelled || !player) return;
      plan(prepared, config);
      // The progress bar shows the song's structure: its sections, the choruses and drops in the cover's colour.
      overlay.setStructure(prepared.analysis.sections.map((x): BarSection => ({ start: x.start, end: x.end, name: SECTION[x.label], loud: x.label === 'chorus' || x.label === 'drop' })), prepared.palette.css.signal);
      overlay.status('正在准备画面…');
      await player.warm(nextFrame, () => job.cancelled);
      if (job.cancelled) return;
      overlay.status(null);
      describe(prepared);
    } catch (e) {
      if (!(e instanceof Cancelled)) overlay.status('无法生成 MV：' + ((e as Error)?.message || e));
    } finally {
      if (preparing === job) preparing = null;
    }
  }

  async function open(): Promise<void> {
    overlay.show();
    overlay.status('正在准备…');
    fonts ??= loadFonts(file => readPluginFile('fonts/' + file));
    await fonts;
    if (!player) {
      player = new MvPlayer(overlay.stage, pixelRatio(config.quality));
      window.addEventListener('resize', () => player?.resize());
    }
    player.resize();
    last = 0;
    if (!raf) raf = requestAnimationFrame(loop);
    await prepareCurrent();
  }

  function close(): void {
    overlay.hide();
    if (preparing) preparing.cancelled = true;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Follow song changes while the MV is open.
  client.store.subscribe(() => {
    // NetEase's play state (2 = playing) changes the moment anything pauses it — its own controls, a media key, the
    // tray — well before the PlayState event: the picture stops with it.
    const state = client.store.getState()?.playing?.playingState;
    if (typeof state === 'number') clock.onState('', '', state === 2 ? 1 : 0);
    if (!overlay.visible) return;
    const s = playingSong(client.store);
    if (s && s.id !== player?.song?.id && s.id !== preparing?.id) void prepareCurrent();
  });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); overlay.visible ? close() : void open(); }
  });

  listeners.push(c => {
    clock.offset = c.latencyMs / 1000;
    overlay.showControls = c.controls;
    if (c.button && !button) button = mvButton(() => open());
    if (!c.button && button) { button.remove(); button = null; }
    if (player) { player.engine.renderer.setPixelRatio(pixelRatio(c.quality)); player.resize(); }
    // Replanned a moment after the last change (a few scenes clicked off in a row load once).
    clearTimeout(replan);
    replan = window.setTimeout(() => {
      const song = player?.song;
      if (!song || !player || planKey(config) === plannedWith) return;
      plan(song, config);
      describe(song);
      void player.warm(nextFrame);
    }, 350);
  });

  (window as any)[KEY] = { open, close, clock, get player() { return player; } };
}

plugin.onLoad(() => {
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = {};
  findClient().then(client => {
    if (client) start(client);
    else console.warn('[BetterMV] 未找到网易云的内部模块，插件未启动');
  });
});
