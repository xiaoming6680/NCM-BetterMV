// The update window. When 自动检查更新 has found a newer version, it comes up by itself on the MV page or on the
// settings page, whichever is in sight first, and only once: a version shown is not offered again for a day (稍后提醒
// is that day), 忽略此版本 never again. It follows the update through: the download and the install on one line of
// progress, then a restart of NetEase; or what failed, and how to update by hand from the version's release page
// (GitHub can't be reached from some networks). Once the update is under way it moves with the user between the two
// pages; one not acted on goes with its page.
//
// On the MV page it is a card at the top right, over the picture but out of its way: no scrim, the MV plays on, and
// it moves by transform and opacity only. On the settings page it is a dialog over the page, in the page's theme.
import { appIcon, icon } from './icons.ts';
import {
  canRestart, installUpdate, openPage, openPluginsFolder, pluginsFolder, releasePage, restartNetEase, VERSION, watchUpdate, type Release, type UpdateState,
} from './update.ts';

/** Where the window comes up: the MV page, or the plugin's page in BetterNCM's settings. */
export type Surface = 'mv' | 'settings';

const DAY = 24 * 3600 * 1000;
const EASE = 'cubic-bezier(.32,.72,0,1)';
/** How long a page is in sight before the window comes up on it (not over the page's own arrival). */
const SETTLE: Record<Surface, number> = { mv: 1500, settings: 600 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A small movement, transform and opacity only (off the main thread, beside the MV); none with reduced motion. */
function play(e: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (typeof (e as HTMLElement).animate !== 'function') return null;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return (e as HTMLElement).animate(frames, opts);
}

const mb = (n: number) => (n / 1048576).toFixed(1);

interface Win {
  /** The page it is on; null once that page went out of sight while the update goes on (it comes back on the next). */
  surface: Surface | null;
  slot: HTMLDivElement;
  scrim: HTMLDivElement;
  card: HTMLDivElement;
  title: HTMLDivElement;
  sub: HTMLDivElement;
  main: HTMLDivElement;
  text: HTMLDivElement;
  progress: HTMLDivElement;
  fill: HTMLElement;
  step: HTMLSpanElement;
  pct: HTMLElement;
  aside: HTMLDivElement;
  buttons: HTMLDivElement;
  foot: HTMLButtonElement;
  /** The release it is about (a failure may not carry it). */
  release: Release | null;
  version: string;
  /** Which of its views is drawn: the words and buttons are made anew only when it changes. */
  drawn: string;
}

/** The pages in sight, and what the window goes into on each. */
const pages = new Map<Surface, HTMLElement>();
let update: UpdateState = { kind: 'idle' };
let win: Win | null = null;
let timer = 0;
/** BetterNCM's plugins folder, named in the steps for updating by hand. */
let folder = '';

const autoOn = () => plugin.getConfig<boolean>('autoUpdate', true) as unknown !== false;

/** The version the window would come up for now: one found by the daily check, or a newer package found at start. */
function offered(): string | null {
  if (!autoOn()) return null;
  const s = update;
  const version = s.kind === 'available' && s.auto ? s.release.version : s.kind === 'ready' && s.auto ? s.version : null;
  if (!version || plugin.getConfig('updateIgnored', '') === version) return null;
  try {
    const told = JSON.parse(String(plugin.getConfig('updatePrompted', '')) || 'null');
    if (told && told.version === version && Date.now() - Number(told.at) < DAY) return null;
  } catch { /* offered */ }
  return version;
}

/** The update is under way, or done or failed after it was asked for: the window follows it from page to page. */
const underway = () => update.kind === 'downloading' || update.kind === 'installing' || update.kind === 'failed' || (update.kind === 'ready' && !update.auto);

/** The page in front: the MV page covers everything, the settings page too. */
const front = (): Surface | null => (pages.has('mv') ? 'mv' : pages.has('settings') ? 'settings' : null);

/**
 * A page came into sight (`host`: what the window goes into on it) or went out of it (null). Telling it again while
 * nothing changed costs nothing.
 */
export function updateWindowOn(surface: Surface, host: HTMLElement | null): void {
  if (host ? pages.get(surface) === host : !pages.has(surface)) return;
  if (host) pages.set(surface, host); else pages.delete(surface);
  const to = front();
  if (!win) { schedule(); return; }
  if (win.surface === to) return;
  // Not acted on, it goes with its page (the MV page opened over the settings page leaves it too); following an
  // update, it moves to the page now in front, or stays where it was, out of sight, until one comes up.
  if (!underway()) close();
  else if (to) mount(to, false);
  else win.surface = null;
}

watchUpdate(s => {
  update = s;
  if (win) draw(); else schedule();
});

/** The window comes up a moment after a page is in sight, if there is a version to offer then. */
function schedule(): void {
  const to = front();
  if (!to || !offered()) { clearTimeout(timer); timer = 0; return; }
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    if (win) return;
    const now = front();
    if (now === to && offered()) open(now); else schedule();
  }, SETTLE[to]);
}

