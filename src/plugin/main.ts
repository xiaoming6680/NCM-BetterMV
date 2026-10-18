// BetterMV plugin entry. Opens a full-window MV for the song NetEase is playing: gathers the song (cached audio,
// lyrics, wiki, cover), analyses it in slices between frames, then renders at the time NetEase reports.
import { loadFonts } from '../render/text.ts';
import { prepareSong, styleFor, Cancelled, whenIdle, yieldToPage, type PreparedSong, type Stage } from '../app/prepare.ts';
import { MvPlayer } from '../app/player.ts';
import { Governor, ladder } from '../app/governor.ts';
import {
  findClient, isMaximized, nextSong, liked, listTrack, minimizeWindow, playingIndex, playingSong, playItem, playList, playMode, seek, setPlayMode,
  setVolume, skip, toggleLike, toggleMaximize, togglePlay, volume, type Client, type PlayingSong,
} from './client.ts';
import { ProgressClock } from './clock.ts';
import { fetchChorus, fetchLyric, fetchWiki, getAudio, loadCover, songCacheDir, SourceError } from './source.ts';
import { alignSong, applyAlignment, cachedAlignment, checkPack, needsAlignment } from './aligner.ts';
import { startUpdates } from './update.ts';
import { isRecordingKeys, keyCombo, keyLabel, loadConfig, mvButton, Overlay, pixelRatio, settingsView, type BarSection, type Config, type QueueTrack } from './ui.ts';
import type { MenuEntry } from './menu.ts';
import { Cancelled as ExportCancelled, exportMv, VIDEO } from './video.ts';
import { exportNative, type VideoSpec } from './export.ts';
import { EncoderUnavailable } from './encoder.ts';
import { bitrateFor, loadOptions, partOf, saveOptions, saveSpeed, videoSize, wantsHardware, type ExportOptions } from './exportOptions.ts';
import { exportSheet } from './exportSheet.ts';
import { Pill } from './pill.ts';
import { STYLES } from '../style/style.ts';
import { execArg } from './exec.ts';
import { obs, obsKey } from './obs.ts';
import { OBS_VERSION, type ObsPlan, type ObsState } from '../obs/snapshot.ts';
import { Exposure } from './exposure.ts';
import type { SectionLabel } from '../types.ts';
import type { SceneId, Shot } from '../scenes/types.ts';
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
/** How long each plate has been on screen over the plays so far: the planner shows the ones seen least first. */
const exposure = new Exposure();
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
  /**
   * 画质 自动: the player's governor (on its GL context) and the shot last drawn (the step changes at a cut). tools/bench
   * turns it off (`governed`): its own GPU timing can't nest inside this one, and it sets the resolution itself.
   */
  let governor: Governor | null = null;
  let governed = true;
  let onScreen: Shot | null = null;
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
  // The picture stops (or jumps) on the click, not when NetEase's events catch up.
  const playPause = () => {
    const playing = isPlaying();
    if (playing) clock.pause();
    togglePlay(client.store, playing);
  };
  /** The playing song arranged anew, now. */
  const reroll = () => {
    const song = player?.song;
    if (!song || !player) return;
    plan(song, config, true);
    describe(song);
    void player.warm(nextFrame);
  };
  const overlay = new Overlay({
    onClose: () => leave(),
    onTogglePlay: playPause,
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
    settings: () => settingsView(config, changed, sketch, true, player?.song ? { id: player.song.id, name: player.song.name ?? '' } : undefined, { reroll }),
    menu: () => menu(),
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
  let playSeed: { id: number; seed: number; exposure?: Record<string, number> } = { id: 0, seed: 0 };
  /**
   * The seed, and the plates' screen time so far as it stood when the play began (kept with the seed, so a replan and
   * the OBS page plan the same MV). A fixed arrangement is the song's own, whatever was seen before: none.
   */
  const seedOf = (song: PreparedSong, c: Config, fresh = false): { seed: number; exposure?: Record<string, number> } => {
    if (c.arrange === 'fixed' && !fresh) return { seed: Math.imul(song.id ^ 0x9e3779b9, 2654435761) >>> 0 };
    if (fresh || playSeed.id !== song.id) {
      if (playSeed.id !== song.id) exposure.newSong();
      playSeed = { id: song.id, seed: (Math.random() * 4294967296) >>> 0, exposure: exposure.snapshot() };
    }
    return playSeed;
  };
  const exposureMap = (p: ObsPlan) => (p.exposure ? new Map(Object.entries(p.exposure)) : undefined);
  /** How the MV is arranged: the style, the plates and looks left out, this song's lyric delay, the seed. */
  const planFor = (song: PreparedSong, c: Config, fresh = false): ObsPlan => {
    const { seed, exposure: seen } = seedOf(song, c, fresh);
    return { style: c.style, off: [...c.off, ...c.offLooks], lyricDelay: (c.lyricDelays[song.id] ?? 0) / 1000, seed, exposure: seen };
  };
  const plan = (song: PreparedSong, c: Config, fresh = false) => {
    plannedWith = planKey(c, song.id);
    const p = planFor(song, c, fresh);
    player!.load(song, styleFor(song, p.style), new Set(p.off as Array<SceneId | LookId>), undefined, undefined, p.lyricDelay, p.seed, undefined, exposureMap(p));
    pushState();
  };
  /** plan() for the song the waiting view is readying: built a plate between pauses. False when the job was dropped. */
  const planInSlices = async (song: PreparedSong, c: Config, job: Job): Promise<boolean> => {
    plannedWith = planKey(c, song.id);
    const p = planFor(song, c);
    if (!await player!.loadInSlices(yieldToPage, () => job.cancelled, song, styleFor(song, p.style), new Set(p.off as Array<SceneId | LookId>), p.lyricDelay, p.seed, exposureMap(p))) return false;
    pushState();
    return true;
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

  // ---- The right click's menu ----
  /** The song the MV page shows: made, and still the one playing (null while it is being made, or failed). */
  const shownSong = (): PreparedSong | null => {
    const s = player?.song;
    return s && preparing?.id !== s.id && playingSong(client.store)?.id === s.id ? s : null;
  };
  const setConfig = <K extends 'style' | 'controls'>(key: K, value: Config[K]) => { config[key] = value; plugin.setConfig(key, value); changed(config); };
  function menu(): MenuEntry[] {
    const song = shownSong(), now = playingSong(client.store), like = now ? liked(client.store) : null;
    const styles: Array<[Config['style'], string]> = [['auto', '自动'], ...Object.values(STYLES).map((s): [Config['style'], string] => [s.id, s.name])];
    return [
      { label: isPlaying() ? '暂停' : '播放', hint: keyLabel(config.keys.playPause), disabled: !now, run: playPause },
      like === null ? null : { label: like ? '取消喜欢' : '喜欢', run: () => toggleLike(client.store) },
      '-',
      // (Not while the MV is being made into a video: the player is drawing that.)
      { label: '换一种编排', disabled: !song || !!download, run: reroll },
      { label: '风格', disabled: !!download, items: styles.map(([id, name]) => ({ label: name, checked: config.style === id, run: () => setConfig('style', id) })) },
      '-',
      { label: '保存当前画面', disabled: !song || !!download, run: () => { snapshot = true; } },
      download ? { label: '取消下载', run: stopDownload } : { label: '下载 MV…', disabled: !song, run: openExport },
      '-',
      { label: '显示控制栏', checked: config.controls, run: () => setConfig('controls', !config.controls) },
      { label: '设置…', run: () => overlay.openPanel('settings') },
      { label: '退出 MV', hint: keyLabel(config.keys.exit), run: leave },
    ];
  }

  // ---- Saving: the frame on screen as a picture, the MV as an MP4 (src/plugin/video.ts) ----
  /** A download being made: its song, whether it was called off, when it began, how far along (0..1), and how it shows that. */
  interface Download { song: PreparedSong; cancelled: boolean; began: number; part: number; render: () => void }
  let download: Download | null = null;
  /** The download's progress while the MV page is closed (it goes on behind). */
  const pill = new Pill();
  /** The next frame drawn is saved as a picture. */
  let snapshot = false;
  const errText = (e: unknown) => (e as Error)?.message || String(e);
  /** Where they go: a BetterMV folder in NetEase's download folder (else in BetterNCM's), made if missing. */
  async function saveFolder(): Promise<string> {
    const base = String(client.storage?.downloadDir || '').replace(/[\\/]+$/, '');
    const parent = base || (await betterncm.app.getDataPath()).replace(/[\\/]+$/, '');
    const dir = `${parent}\\BetterMV${base ? '' : '\\MV'}`;
    for (const d of base ? [dir] : [`${parent}\\BetterMV`, dir]) if (!await betterncm.fs.exists(d)) await betterncm.fs.mkdir(d);
    return dir;
  }
  /** “Song - Artist”, as NetEase names a song, without the characters a file name can't have. */
  const fileName = (song: PreparedSong) => {
    const artists = (song.artists ?? []).join(',');
    return `${song.name || song.id}${artists ? ' - ' + artists : ''}`.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  async function freePath(dir: string, name: string, ext: string): Promise<string> {
    for (let i = 1; ; i++) {
      const path = `${dir}\\${name}${i > 1 ? ` (${i})` : ''}.${ext}`;
      if (!await betterncm.fs.exists(path)) return path;
    }
  }
  /** Its folder opened with the file selected (the path in escaped quotes, the window shown: docs/CLIENT.md, app.exec). */
  const reveal = (path: string) => { void Promise.resolve(betterncm.app.exec(`explorer /select,${execArg(path)}`, false, true)).catch(() => {}); };
  const showIt = (path: string) => ({ label: '在文件夹中显示', run: () => reveal(path) });

  /** The frame just drawn, with its HUD, as a PNG (in the same task as the drawing: the canvas is cleared once shown). */
  function saveFrame(p: MvPlayer): void {
    const gl = p.engine.renderer.domElement, song = p.song!, at = clock.time();
    const c = document.createElement('canvas');
    c.width = gl.width;
    c.height = gl.height;
    const g = c.getContext('2d')!;
    g.drawImage(gl, 0, 0);
    p.hud.draw(g, c.width, c.height);
    c.toBlob(blob => void (async () => {
      try {
        if (!blob) throw new Error('无法读取画面');
        const path = await freePath(await saveFolder(), `${fileName(song)} ${Math.floor(at / 60)}分${String(Math.floor(at % 60)).padStart(2, '0')}秒`, 'png');
        if (!await betterncm.fs.writeFile(path, blob)) throw new Error('无法写入文件');
        overlay.notice('画面已保存', { action: showIt(path), hideAfter: 8000 });
      } catch (e) {
        overlay.notice('保存画面失败：' + errText(e), { hideAfter: 6000 });
      }
    })(), 'image/png');
  }

  /** The picture drawn at a video's size (pixel ratio 1); null: the window's again. */
  function frame(size: { width: number; height: number } | null): void {
    if (!player) return;
    player.engine.fixedSize = size ? { width: size.width, height: size.height } : null;
    player.engine.setPixelRatio(size ? 1 : config.quality === 'auto' && governor ? governor.pixelRatio : pixelRatio(config.quality));
    player.resize();
  }

  const minutes = (s: number) => { const n = Math.round(s); return n >= 60 ? `${Math.floor(n / 60)} 分 ${n % 60} 秒` : `${Math.max(1, n)} 秒`; };

  /** 1分05秒, for a file's name. */
  const nameClock = (s: number) => `${Math.floor(s / 60)}分${String(Math.round(s % 60)).padStart(2, '0')}秒`;

  /** The export sheet over the MV page: what to make; its answer starts the download. */
  function openExport(): void {
    const song = shownSong();
    if (!song || download) return;
    void saveFolder().then(folder => overlay.dialog((host, gone) => exportSheet(host, {
      name: song.name || String(song.id), artists: (song.artists ?? []).join(', '), duration: song.duration, sections: song.analysis.sections,
      options: loadOptions(), folder, playhead: clock.time(),
    }, o => { saveOptions(o); void startDownload(o); }, gone)), e => overlay.notice('无法创建保存位置：' + errText(e), { hideAfter: 6000 }));
  }

  /**
   * The MV of the song on screen as an MP4, made without playing it (docs/EXPORT.md): the frames drawn at their own times
   * and handed to the encoder program (src/plugin/export.ts); the MediaRecorder way (video.ts) when it can't be had.
   * Progress shows on the waiting view, or on a pill while the MV page is closed: the download goes on behind. NetEase
   * plays on; a change of song waits until it is done.
   */
  async function startDownload(o: ExportOptions): Promise<void> {
    const song = shownSong(), p = player;
    if (!song || !p || download) return;
    const size = videoSize(o.aspect, o.size);
    const [from, to] = partOf(o, song.duration, song.analysis.sections);
    const spec: VideoSpec = { ...size, fps: o.fps, bitrate: bitrateFor(size.width, size.height, o.fps, o.quality), from, to };
    const name = fileName(song) + (o.part === 'all' ? '' : ` ${nameClock(from)}-${nameClock(to)}`) + (o.aspect === 'tall' ? ' 竖屏' : o.aspect === 'square' ? ' 方形' : '');
    const action = { label: '取消', run: stopDownload };
    let compat = false, said = '';
    const job: Download = download = { song, cancelled: false, began: performance.now(), part: 0, render: () => {} };
    job.render = () => {
      const spent = (performance.now() - job.began) / 1000, left = job.part > 0.04 && spent > 3 ? (spent * (1 - job.part)) / job.part : 0;
      const text = (compat ? '正在下载 MV（兼容模式）' : '正在下载 MV') + (left ? `，还需 ${minutes(left)}` : '');
      const key = text + Math.round(job.part * 100) + overlay.visible;
      if (key === said) return;
      said = key;
      if (overlay.visible) { pill.hide(); overlay.status(text, { progress: job.part, action }); }
      else pill.show(text, { progress: job.part, actions: [action], onOpen: () => void open() });
    };
    /** The result, on the MV page or on the pill. */
    const tell = (text: string, hideAfter: number, sub?: string, more?: { label: string; run: () => void }) => {
      if (overlay.visible) overlay.notice(text, { sub, action: more, hideAfter });
      else pill.show(text, { sub, actions: more ? [more] : [], onOpen: () => void open(), hideAfter });
    };
    job.render();
    let framed = false;
    try {
      const audio = await getAudio(client, song.id, () => job.cancelled);
      if (job.cancelled) throw new ExportCancelled();
      const path = await freePath(await saveFolder(), name, 'mp4');
      frame(spec);
      framed = true;
      const progress = (part: number) => { job.part = part; job.render(); };
      try {
        const done = await exportNative({ player: p, audio, path, spec, hardware: wantsHardware(o.encoder), progress, cancelled: () => job.cancelled });
        saveSpeed(spec.width, spec.height, spec.fps, (done.seconds * 1000) / Math.max(1, done.frames));
        tell('MV 已保存', 12000, name, showIt(path));
      } catch (e) {
        if (!(e instanceof EncoderUnavailable) || job.cancelled) throw e;
        // The encoder program isn't to be had here: the recorder's way, the whole song at 1080p (slower, and not as sharp).
        console.warn('[BetterMV] 视频编码程序不可用，改用兼容模式：', errText(e));
        compat = true;
        job.part = 0;
        job.began = performance.now();
        frame(VIDEO);
        job.render();
        const blob = await exportMv({ player: p, audio, parent: overlay.stage, progress, cancelled: () => job.cancelled });
        frame(null);
        framed = false;
        if (!await betterncm.fs.writeFile(path, blob)) throw new Error('无法写入文件');
        tell('MV 已保存（兼容模式：整首 1080p）', 12000, name, showIt(path));
      }
    } catch (e) {
      const off = job.cancelled || e instanceof ExportCancelled;
      tell(off ? '已取消下载' : '下载失败：' + errText(e), off ? 3000 : 8000);
    } finally {
      if (framed) frame(null);
      if (download === job) download = null;
      // The MV again: of this song, or of the one NetEase went on to meanwhile.
      if (overlay.visible) {
        const now = playingSong(client.store);
        if (now && now.id !== player?.song?.id) void prepareCurrent(); else overlay.status(null);
      }
    }
  }

  /** Calls the download off: it stops at its next frame, and nothing is saved. */
  function stopDownload(): void {
    if (download) download.cancelled = true;
  }

  /** Leaving the MV page: a download goes on behind it, on the pill. */
  function leave(): void { close(); }

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
    // (The song file is made in a task of its own: right after the song's preparation, the two held the page up.)
    await yieldToPage();
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
    // (While a download is made the player draws its frames, behind the waiting view: none here.)
    const rest = obs.shown && !config.obsKeepMv;
    if (rest !== resting && !preparing && !download) {
      resting = rest;
      overlay.status(rest ? '画面正在 OBS 中显示' : null, rest ? { note: true, hint: '需要两边同时显示时，在设置中打开“MV 页同时显示”。' } : {});
    }
    const cap = config.fpsCap, period = cap ? 1000 / cap : 0;
    if (!resting && !download && (!cap || !last || now >= due - 1)) {
      if (cap) due = (now - due > period ? now : due) + period;
      // (After a gap — the window hidden, the page held up — the frames before it say nothing about the next ones.)
      if (last && now - last > 250) governor?.reset();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      // Only draw the song the MV was made for; while NetEase switches songs the last frame stays. Not while it is
      // still being readied behind the waiting view either: a frame then waited for its plate's shaders, 0.2–1 s.
      if (player.song && preparing?.id !== player.song.id && (clock.songId === player.song.id || !clock.playId)) {
        const gov = config.quality === 'auto' && governed ? governor : null;
        // A saved frame has the HUD (and the badge that goes with it), whatever the controls do.
        if (snapshot) player.hud.visible = true;
        gov?.begin();
        const shot = player.frame(clock.now(), dt);
        // (Screen time for the planner's record: only while the song plays on this page.)
        if (shot && isPlaying()) exposure.add(shot.scene, dt);
        if (snapshot) { snapshot = false; saveFrame(player); }
        if (gov) govern(gov, player, shot, now);
        onScreen = shot;
      }
    }
    overlay.progress(clock.time(), duration(), isPlaying());
    overlay.volume(volume(client.store));
    overlay.playState(liked(client.store), playMode(client.store));
    if (!download) player.hud.visible = !(overlay.awake && overlay.showControls);
    raf = requestAnimationFrame(loop);
  }

  /**
   * 画质 自动, after a frame: its GPU time noted (not under a transition, which draws two plates), and at a cut the step
   * the frames call for. Not at the cuts inside a run, whose camera move carries on across them.
   */
  function govern(gov: Governor, p: MvPlayer, shot: Shot | null, now: number): void {
    gov.end(now, !p.transitioning);
    if (!shot || shot === onScreen || (shot.run && shot.run.start < shot.start)) return;
    const step = gov.wanted(1000 / Math.min(config.fpsCap || 60, 60), now);
    if (step === gov.step) return;
    gov.go(step, now);
    p.engine.setPixelRatio(gov.pixelRatio);
    p.resize();
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
    // (A download is drawing the player's song: the next one is prepared once it is done.)
    if (download) return;
    const song = playingSong(client.store);
    if (!song) { overlay.song(null); overlay.mvInfo(null); overlay.status('请先在网易云音乐中播放歌曲'); resting = false; pushState(); return; }
    // (With only the OBS output on, the MV page is closed: no renderer is made here.)
    if (overlay.visible) livePlayer();
    // Already showing this song (reopened after closing): just take the loading note away. (Not while it is still
    // being built or warmed: the player has it from the start of the build.)
    if (player?.song?.id === song.id && preparing?.id !== song.id) { overlay.status(null); resting = false; void obsPublish(player.song); return; }
    // (A job for it dropped meanwhile — the MV page closed and opened again — is still winding down: begun anew.)
    if (preparing?.id === song.id && !preparing.cancelled) return;
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
      // The progress bar shows the song's structure: its sections, the choruses and drops in the cover's colour.
      overlay.setStructure(prepared.analysis.sections.map((x): BarSection => ({ start: x.start, end: x.end, name: SECTION[x.label], loud: x.label === 'chorus' || x.label === 'drop' })), prepared.palette.css.signal);
      overlay.status('正在准备画面…', { progress: 0.9 });
      if (!await planInSlices(prepared, config, job)) {
        if (job.cancelled) return;
        // (Another load took the player over meanwhile: this song built at once instead.)
        plan(prepared, config);
      }
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
      governor = new Governor(p.engine.renderer.getContext() as WebGL2RenderingContext, ladder(pixelRatio('high')));
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
    governor?.reset();
    if (!raf) raf = requestAnimationFrame(loop);
    // (A download in hand: the page shows how far it is.)
    if (download) { download.render(); return; }
    await prepareCurrent();
  }

  function close(): void {
    overlay.hide();
    download?.render();
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
    overlay.visible ? leave() : void open();
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
    // (Out of 自动, the governor starts again from the top the next time it's chosen.)
    if (c.quality !== 'auto' && governor) { governor.step = 0; governor.reset(); }
    const pr = c.quality === 'auto' && governor ? governor.pixelRatio : pixelRatio(c.quality);
    // (Not while a download draws at its own size.)
    if (player && !player.engine.fixedSize && pr !== player.engine.renderer.getPixelRatio()) { player.engine.setPixelRatio(pr); player.resize(); }
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

  (window as any)[KEY] = {
    open, close, clock, obs, client, get player() { return player; },
    // (For tools/bench: the song being readied, and the one being prepared ahead.)
    get preparing() { return preparing; }, get ahead() { return ahead?.job ?? null; },
    get governor() { return governor; }, get governed() { return governed; }, set governed(on: boolean) { governed = on; },
    // (The download being recorded, and a way to start one without the sheet, for testing.)
    get download() { return download; },
    exportMv: (o: Partial<ExportOptions> = {}) => startDownload({ ...loadOptions(), ...o }),
    get pill() { return pill; },
  };
}

plugin.onLoad(() => {
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = {};
  findClient().then(client => {
    if (client) start(client);
    else console.warn('[BetterMV] 未找到网易云的内部模块，插件未启动');
  });
});
