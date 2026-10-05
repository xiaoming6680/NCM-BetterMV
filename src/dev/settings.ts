// Dev page: the plugin's settings page as BetterNCM shows it, on a light and on a dark panel; with ?mv, the MV page
// (a sketch standing in for the picture) with its own settings panel open. `plugin` is stood in for (settings kept in
// localStorage); the scene sketches come from public/previews/.
import { loadConfig, Overlay, settingsView } from '../plugin/ui.ts';

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

if (new URLSearchParams(location.search).has('mv')) {
  document.querySelector('main')!.remove();
  const config = loadConfig();
  const overlay = new Overlay({
    onClose: log('close'), onTogglePlay: log('play'), onPrev: log('prev'), onNext: log('next'), onSeek: log('seek'), onVolume: log('volume'),
    onDragWindow: log('drag'), onResizeWindow: log('resize'), onToggleMaximize: log('maximize'),
    settings: () => settingsView(config, c => console.log('config', JSON.stringify(c)), sketch, true),
  });
  const picture = document.createElement('img');
  picture.src = '/previews/drive.webp';
  picture.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  overlay.stage.append(picture);
  overlay.show();
  overlay.info('示例 — BetterMV · 律动（曲风：电子）');
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