function open(surface: Surface): void {
  const version = offered()!;
  plugin.setConfig('updatePrompted', JSON.stringify({ version, at: Date.now() }));
  win = build(version);
  draw();
  mount(surface, true);
}

function build(version: string): Win {
  // (Keys pressed on its buttons are theirs: the MV page's shortcuts leave them alone.)
  const slot = el('div', 'bmv-upd-slot');
  slot.dataset.bmvSettings = '';
  const scrim = el('div', 'bmv-upd-scrim');
  scrim.onclick = () => close();
  const card = el('div', 'bmv-upd');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'BetterMV 更新');
  const head = el('div', 'bmv-upd-head');
  const mark = el('div', 'bmv-upd-icon');
  mark.innerHTML = appIcon(40);
  const titles = el('div', 'bmv-upd-titles');
  const title = el('div', 'bmv-upd-title'), sub = el('div', 'bmv-upd-sub');
  titles.append(title, sub);
  const x = el('button', 'bmv-upd-x');
  x.innerHTML = icon('xmark', 12, 2.2);
  x.title = '关闭';
  x.setAttribute('aria-label', '关闭');
  x.onclick = () => close();
  head.append(mark, titles, x);
  // Under the titles: the words or the line of progress, then the buttons; along the bottom, the page to update by hand.
  const main = el('div', 'bmv-upd-main');
  const body = el('div', 'bmv-upd-body');
  const text = el('div', 'bmv-upd-text');
  const progress = el('div', 'bmv-upd-progress');
  const bar = el('div', 'bmv-upd-bar');
  const fill = el('i');
  bar.append(fill);
  const stepRow = el('div', 'bmv-upd-step');
  const step = el('span'), pct = el('b');
  stepRow.append(step, pct);
  progress.append(bar, stepRow);
  body.append(text, progress);
  const actions = el('div', 'bmv-upd-actions');
  const aside = el('div', 'bmv-upd-aside'), buttons = el('div', 'bmv-upd-btns');
  actions.append(aside, buttons);
  main.append(body, actions);
  const foot = el('button', 'bmv-upd-foot');
  card.append(head, main, foot);
  slot.append(card);
  return { surface: null, slot, scrim, card, title, sub, main, text, progress, fill, step, pct, aside, buttons, foot, release: null, version, drawn: '' };
}

