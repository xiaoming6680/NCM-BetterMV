// Dev page: the plugin's settings page as BetterNCM shows it, on a light and on a dark panel; with ?mv, the MV page
// (a sketch standing in for the picture) and its controls, over a made-up play list (?long: names that don't fit).
// `plugin` is stood in for (settings kept in localStorage); the scene sketches come from public/previews/.
import { loadConfig, Overlay, settingsView, type QueueTrack } from '../plugin/ui.ts';
import type { PlayMode } from '../plugin/client.ts';

const store = 'bettermv-settings-dev';
const saved = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(store) || '{}'); } catch { return {}; } };
(window as any).plugin = {
  pluginPath: '',
  onLoad() {},
  onConfig() {},
  getConfig: (key: string, fallback: unknown) => saved()[key] ?? fallback,
  setConfig: (key: string, value: unknown) => {
    const all = saved();
    all[key] = value;
    try { localStorage.setItem(store, JSON.stringify(all)); } catch { /* private window */ }
  },
};

const sketch = (id: string) => fetch(`/previews/${id}.webp`).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => URL.createObjectURL(b), () => null);
const log = (what: string) => (...a: unknown[]) => console.log(what, ...a.map(x => JSON.stringify(x)));

const params = new URLSearchParams(location.search);
if (params.has('mv')) {
  document.querySelector('main')!.remove();
  const config = loadConfig();
  const long = params.has('long');
  const tracks: QueueTrack[] = Array.from({ length: 40 }, (_, i) => ({
    name: long && i % 3 === 0 ? `示例歌曲 ${i + 1}（一个很长很长的版本名称 · Extended Mix feat. 另一位歌手）` : `示例歌曲 ${i + 1}`,
    artists: long && i % 2 === 0 ? ['歌手甲', '歌手乙', 'A Very Long Artist Name', '歌手丙'] : ['歌手甲'],
    duration: 150 + ((i * 37) % 120),
  }));
  const state = { at: 6, liked: false, mode: 'playCycle' as PlayMode, max: false, playing: true };
  const overlay: Overlay = new Overlay({
    onClose: log('close'), onPrev: () => playAt(state.at - 1), onNext: () => playAt(state.at + 1), onSeek: log('seek'), onVolume: log('volume'),
    onTogglePlay: () => { state.playing = !state.playing; overlay.progress(52, 120, state.playing); },
    onToggleLike: () => { state.liked = !state.liked; overlay.playState(state.liked, state.mode); },
    onPlayMode: mode => { state.mode = mode; overlay.playState(state.liked, mode); },
    onPlayAt: i => playAt(i),
    onDragWindow: log('drag'), onResizeWindow: log('resize'), onMinimize: log('minimize'),
    onToggleMaximize: () => { state.max = !state.max; overlay.maximized = state.max; },
    settings: () => settingsView(config, c => console.log('config', JSON.stringify(c)), sketch, true),
  });
  const playAt = (i: number) => {
    state.at = (i + tracks.length) % tracks.length;
    const t = tracks[state.at];
    overlay.song({ name: t.name, artists: t.artists, cover: '/previews/drive.webp' });
    overlay.queue(tracks, state.at);
  };
  const picture = document.createElement('img');
  picture.src = '/previews/drive.webp';
  picture.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  overlay.stage.append(picture);
  overlay.show();
  playAt(state.at);
  overlay.mvInfo({ style: '律动', why: '曲风：电子', lyrics: long ? 'aligning' : null });
  overlay.playState(state.liked, state.mode);
  overlay.setStructure([{ start: 0, end: 40, name: '前奏', loud: false }, { start: 40, end: 80, name: '副歌', loud: true }, { start: 80, end: 120, name: '尾奏', loud: false }], '#ec4141');
  overlay.progress(52, 120, true);
  overlay.volume(0.6);
  (window as any).overlay = overlay;
} else {
  for (const id of ['light', 'dark']) {
    const config = loadConfig();
    document.getElementById(id)!.append(settingsView(config, c => console.log('config', JSON.stringify(c)), sketch));
  }
}
