// Dev page: the plugin's settings page as BetterNCM shows it, on a light and on a dark panel and as on BetterNCM's dark
// skin (a ground that is not the page's ancestor, no colour handed down); with ?mv, the MV page
// (a sketch standing in for the picture) and its controls, over a made-up play list (?long: names that don't fit;
// ?demo: the picture the README and the releases show — the plugin's push tunnel, the original demo cover, made-up
// tracks, the play list open). `plugin` is stood in for (settings kept in localStorage); the scene sketches come from
// public/previews/.
import { loadConfig, Overlay, settingsView, type QueueTrack } from '../plugin/ui.ts';
import type { PlayMode } from '../plugin/client.ts';
import { checkPack } from '../plugin/aligner.ts';
import { exportSheet } from '../plugin/exportSheet.ts';
import { loadOptions, saveOptions } from '../plugin/exportOptions.ts';
import { Pill } from '../plugin/pill.ts';

// No aligner pack here (no BetterNCM): the lyrics row offers the download, as on a fresh install.
void checkPack();

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
  const long = params.has('long'), demo = params.has('demo');
  const DEMO: Array<[string, number]> = [
    ['光从山的背面升起', 214], ['我们沿着隧道一直跑', 197], ['把夜色折成三角形', 241], ['每一拍都是新的开始', 228],
    ['远处的声音亮起来', 186], ['风把星星吹成线', 233], ['听见心跳的回声', 205], ['世界在这一刻展开', 262],
    ['别停下 跟着节拍走', 219], ['直到天亮也不回头', 247], ['低空飞行', 193], ['海平面以下', 274], ['晶体', 201], ['半调', 176],
  ];
  const tracks: QueueTrack[] = demo ? DEMO.map(([name, duration]) => ({ name, artists: ['示例曲目'], duration })) : Array.from({ length: 40 }, (_, i) => ({
    name: long && i % 3 === 0 ? `示例歌曲 ${i + 1}（一个很长很长的版本名称 · Extended Mix feat. 另一位歌手）` : `示例歌曲 ${i + 1}`,
    artists: long && i % 2 === 0 ? ['歌手甲', '歌手乙', 'A Very Long Artist Name', '歌手丙'] : ['歌手甲'],
    duration: 150 + ((i * 37) % 120),
  }));
  const picture = demo ? '/film/art/tunnel-h.jpg' : '/previews/drive.webp', cover = demo ? '/tools/previews/demo-cover.jpg' : '/previews/drive.webp';
  const state = { at: demo ? 3 : 6, liked: demo, mode: 'playCycle' as PlayMode, max: false, playing: true, style: 'auto' };
  const overlay: Overlay = new Overlay({
    onClose: log('close'), onPrev: () => playAt(state.at - 1), onNext: () => playAt(state.at + 1), onSeek: log('seek'), onVolume: log('volume'),
    onTogglePlay: () => { state.playing = !state.playing; overlay.progress(52, 120, state.playing); },
    onToggleLike: () => { state.liked = !state.liked; overlay.playState(state.liked, state.mode); },
    onPlayMode: mode => { state.mode = mode; overlay.playState(state.liked, mode); },
    onPlayAt: i => playAt(i),
    onDragWindow: log('drag'), onResizeWindow: log('resize'), onMinimize: log('minimize'),
    onToggleMaximize: () => { state.max = !state.max; overlay.maximized = state.max; },
    settings: () => settingsView(config, c => console.log('config', JSON.stringify(c)), sketch, true, { id: 1, name: '示例歌曲' }, { reroll: log('reroll') }),
    // The plugin's menu (src/plugin/main.ts), its download asking first and then showing its progress.
    menu: () => [
      { label: state.playing ? '暂停' : '播放', hint: '空格', run: () => overlay.progress(52, 120, state.playing = !state.playing) },
      { label: state.liked ? '取消喜欢' : '喜欢', run: () => { state.liked = !state.liked; overlay.playState(state.liked, state.mode); } },
      '-',
      { label: '换一种编排', run: log('reroll') },
      { label: '风格', items: [['auto', '自动'], ['pulse', '律动'], ['ballad', '抒情'], ['word', '字'], ['ink', '墨']].map(([id, name]) => ({ label: name, checked: state.style === id, run: () => { state.style = id; } })) },
      '-',
      { label: '保存当前画面', run: () => overlay.notice('画面已保存', { action: { label: '在文件夹中显示', run: log('reveal') }, hideAfter: 8000 }) },
      { label: '下载 MV…', run: () => overlay.dialog((host, gone) => exportSheet(host, {
        name: long ? '示例歌曲（一个很长很长的版本名称 Extended Mix）' : '示例歌曲', artists: '歌手甲', duration: 228, options: loadOptions(), folder: 'E:\\CloudMusic\\BetterMV', playhead: 52,
        sections: [{ label: 'intro', start: 0, end: 14 }, { label: 'verse', start: 14, end: 46 }, { label: 'chorus', start: 62, end: 94 }, { label: 'drop', start: 174, end: 206 }],
      }, o => {
        saveOptions(o);
        // (Made up: a download's progress on the waiting view, then the file saved.)
        let part = 0;
        const done = () => { clearInterval(timer); overlay.status(null); };
        const timer = window.setInterval(() => {
          part = Math.min(1, part + 0.01);
          overlay.status(part > 0.05 ? '正在下载 MV，还需 1 分 12 秒' : '正在下载 MV', { progress: part, action: { label: '取消', run: () => { done(); overlay.notice('已取消下载', { hideAfter: 3000 }); } } });
          if (part >= 1) { done(); overlay.notice('MV 已保存', { sub: long ? '示例歌曲（一个很长很长的版本名称 Extended Mix） - 歌手甲' : '示例歌曲 - 歌手甲', action: { label: '在文件夹中显示', run: log('reveal') }, hideAfter: 12000 }); }
        }, 120);
      }, gone)) },
      '-',
      { label: '显示控制栏', checked: overlay.showControls, run: () => { overlay.showControls = !overlay.showControls; } },
      { label: '设置…', run: () => overlay.openPanel('settings') },
      { label: '退出 MV', hint: 'Esc', run: log('close') },
    ],
  });
  const playAt = (i: number) => {
    state.at = (i + tracks.length) % tracks.length;
    const t = tracks[state.at];
    overlay.song({ name: t.name, artists: t.artists, cover });
    overlay.queue(tracks, state.at);
  };
  const img = document.createElement('img');
  img.src = picture;
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  overlay.stage.append(img);
  overlay.show();
  playAt(state.at);
  overlay.mvInfo({ style: '律动', why: '曲风：电子', lyrics: long ? 'aligning' : null });
  overlay.playState(state.liked, state.mode);
  if (demo) {
    // A song's sections as the analysis gives them: choruses and the drop marked in the tunnel's pink.
    const parts: Array<[string, number, boolean]> = [['前奏', 14, false], ['主歌', 46, false], ['预副歌', 62, false], ['副歌', 94, true], ['主歌', 126, false],
      ['副歌', 158, true], ['桥段', 174, false], ['高潮', 206, true], ['尾奏', 228, false]];
    overlay.setStructure(parts.map(([name, end, loud], i) => ({ start: parts[i - 1]?.[1] ?? 0, end, name, loud })), '#ff5c7c');
    overlay.progress(82, 228, true);
    overlay.volume(0.7);
    overlay.openPanel('queue');
  } else {
    overlay.setStructure([{ start: 0, end: 40, name: '前奏', loud: false }, { start: 40, end: 80, name: '副歌', loud: true }, { start: 80, end: 120, name: '尾奏', loud: false }], '#ec4141');
    overlay.progress(52, 120, true);
    overlay.volume(0.6);
  }
  (window as any).overlay = overlay;
  if (params.has('pill')) { overlay.hide(); new Pill().show('正在下载 MV，还需 1 分 12 秒', { progress: 0.42, actions: [{ label: '取消', run: log('cancel') }] }); }
} else {
  // Each host shows a state of the song cache: found (the dark one is the README's picture), none found, NetEase not
  // found yet.
  const caches: Record<string, string | null | undefined> = { light: 'E:/NetEaseCache/Cache', dark: 'D:/CloudMusic/Cache', bncm: undefined, narrow: null };
  for (const id of ['light', 'dark', 'bncm', 'narrow']) {
    const config = loadConfig();
    document.getElementById(id)!.append(settingsView(config, c => console.log('config', JSON.stringify(c)), sketch, false, undefined, {}, {
      cacheDir: () => Promise.resolve(caches[id]),
    }));
  }
}
