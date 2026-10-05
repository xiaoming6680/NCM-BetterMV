// NetEase 3.x internals, found through the webpack module cache (the way BetterDownload and InfLink-rs do it):
// the native Bridge (player events), the AudioPlayer SDK and the dva/redux store (the playing song).

type Loader = { c: Record<string, { exports?: any }>; m?: Record<string, unknown> };

export interface Bridge {
  appendRegisterCall(name: string, ns: string, fn: (...args: any[]) => void): void;
  removeRegisterCall(name: string, ns: string, fn: (...args: any[]) => void): void;
  call(name: string, ...args: unknown[]): Promise<unknown>;
}

export interface Store {
  getState(): any;
  subscribe(fn: () => void): () => void;
  dispatch(action: { type: string; payload?: unknown }): void;
}

export interface Client {
  bridge: Bridge;
  store: Store;
  /** NetEase's settings object; `cacheDir` is where songs are cached (in its Cache subfolder). */
  storage: { cacheDir?: string; downloadDir?: string } | null;
}

function getRequire(): Loader | null {
  const chunks = window.webpackJsonp as any;
  if (!chunks || !Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
  const id = 'bettermv_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  let loader: Loader | null = null;
  chunks.push([[id], { [id]: (_m: unknown, _e: unknown, require: Loader) => { loader = require; } }, [[id]]]);
  const l = loader as Loader | null;
  if (l && l.c) { delete l.c[id]; if (l.m) delete l.m[id]; }
  return l && l.c ? l : null;
}

function findExport(loader: Loader, test: (x: any) => boolean): any {
  for (const key of Object.keys(loader.c)) {
    const exports = loader.c[key] && loader.c[key].exports;
    if (!exports) continue;
    for (const candidate of [exports, exports.default]) {
      try { if (candidate && typeof candidate === 'object' && test(candidate)) return candidate; } catch { /* getters may throw */ }
    }
  }
  return null;
}

/** Polls until the client has booted (up to about two minutes). */
export async function findClient(): Promise<Client | null> {
  for (let i = 0; i < 240; i++) {
    try {
      const loader = getRequire();
      if (loader) {
        const sdk = findExport(loader, x => x.Bridge && typeof x.Bridge.appendRegisterCall === 'function' && typeof x.Bridge.call === 'function');
        const dva = findExport(loader, x => x.a && typeof x.a === 'object' && typeof x.a.getStore === 'function');
        const store = dva && dva.a.inited && dva.a.app && dva.a.app._store;
        if (sdk && store && typeof store.subscribe === 'function') return { bridge: sdk.Bridge, store, storage: sdk.Storage ?? null };
      }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

export interface PlayingSong {
  id: number;
  name: string;
  artists: string[];
  cover: string;
  /** Seconds. */
  duration: number;
  local: boolean;
}

export function playingSong(store: Store): PlayingSong | null {
  const p = store.getState()?.playing;
  if (!p || p.resourceType === 'voice') return null;
  const local = p.trackFileType === 'local';
  const raw = String(local && p.onlineResourceId ? p.onlineResourceId : p.resourceTrackId || '');
  if (!/^\d+$/.test(raw) || raw === '0') return null;
  return {
    id: Number(raw), name: p.resourceName || '', artists: (p.resourceArtists || []).map((a: any) => a && a.name).filter(Boolean),
    cover: p.resourceCoverUrl || '', duration: (p.curTrack?.duration || 0) / 1000, local,
  };
}

export function togglePlay(store: Store, playing: boolean): void {
  store.dispatch({ type: playing ? 'playing/pause' : 'playing/resume', payload: { triggerScene: 'desktopLyric' } });
}

/** Next (+1) or previous (-1) track in NetEase's play list. */
export function skip(store: Store, flag: 1 | -1): void {
  store.dispatch({ type: 'playingList/jump2Track', payload: { flag, type: 'call', triggerScene: 'hotKey' } });
}

export function seek(store: Store, seconds: number): void {
  store.dispatch({ type: 'playing/setPlayingPosition', payload: { duration: Math.max(0, seconds) } });
}

/** NetEase's own volume, 0..1 (what its volume slider shows). */
export function volume(store: Store): number | null {
  const v = store.getState()?.playing?.playingVolume;
  return typeof v === 'number' ? v : null;
}

/** Set NetEase's volume (0..1) the way its own slider does, so the two stay in step (as InfLink-rs does it). */
export function setVolume(store: Store, v: number): void {
  store.dispatch({ type: 'playing/setVolume', payload: { volume: Math.max(0, Math.min(1, v)) } });
}

/** NetEase's play modes (`playing.playingMode`): 心动模式 and 私人 FM are entered from their own pages. */
export type PlayMode = 'playOrder' | 'playCycle' | 'playOneCycle' | 'playRandom' | 'playAi' | 'playFm';
const PLAY_MODES: readonly string[] = ['playOrder', 'playCycle', 'playOneCycle', 'playRandom', 'playAi', 'playFm'];

export function playMode(store: Store): PlayMode | null {
  const m = store.getState()?.playing?.playingMode;
  return PLAY_MODES.includes(m) ? m : null;
}

/** As its tray menu switches it. */
export function setPlayMode(store: Store, mode: PlayMode): void {
  store.dispatch({ type: 'playing/switchPlayingMode', payload: { playingMode: mode, triggerScene: 'sysTray' } });
}

/**
 * Whether the playing song is in the user's liked songs (the map NetEase keeps of them); null when it can't be
 * liked from here: not signed in, or a podcast.
 */
export function liked(store: Store): boolean | null {
  const s = store.getState(), p = s?.playing, map = s?.['async:hostResource']?.likeTracksMap;
  if (!s?.host?.uid || !p || p.resourceType === 'voice' || !map || typeof map !== 'object') return null;
  return !!map[p.onlineResourceId || p.resourceTrackId];
}

/** Like the playing song, or take the like back (what its like shortcut does, without the tray notice). */
export function toggleLike(store: Store): void {
  store.dispatch({ type: 'async:hostResource/setLikeCurPlayingTrack', payload: {} });
}

/** NetEase's play list (`playingList.curPlayingList`): its own entries, kept as they are to hand back to `playItem`. */
export function playList(store: Store): readonly any[] {
  const list = store.getState()?.playingList?.curPlayingList;
  return Array.isArray(list) ? list : [];
}

/** Where the playing track is in the play list (-1: not in it). */
export function playingIndex(store: Store, list: readonly any[]): number {
  const p = store.getState()?.playing;
  const id = p?.curPlaying?.resourceId, track = p?.resourceTrackId;
  if (id != null) { const i = list.findIndex(x => x && String(x.resourceId) === String(id)); if (i >= 0) return i; }
  return track ? list.findIndex(x => x && String(x.track?.id ?? x.resourceId) === String(track)) : -1;
}

/** A play list entry's name, artists and length (seconds); a podcast's show stands in for its artists. */
export function listTrack(item: any): { name: string; artists: string[]; duration: number } {
  const t = item?.track ?? {};
  const artists = (t.artists ?? t.ar ?? []).map((a: any) => a?.name).filter(Boolean);
  if (!artists.length && (t.radio?.name || t.dj?.nickname)) artists.push(t.radio?.name || t.dj?.nickname);
  return { name: String(t.name ?? item?.name ?? ''), artists, duration: Number(t.duration ?? t.dt ?? 0) / 1000 || 0 };
}

/** Play an entry of the play list, as a click in NetEase's own list does. */
export function playItem(store: Store, item: unknown): void {
  store.dispatch({ type: 'playing/playOneTrackInPlayingList', payload: { item, flag: 0, switchType: 'call', triggerScene: 'playingList' } });
}

/** NetEase's window, as its title bar's buttons do it. */
export const isMaximized = (store: Store): boolean => !!store.getState()?.app?.isMaxWindow;
export const minimizeWindow = (store: Store): void => store.dispatch({ type: 'app/minimizeWindow' });
export const toggleMaximize = (store: Store): void => store.dispatch({ type: isMaximized(store) ? 'app/restoreWindow' : 'app/maximizeWindow' });