/** Puts the window on a page: arriving (from the right on the MV page, settling over the settings page), or moved there. */
function mount(surface: Surface, arriving: boolean): void {
  const w = win!;
  w.surface = surface;
  const host = pages.get(surface)!;
  const dialog = surface === 'settings';
  w.slot.className = 'bmv-upd-slot ' + (dialog ? 'is-dialog' : 'is-mv');
  w.card.setAttribute('aria-modal', String(dialog));
  if (dialog) host.append(w.scrim, w.slot);
  else { w.scrim.remove(); host.append(w.slot); }
  window.removeEventListener('keydown', onKey, true);
  if (dialog) window.addEventListener('keydown', onKey, true);
  if (!arriving) play(w.card, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  else if (!dialog) play(w.card, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE });
  else {
    play(w.scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    play(w.card, [{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: EASE });
  }
}

/** Esc puts the dialog on the settings page away. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || win?.surface !== 'settings') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

function close(): void {
  const w = win;
  if (!w) return;
  win = null;
  clearTimeout(timer);
  timer = 0;
  window.removeEventListener('keydown', onKey, true);
  const gone = () => { w.slot.remove(); w.scrim.remove(); };
  const away = w.surface && w.slot.isConnected ? play(w.card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: w.surface === 'mv' ? 'translateX(12px)' : 'scale(.97)' }],
    { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }) : null;
  if (!away) { gone(); return; }
  if (w.surface === 'settings') play(w.scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  away.onfinish = gone;
}

/** The window as the update stands: its words, its line of progress and its buttons. */
function draw(): void {
  const w = win;
  if (!w) return;
  const s = update;
  // (A check under way keeps what is shown: the daily one runs a few seconds after start, the window may be up.)
  if (s.kind === 'checking') return;
  if (s.kind === 'idle' || s.kind === 'latest') { close(); return; }
  if ((s.kind === 'available' || s.kind === 'downloading' || s.kind === 'installing' || s.kind === 'failed') && s.release) {
    w.release = s.release;
    w.version = s.release.version;
  } else if (s.kind === 'ready') w.version = s.version;
  const view = s.kind === 'available' ? (s.installable ? 'offer' : 'dev') : s.kind === 'downloading' || s.kind === 'installing' ? 'progress'
    : s.kind === 'ready' ? (s.auto ? 'placed' : 'ready') : 'failed';

  // One line of progress for the whole update: the download takes it to 90 %, checking and writing the package the rest.
  let k = -1;
  if (s.kind === 'downloading') {
    k = s.total ? 0.9 * Math.min(1, s.done / s.total) : 0;
    w.step.textContent = !s.done ? '正在准备下载' : s.total ? `正在下载 ${mb(s.done)} / ${mb(s.total)} MB` : `正在下载 ${mb(s.done)} MB`;
  } else if (s.kind === 'installing') {
    k = 0.96;
    w.step.textContent = '正在安装';
  } else if (view === 'ready') {
    k = 1;
    w.step.textContent = '下载并安装完成';
  }
  if (k >= 0) {
    w.fill.style.transform = `translateX(${((k - 1) * 100).toFixed(2)}%)`;
    w.pct.textContent = `${Math.round(k * 100)}%`;
  }
  if (view === w.drawn) return;
  const again = !!w.drawn;
  w.drawn = view;

  const v = w.version, page = w.release?.page || releasePage(v), name = w.release?.name || `BetterMV-${v}.plugin`;
  const current = VERSION ? `当前版本 ${VERSION}` : '';
  const button = (text: string, fn: () => void, primary = false) => {
    const b = el('button', 'bmv-btn' + (primary ? ' is-primary' : ''), text);
    b.onclick = fn;
    return b;
  };
  const quiet = (text: string, fn: () => void) => { const b = el('button', 'bmv-upd-quiet', text); b.onclick = fn; return b; };
  const foot = (text: string | null, fn?: () => void) => {
    w.foot.style.display = text ? '' : 'none';
    w.card.classList.toggle('no-foot', !text);
    if (!text) return;
    w.foot.textContent = text;
    w.foot.insertAdjacentHTML('beforeend', icon('chevronRight', 12, 2));
    w.foot.onclick = fn!;
  };
  const ignore = () => quiet('忽略此版本', () => { plugin.setConfig('updateIgnored', v); close(); });
  const restart = () => (canRestart() ? [button('稍后', close), button('重启网易云', restartNetEase, true)] : [button('好', close, true)]);
  w.sub.classList.toggle('is-error', view === 'failed');
  w.aside.textContent = '';
  w.buttons.textContent = '';
  let words = '';
  if (view === 'offer' || view === 'dev') {
    w.title.textContent = `BetterMV ${v} 已发布`;
    w.sub.textContent = current;
    const release = w.release!;
    words = view === 'dev' ? '开发安装无法自动更新，请在发布页下载安装包。'
      : release.size ? `下载约 ${mb(release.size)} MB，安装后重启网易云生效。` : '安装后重启网易云生效。';
    w.aside.append(ignore());
    w.buttons.append(button('稍后提醒', close), view === 'dev'
      ? button('前往下载', () => { openPage(page); close(); }, true)
      : button('立即更新', () => void installUpdate(release), true));
    foot(view === 'dev' ? null : '在发布页手动下载', () => openPage(page));
  } else if (view === 'progress') {
    w.title.textContent = `正在更新到 ${v}`;
    w.sub.textContent = current;
    const hide = button('隐藏', close);
    hide.title = '更新在后台继续，进度可在设置的“更新”中查看';
    w.buttons.append(hide);
    foot('在发布页手动下载', () => openPage(page));
  } else if (view === 'ready' || view === 'placed') {
    w.title.textContent = `BetterMV ${v} 已安装`;
    w.sub.textContent = '重启网易云后生效';
    if (view === 'placed') words = VERSION ? `新版本已在插件文件夹中，当前运行的仍是 ${VERSION}。` : '新版本已在插件文件夹中。';
    w.buttons.append(...restart());
    foot('查看更新内容', () => openPage(page));
  } else {
    w.title.textContent = 'BetterMV 更新失败';
    w.sub.textContent = s.kind === 'failed' ? s.message : '';
    words = `可打开发布页手动下载 ${name}，放入插件文件夹${folder ? `（${folder}）` : ''}后重启网易云。`;
    if (!folder) {
      void pluginsFolder().then(f => {
        folder = f;
        if (win === w && w.drawn === 'failed') w.text.textContent = `可打开发布页手动下载 ${name}，放入插件文件夹（${f}）后重启网易云。`;
      }, () => {});
    }
    w.aside.append(quiet('打开插件文件夹', () => void openPluginsFolder()));
    w.buttons.append(button('重试', () => void installUpdate(w.release!)), button('打开发布页', () => openPage(page), true));
    if (!w.release) w.buttons.firstElementChild!.remove();
    foot(null);
  }
  w.text.textContent = words;
  w.text.style.display = k >= 0 ? 'none' : '';
  w.progress.style.display = k >= 0 ? '' : 'none';
  // A new view fades in where the last one was (the card's size changes only for a failure's longer words).
  if (again) play(w.main, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
}
