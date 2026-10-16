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
import { fetchChorus, fetchLyric, fetchWiki, getAudio, loadCover, songCacheDir, SourceError } from './source.ts';
import { alignSong, applyAlignment, cachedAlignment, checkPack, needsAlignment } from './aligner.ts';
import { startUpdates } from './update.ts';
import { isRecordingKeys, keyCombo, loadConfig, mvButton, Overlay, pixelRatio, settingsView, type BarSection, type Config, type QueueTrack } from './ui.ts';
import { obs, obsKey } from './obs.ts';
import { OBS_VERSION, type ObsPlan, type ObsState } from '../obs/snapshot.ts';
import type { SectionLabel } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import type { LookId } from '../director/director.ts';

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
/** NetEase's internals, once found (the settings page shows where its song cache is). */
let found: Client | null = null;
plugin.onConfig(() => settingsView(config, changed, sketch, false, undefined, {}, {
  cacheDir: () => (found ? songCacheDir(found) : Promise.resolve(undefined)),
}));
void checkPack();
// Older BetterMV packages beside this one go; a newer version is looked for once a day.
startUpdates(config.autoUpdate);

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
  found = client;
  // (The OBS page's clock follows NetEase's: a stamp a second while playing, at once on a seek. Driven by NetEase's
  // events, not a timer, which a minimised window would slow to one a minute.)
  client.bridge.appendRegisterCall('PlayProgress', 'audioplayer', () => pushState());
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
   * This play's seed: drawn anew when a song starts playing (a song plays differently each time), kept while it plays,
   * so the MV page and the OBS page draw the same MV. A fixed one per song when its arrangement is kept.
   */
  let playSeed = { id: 0, seed: 0 };
  const seedOf = (song: PreparedSong, c: Config, fresh = false) => {
    if (c.arrange === 'fixed' && !fresh) return Math.imul(song.id ^ 0x9e3779b9, 2654435761) >>> 0;
    if (fresh || playSeed.id !== song.id) playSeed = { id: song.id, seed: (Math.random() * 4294967296) >>> 0 };
    return playSeed.seed;
  };
  /** How the MV is arranged: the style, the plates and looks left out, this song's lyric delay, the seed. */
  const planFor = (song: PreparedSong, c: Config, fresh = false): ObsPlan => ({
    style: c.style, off: [...c.off, ...c.offLooks], lyricDelay: (c.lyricDelays[song.id] ?? 0) / 1000, seed: seedOf(song, c, fresh),
  });
  const plan = (song: PreparedSong, c: Config, fresh = false) => {
    plannedWith = planKey(c, song.id);
    const p = planFor(song, c, fresh);
    player!.load(song, styleFor(song, p.style), new Set(p.off as Array<SceneId | LookId>), undefined, undefined, p.lyricDelay, p.seed);
    pushState();
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

  // OBS output (src/plugin/obs.ts): the playing song, once prepared, goes to the local server, and where NetEase is
  // playing follows it; the OBS page draws the same MV from them.
  /** The song the OBS page is given, and its file name on the server (another once the aligner pack timed its words). */
  let obsSong: { song: PreparedSong; file: string } | null = null;
  const obsFile = (song: PreparedSong) => `${song.id}-${aligned.get(song) === 'aligned' ? 'w' : 'e'}`;
  async function obsPublish(song: PreparedSong): Promise<void> {
    if (!obs.on) return;
    const file = obsFile(song);
    obsSong = { song, file };
    pushState();
    if (await obs.sendSong(song, file)) pushState(true);
  }
  function obsState(): ObsState {
    const s = playingSong(client.store);
    const shown = obsSong && s && obsSong.song.id === s.id && obs.has(obsSong.file) ? obsSong : null;
    return {
      v: OBS_VERSION,
      song: s ? { id: s.id, name: s.name, artists: s.artists, cover: s.cover } : null,
      file: shown?.file ?? null,
      plan: shown ? planFor(shown.song, config) : null,
      // (While NetEase switches songs its clock still has the last one.)
      t: s && clock.songId === s.id ? clock.time() : 0,
      at: Date.now(),
      playing: isPlaying(),
      delay: clock.offset,
    };
  }
  let lastPush = { at: 0, t: 0, playing: false, key: '' };
  /** Sends the state when it changed, when the song time jumped (a seek), and once a second while playing. */
  function pushState(force = false): void {
    if (obs.status.kind !== 'on') return;
    const st = obsState();
    const key = `${st.song?.id}|${st.file}|${st.playing}|${JSON.stringify(st.plan)}|${st.delay}`;
    const expected = lastPush.t + (lastPush.playing ? (st.at - lastPush.at) / 1000 : 0);
    if (!force && key === lastPush.key && Math.abs(st.t - expected) < 0.3 && (!st.playing || st.at - lastPush.at < 1000)) return;
    lastPush = { at: st.at, t: st.t, playing: st.playing, key };
    obs.sendState(st);
  }
  /** The playing song to the OBS page: prepared already (by the MV page or ahead), or prepared now. */
  function obsFollow(): void {
    if (obs.status.kind !== 'on') return;
    const s = playingSong(client.store);
    const p = s && (player?.song?.id === s.id ? player.song : ready.get(s.id));
    if (p) void obsPublish(p);
    else if (s && s.id !== preparing?.id) void prepareCurrent();
    pushState(true);
  }
  /** While an OBS page shows the MV, the MV page rests (unless the settings keep it going) and says so. */
  let resting = false;

  function loop(now: number): void {
    raf = 0;
    if (!overlay.visible || !player) return;
    // With a frame cap the picture is drawn only once its time has come (a millisecond early is fine: the screen's
    // own beat decides when it shows); the controls follow every frame. The next one is due a period after this one
    // was due, not after now, so the cap holds on average whatever the screen's rate: at 120 on a 144 Hz screen five
    // frames in six are drawn (counting from now, every other one would be, 72 a second). After a stall (more than a
    // period late) the schedule starts again from now.
    const rest = obs.shown && !config.obsKeepMv;
    if (rest !== resting && !preparing) {
      resting = rest;
      overlay.status(rest ? '画面正在 OBS 中显示' : null, rest ? { note: true, hint: '需要两边同时显示时，在设置中打开“MV 页同时显示”。' } : {});
    }
    const cap = config.fpsCap, period = cap ? 1000 / cap : 0;
    if (!resting && (!cap || !last || now >= due - 1)) {
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
      if (n && obsSong?.song === target) void obsPublish(target);
    });
  }

  /**
   * With “提前分析下一首” on, the song after this one in the play list is read and prepared ahead while the MV plays,
   * so it shows at once when it comes (taken over at full speed if it comes first).
   */
  function prefetchNext(): void {
    const current = playingSong(client.store);
    if (!config.prefetch || (!overlay.visible && !obs.on) || preparing || !current) return;
    const next = nextSong(client.store);
    if (!next || next.id === current.id || ready.has(next.id) || ahead?.job.id === next.id) return;
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
    if (!song) { overlay.song(null); overlay.mvInfo(null); overlay.status('请先在网易云音乐中播放歌曲'); resting = false; pushState(); return; }
    // (With only the OBS output on, the MV page is closed: no renderer is made here.)
    if (overlay.visible) livePlayer();
    // Already showing this song (reopened after closing): just take the loading note away.
    if (player?.song?.id === song.id) { overlay.status(null); resting = false; void obsPublish(player.song); return; }
    if (preparing?.id === song.id) return;
    if (preparing) preparing.cancelled = true;
    // The song prepared ahead is this one: it goes on at full speed. Ahead of another song, it is dropped.
    const taken = ahead?.job.id === song.id ? ahead : null;
    if (ahead && !taken) ahead.job.cancelled = true;
    ahead = null;
    const job: Job = taken?.job ?? { id: song.id, cancelled: false, urgent: true };
    job.urgent = true;
    preparing = job;
    resting = false;
    pushState();
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
      if (job.cancelled) return;
      void obsPublish(prepared);
      // Only the OBS output wants it (the MV page is closed): done here.
      if (!player || !overlay.visible) { preparing = null; prefetchNext(); return; }
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
    if (player?.engine.renderer.getContext().isContextLost()) overlay.status('画面中断：显卡被重置', { error: true, hint: '频繁出现时请调低画质。' });
    else overlay.status('无法生成 MV：' + ((e as Error)?.message || e), { error: true, hint: e instanceof SourceError ? e.hint : '重试仍失败时，请先在网易云中完整播放一遍这首歌。' });
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
    // (The OBS output still wants the song being prepared, and the next one.)
    if (!obs.on) {
      if (preparing) preparing.cancelled = true;
      if (ahead) { ahead.job.cancelled = true; ahead = null; }
    }
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
    pushState();
    if (!overlay.visible && !obs.on) return;
    const moved = syncQueue();
    const s = playingSong(client.store);
    // (With the MV page closed, the song the OBS page has is what counts.)
    const has = overlay.visible ? player?.song?.id : obsSong?.song.id;
    if (s && s.id !== has && s.id !== preparing?.id) void prepareCurrent();
    // (The list or the place in it changed: what comes next may have.)
    else if (moved) prefetchNext();
  });

  // Opening and leaving the MV page, from anywhere in NetEase (the key as set; not while the settings take a new one).
  window.addEventListener('keydown', e => {
    if (isRecordingKeys() || keyCombo(e) !== config.keys.toggle) return;
    e.preventDefault();
    overlay.visible ? close() : void open();
  });

  // The OBS output with the settings: started, stopped, moved to another port.
  let obsWith = '';
  const obsSync = (c: Config) => {
    const want = c.obs ? `${c.obsPort}` : '';
    if (want === obsWith) return;
    obsWith = want;
    if (want) void obs.start(c.obsPort, obsKey()); else void obs.stop();
  };
  // (On again after a start, a restart of the server, a new port: it is given the playing song.)
  let obsWas = obs.status.kind;
  obs.watch(st => { if (st.kind === 'on' && obsWas !== 'on') obsFollow(); obsWas = st.kind; });
  obsSync(config);

  listeners.push(c => {
    obsSync(c);
    pushState();
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

  (window as any)[KEY] = { open, close, clock, obs, client, get player() { return player; } };
}

plugin.onLoad(() => {
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = {};
  findClient().then(client => {
    if (client) start(client);
    else console.warn('[BetterMV] 未找到网易云的内部模块，插件未启动');
  });
});
