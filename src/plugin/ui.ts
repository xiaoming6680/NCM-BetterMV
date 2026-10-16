// The plugin's surface inside NetEase: a small "MV" button, the full-window MV view with its controls, and the
// settings page. The look (src/plugin/uiStyle.ts): white glyphs over a soft scrim on the picture, frosted sheets for
// what slides over it, grouped lists for the settings.
import { STYLES, type StyleId } from '../style/style.ts';
import type { LookId, SceneId } from '../scenes/types.ts';
import { LOOKS, SCENE_GROUPS, SCENES } from '../scenes/catalog.ts';
import { SECTION_LABELS, type Section } from '../types.ts';
import { installPack, removePack, watchPack } from './aligner.ts';
import type { PlayMode } from './client.ts';
import { appIcon, icon, type IconName } from './icons.ts';
import { ensureStyles } from './uiStyle.ts';

/** The plugin's version (plugin/manifest.json, put in at build time). */
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '';

export interface Config {
  style: 'auto' | StyleId;
  quality: 'high' | 'mid' | 'low';
  /** Shifts the picture against the sound (positive = later), for Bluetooth or other laggy outputs. */
  latencyMs: number;
  button: boolean;
  /** Playback controls on the MV page (they hide themselves when the mouse rests). */
  controls: boolean;
  /** Plates the user turned off; the director leaves them out. */
  off: SceneId[];
  /** Looks the user turned off (no section is redrawn in them). */
  offLooks: LookId[];
  /** Per song (by id): how much later its words show, ms (negative = earlier), for a song whose lyric runs off. */
  lyricDelays: Record<string, number>;
  /** Each play of a song arranged anew, or always the same arrangement (its seed taken from the song). */
  arrange: 'random' | 'fixed';
  /** Frames drawn at most per second (0: as many as the screen shows). */
  fpsCap: 0 | 240 | 120 | 60 | 30;
  /** Analyse the play list's next track in the background while one plays. */
  prefetch: boolean;
  /** Ask GitHub once a day whether a newer version is out. */
  autoUpdate: boolean;
  /** The key of each action, as `Ctrl+Shift+KeyM`: the modifiers, then the key's code. */
  keys: Keys;
}

/** What the keyboard can do: open or leave the MV page (anywhere in NetEase), and on the MV page itself. */
export type KeyAction = 'toggle' | 'exit' | 'playPause' | 'back' | 'forward' | 'volUp' | 'volDown';
export type Keys = Record<KeyAction, string>;
export const DEFAULT_KEYS: Keys = {
  toggle: 'Ctrl+Shift+KeyM', exit: 'Escape', playPause: 'Space', back: 'ArrowLeft', forward: 'ArrowRight', volUp: 'ArrowUp', volDown: 'ArrowDown',
};
const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
/** A key press as the settings store it (null for a modifier alone). */
export function keyCombo(e: KeyboardEvent): string | null {
  if (!e.code || MODIFIER_CODES.indexOf(e.code) >= 0) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Win');
  parts.push(e.code);
  return parts.join('+');
}
const KEY_NAMES: Record<string, string> = {
  Space: '空格', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backspace: '退格', Enter: 'Enter',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-',
  Equal: '=', Backquote: '`', PageUp: 'PgUp', PageDown: 'PgDn',
};
/** The caps of a stored key, e.g. `Ctrl`, `Shift`, `M`. */
export function keyCaps(combo: string): string[] {
  return combo.split('+').map(p => KEY_NAMES[p] ?? p.replace(/^(Key|Digit)/, '').replace(/^Numpad/, '小键盘 '));
}
export const keyLabel = (combo: string) => keyCaps(combo).join('+');
/** True while the settings wait for a new key (no action takes the press meanwhile). */
let recordingKeys = false;
export const isRecordingKeys = () => recordingKeys;

export function loadConfig(): Config {
  return {
    style: plugin.getConfig('style', 'auto' as Config['style']),
    quality: plugin.getConfig('quality', 'high' as Config['quality']),
    latencyMs: Number(plugin.getConfig('latencyMs', 0)) || 0,
    button: plugin.getConfig<boolean>('button', true) as unknown !== false,
    controls: plugin.getConfig<boolean>('controls', true) as unknown !== false,
    // Kept as "drive,tunnel" (a plain string survives any config store); unknown names are dropped.
    off: String(plugin.getConfig('offScenes', '')).split(',').filter((id): id is SceneId => SCENES.some(s => s.id === id)),
    offLooks: String(plugin.getConfig('offLooks', '')).split(',').filter((id): id is LookId => LOOKS.some(s => s.id === id)),
    lyricDelays: (() => { try { return JSON.parse(String(plugin.getConfig('lyricDelays', '{}'))) || {}; } catch { return {}; } })(),
    arrange: plugin.getConfig('arrange', 'random' as Config['arrange']) === 'fixed' ? 'fixed' : 'random',
    fpsCap: (() => { const n = Number(plugin.getConfig('fpsCap', 0)); return n === 240 || n === 120 || n === 60 || n === 30 ? n : 0; })(),
    prefetch: plugin.getConfig<boolean>('prefetch', false) as unknown === true,
    autoUpdate: plugin.getConfig<boolean>('autoUpdate', true) as unknown !== false,
    keys: (() => {
      const keys = { ...DEFAULT_KEYS };
      try {
        const saved = JSON.parse(String(plugin.getConfig('keys', '{}'))) || {};
        for (const a of Object.keys(keys) as KeyAction[]) if (typeof saved[a] === 'string' && saved[a]) keys[a] = saved[a];
      } catch { /* the defaults */ }
      return keys;
    })(),
  };
}

export const pixelRatio = (q: Config['quality']) =>
  q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'mid' ? 1 : 0.7;

/** NetEase's play modes, in the order its own button steps through them (心动模式 and 私人 FM are entered elsewhere). */
const MODES: Record<PlayMode, { icon: IconName; name: string }> = {
  playOrder: { icon: 'order', name: '顺序播放' },
  playCycle: { icon: 'repeat', name: '列表循环' },
  playOneCycle: { icon: 'repeatOne', name: '单曲循环' },
  playRandom: { icon: 'shuffle', name: '随机播放' },
  playAi: { icon: 'sparkle', name: '心动模式' },
  playFm: { icon: 'repeat', name: '私人 FM' },
};
const MODE_CYCLE: PlayMode[] = ['playOrder', 'playCycle', 'playOneCycle', 'playRandom'];
/** A section of the song for the progress bar: loud ones (choruses, drops) are marked. */
export interface BarSection { start: number; end: number; name: string; loud: boolean }
/** The song under the controls. */
export interface SongInfo { name: string; artists: string[]; cover: string | null }
/** A track of NetEase's play list. */
export interface QueueTrack { name: string; artists: string[]; duration: number }
/** How the MV shows the song: its style, why it was chosen (null: chosen by hand), its tempo, the lyrics' word times. */
export interface MvInfo { style: string; why: string | null; bpm?: number; lyrics: 'aligning' | 'aligned' | null }
/** What the waiting view says besides its line: how far along (0..1), or that it failed. */
export interface StatusOptions { progress?: number; error?: boolean; hint?: string }
/** NetEase's covers come in any size: a small one for the thumbnail, a large one for the waiting view. */
const sized = (url: string, px: number) => url.replace(/^http:/, 'https:') + (/\?/.test(url) ? '' : `?param=${px}y${px}`);
const clock = (s: number) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const EASE = 'cubic-bezier(.32,.72,0,1)';
/**
 * One small movement on an element, transform and opacity only (they run off the main thread, beside the MV); none
 * when the system asks for reduced motion.
 */
