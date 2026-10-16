// The 直播 section of the settings (docs/OBS.md): OBS output on or off, its address (dragged into OBS, or copied), how
// the connection stands, whether the MV page keeps drawing while OBS shows the MV, the port. The settings page calls it
// with its own building blocks, so these rows look like the rest.
import type { Config } from './ui.ts';
import { obs, obsKey, type ObsStatus } from './obs.ts';

/** The settings page's building blocks (src/plugin/ui.ts settingsView). */
export interface SettingsKit {
  /** A section; titled unless the title is the page's own. */
  section: (title: string, aside?: HTMLElement, note?: string) => HTMLElement;
  /** A rounded group of rows in a section. */
  group: (host: HTMLElement) => HTMLElement;
  /** A row: the label and a short line under it on the left, the control on the right, a longer note across. */
  row: (host: HTMLElement, label: string, control: HTMLElement, sub?: string, note?: HTMLElement | string) => HTMLElement;
  button: (text: string, fn: () => void) => HTMLButtonElement;
  link: (text: string, fn: () => void) => HTMLButtonElement;
  /** Repaints whatever else on the page shows a setting (after one changed here). */
  sync: () => void;
}

export interface ObsSettings {
  /** For the section's entry row: 未开启, 已开启, 已连接. */
  value: () => string;
  /** Repaints these rows (a setting changed elsewhere on the page); give it to the page's sync. */
  paint: () => void;
}

const CSS = `
.bmv-obs-url{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:26px;padding:0 10px;border-radius:7px;background:var(--group);
  color:var(--t1);font:500 12.5px/1 Consolas,"Cascadia Mono",monospace;text-decoration:none;cursor:grab;user-select:none;white-space:nowrap}
.bmv-obs-url:active{cursor:grabbing}
.bmv-obs-url svg{flex:none;opacity:.6}
.bmv-obs-off .bmv-obs-url{opacity:.45;cursor:default}
.bmv-obs-ctl{display:flex;align-items:center;gap:8px;min-width:0}
.bmv-obs-state{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--t2);white-space:nowrap}
.bmv-obs-state::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--off)}
.bmv-obs-state.is-on::before{background:#34c759}
.bmv-obs-state.is-wait::before{background:#ff9f0a}
.bmv-obs-state.is-error{color:#ff453a}
.bmv-obs-state.is-error::before{background:#ff453a}
.bmv-obs-port{width:72px;height:26px;padding:0 8px;border:0;border-radius:7px;background:var(--ctl);color:var(--t1);font:inherit;font-size:13px;
  box-shadow:inset 0 0 0 .5px var(--line);text-align:center;-moz-appearance:textfield}
.bmv-obs-port::-webkit-inner-spin-button{-webkit-appearance:none}
.bmv-obs-more{margin-top:14px}
.bmv-obs-steps{margin:10px 0 0;padding:0 4px 0 22px;list-style:decimal outside;font-size:12px;line-height:1.7;color:var(--t2)}
.bmv-obs-steps>li{display:list-item}
`;
let styled = false;

const GRIP = '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><circle cx="2.5" cy="2" r="1.2"/><circle cx="7.5" cy="2" r="1.2"/>' +
  '<circle cx="2.5" cy="6" r="1.2"/><circle cx="7.5" cy="6" r="1.2"/><circle cx="2.5" cy="10" r="1.2"/><circle cx="7.5" cy="10" r="1.2"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Into the clipboard, also where the page isn't a secure context (navigator.clipboard is missing there). */
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* below */ }
  const t = el('textarea');
  t.value = text;
  t.style.cssText = 'position:fixed;opacity:0';
  document.body.append(t);
  t.select();
  document.execCommand('copy');
  t.remove();
}

function stateText(s: ObsStatus): { text: string; cls: string } {
  switch (s.kind) {
    case 'off': return { text: '未开启', cls: '' };
    case 'starting': return { text: '正在启动', cls: 'is-wait' };
    case 'error': return { text: s.error || '无法启动', cls: 'is-error' };
  }
  if (!s.pages) return { text: '等待 OBS 连接', cls: 'is-wait' };
  const who = s.obs ? 'OBS 已连接' : '浏览器已连接';
  if (!s.visible) return { text: who + '，未显示', cls: 'is-wait' };
  return { text: s.pages > 1 ? `${who}（${s.pages} 个）` : who, cls: 'is-on' };
}

/**
 * The 直播 rows, added through `kit`: a section (titled 直播, so on a page of that name it shows no title of its own)
 * with the switch, the address and the connection, then the MV page's behaviour and the port, then how to set up OBS.
 */
