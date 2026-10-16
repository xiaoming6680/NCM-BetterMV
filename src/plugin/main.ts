// BetterMV plugin entry. Opens a full-window MV for the song NetEase is playing: gathers the song (cached audio,
// lyrics, wiki, cover), analyses it in slices between frames, then renders at the time NetEase reports.
import { loadFonts } from '../render/text.ts';
import { prepareSong, styleFor, Cancelled, whenIdle, yieldToPage, type PreparedSong, type Stage } from '../app/prepare.ts';
import { MvPlayer } from '../app/player.ts';
import {
  findClient, isMaximized, nextSong, liked, listTrack, minimizeWindow, playingIndex, playingSong, playItem, playList, playMode, seek, setPlayMode,
  setVolume, skip, toggleLike, toggleMaximize, togglePlay, volume, type Client, type PlayingSong,
} from './client.ts';
import { ProgressClock } from './clock.ts';
import { fetchChorus, fetchLyric, fetchWiki, getAudio, loadCover, songCacheDir } from './source.ts';
import { alignSong, applyAlignment, cachedAlignment, checkPack, needsAlignment } from './aligner.ts';
import { isRecordingKeys, keyCombo, loadConfig, mvButton, Overlay, pixelRatio, settingsView, type BarSection, type Config, type QueueTrack } from './ui.ts';
import type { SectionLabel } from '../types.ts';

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
// Each scene's (and look's) sketch for the settings page (previews/<scene>.webp, previews/look-<id>.webp in the plugin
// folder), read once.
const sketches = new Map<string, Promise<string | null>>();
const sketch = (id: string) => {
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

/** A song being prepared: the one to show (urgent), or the next one ahead. */
interface Job { id: number; cancelled: boolean; urgent: boolean; progress?: (stage: Stage, progress: number) => void }
/** A song read and prepared, with its audio (for the aligner pack) and whether its word times came from the pack. */
interface Gathered { song: PreparedSong; audio: ArrayBuffer; wordsFromPack: boolean }
interface Ahead { job: Job; done: Promise<Gathered | null> }

function start(client: Client): void {
  const clock = new ProgressClock();
  clock.offset = config.latencyMs / 1000;
  client.bridge.appendRegisterCall('PlayProgress', 'audioplayer', clock.onProgress);
  client.bridge.appendRegisterCall('PlayState', 'audioplayer', clock.onState);
  void songCacheDir(client); // records the client's cache folder for the dev tools

  let player: MvPlayer | null = null;
  window.addEventListener('resize', () => player?.resize());
  let fonts: Promise<void> | null = null;
  let preparing: Job | null = null;
  /** The next song being prepared in the background (prefetchNext). */
  let ahead: Ahead | null = null;
  const ready = new Map<number, PreparedSong>();
  /** Songs whose word times are being found by the aligner pack, or were. */
  const aligned = new WeakMap<PreparedSong, 'aligning' | 'aligned'>();
  let raf = 0;
  let last = 0;
  /** With a frame cap: when the next picture is due (the schedule the cap keeps). */
  let due = 0;
  /** NetEase's play list as the list panel shows it: its entries (to play one), their names, the playing one. */
  const queue = { list: [] as readonly any[], tracks: [] as QueueTrack[], at: -2 };

  /**
   * Whether NetEase is playing: its store's play state (2 = playing), the clock only when the store has none. The
   * clock counts as playing only within 350 ms of a progress event (none yet just after a resume or a seek, or when a
   * heavy frame holds them up), so the pause button asked it, sent a resume to a playing song and the first press did
   * nothing (the user: “暂停键有时候第一次按下不起效果”).
   */
  const isPlaying = () => {
    const state = client.store.getState()?.playing?.playingState;
    return typeof state === 'number' ? state === 2 : clock.playing;
  };
  const overlay = new Overlay({
    onClose: () => close(),
    // The picture stops (or jumps) on the click, not when NetEase's events catch up.
    onTogglePlay: () => {
      const playing = isPlaying();
      if (playing) clock.pause();
      togglePlay(client.store, playing);
    },
    onPrev: () => skip(client.store, -1),
    onNext: () => skip(client.store, 1),
    onVolume: v => setVolume(client.store, v),
    onToggleLike: () => toggleLike(client.store),
    onPlayMode: mode => setPlayMode(client.store, mode),
    onPlayAt: i => { const item = queue.list[i]; if (item) playItem(client.store, item); },
    onSeek: s => {
      const to = Math.min(Math.max(0, s), duration() - 0.5);
      clock.seek(to);
      seek(client.store, to);
    },
    // What NetEase's own title bar calls (its window has no system frame).
    onDragWindow: () => { try { void Promise.resolve(client.bridge.call('winhelper.dragWindow')).catch(() => {}); } catch { /* no such call */ } },
    // And what its resize grips call.
    onResizeWindow: edge => { try { void Promise.resolve(client.bridge.call('winhelper.sizeWindow', edge)).catch(() => {}); } catch { /* no such call */ } },
    onMinimize: () => minimizeWindow(client.store),
    onToggleMaximize: () => toggleMaximize(client.store),
    onRetry: () => void prepareCurrent(),
    // The same settings, in a panel on the MV page (tried out while watching).
    settings: () => settingsView(config, changed, sketch, true, player?.song ? { id: player.song.id, name: player.song.name ?? '' } : undefined, {
      // The playing song arranged anew, now.
      reroll: () => {
        const song = player?.song;
        if (!song || !player) return;
        plan(song, config, true);
        describe(song);
        void player.warm(nextFrame);
      },
    }),
  });
  overlay.showControls = config.controls;
  overlay.setKeys(config.keys);
  const duration = () => player?.song?.duration || playingSong(client.store)?.duration || 0;
  // What the loaded MV was planned with: a settings change replans it only when the style, the scenes or looks, the
  // arrangement mode or this song's lyric delay changed.
  let plannedWith = '';
  const planKey = (c: Config, id = player?.song?.id) => `${c.style}|${c.off.join(',')}|${c.offLooks.join(',')}|${id ? c.lyricDelays[id] ?? 0 : 0}|${c.arrange}`;
  /**
   * The arrangement's seed: a fixed one per song when its arrangement is kept, a new one when asked for (`fresh`),
   * else the player's own (drawn anew for each play of a song, kept while it plays).
   */
  const seedFor = (song: PreparedSong, c: Config, fresh: boolean) =>
    fresh ? (Math.random() * 4294967296) >>> 0 : c.arrange === 'fixed' ? Math.imul(song.id ^ 0x9e3779b9, 2654435761) >>> 0 : undefined;
  const plan = (song: PreparedSong, c: Config, fresh = false) => {
    plannedWith = planKey(c, song.id);
    player!.load(song, styleFor(song, c.style), new Set([...c.off, ...c.offLooks]), undefined, undefined, (c.lyricDelays[song.id] ?? 0) / 1000, seedFor(song, c, fresh));
  };
  /** The MV's style beside the volume (and why, when chosen automatically), and how the lyrics' word times stand. */
  const describe = (song: PreparedSong) => overlay.mvInfo({
    style: player!.style!.name, why: config.style === 'auto' ? song.choice.reason : null, bpm: song.analysis.namedBpm ?? song.analysis.bpm, lyrics: aligned.get(song) ?? null,
  });
  /** Hands NetEase's play list to the list panel, read again only when it (or the playing track) changed. */
  const syncQueue = (): boolean => {
    const list = playList(client.store), at = playingIndex(client.store, list);
    if (list === queue.list && at === queue.at) return false;
    if (list !== queue.list) { queue.list = list; queue.tracks = list.map(listTrack); }
    queue.at = at;
    overlay.queue(queue.tracks, at);
    return true;
  };
  let replan = 0;
  let button: HTMLButtonElement | null = config.button ? mvButton(() => open()) : null;

  function loop(now: number): void {
    raf = 0;
    if (!overlay.visible || !player) return;
    // With a frame cap the picture is drawn only once its time has come (a millisecond early is fine: the screen's
    // own beat decides when it shows); the controls follow every frame. The next one is due a period after this one
    // was due, not after now, so the cap holds on average whatever the screen's rate: at 120 on a 144 Hz screen five
    // frames in six are drawn (counting from now, every other one would be, 72 a second). After a stall (more than a
    // period late) the schedule starts again from now.
    const cap = config.fpsCap, period = cap ? 1000 / cap : 0;
    if (!cap || !last || now >= due - 1) {
      if (cap) due = (now - due > period ? now : due) + period;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      // Only draw the song the MV was made for; while NetEase switches songs the last frame stays.
      if (player.song && (clock.songId === player.song.id || !clock.playId)) player.frame(clock.now(), dt);
    }
    overlay.progress(clock.time(), duration(), isPlaying());
    overlay.volume(volume(client.store));
    overlay.playState(liked(client.store), playMode(client.store));
    player.hud.visible = !(overlay.awake && overlay.showControls);
    raf = requestAnimationFrame(loop);
  }

  /**
   * Reads a song (audio, lyrics, wiki, cover) and prepares it. Urgent (the song to show): as fast as the page allows;
   * otherwise (the next song, ahead) in short slices in the time the MV's frames leave over.
   */
  async function gather(song: PlayingSong, job: Job): Promise<Gathered> {
    const [audio, lyric, wiki, chorus, cover] = await Promise.all([
      getAudio(client, song.id, () => job.cancelled), fetchLyric(song.id), fetchWiki(song.id), fetchChorus(song.id), loadCover(song.cover),
    ]);
    if (job.cancelled) throw new Cancelled();
    let wordsFromPack = false;
    const prepared = await prepareSong(
      { id: song.id, name: song.name, artists: song.artists, audio, lyric, wiki, chorus, cover },
      {
        pause: () => (job.urgent ? yieldToPage() : whenIdle()),
        sliceMs: job.urgent ? undefined : 3,
        cancelled: () => job.cancelled,
        onProgress: (stage, p) => job.progress?.(stage, p),
        // Word times found before (aligner pack) go in before the analysis reads the lyrics.
        refineLines: async lines => {
          const r = await cachedAlignment(song.id, lines);
          wordsFromPack = !!r && applyAlignment(lines, r) > 0;
        },
      },
    );
    return { song: prepared, audio, wordsFromPack };
  }

  /** Audio kept for the aligner pack: songs prepared whose word times haven't been looked for yet. */
  const toAlign = new WeakMap<PreparedSong, ArrayBuffer>();
  /** Into the last few prepared songs. */
  function keep(g: Gathered): void {
    ready.set(g.song.id, g.song);
    if (g.wordsFromPack) aligned.set(g.song, 'aligned');
    else if (needsAlignment(g.song.lines)) toAlign.set(g.song, g.audio);
    while (ready.size > 3) ready.delete(ready.keys().next().value as number);
  }
  /**
   * The first time a song is shown, its word times are found by the aligner pack: the MV starts with the estimate and
   * the found times replace it in place when the pack is done.
   */
  async function alignIfNeeded(target: PreparedSong): Promise<void> {
    const audio = toAlign.get(target);
    if (!audio) return;
    toAlign.delete(target);
    if (!await checkPack()) return;
    aligned.set(target, 'aligning');
    void alignSong(target.id, target.lines, target.duration, audio).then(r => {
      const n = r ? applyAlignment(target.lines, r) : 0;
      if (n) aligned.set(target, 'aligned'); else aligned.delete(target);
      if (player?.song === target) describe(target);
    });
  }

  /**
   * With “提前分析下一首” on, the song after this one in the play list is read and prepared ahead while the MV plays,
   * so it shows at once when it comes (taken over at full speed if it comes first).
   */
  function prefetchNext(): void {
    if (!config.prefetch || !overlay.visible || preparing || !player?.song) return;
    const next = nextSong(client.store);
    if (!next || next.id === player.song.id || ready.has(next.id) || ahead?.job.id === next.id) return;
    if (ahead) ahead.job.cancelled = true;
    const job: Job = { id: next.id, cancelled: false, urgent: false };
    const entry: Ahead = {
      job,
      done: gather(next, job).then(g => {
        if (!job.urgent && !job.cancelled) keep(g);
        return g;
      }, () => null).finally(() => { if (ahead === entry) ahead = null; }),
    };
    ahead = entry;
  }

  async function prepareCurrent(): Promise<void> {
    const song = playingSong(client.store);
    if (!song) { overlay.song(null); overlay.mvInfo(null); overlay.status('请先在网易云音乐中播放歌曲'); return; }
    livePlayer();
    // Already showing this song (reopened after closing): just take the loading note away.
    if (player?.song?.id === song.id) { overlay.status(null); return; }
    if (preparing?.id === song.id) return;
    if (preparing) preparing.cancelled = true;
    // The song prepared ahead is this one: it goes on at full speed. Ahead of another song, it is dropped.
    const taken = ahead?.job.id === song.id ? ahead : null;
    if (ahead && !taken) ahead.job.cancelled = true;
    ahead = null;
    const job: Job = taken?.job ?? { id: song.id, cancelled: false, urgent: true };
    job.urgent = true;
    preparing = job;
    overlay.setBackdrop(song.cover || null);
    overlay.setStructure([], '#ffffff');
    overlay.song({ name: song.name, artists: song.artists, cover: song.cover || null });
    overlay.mvInfo(null);
    try {
      let prepared = ready.get(song.id);
      if (!prepared) {
        overlay.status('正在读取歌曲…', { progress: 0.03 });
        job.progress = (stage, p) => overlay.status(stage === 'decode' ? '正在解码音频…' : '正在分析节拍与段落…', { progress: stage === 'decode' ? 0.08 : 0.15 + 0.73 * p });
        const g = (taken && await taken.done) || await gather(song, job);
        if (job.cancelled) return;
        keep(g);
        prepared = g.song;
      }
      await alignIfNeeded(prepared);
      if (job.cancelled || !player) return;
      plan(prepared, config);
      // The progress bar shows the song's structure: its sections, the choruses and drops in the cover's colour.
      overlay.setStructure(prepared.analysis.sections.map((x): BarSection => ({ start: x.start, end: x.end, name: SECTION[x.label], loud: x.label === 'chorus' || x.label === 'drop' })), prepared.palette.css.signal);
      overlay.status('正在准备画面…', { progress: 0.9 });
      await player.warm(yieldToPage, () => job.cancelled);
      if (job.cancelled) return;
      overlay.status(null);
      describe(prepared);
      preparing = null;
      prefetchNext();
    } catch (e) {
      // (The song comes off the player: 重试 used to find it “already showing” and uncover a dead canvas — black.)
      if (!(e instanceof Cancelled)) { player?.unload(); failed(e); }
    } finally {
      if (preparing === job) preparing = null;
    }
  }

  /** A failure on the waiting view, with 重试. A lost WebGL context says so (the retry makes the renderer anew). */
  function failed(e: unknown): void {
    if (player?.engine.renderer.getContext().isContextLost()) overlay.status('画面中断：显卡被重置', { error: true, hint: '点重试会重新生成画面。' });
    else overlay.status('无法生成 MV：' + ((e as Error)?.message || e), { error: true, hint: '若重试仍失败，请先在网易云中完整播放这首歌，缓存完成后再试。' });
  }

  /**
   * The MV's player, made anew when its WebGL context is lost (the GPU was reset by the driver or by another
   * program's load: every shader compiled after it fails, “parameter 1 is not of type 'WebGLShader'”, and the
   * canvas stays black until the renderer is replaced).
   */
  function livePlayer(): MvPlayer {
    if (player && player.engine.renderer.getContext().isContextLost()) {
      try { player.dispose(); } catch { /* a lost context */ }
      player = null;
    }
    if (!player) {
      const p = player = new MvPlayer(overlay.stage, pixelRatio(config.quality));
      p.resize();
      // Lost while playing: the song comes off it, and the waiting view offers to make the picture again.
      p.engine.renderer.domElement.addEventListener('webglcontextlost', () => {
        if (player !== p) return;
        if (preparing) preparing.cancelled = true;
        p.unload();
        failed(null);
      });
    }
    return player;
  }

  async function open(): Promise<void> {
    overlay.maximized = isMaximized(client.store);
    syncQueue();
    overlay.show();
    overlay.status('正在准备…', { progress: 0 });
    fonts ??= loadFonts(file => readPluginFile('fonts/' + file));
    await fonts;
    livePlayer().resize();
    last = due = 0;
    if (!raf) raf = requestAnimationFrame(loop);
    await prepareCurrent();
  }

  function close(): void {
    overlay.hide();
    if (preparing) preparing.cancelled = true;
    if (ahead) { ahead.job.cancelled = true; ahead = null; }
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Follow song changes while the MV is open.
  client.store.subscribe(() => {
    // NetEase's play state (2 = playing) changes the moment anything pauses it — its own controls, a media key, the
    // tray — well before the PlayState event: the picture stops with it.
    const state = client.store.getState()?.playing?.playingState;
    if (typeof state === 'number') clock.onState('', '', state === 2 ? 1 : 0);
    overlay.maximized = isMaximized(client.store);
    if (!overlay.visible) return;
    const moved = syncQueue();
    const s = playingSong(client.store);
    if (s && s.id !== player?.song?.id && s.id !== preparing?.id) void prepareCurrent();
    // (The list or the place in it changed: what comes next may have.)
    else if (moved) prefetchNext();
  });

  // Opening and leaving the MV page, from anywhere in NetEase (the key as set; not while the settings take a new one).
  window.addEventListener('keydown', e => {
    if (isRecordingKeys() || keyCombo(e) !== config.keys.toggle) return;
    e.preventDefault();
    overlay.visible ? close() : void open();
  });

  listeners.push(c => {
    clock.offset = c.latencyMs / 1000;
    overlay.showControls = c.controls;
    overlay.setKeys(c.keys);
    if (c.button && !button) button = mvButton(() => open());
    if (!c.button && button) { button.remove(); button = null; }
    const pr = pixelRatio(c.quality);
    if (player && pr !== player.engine.renderer.getPixelRatio()) { player.engine.setPixelRatio(pr); player.resize(); }
    if (!c.prefetch && ahead) { ahead.job.cancelled = true; ahead = null; }
    prefetchNext();
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