function play(e: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (!e || typeof (e as HTMLElement).animate !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  (e as HTMLElement).animate(frames, opts);
}
/** Things arriving one after another: each rises a few px and fades in, `step` ms apart. */
function arrive(items: Element[], step = 35, delay = 40, rise = 10): void {
  items.forEach((e, i) => play(e, [{ opacity: 0, transform: `translateY(${rise}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 420, delay: delay + i * step, easing: EASE, fill: 'backwards' }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A glyph button of the MV page. */
function glyph(name: IconName, title: string, fn: () => void, size = 22, extra = ''): HTMLButtonElement {
  const b = el('button', 'bmv-g' + (extra ? ' ' + extra : ''));
  b.innerHTML = icon(name, size);
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = ev => { ev.stopPropagation(); fn(); };
  return b;
}

const mvButtonTitle = (key: string) => `BetterMV：为当前歌曲生成 MV（${keyLabel(key)}）`;

export function mvButton(onClick: () => void): HTMLButtonElement {
  ensureStyles();
  const b = el('button', 'bmv-ui bmv-mvbtn');
  b.innerHTML = `${icon('play', 11)}<span>MV</span>`;
  b.title = mvButtonTitle(loadConfig().keys.toggle);
  b.onclick = e => { e.stopPropagation(); onClick(); };
  document.body.appendChild(b);
  return b;
}

/** Where NetEase's window can be resized from: its four corners and its right edge (it has no others). */
export type WindowEdge = 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'right';

export interface OverlayHandlers {
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Seek to a song time in seconds. */
  onSeek: (seconds: number) => void;
  /** Set NetEase's volume, 0..1. */
  onVolume: (v: number) => void;
  /** Add the song to the user's liked songs, or take it out. */
  onToggleLike: () => void;
  /** Switch NetEase's play mode. */
  onPlayMode: (mode: PlayMode) => void;
  /** Play the track at that place of NetEase's play list. */
  onPlayAt: (index: number) => void;
  /** Hand the window to the system's move loop (the title bar's drag). */
  onDragWindow: () => void;
  /** Hand the window to the system's sizing loop, from that corner or edge. */
  onResizeWindow: (edge: WindowEdge) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  /** Try making the MV again after it failed. */
  onRetry?: () => void;
  /** The settings panel's contents, built each time it opens (so it shows the settings as they are now). */
  settings: () => HTMLElement;
}

/** Width of the MV page's sheet, px; it floats 10 px in from the window's edges. */
const PANEL = 380;
const PANEL_ROOM = PANEL + 20;

/** Mouse and touch events that must not reach the page under the MV (NetEase or other plugins' listeners). */
const SWALLOW = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend'];

/** A song's sections as capsules on a line (the progress bar, the waiting view's line). */
function drawSegments(layer: HTMLElement, sections: BarSection[], duration: number): void {
  const d = duration || sections[sections.length - 1]?.end || 1;
  const list = sections.length ? sections : [{ start: 0, end: d, name: '', loud: false }];
  layer.textContent = '';
  for (const s of list) {
    const e = el('i', s.loud ? 'is-loud' : '');
    e.style.left = `calc(${(s.start / d) * 100}% + 1px)`;
    e.style.width = `calc(${((s.end - s.start) / d) * 100}% - 2px)`;
    layer.append(e);
  }
}

export class Overlay {
  readonly root = el('div', 'bmv-ui bmv-root');
  readonly stage = el('div', 'bmv-stage');
  private backdrop = el('div', 'bmv-backdrop');
  private backdropLayers = [el('div', 'bmv-bd'), el('div', 'bmv-bd')];
  /** The waiting view: the artwork, the song, a line of progress and what is being done. */
  private loadEl = el('div', 'bmv-load');
  private loadArt = el('div', 'bmv-load-art');
  private loadTitle = el('div', 'bmv-load-title');
  private loadArtist = el('div', 'bmv-load-artist');
  private loadDim = el('div', 'bmv-segs');
  private loadLit = el('div', 'bmv-segs is-lit');
  private loadFill = el('div', 'bmv-load-fill');
  private loadProgress = -1;
  private loadStep = el('span');
  private loadPct = el('b');
  private loadHint = el('div', 'bmv-load-hint');
  private hasSong = false;
  /** When the waiting view came up (a glimpse of it is faded, not flown). */
  private loadSince = 0;
  private dragEl = el('div', 'bmv-drag');
  private grips: HTMLElement[] = [];
  /** Along the top: a shade, and the settings and window buttons (they make room for an open panel). */
  private top = el('div', 'bmv-top');
  private topButtons = el('div', 'bmv-top-btns');
  private gearEl!: HTMLButtonElement;
  private maxEl!: HTMLButtonElement;
  private panel = el('div', 'bmv-sheet');
  private panelTitle = el('div', 'bmv-sheet-title');
  private panelAside = el('div', 'bmv-sheet-aside');
  private panelBody = el('div', 'bmv-sheet-body bmv-scroll');
  /** Which panel slides in from the right: the settings or the play list (the controls and the cursor then stay up). */
  private open: 'settings' | 'queue' | null = null;
  get panelOpen(): boolean { return this.open !== null; }
  private bar = el('div', 'bmv-bar');
  /** The song: cover, name, artists. */
  private songEl = el('div', 'bmv-song');
  private coverEl = el('img', 'bmv-cover');
  private nameEl = el('div', 'bmv-name');
  private artistEl = el('div', 'bmv-artist');
  private likeEl!: HTMLButtonElement;
  private modeEl!: HTMLButtonElement;
  private liked: boolean | null | undefined;
  private mode: PlayMode | null | undefined;
  /** The MV's style and tempo (opens the settings). */
  private styleEl = el('button', 'bmv-chip');
  private mv: MvInfo | null = null;
  private listEl!: HTMLButtonElement;
  private rightCol = el('div', 'bmv-right');
  private rightItems = el('div', 'bmv-right-items');
  private playEl!: HTMLButtonElement;
  private transport = el('div', 'bmv-transport');
  private track = el('div', 'bmv-track');
  private knob = el('div', 'bmv-knob');
  private timeEl = el('span');
  private lengthEl = el('span');
  /** The song's sections along the progress bar: dim, and a bright copy clipped to what has been played. */
  private segDim = el('div', 'bmv-segs');
  private segLit = el('div', 'bmv-segs is-lit');
  private tipEl = el('div', 'bmv-tip');
  private sections: BarSection[] = [];
  private volTrack = el('div', 'bmv-vol-track');
  private volFill = el('div', 'bmv-vol-fill');
  private volKnob = el('div', 'bmv-knob');
  private volIcon!: HTMLButtonElement;
  private vol = -1;
  private volDragging = false;
  /** The volume before muting, to come back to. */
  private unmuted = 0.6;
  private idleTimer = 0;
  private dragging = false;
  private duration = 0;
  private playing: boolean | null = null;
  private lastSecond = -1;
  /** NetEase's play list as last given, the playing track's place in it, and its rows once drawn. */
  private tracks: QueueTrack[] = [];
  private queueAt = -1;
  private rows: HTMLElement[] = [];
  private rowsFor: QueueTrack[] | null = null;
  private litRow = -1;
  showControls = true;
  visible = false;

  constructor(private handlers: OverlayHandlers) {
    ensureStyles();
    const r = this.root;
    this.backdrop.append(...this.backdropLayers);
    this.buildLoad();
    this.buildTop();
    this.buildBar();
    this.buildDrag();
    this.buildGrips();
    this.buildPanel();
    // The waiting view covers the picture (while NetEase switches songs the last frame stays on the canvas).
    r.append(this.stage, this.backdrop, this.loadEl, this.dragEl, this.top, this.bar, this.panel, ...this.grips);
    document.body.appendChild(r);
    r.addEventListener('mousemove', () => this.wake());
    // A button clicked with the mouse lets the focus go (a key pressed later would ring it); one pressed from the
    // keyboard (detail 0) keeps it.
    r.addEventListener('click', e => { const b = (e.target as HTMLElement | null)?.closest?.('button'); if (b && e.detail > 0) b.blur(); });
    // Leaving the window puts the controls away at once.
    r.addEventListener('mouseleave', () => this.sleep());
    // Clicks on the MV are the MV's: page-wide listeners (NetEase's, other plugins') never see them.
    for (const type of SWALLOW) r.addEventListener(type, e => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
    this.stage.addEventListener('dblclick', () => handlers.onTogglePlay());
    // A click on the picture puts the open panel away.
    this.stage.addEventListener('pointerdown', () => { if (this.panelOpen) this.closePanel(); });
    // The keys as set (Overlay.keys); any other press, NetEase's own shortcuts among them (Ctrl+← → …), goes through.
    window.addEventListener('keydown', e => {
      if (!this.visible || recordingKeys) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const c = keyCombo(e), k = this.keys;
      if (!c) return;
      // Keys on the settings panel's own controls are theirs (the exit key still closes the panel).
      if (c !== k.exit && t?.closest?.('[data-bmv-settings]')) return;
      let hit = true;
      if (c === k.exit) { if (this.panelOpen) this.closePanel(); else handlers.onClose(); }
      else if (c === k.playPause) handlers.onTogglePlay();
      else if (c === k.forward) handlers.onSeek(this.current + 5);
      else if (c === k.back) handlers.onSeek(this.current - 5);
      else if (c === k.volUp) this.nudgeVolume(0.05);
      else if (c === k.volDown) this.nudgeVolume(-0.05);
      else hit = false;
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        this.wake();
        // A button last clicked keeps the focus, and a key press shows its focus ring (the user: “在使用快捷键时不要有提示
        // 框”): a shortcut takes the focus off the MV page's controls. (Tab still shows where the focus is.)
        const f = document.activeElement as HTMLElement | null;
        if (f && f !== document.body && r.contains(f) && !t?.closest?.('[data-bmv-settings]')) f.blur();
      }
    }, true);
    this.setKeys(this.keys);
  }

  /** The keys of the MV page's actions (the settings'); the buttons' tips name them. */
  keys: Keys = { ...DEFAULT_KEYS };
  setKeys(keys: Keys): void {
    this.keys = keys;
    this.playEl.title = `播放 / 暂停（${keyLabel(keys.playPause)}）`;
    this.closeEl.title = `退出 MV（${keyLabel(keys.exit)}）`;
  }
  private closeEl!: HTMLButtonElement;

  private current = 0;

  /** A glyph of the controls; using one keeps the controls up. */
  private button(name: IconName, title: string, fn: () => void, size = 22, extra = ''): HTMLButtonElement {
    return glyph(name, title, () => { fn(); this.wake(); }, size, extra);
  }

  /** The waiting view, centred over the cover's moving colours. */
  private buildLoad(): void {
    const line = el('div', 'bmv-load-line');
    this.loadFill.append(this.loadLit);
    line.append(this.loadDim, this.loadFill);
    const step = el('div', 'bmv-load-step');
    step.append(this.loadStep, this.loadPct);
    const mark = el('div', 'bmv-load-mark');
    mark.innerHTML = appIcon(72);
    const retry = el('button', 'bmv-btn bmv-load-retry', '重试');
    retry.onclick = ev => { ev.stopPropagation(); this.handlers.onRetry?.(); };
    this.loadEl.append(mark, this.loadArt, this.loadTitle, this.loadArtist, line, step, this.loadHint, retry);
    drawSegments(this.loadDim, [], 1);
    drawSegments(this.loadLit, [], 1);
  }

  /** Top right, as on NetEase's play page: the settings, then minimise, maximise / restore and leave the MV. */
  private buildTop(): void {
    const g = this.topButtons;
    this.gearEl = this.button('sliders', '设置', () => this.togglePanel('settings'), 20);
    this.maxEl = this.button('maximize', '最大化', () => this.handlers.onToggleMaximize(), 18);
    this.closeEl = this.button('close', '退出 MV', () => this.handlers.onClose(), 18);
    g.append(this.gearEl, el('div', 'bmv-rule'), this.button('minimize', '最小化', () => this.handlers.onMinimize(), 18), this.maxEl, this.closeEl);
    this.top.append(g);
  }

  /**
   * The controls: the progress bar with the times under its ends, then the song (left), the playback buttons
   * (centred, as on NetEase's play bar: like, previous, play, next, play mode) and the MV's style, the volume and the
   * play list (right).
   */
  private buildBar(): void {
    const row = el('div', 'bmv-row3');

    // The song: name and artists on lines of their own, each cut short with an ellipsis (whole on hover).
    this.coverEl.alt = '';
    this.coverEl.style.display = 'none';
    this.coverEl.onerror = () => { this.coverEl.style.display = 'none'; };
    const text = el('div', 'bmv-song-text');
    text.append(this.nameEl, this.artistEl);
    this.songEl.append(this.coverEl, text);

    const transport = this.transport;
    this.likeEl = this.button('heart', '喜欢', () => this.handlers.onToggleLike(), 20, 'is-quiet');
    this.modeEl = this.button('repeat', '', () => {
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(this.mode as PlayMode) + 1) % MODE_CYCLE.length];
      this.handlers.onPlayMode(next);
    }, 20, 'is-quiet');
    // Until NetEase says (and when it can't: not signed in, private FM), they keep their place but don't show.
    this.likeEl.style.visibility = this.modeEl.style.visibility = 'hidden';
    this.playEl = this.button('pause', '播放 / 暂停（空格）', () => this.handlers.onTogglePlay(), 30, 'is-play');
    transport.append(this.likeEl, this.button('prev', '上一首（Ctrl+←）', () => this.handlers.onPrev(), 24), this.playEl,
      this.button('next', '下一首（Ctrl+→）', () => this.handlers.onNext(), 24), this.modeEl);

    // The right column, and in it what it holds at its natural width (to see what fits).
    const s = this.styleEl;
    s.style.display = 'none';
    s.onclick = ev => { ev.stopPropagation(); this.togglePanel('settings'); };
    this.listEl = this.button('list', '播放列表', () => this.togglePanel('queue'), 22, 'is-quiet');
    this.rightItems.append(s, this.buildVolume(), this.listEl);
    this.rightCol.append(this.rightItems);
    row.append(this.songEl, transport, this.rightCol);
    // A narrow bar (a small window, or a panel open beside it) drops the volume slider, then the style.
    new ResizeObserver(() => this.fit()).observe(this.rightCol);

    // The bar is the song's structure: a segment a section, dim ahead of the playhead, lit behind it.
    this.segLit.style.clipPath = 'inset(0 100% 0 0)';
    this.track.append(this.segDim, this.segLit, this.knob, this.tipEl);
    this.renderSections();
    this.track.onmouseenter = () => { this.tipEl.style.opacity = '1'; this.tipEl.style.transform = 'translate(-50%,0)'; };
    this.track.onmouseleave = () => { this.tipEl.style.opacity = '0'; this.tipEl.style.transform = ''; };
    const at = (x: number) => { const r = this.track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    // Pointer capture keeps the drag on the track (no window listeners, so nothing leaks to the page).
    this.track.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.track.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.track.classList.add('is-drag');
      this.showAt(at(e.clientX));
    };
    this.track.onpointermove = e => { const k = at(e.clientX); this.tip(k); if (this.dragging) this.showAt(k); };
    this.track.onpointerup = e => {
      if (!this.dragging) return;
      this.dragging = false;
      this.track.classList.remove('is-drag');
      this.track.releasePointerCapture(e.pointerId);
      this.handlers.onSeek(at(e.clientX) * this.duration);
    };
    this.track.onpointercancel = () => { this.dragging = false; this.track.classList.remove('is-drag'); };
    // The times at the ends of the line, as on NetEase's play bar: one row, not two.
    const seek = el('div', 'bmv-seek');
    seek.append(this.timeEl, this.track, this.lengthEl);
    this.bar.append(seek, row);
  }

  /**
   * What fits beside the playback buttons: when the right column runs short, the volume becomes the speaker alone (the
   * wheel over it still works), then the style goes.
   */
  private fit(): void {
    const room = this.rightCol.clientWidth, over = () => this.rightItems.offsetWidth > room;
    this.volTrack.style.display = '';
    this.styleEl.style.display = this.mv ? '' : 'none';
    if (!room) return; // not laid out (the MV page is closed)
    if (over()) this.volTrack.style.display = 'none';
    if (over()) this.styleEl.style.display = 'none';
  }

  /** NetEase's volume: a speaker (mute / unmute) and a slider; the wheel over it and the up / down keys nudge it. */
  private buildVolume(): HTMLElement {
    const box = el('div', 'bmv-vol');
    this.volIcon = this.button('speaker', '静音', () => {
      if (this.vol > 0.001) { this.unmuted = this.vol; this.setVol(0); } else this.setVol(this.unmuted > 0.02 ? this.unmuted : 0.6);
    }, 22, 'is-quiet');
    const t = this.volTrack;
    const bar = el('div', 'bmv-vol-bar');
    bar.append(el('div', 'bmv-vol-rail'), this.volFill);
    t.append(bar, this.volKnob);
    const at = (x: number) => { const r = t.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    t.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      this.volDragging = true;
      t.classList.add('is-drag');
      this.setVol(at(e.clientX));
    };
    t.onpointermove = e => { if (this.volDragging) this.setVol(at(e.clientX)); };
    t.onpointerup = e => { if (!this.volDragging) return; this.volDragging = false; t.classList.remove('is-drag'); t.releasePointerCapture(e.pointerId); };
    t.onpointercancel = () => { this.volDragging = false; t.classList.remove('is-drag'); };
    box.onwheel = e => { e.preventDefault(); this.nudgeVolume(e.deltaY < 0 ? 0.05 : -0.05); };
    box.append(this.volIcon, t);
    this.showVol(0.6);
    return box;
  }

  private setVol(v: number): void {
    this.showVol(v);
    this.handlers.onVolume(v);
  }

  private nudgeVolume(d: number): void {
    this.setVol(Math.max(0, Math.min(1, (this.vol < 0 ? 0.6 : this.vol) + d)));
    this.wake();
  }

  private showVol(v: number): void {
    if (Math.abs(v - this.vol) < 1e-3) return;
    const was = this.vol;
    this.vol = v;
    this.volFill.style.width = v * 100 + '%';
    this.volKnob.style.left = v * 100 + '%';
    this.volTrack.title = `音量 ${Math.round(v * 100)}%（滚轮或 ↑ ↓ 调节）`;
    if (was < 0 || (was > 0.001) !== (v > 0.001)) this.volIcon.innerHTML = icon(v > 0.001 ? 'speaker' : 'muted', 22);
    this.volIcon.title = v > 0.001 ? '静音' : '取消静音';
  }

  /** NetEase's volume as it is now (it may change from its own controls); ignored while the slider is held. */
  volume(v: number | null): void {
    if (v === null || this.volDragging) return;
    this.showVol(v);
  }

  /** The song's structure along the progress bar ([] while none is known: one plain bar), its loud parts in `accent`. */
  setStructure(sections: BarSection[], accent: string): void {
    this.sections = sections;
    this.root.style.setProperty('--song', accent);
    this.renderSections();
  }

  private renderSections(): void {
    const d = this.duration || this.sections[this.sections.length - 1]?.end || 1;
    for (const layer of [this.segDim, this.segLit, this.loadDim, this.loadLit]) drawSegments(layer, this.sections, d);
  }

  /** The hover label: the section under the cursor and its time. */
  private tip(k: number): void {
    const t = k * this.duration, s = this.sections.find(x => t >= x.start && t < x.end);
    this.tipEl.textContent = '';
    if (s) this.tipEl.append(s.name, el('span', '', clock(t))); else this.tipEl.append(clock(t));
    this.tipEl.style.left = k * 100 + '%';
  }

  /**
   * The sheet that slides in over the right of the picture, for the settings or the play list (one at a time); the
   * MV keeps playing beside it.
   */
  private buildPanel(): void {
    const head = el('div', 'bmv-sheet-head');
    const close = el('button', 'bmv-x');
    close.innerHTML = icon('xmark', 14, 2);
    close.title = '收起（Esc）';
    close.setAttribute('aria-label', '收起');
    close.onclick = () => this.closePanel();
    head.append(this.panelTitle, this.panelAside, close);
    this.panel.append(head, this.panelBody);
  }

  private togglePanel(which: 'settings' | 'queue'): void {
    if (this.open === which) this.closePanel(); else this.openPanel(which);
  }

  /** Open the settings (built anew, so they show the settings as they are now) or the play list, in place of the other. */
  openPanel(which: 'settings' | 'queue' = 'settings'): void {
    if (this.open === 'settings') hideSketch();
    this.open = which;
    const body = this.panelBody;
    body.textContent = '';
    body.scrollTop = 0;
    body.style.paddingBottom = which === 'queue' ? '12px' : '';
    if (which === 'settings') {
      this.panelTitle.textContent = '设置';
      this.panelAside.innerHTML = appIcon(18);
      this.panelAside.append(VERSION ? `BetterMV ${VERSION}` : 'BetterMV');
      body.append(this.handlers.settings());
    } else {
      this.panelTitle.textContent = '播放列表';
      this.rowsFor = null;
      this.drawQueue();
      // The playing track in the middle of the list.
      const row = this.rows[this.queueAt];
      if (row) body.scrollTop = row.offsetTop - (body.clientHeight - row.offsetHeight) / 2;
    }
    // The contents are laid out first; the sheet slides in (and the controls make room) a frame later, not under that
    // work.
    if (!this.panel.classList.contains('is-open')) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!this.open || this.panel.classList.contains('is-open')) return;
        this.panel.classList.add('is-open');
        // Its contents arrive in turn behind it: the settings' sections, or the rows in sight of the play list.
        const items = this.open === 'settings'
          ? Array.from(this.panelBody.querySelectorAll('.bmv-sec')).slice(0, 6)
          : this.rows.filter(r => r.offsetTop + r.offsetHeight > this.panelBody.scrollTop && r.offsetTop < this.panelBody.scrollTop + this.panelBody.clientHeight).slice(0, 14);
        arrive(items, this.open === 'settings' ? 45 : 22, 80);
        // The scrim stays across the window (the sheet covers its end); only the controls move over.
        this.shift(() => {
          this.bar.style.paddingRight = PANEL_ROOM + 28 + 'px';
          this.topButtons.style.right = PANEL_ROOM + 10 + 'px';
        });
      }));
    }
    this.gearEl.classList.toggle('is-on', which === 'settings');
    this.listEl.classList.toggle('is-on', which === 'queue');
    this.wake();
  }

  closePanel(): void {
    if (!this.open) return;
    if (this.open === 'settings') hideSketch();
    this.open = null;
    if (this.panel.classList.contains('is-open')) {
      this.panel.classList.remove('is-open');
      this.shift(() => {
        this.bar.style.paddingRight = '';
        this.topButtons.style.right = '';
      });
    }
    this.gearEl.classList.remove('is-on');
    this.listEl.classList.remove('is-on');
    this.wake();
  }

  /**
   * Resize the controls for the sheet (or back) at once, then play the change as transforms from where things were: the
   * progress line stretches, the rest slide. A layout animation would lay the bar out every frame beside the MV.
   */
  private shift(apply: () => void): void {
    const moving: Array<[HTMLElement, boolean]> = [[this.track, true], [this.lengthEl, false], [this.transport, false], [this.rightItems, false], [this.topButtons, false]];
    const before = moving.map(([e]) => e.getBoundingClientRect());
    apply();
    if (!this.visible || typeof this.track.animate !== 'function') return;
    moving.forEach(([e, stretch], i) => {
      const a = before[i], b = e.getBoundingClientRect();
      if (!a.width || !b.width) return;
      const dx = stretch ? a.left - b.left : a.right - b.right, sx = stretch ? a.width / b.width : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(sx - 1) < 0.001) return;
      e.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: 'none' }], { duration: 450, easing: EASE });
    });
  }

  /** NetEase's play list and the playing track's place in it (-1: not in it); drawn when the list is open. */
  queue(tracks: QueueTrack[], current: number): void {
    this.tracks = tracks;
    this.queueAt = current;
    if (this.open === 'queue') this.drawQueue();
  }

  /** The play list's rows (only when the list itself changed), and which one is playing. */
  private drawQueue(): void {
    if (this.rowsFor !== this.tracks) {
      this.rowsFor = this.tracks;
      this.litRow = -1;
      this.panelAside.textContent = this.tracks.length ? `${this.tracks.length} 首` : '';
      const body = this.panelBody;
      body.textContent = '';
      if (!this.tracks.length) body.append(el('div', 'bmv-q-empty', '播放列表为空'));
      // A long list costs little: rows off screen are skipped until scrolled to.
      this.rows = this.tracks.map((t, i) => {
        const row = el('div', 'bmv-q');
        const text = el('div', 'bmv-q-text');
        const artists = t.artists.join(' / ');
        text.append(el('div', 'bmv-q-name', t.name || '未知歌曲'), el('div', 'bmv-q-artist', artists));
        row.title = artists ? `${t.name} - ${artists}` : t.name;
        row.append(el('div', 'bmv-q-num', String(i + 1)), text, el('div', 'bmv-q-dur', t.duration ? clock(t.duration) : ''));
        row.onclick = () => this.handlers.onPlayAt(i);
        body.append(row);
        return row;
      });
    }
    if (this.litRow === this.queueAt) return;
    // The playing track: bars moving with the music in place of its number.
    const paint = (i: number, on: boolean) => {
      const row = this.rows[i];
      if (!row) return;
      row.classList.toggle('is-now', on);
      const num = row.firstElementChild as HTMLElement;
      num.innerHTML = on ? '<span class="bmv-eq"><i></i><i></i><i></i></span>' : String(i + 1);
    };
    paint(this.litRow, false);
    paint(this.queueAt, true);
    this.litRow = this.queueAt;
  }

  /**
   * The strip along the top works like NetEase's own title bar (which the MV covers): press and move to drag the
   * window, double-click to maximise or restore.
   */
  private buildDrag(): void {
    const d = this.dragEl;
    let down: { x: number; y: number } | null = null;
    d.addEventListener('mousedown', e => { down = e.button === 0 ? { x: e.screenX, y: e.screenY } : null; });
    d.addEventListener('mousemove', e => {
      if (!down) return;
      if (!(e.buttons & 1)) { down = null; return; }
      if (Math.abs(e.screenX - down.x) > 5 || Math.abs(e.screenY - down.y) > 5) { down = null; this.handlers.onDragWindow(); }
    });
    d.addEventListener('mouseup', () => { down = null; });
    d.addEventListener('dblclick', () => { down = null; this.handlers.onToggleMaximize(); });
  }

  /**
   * NetEase's own resize grips, which the MV covers, at the same places and sizes: the corners (8 px) and the right
   * edge (5 px). A press hands the window to the system's sizing loop. Over everything else, the settings panel too.
   */
  private buildGrips(): void {
    const grips: Array<[WindowEdge, string]> = [
      ['topleft', 'top:0;left:0;width:8px;height:8px;cursor:nwse-resize'],
      ['topright', 'top:0;right:0;width:8px;height:8px;cursor:nesw-resize'],
      ['bottomleft', 'bottom:0;left:0;width:8px;height:8px;cursor:nesw-resize'],
      ['bottomright', 'bottom:0;right:0;width:8px;height:8px;cursor:nwse-resize'],
      ['right', 'top:8px;bottom:8px;right:0;width:5px;cursor:ew-resize'],
    ];
    this.grips = grips.map(([edge, css]) => {
      const g = el('div');
      g.style.cssText = 'position:absolute;' + css;
      g.addEventListener('mousedown', e => { if (e.button === 0) this.handlers.onResizeWindow(edge); });
      return g;
    });
  }

  /** The window is maximised: its button restores it, and the resize grips go (a maximised window can't be resized). */
  set maximized(on: boolean) {
    if (on === this.isMax) return;
    this.isMax = on;
    for (const g of this.grips) g.style.display = on ? 'none' : '';
    this.maxEl.innerHTML = icon(on ? 'restore' : 'maximize', 18);
    this.maxEl.title = on ? '向下还原' : '最大化';
  }
  private isMax = false;

  private showAt(k: number): void {
    this.segLit.style.clipPath = `inset(0 ${(1 - k) * 100}% 0 0)`;
    this.knob.style.left = k * 100 + '%';
    this.timeEl.textContent = clock(k * this.duration);
  }

  /** True while the close button and controls are up (after the mouse moved). */
  awake = false;

  private wake(): void {
    this.awake = true;
    this.top.style.opacity = '1';
    this.top.style.transform = '';
    this.bar.style.transform = '';
    this.bar.style.opacity = this.showControls ? '1' : '0';
    this.bar.style.pointerEvents = this.showControls ? 'auto' : 'none';
    this.root.style.cursor = '';
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => (this.dragging ? this.wake() : this.sleep()), 2500);
  }

  /** Put the buttons, the controls and the cursor away (not while a panel is open). */
  private sleep(): void {
    if (this.dragging || this.panelOpen) return;
    clearTimeout(this.idleTimer);
    this.awake = false;
    this.top.style.opacity = '0';
    this.top.style.transform = 'translateY(-6px)';
    this.bar.style.opacity = '0';
    this.bar.style.transform = 'translateY(10px)';
    this.bar.style.pointerEvents = 'none';
    this.root.style.cursor = 'none';
  }

  show(): void {
    this.visible = true;
    // Last in the page, so nothing another plugin added at the same z-index sits over the MV.
    if (this.root !== document.body.lastElementChild) document.body.appendChild(this.root);
    const was = this.root.style.display === 'block';
    this.root.style.display = 'block';
    if (!was) play(this.root, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    this.wake();
    // The settings' first layout (its many glyphs shaped for the first time) takes tens of ms: done once, out of
    // sight, while the MV is being made, so the first opening of the panel doesn't stall.
    if (!this.warmed) {
      this.warmed = true;
      window.setTimeout(() => {
        if (!this.visible || this.open) return;
        const v = this.handlers.settings();
        v.style.cssText = `position:absolute;left:-10000px;top:0;width:${PANEL}px;visibility:hidden;pointer-events:none`;
        this.root.append(v);
        void v.offsetHeight;
        v.remove();
      }, 1200);
    }
  }
  private warmed = false;
  hide(): void {
    this.closePanel();
    this.visible = false;
    const r = this.root;
    if (typeof r.animate !== 'function' || r.style.display !== 'block') { r.style.display = 'none'; return; }
    // A short fade out; gone at once if it is shown again meanwhile.
    const fade = r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in' });
    fade.onfinish = () => { if (!this.visible) r.style.display = 'none'; };
  }

  /**
   * What the MV page is waiting on (null: nothing, the MV shows). With a song known the waiting view shows its
   * artwork, name and a line of progress; without one, the text alone.
   */
  status(text: string | null, opts: StatusOptions = {}): void {
    const l = this.loadEl;
    if (text === null) { this.finishLoading(); return; }
    const p = opts.progress;
    l.classList.toggle('is-error', !!opts.error);
    l.classList.toggle('is-empty', !this.hasSong);
    this.loadStep.textContent = text;
    this.loadHint.textContent = opts.hint ?? '';
    this.loadPct.textContent = p === undefined || opts.error ? '' : `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    const k = Math.max(0, Math.min(1, p ?? 0));
    if (k !== this.loadProgress) {
      this.loadProgress = k;
      this.loadFill.style.transform = `translateX(${(k - 1) * 100}%)`;
      this.loadLit.style.transform = `translateX(${(1 - k) * 100}%)`;
    }
    this.loadArt.style.visibility = '';
    clearTimeout(this.leaveTimer);
    l.classList.remove('is-leaving');
    this.backdrop.classList.remove('is-leaving');
    if (!l.classList.contains('is-on')) {
      this.loadSince = performance.now();
      if (this.hasSong) {
        play(this.loadArt, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: EASE, fill: 'backwards' });
        arrive([this.loadTitle, this.loadArtist, this.loadDim.parentElement!, this.loadStep.parentElement!], 60, 120, 8);
      }
    }
    l.classList.add('is-on');
    this.backdrop.classList.add('is-on');
  }

  /**
   * The MV is ready: the waiting view goes. With the controls up, its artwork flies into the thumbnail by the song's
   * name, where it can be seen to land. With them away (the usual case), the whole view (cover colours, artwork,
   * name, line) fades out as one, the artwork settling back a little, and the MV comes up behind it.
   */
  private finishLoading(): void {
    const l = this.loadEl, wasOn = l.classList.contains('is-on');
    const shown = wasOn && this.visible && this.hasSong && !l.classList.contains('is-error') && !l.classList.contains('is-empty') &&
      performance.now() - this.loadSince >= 700;
    const to = this.coverEl.getBoundingClientRect();
    const intoThumb = shown && this.awake && this.showControls && to.width > 0 && typeof this.loadArt.animate === 'function';
    if (shown && !intoThumb) {
      l.classList.add('is-leaving');
      this.backdrop.classList.add('is-leaving');
      clearTimeout(this.leaveTimer);
      this.leaveTimer = window.setTimeout(() => { l.classList.remove('is-leaving'); this.backdrop.classList.remove('is-leaving'); }, 900);
    }
    l.classList.remove('is-on');
    this.backdrop.classList.remove('is-on');
    if (!intoThumb) return;
    const from = this.loadArt.getBoundingClientRect(), box = this.root.getBoundingClientRect();
    if (!from.width) return;
    const fly = el('div', 'bmv-load-art');
    fly.style.cssText = `position:absolute;left:${from.left - box.left}px;top:${from.top - box.top}px;width:${from.width}px;height:${from.height}px;` +
      `background-image:${this.loadArt.style.backgroundImage};transform-origin:0 0;pointer-events:none;will-change:transform,opacity`;
    this.root.insertBefore(fly, this.dragEl);
    this.loadArt.style.visibility = 'hidden';
    // Transform and opacity only, so it runs off the main thread while the MV's first frames are drawn.
    const k = to.width / from.width;
    const land = fly.animate([
      { transform: 'none' },
      { transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${k})` },
    ], { duration: 720, easing: EASE, fill: 'forwards' });
    land.onfinish = () => {
      const fade = fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      fade.onfinish = () => fly.remove();
    };
  }
  private leaveTimer = 0;

  /** The song under the controls and in the waiting view (null: none playing). */
  song(info: SongInfo | null): void {
    const name = info?.name || '', artists = info?.artists.join(' / ') || '';
    this.hasSong = !!info;
    this.root.classList.toggle('is-nosong', !info);
    if (!info) {
      // Nothing playing: no structure, and play (not pause) under the dimmed buttons.
      this.setStructure([], '#fff');
      this.playing = null;
      this.playEl.innerHTML = icon('play', 30);
    }
    this.nameEl.textContent = this.loadTitle.textContent = name;
    this.artistEl.textContent = this.loadArtist.textContent = artists;
    this.songEl.title = artists ? `${name} - ${artists}` : name;
    const cover = info?.cover ? sized(info.cover, 96) : '';
    if (cover && this.coverEl.getAttribute('src') !== cover) this.coverEl.src = cover;
    this.coverEl.style.display = cover ? '' : 'none';
    this.loadArt.style.backgroundImage = info?.cover ? `url("${sized(info.cover, 640)}")` : '';
  }

  /** The MV's style and tempo beside the volume (null while the MV is being made); why, and the lyrics, on hover. */
  mvInfo(info: MvInfo | null): void {
    this.mv = info;
    const s = this.styleEl;
    s.textContent = '';
    if (info) {
      s.append(info.style);
      if (info.bpm) s.append(el('span', '', `${Math.round(info.bpm)} BPM`));
      if (info.lyrics === 'aligning') s.append(el('span', '', '正在对齐歌词'));
      s.title = [
        `风格：${info.style}（${info.why ? `自动选择，${info.why}` : '手动指定'}）`,
        info.lyrics === 'aligning' ? '歌词：正在按音频对齐每个字' : info.lyrics === 'aligned' ? '歌词：已按音频对齐每个字' : '',
        '点击打开设置',
      ].filter(Boolean).join('\n');
    }
    this.fit();
  }

  /**
   * Whether the song is in the user's liked songs (null: NetEase can't say — not signed in, a podcast — and the heart
   * goes) and NetEase's play mode (the button goes in private FM). Touches the DOM only when they changed.
   */
  playState(liked: boolean | null, mode: PlayMode | null): void {
    if (liked !== this.liked) {
      const l = this.likeEl, was = this.liked;
      l.style.visibility = liked === null ? 'hidden' : 'visible';
      l.innerHTML = icon(liked ? 'heartFill' : 'heart', 20);
      if (typeof was === 'boolean' && typeof liked === 'boolean') {
        play(l.firstElementChild, liked
          ? [{ transform: 'scale(.7)' }, { transform: 'scale(1.22)', offset: 0.45 }, { transform: 'none' }]
          : [{ transform: 'scale(.8)' }, { transform: 'none' }], { duration: liked ? 380 : 220, easing: 'ease-out' });
      }
      l.classList.toggle('is-quiet', !liked);
      l.classList.toggle('is-liked', !!liked);
      l.title = liked ? '取消喜欢' : '喜欢';
      this.liked = liked;
    }
    if (mode !== this.mode) {
      this.mode = mode;
      const m = this.modeEl, known = mode && mode !== 'playFm' ? MODES[mode] : null;
      m.style.visibility = known ? 'visible' : 'hidden';
      if (known) {
        const first = !m.firstElementChild;
        m.innerHTML = icon(known.icon, 20);
        m.title = known.name;
        if (!first) play(m.firstElementChild, [{ opacity: 0, transform: 'rotate(-90deg) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
      }
    }
  }

  /** Called every frame with the song position. Touches the DOM only when something visible changed. */
  progress(seconds: number, duration: number, playing: boolean): void {
    this.current = seconds;
    if (duration && Math.abs(duration - this.duration) > 0.5) { this.duration = duration; this.renderSections(); }
    this.duration = duration;
    if (playing !== this.playing) {
      const swap = this.playing !== null;
      this.playing = playing;
      this.playEl.innerHTML = icon(playing ? 'pause' : 'play', 30);
      if (swap) play(this.playEl.firstElementChild, [{ opacity: 0.2, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
      this.root.classList.toggle('is-playing', playing);
    }
    if (this.dragging || !duration) return;
    const second = Math.floor(seconds * 4);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    this.showAt(Math.max(0, Math.min(1, seconds / duration)));
    this.lengthEl.textContent = clock(duration);
  }

  setBackdrop(url: string | null): void {
    const image = url ? `url("${sized(url, 200)}")` : '';
    for (const layer of this.backdropLayers) layer.style.backgroundImage = image;
  }
}


/** The picture delay's range, ms. */
const LATENCY_MIN = -200, LATENCY_MAX = 400;

const STYLE_NOTE: Record<Config['style'], string> = {
  auto: '根据网易云的曲风标签选择：说唱为“字”，国风为“墨”，电子、舞曲、摇滚为“律动”，民谣、古典、轻音乐为“抒情”；无标签时依据鼓点和 drop 判断。',
  pulse: '踩拍硬切，细线与光效，drop 处进入推进隧道。适合电子、舞曲、摇滚。',
  ballad: '长镜头、柔光、缓慢推移，转场柔和、无闪烁。适合慢歌、民谣、轻音乐。',
  word: '以歌词为画面主体：字墙、海报排版、网点印刷。适合说唱。',
  ink: '封面呈现为宣纸水墨，歌词竖排，以墨迹晕染转场。适合国风、古风。',
};

/** Which styles use each plate (any section, any cover, with or without lyrics); every style opens on the cards. */
function stylesUsing(): Map<SceneId, string[]> {
  const out = new Map<SceneId, string[]>();
  for (const style of Object.values(STYLES)) {
    const ids = new Set<SceneId>(['cards']);
    if (style.transitions.dropPunch || style.id !== 'ink') ids.add('crystal');
    for (const label of SECTION_LABELS) for (const graphic of [true, false]) for (const lyrics of [true, false]) {
      for (const p of style.pool({ label } as Section, { graphic, lyrics })) ids.add(p.scene);
    }
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), style.name]);
  }
  return out;
}

interface Sketch { root: HTMLDivElement; img: HTMLImageElement; blank: HTMLDivElement; title: HTMLDivElement; note: HTMLDivElement; foot: HTMLDivElement; token: number; timer: number }
/** The sketch card shown over a scene the pointer rests on: one for the page, on the body (above the panel). */
let sketch: Sketch | null = null;

function sketchCard(): Sketch {
  // Last in the page each time, so it shows over the MV (same z-index) when its settings panel is open.
  if (sketch) { if (sketch.root !== document.body.lastElementChild) document.body.append(sketch.root); return sketch; }
  const root = el('div', 'bmv-ui bmv-card');
  const frame = el('div', 'bmv-card-frame');
  const img = el('img');
  img.alt = '';
  const blank = el('div', 'bmv-card-blank');
  frame.append(img, blank);
  const body = el('div', 'bmv-card-body');
  const title = el('div', 'bmv-card-title');
  const note = el('div', 'bmv-card-note');
  const foot = el('div', 'bmv-card-foot');
  body.append(title, note, foot);
  root.append(frame, body);
  document.body.append(root);
  return (sketch = { root, img, blank, title, note, foot, token: 0, timer: 0 });
}

function hideSketch(): void {
  if (!sketch) return;
  sketch.token++;
  clearTimeout(sketch.timer);
  sketch.root.classList.remove('is-on');
}

/**
 * Whether the host shows the settings page in a dark theme (BetterNCM's panel follows NetEase's own skin, not the
 * system's). The page's ancestors don't say (NetEase paints its dark ground on a layer beside them, and BetterNCM hands
 * down black text), so it asks what is painted under the page: the elements stacked at a point of it, top first,
 * past its own, until one has a ground. Failing that, the host's own words around the page (light on a dark skin;
 * the median of a few, so an accent colour doesn't decide), then the ancestors' grounds, then the system's setting.
 * Whatever it decides, the page carries its own ground, so its words never stand on the wrong one.
 */
function hostIsDark(view: HTMLElement): boolean {
  const lum = (css: string) => {
    const m = css.match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    if (m.length > 3 && Number(m[3]) < 0.5) return null;
    return (0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2])) / 255;
  };
  // What is painted under the page, at a point of it in sight.
  const r = view.getBoundingClientRect();
  const x = Math.min(Math.max(r.left + 6, 0), window.innerWidth - 1), y = Math.min(Math.max(r.top + 6, 0), window.innerHeight - 1);
  if (r.width && r.height && x >= r.left && x < r.right && y >= r.top && y < r.bottom && document.elementsFromPoint) {
    for (const e of document.elementsFromPoint(x, y)) {
      if (view.contains(e) || e.closest('.bmv-ui')) continue;
      const l = lum(getComputedStyle(e).backgroundColor);
      if (l !== null) return l < 0.45;
    }
  }
  // The host's own words around the page.
  const words = (root: Element, out: number[], room: number) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(), seen = 0; n && seen < 400 && out.length < room; n = walk.nextNode(), seen++) {
      const e = n.parentElement;
      if (!n.nodeValue || !n.nodeValue.trim() || !e || !e.getClientRects().length) continue;
      const l = lum(getComputedStyle(e).color);
      if (l !== null) out.push(l);
    }
  };
  for (let branch: Element = view, up = view.parentElement; up && up !== document.documentElement; branch = up, up = up.parentElement) {
    const seen: number[] = [];
    for (const sib of Array.from(up.children)) {
      if (sib === branch || sib.tagName === 'STYLE' || sib.tagName === 'SCRIPT' || sib.classList.contains('bmv-ui')) continue;
      words(sib, seen, 9);
      if (seen.length >= 9) break;
    }
    if (seen.length) return seen.sort((a, b) => a - b)[seen.length >> 1] > 0.5;
  }
  for (let e = view.parentElement; e; e = e.parentElement) {
    const l = lum(getComputedStyle(e).backgroundColor);
    if (l !== null) return l < 0.45;
  }
  return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Settings page for BetterNCM's plugin panel, or (`compact`) the MV page's own settings panel: narrower, without the
 * header and the keys, the sketches shown beside the panel. `preview` gives a scene's sketch (an image URL), or null
 * when there is none.
 */
export function settingsView(config: Config, onChange: (c: Config) => void, preview: (id: string) => Promise<string | null>, compact = false, song?: { id: number; name: string }, actions: { reroll?: () => void } = {}): HTMLElement {
  ensureStyles();
  const view = el('div', 'bmv-ui bmv-set ' + (compact ? 'is-compact' : 'is-page'));
  view.dataset.bmvSettings = '';
  view.dataset.theme = 'dark';
  if (!compact) {
    // The host's theme is known once the page is in it, and followed while it is (NetEase's theme can change).
    view.dataset.theme = 'light';
    let tries = 0, shown = false;
    const look = () => {
      if (view.isConnected) {
        shown = true;
        const theme = hostIsDark(view) ? 'dark' : 'light';
        if (view.dataset.theme !== theme) view.dataset.theme = theme;
        window.setTimeout(look, 1000);
      } else if (!shown && tries++ < 240) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);

    const head = el('div', 'bmv-set-head');
    const mark = el('div', 'bmv-appicon');
    mark.innerHTML = appIcon(56);
    const text = el('div');
    const name = el('div', 'bmv-set-name', 'BetterMV');
    if (VERSION) name.append(el('span', 'bmv-set-ver', VERSION));
    text.append(name, el('div', 'bmv-set-desc', '为正在播放的歌曲实时生成 3D MV：以封面构建场景，按歌曲结构剪辑镜头，按曲风自动选择风格。'));
    head.append(mark, text);
    view.append(head);
  }

  /** A titled section; returns the place for its rows (a rounded group) unless `bare`. */
  const section = (title: string, aside?: HTMLElement, note?: string) => {
    const sec = el('div', 'bmv-sec');
    const h = el('div', 'bmv-sec-h');
    h.append(el('div', 'bmv-sec-title', title));
    if (aside) { aside.classList.add('bmv-sec-aside'); h.append(aside); }
    sec.append(h);
    if (note) sec.append(el('div', 'bmv-sec-note', note));
    view.append(sec);
    return sec;
  };
  const group = (host: HTMLElement) => { const g = el('div', 'bmv-group'); host.append(g); return g; };
  /** A row: the label (and a short line under it) on the left, the control on the right, a longer note across. */
  const row = (host: HTMLElement, label: string, control: HTMLElement, sub?: string, note?: HTMLElement | string) => {
    const r = el('div', 'bmv-row');
    const l = el('div', 'bmv-row-l');
    l.append(el('div', 'bmv-row-label', label));
    if (sub) l.append(el('div', 'bmv-row-sub', sub));
    const c = el('div', 'bmv-row-c');
    c.append(control);
    r.append(l, c);
    if (note) {
      const n = typeof note === 'string' ? el('div', '', note) : note;
      n.classList.add('bmv-row-note');
      r.append(n);
    }
    host.append(r);
    return r;
  };
  const button = (text: string, fn: () => void) => { const b = el('button', 'bmv-btn', text); b.onclick = fn; return b; };
  const link = (text: string, fn: () => void) => { const b = el('button', 'bmv-link', text); b.onclick = fn; return b; };
  const segmented = <K extends 'style' | 'quality' | 'arrange' | 'fpsCap'>(key: K, options: Array<[Config[K], string]>, then?: () => void) => {
    const g = el('div', 'bmv-segc');
    g.setAttribute('role', 'group');
    const paint = () => g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === String(config[key]))));
    for (const [value, text] of options) {
      const b = el('button', '', text);
      b.dataset.value = String(value);
      b.onclick = () => { config[key] = value; plugin.setConfig(key, value); paint(); then?.(); onChange(config); };
      g.append(b);
    }
    paint();
    return g;
  };
  const toggle = (key: 'button' | 'controls' | 'prefetch', label: string) => {
    const b = el('button', 'bmv-switch');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', label);
    const paint = () => b.setAttribute('aria-checked', String(config[key]));
    b.onclick = () => { config[key] = !config[key]; plugin.setConfig(key, config[key]); paint(); onChange(config); };
    paint();
    return b;
  };
  /**
   * A milliseconds stepper: − / the value (typed, or ↑ ↓ 10 ms) / +, held buttons repeating, and 归零. `get` / `set`
   * read and store the value; `less` / `more` title the buttons.
   */
  const msStepper = (get: () => number, set: (ms: number) => void, min: number, max: number, by: number, less: string, more: string) => {
    const host = el('div', 'bmv-row-c');
    host.style.margin = '0';
    const stepper = el('div', 'bmv-stepper');
    const input = el('input');
    input.inputMode = 'numeric';
    input.title = '可直接输入；↑ ↓ 键每次调整 10 ms';
    const zero = link('归零', () => apply(0));
    const show = () => { const ms = get(); input.value = (ms > 0 ? '+' : '') + ms; zero.style.visibility = ms ? 'visible' : 'hidden'; };
    const apply = (ms: number) => {
      ms = Math.max(min, Math.min(max, Math.round(ms)));
      if (ms !== get()) set(ms);
      show();
    };
    const step = (name: IconName, d: number, title: string) => {
      const b = el('button');
      b.innerHTML = icon(name, 14, 2);
      b.title = title;
      b.setAttribute('aria-label', title);
      // Held down, it repeats after 0.4 s, every 60 ms.
      let timer = 0;
      const stop = () => { clearTimeout(timer); timer = 0; };
      b.onpointerdown = e => {
        if (e.button !== 0) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        apply(get() + d);
        const again = (wait: number) => { timer = window.setTimeout(() => { apply(get() + d); again(60); }, wait); };
        again(400);
      };
      b.onpointerup = b.onpointercancel = b.onlostpointercapture = stop;
      b.onclick = e => { if (e.detail === 0) apply(get() + d); }; // Enter / Space on the focused button
      return b;
    };
    input.onkeydown = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); apply(get() + (e.key === 'ArrowUp' ? 10 : -10)); }
      else if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { show(); input.blur(); }
    };
    input.onblur = () => { const ms = parseInt(input.value.replace(/[^\d-]/g, ''), 10); if (Number.isFinite(ms)) apply(ms); else show(); };
    input.onfocus = () => input.select();
    stepper.append(step('minus', -by, less), input, step('plus', by, more));
    host.append(stepper, el('span', 'bmv-unit', 'ms'), zero);
    show();
    return host;
  };

  const picture = group(section('画面'));
  const styleNote = el('div', '', STYLE_NOTE[config.style]);
  row(picture, '风格', segmented('style', [['auto', '自动'], ['pulse', '律动'], ['ballad', '抒情'], ['word', '字'], ['ink', '墨']], () => { styleNote.textContent = STYLE_NOTE[config.style]; }), undefined, styleNote);
  row(picture, '画面编排', segmented('arrange', [['random', '每次不同'], ['fixed', '固定']]), '同一首歌再次播放时，场景、镜头与画风是否重新编排');
  // On the MV page: the playing song arranged anew, at once.
  if (actions.reroll) {
    const again = button('换一种', () => {
      actions.reroll!();
      again.textContent = '已重新编排';
      window.setTimeout(() => { again.textContent = '换一种'; }, 1400);
    });
    row(picture, '当前歌曲', again, '立即重新编排正在播放的歌曲');
  }
  // Picture delay, no slider: − and + step 10 ms (held, they repeat), the number can be typed, and back to zero.
  row(picture, '画面延迟', msStepper(() => config.latencyMs, ms => { config.latencyMs = ms; plugin.setConfig('latencyMs', ms); onChange(config); },
    LATENCY_MIN, LATENCY_MAX, 10, '画面提前 10 ms', '画面推后 10 ms'), undefined,
  compact ? '画面早于声音时调大（蓝牙耳机通常需 +150～250 ms），可在播放中实时调整' : '画面早于声音时调大（蓝牙耳机通常需 +150～250 ms）；也可在 MV 页右上角的设置中实时调整');

  const perf = group(section('性能'));
  row(perf, '画质', segmented('quality', [['high', '高'], ['mid', '中'], ['low', '低']]), '画面卡顿时调低');
  row(perf, '帧率上限', segmented('fpsCap', [[0, '不限'], [240, '240'], [120, '120'], [60, '60'], [30, '30']]), '限制每秒绘制的帧数；高刷新率屏幕可选 120 或 240，30 帧可明显降低显卡占用');
  row(perf, '提前分析下一首', toggle('prefetch', '提前分析下一首'), '播放时在后台分析播放列表中的下一首，切歌后无需等待；会占用部分 CPU');

  const shell = group(section('界面'));
  const mvButtonRow = row(shell, 'MV 按钮', toggle('button', 'MV 按钮'), `显示在播放栏上方；关闭后可用 ${keyLabel(config.keys.toggle)} 打开`);
  row(shell, '控制栏', toggle('controls', '控制栏'), 'MV 页底部的播放控制，鼠标静止时自动隐藏');

  // The optional aligner pack: its state follows the download while the page is open.
  const words = group(section('歌词'));
  // On the MV page: this song's own lyric delay (some songs' lyrics run late or early on NetEase's side).
  if (song) {
    const key = String(song.id);
    row(words, '歌词延迟', msStepper(() => config.lyricDelays[key] ?? 0, ms => {
      if (ms) config.lyricDelays[key] = ms; else delete config.lyricDelays[key];
      plugin.setConfig('lyricDelays', JSON.stringify(config.lyricDelays));
      onChange(config);
    }, -3000, 3000, 50, '歌词提前 50 ms', '歌词推后 50 ms'), undefined, `仅对当前歌曲（${song.name}）生效：歌词晚于演唱时调小，早于演唱时调大`);
  }
  const pack = el('div', 'bmv-row-c');
  pack.style.margin = '0';
  const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
  const stopWatching = watchPack(st => {
    if (!view.isConnected && pack.childElementCount) { stopWatching(); return; }
    pack.textContent = '';
    const state = (t: string, error = false) => pack.append(el('span', 'bmv-state' + (error ? ' is-error' : ''), t));
    if (st.kind === 'checking') state('正在检查…');
    else if (st.kind === 'none') pack.append(button('下载对齐包（约 400 MB）', () => void installPack()));
    else if (st.kind === 'installing') {
      const pct = st.total ? st.done / st.total : 0;
      const box = el('div', 'bmv-pack-progress');
      const meter = el('div', 'bmv-meter');
      const fill = el('i');
      fill.style.width = `${(pct * 100).toFixed(1)}%`;
      meter.append(fill);
      const downloading = st.total && st.note.indexOf('正在下载') === 0;
      box.append(el('span', 'bmv-state', downloading ? `正在下载 ${Math.round(st.done / 1048576)} / ${mb(st.total)}` : st.note), meter);
      pack.append(box);
    } else if (st.kind === 'ready') { state('已安装'); pack.append(button('删除', () => void removePack())); }
    else if (st.kind === 'removing') state('正在删除…');
    else { state('安装失败：' + st.message, true); pack.append(button('重试', () => void installPack())); }
  });
  row(words, '逐字对齐', pack, undefined,
    '适用于仅有逐句歌词的歌曲：按音频识别每个字的演唱时间，替代按音节的估算。首次播放时在本机后台分析，耗时数秒至半分钟，结果缓存后复用。全程本地运行，不上传数据。');

  // The keys: a click on one, then the new keys pressed; one already in use by another action trades places with it.
  const KEY_ROWS: Array<[KeyAction, string, string?]> = [
    ['toggle', '打开 / 退出 MV 页', '在网易云的任何页面都可用；也可点击播放栏上方的 MV 按钮'],
    ['exit', '退出 MV 页', '设置或播放列表打开时，先收起面板'],
    ['playPause', '播放 / 暂停'],
    ['back', '快退 5 秒'],
    ['forward', '快进 5 秒'],
    ['volUp', '音量加大'],
    ['volDown', '音量减小'],
  ];
  const keyName = (a: KeyAction) => KEY_ROWS.find(r => r[0] === a)![1];
  const keyButtons = new Map<KeyAction, HTMLButtonElement>();
  const keysNote = el('div', 'bmv-sec-note');
  const keysTip = '点击后按下新的组合键，Esc 取消；与其他动作重复时两者互换。网易云自身的快捷键（如 Ctrl+← → 切歌）同样有效。';
  keysNote.textContent = keysTip;
  let noteTimer = 0;
  const saveKeys = () => {
    plugin.setConfig('keys', JSON.stringify(config.keys));
    onChange(config);
    refreshKeys();
    // Where the opening key is named: the MV button's row and the button's own tip.
    const sub = mvButtonRow.querySelector('.bmv-row-sub');
    if (sub) sub.textContent = `显示在播放栏上方；关闭后可用 ${keyLabel(config.keys.toggle)} 打开`;
    document.querySelectorAll<HTMLElement>('.bmv-mvbtn').forEach(b => { b.title = mvButtonTitle(config.keys.toggle); });
  };
  const paintKey = (a: KeyAction) => {
    const b = keyButtons.get(a)!;
    b.textContent = '';
    for (const cap of keyCaps(config.keys[a])) b.append(el('span', 'bmv-kbd', cap));
  };
  const resetKeys = link('恢复默认', () => {
    stopRecording?.();
    config.keys = { ...DEFAULT_KEYS };
    keyButtons.forEach((_, a) => paintKey(a));
    saveKeys();
  });
  const refreshKeys = () => {
    resetKeys.style.display = (Object.keys(DEFAULT_KEYS) as KeyAction[]).every(a => config.keys[a] === DEFAULT_KEYS[a]) ? 'none' : '';
  };
  let stopRecording: (() => void) | null = null;
  const record = (a: KeyAction, b: HTMLButtonElement) => {
    stopRecording?.();
    recordingKeys = true;
    b.classList.add('is-recording');
    b.textContent = '请按下快捷键…';
    const stop = () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', away, true);
      recordingKeys = false;
      stopRecording = null;
      b.classList.remove('is-recording');
      paintKey(a);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { stop(); return; }
      const c = keyCombo(e);
      if (!c) return;
      const other = (Object.keys(config.keys) as KeyAction[]).find(x => x !== a && config.keys[x] === c);
      if (other) {
        config.keys[other] = config.keys[a];
        paintKey(other);
        keysNote.textContent = `已与“${keyName(other)}”互换。`;
        clearTimeout(noteTimer);
        noteTimer = window.setTimeout(() => { keysNote.textContent = keysTip; }, 2400);
      }
      config.keys[a] = c;
      stop();
      saveKeys();
    };
    const away = (e: Event) => { if (!b.contains(e.target as Node)) stop(); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', away, true);
    stopRecording = stop;
  };
  const keysSec = section('快捷键', (() => { const x = el('div'); x.append(resetKeys); return x; })());
  keysSec.append(keysNote);
  const keyGroup = group(keysSec);
  for (const [a, label, sub] of KEY_ROWS) {
    const b = el('button', 'bmv-keycap');
    b.title = '点击后按下新的快捷键';
    b.onclick = () => (b.classList.contains('is-recording') ? stopRecording?.() : record(a, b));
    keyButtons.set(a, b);
    paintKey(a);
    row(keyGroup, label, b, sub);
  }
  refreshKeys();

  // Scenes and looks: each one on or off; resting on one shows its sketch, large, with what it is. Choices are
  // gathered and applied together from the bar at the bottom (each applied change replans the MV, a moment's work).
  const off = new Set(config.off), offLooks = new Set(config.offLooks);
  const using = stylesUsing();
  const count = el('span');
  const allOn = link('全部开启', () => { off.clear(); refresh(); });
  const aside = el('div');
  aside.append(count, allOn);
  const scenes = section('场景', aside, '点击选择开启或关闭，再点击底部的“应用”生效；鼠标悬停可查看说明。关闭的场景由同一段落的其他场景替代。');
  const paints: Array<() => void> = [];
  let warnTimer = 0;
  const applyBar = el('div', 'bmv-apply');
  const applyText = el('span', 'bmv-apply-text');
  const changes = () => {
    const diff = (now: Set<string>, saved: string[]) => saved.filter(id => !now.has(id)).length + [...now].filter(id => !saved.includes(id)).length;
    return diff(off, config.off) + diff(offLooks, config.offLooks);
  };
  const refresh = () => {
    paints.forEach(p => p());
    count.textContent = `已开启 ${SCENES.length - off.size} / ${SCENES.length}`;
    count.classList.remove('bmv-warn');
    allOn.style.display = off.size ? '' : 'none';
    const n = changes();
    if (n) { clearTimeout(doneTimer); applyBar.classList.remove('is-done'); }
    if (applyBar.classList.contains('is-done')) return;
    applyText.textContent = `已修改 ${n} 项`;
    applyBar.classList.toggle('is-on', n > 0);
  };
  let doneTimer = 0;
  const apply = () => {
    config.off = SCENES.map(s => s.id).filter(id => off.has(id));
    config.offLooks = LOOKS.map(l => l.id).filter(id => offLooks.has(id));
    plugin.setConfig('offScenes', config.off.join(','));
    plugin.setConfig('offLooks', config.offLooks.join(','));
    onChange(config);
    // Said done for a moment before the bar goes.
    refresh();
    applyBar.classList.add('is-on', 'is-done');
    applyText.textContent = '已应用';
    clearTimeout(doneTimer);
    doneTimer = window.setTimeout(() => { applyBar.classList.remove('is-done'); refresh(); }, 1100);
  };
  const revert = () => {
    off.clear(); config.off.forEach(id => off.add(id));
    offLooks.clear(); config.offLooks.forEach(id => offLooks.add(id));
    refresh();
  };
  const applyNow = button('应用', apply);
  applyNow.classList.add('is-primary');
  applyBar.append(applyText, button('还原', revert), applyNow);
  /** The card for a scene or a look: `image` is its sketch's name, `by` the styles that use it. */
  const showSketch = (info: { name: string; note: string }, image: string, by: string[], isOff: boolean, anchor: HTMLElement) => {
    const s = sketchCard(), token = ++s.token, wasOn = s.root.classList.contains('is-on');
    s.title.textContent = info.name;
    if (isOff) s.title.append(el('span', 'bmv-card-badge', '已关闭'));
    s.note.textContent = info.note;
    const chosen = config.style === 'auto' ? null : STYLES[config.style].name;
    s.foot.textContent = `用于：${by.join('、') || '无'}` + (chosen && !by.includes(chosen) ? `（当前风格“${chosen}”不使用）` : '');
    s.img.style.visibility = 'hidden';
    s.blank.textContent = '';
    void preview(image).then(url => {
      if (s.token !== token) return;
      if (!url) { s.blank.textContent = '暂无示意图'; return; }
      s.img.onload = () => { if (s.token === token) s.img.style.visibility = 'visible'; };
      s.img.src = url;
      if (s.img.complete && s.img.naturalWidth) s.img.style.visibility = 'visible';
    });
    // Below the scene when there is room, above it otherwise, always inside the window; in the MV's panel, to the
    // left of the panel beside the scene (over the picture, not over the other scenes).
    const place = () => {
      const r = anchor.getBoundingClientRect(), h = s.root.offsetHeight || 290;
      const side = compact ? view.getBoundingClientRect().left - 352 : -1;
      let top = r.bottom + 8, left = Math.max(8, Math.min(window.innerWidth - 328, r.left));
      if (side >= 8) { left = side; top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2)); }
      else if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 8 - h);
      s.root.style.left = left + 'px';
      s.root.style.top = top + 'px';
      s.root.classList.add('is-on');
    };
    clearTimeout(s.timer);
    // The sketches are on the page already: the card comes after a short rest, then follows the pointer at once.
    const watch = () => {
      if (s.token !== token) return;
      if (!anchor.isConnected || !anchor.matches(':hover, :focus')) hideSketch();
      else s.timer = window.setTimeout(watch, 300);
    };
    s.timer = window.setTimeout(() => { if (s.token !== token) return; place(); watch(); }, wasOn ? 0 : 320);
  };
  /** A grid of sketches, each on or off; resting on one shows its card. */
  const tiles = <T extends { id: string; name: string }>(items: T[], image: (it: T) => string, isOff: (it: T) => boolean, flip: (it: T, b: HTMLElement) => void, card: (it: T, b: HTMLElement) => void) => {
    const grid = el('div', 'bmv-tiles');
    for (const info of items) {
      const b = el('button', 'bmv-tile');
      const frame = el('span', 'bmv-tile-img');
      const img = el('img');
      img.alt = '';
      // Decoded off the main thread; not lazy: an image without a box (display: none until loaded) is never fetched.
      img.decoding = 'async';
      img.onload = () => img.classList.add('is-ready');
      void preview(image(info)).then(url => { if (url) img.src = url; });
      const check = el('span', 'bmv-check');
      check.innerHTML = icon('check', 12, 2.6);
      frame.append(img, check);
      b.append(frame, el('span', 'bmv-tile-name', info.name));
      paints.push(() => {
        const on = !isOff(info);
        b.setAttribute('aria-pressed', String(on));
        b.title = `${info.name}：${on ? '已开启' : '已关闭'}`;
      });
      b.onclick = () => {
        flip(info, b);
        if (!isOff(info)) play(check, [{ transform: 'scale(.4)' }, { transform: 'none' }], { duration: 260, easing: EASE });
      };
      b.onmouseenter = () => card(info, b);
      b.onmouseleave = () => hideSketch();
      b.onfocus = () => card(info, b);
      b.onblur = () => hideSketch();
      grid.append(b);
    }
    return grid;
  };
  const sceneCard = (info: typeof SCENES[number], b: HTMLElement) => showSketch(info, info.id, using.get(info.id) ?? [], off.has(info.id), b);
  for (const g of SCENE_GROUPS) {
    scenes.append(el('div', 'bmv-sub', g.name));
    group(scenes).append(tiles(g.scenes, info => info.id, info => off.has(info.id), (info, b) => {
      if (!off.has(info.id) && off.size >= SCENES.length - 1) {
        count.textContent = '至少保留一个场景';
        count.classList.add('bmv-warn');
        clearTimeout(warnTimer);
        warnTimer = window.setTimeout(refresh, 1800);
        return;
      }
      if (off.has(info.id)) off.delete(info.id); else off.add(info.id);
      refresh();
      sceneCard(info, b);
    }, sceneCard));
  }

  // Looks: each one on or off, like the scenes (applied with them).
  const looks = section('画风', undefined, '部分段落会改用另一种画风呈现，使整首歌不止一种面貌。关闭的画风不再使用。');
  const lookCard = (info: typeof LOOKS[number], b: HTMLElement) => showSketch(info, `look-${info.id}`, info.styles, offLooks.has(info.id), b);
  group(looks).append(tiles(LOOKS, info => `look-${info.id}`, info => offLooks.has(info.id), (info, b) => {
    if (offLooks.has(info.id)) offLooks.delete(info.id); else offLooks.add(info.id);
    refresh();
    lookCard(info, b);
  }, lookCard));
  refresh();

  // Last, so it can stay in sight at the bottom while the page scrolls.
  view.append(applyBar);
  // The sketches load in the background while the page is read.
  for (const s of SCENES) void preview(s.id);
  for (const l of LOOKS) void preview(`look-${l.id}`);
  return view;
}