export function obsSettings(kit: SettingsKit, config: Config, onChange: (c: Config) => void): ObsSettings {
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
  }
  const save = <K extends 'obs' | 'obsKeepMv' | 'obsPort'>(key: K, value: Config[K]) => {
    config[key] = value;
    plugin.setConfig(key, value);
    paint();
    kit.sync();
    onChange(config);
  };
  const switchFor = (key: 'obs' | 'obsKeepMv', label: string) => {
    const b = el('button', 'bmv-switch');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', label);
    b.onclick = () => save(key, !config[key]);
    return b;
  };

  const sec = kit.section('直播');
  const main = kit.group(sec);
  const onSwitch = switchFor('obs', 'OBS 输出');
  kit.row(main, 'OBS 输出', onSwitch, '直播画面中只显示 MV，不含声音');

  // The address, to drag into OBS (it makes a browser source the size of its canvas, named by layer-name) or copy.
  const url = el('a', 'bmv-obs-url');
  url.innerHTML = GRIP;
  const urlText = el('span');
  url.append(urlText);
  url.draggable = true;
  url.title = '拖到 OBS 的预览区';
  url.onclick = e => e.preventDefault();
  url.addEventListener('dragstart', e => {
    if (!config.obs) { e.preventDefault(); return; }
    const dt = e.dataTransfer!;
    const named = `${obs.status.url}?layer-name=BetterMV`;
    dt.setData('text/uri-list', named);
    dt.setData('text/plain', named);
    dt.effectAllowed = 'copy';
  });
  const copyBtn = kit.button('复制', () => {
    void copy(obs.status.url).then(() => {
      copyBtn.textContent = '已复制';
      window.setTimeout(() => { copyBtn.textContent = '复制'; }, 1400);
    });
  });
  const urlCtl = el('div', 'bmv-obs-ctl');
  urlCtl.append(url, copyBtn);
  // (How to use it is in the steps below: a line here wraps to four in the MV page's narrow panel.)
  const urlRow = kit.row(main, '地址', urlCtl);

  const state = el('span', 'bmv-obs-state');
  const retry = kit.link('重试', () => { void obs.start(config.obsPort, obsKey()); });
  const stateCtl = el('div', 'bmv-obs-ctl');
  stateCtl.append(state, retry);
  kit.row(main, '状态', stateCtl);

  const more = kit.group(sec);
  more.classList.add('bmv-obs-more');
  const keepSwitch = switchFor('obsKeepMv', 'MV 页同时显示');
  kit.row(more, 'MV 页同时显示', keepSwitch, '默认在 OBS 显示时暂停，节省显卡');
  const port = el('input', 'bmv-obs-port');
  port.type = 'number';
  port.min = '1024';
  port.max = '65535';
  const setPort = () => {
    const n = Math.floor(Number(port.value));
    if (n >= 1024 && n <= 65535 && n !== config.obsPort) save('obsPort', n);
    else port.value = String(config.obsPort);
  };
  port.onchange = setPort;
  port.onkeydown = e => { if (e.key === 'Enter') port.blur(); e.stopPropagation(); };
  kit.row(more, '端口', port, '被其他程序占用时修改');

  const steps = el('ol', 'bmv-obs-steps');
  for (const s of [
    '打开“OBS 输出”。',
    '把地址拖到 OBS 的预览区并确认。',
    '声音由 OBS 的“桌面音频”采集。',
  ]) steps.append(el('li', '', s));
  sec.append(steps);

  function paint(): void {
    onSwitch.setAttribute('aria-checked', String(config.obs));
    keepSwitch.setAttribute('aria-checked', String(config.obsKeepMv));
    if (document.activeElement !== port) port.value = String(config.obsPort);
    const s = obs.status;
    urlText.textContent = s.url;
    url.href = s.url;
    urlRow.classList.toggle('bmv-obs-off', !config.obs);
    const t = stateText(config.obs ? s : { ...s, kind: 'off' });
    state.textContent = t.text;
    state.className = 'bmv-obs-state ' + t.cls;
    retry.style.display = config.obs && s.kind === 'error' ? '' : 'none';
  }
  // The connection, live while these rows are on screen (dropped once they have been and are gone).
  let seen = false;
  const stop = obs.watch(() => {
    if (sec.isConnected) seen = true;
    else if (seen) { stop(); return; }
    paint();
  });
  paint();

  return {
    value: () => (!config.obs ? '未开启' : obs.shown ? '已连接' : '已开启'),
    paint,
  };
}
