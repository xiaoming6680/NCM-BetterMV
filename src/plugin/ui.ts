// The plugin's surface inside NetEase: a small "MV" button, the full-window MV view with its controls, and the
// settings page.
import { STYLES, type StyleId } from '../style/style.ts';
import type { LookId, SceneId } from '../scenes/types.ts';
import { LOOKS, SCENE_GROUPS, SCENES } from '../scenes/catalog.ts';
import { SECTION_LABELS, type Section } from '../types.ts';
import { installPack, removePack, watchPack } from './aligner.ts';
import type { PlayMode } from './client.ts';

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
}

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
  };
}

export const pixelRatio = (q: Config['quality']) =>
  q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'mid' ? 1 : 0.7;

const FONT = '"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';
const ICON = {
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  muted: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  heartLine: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  order: 'M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-5v6.17l-1.59-1.58L14 17l4 4 4-4-1.41-1.41L19 17.17V11z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  loopOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  sparkle: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  list: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
};
/** The window's buttons, drawn in lines like NetEase's own title bar. */
const LINE = {
  minimize: 'M5 12h14',
  maximize: 'M5.75 5.75h12.5v12.5H5.75z',
  restore: 'M5.75 8.75h9.5v9.5h-9.5zM8.75 8.75v-3h9.5v9.5h-3',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
};
/** NetEase's play modes, in the order its own button steps through them (心动模式 and 私人 FM are entered elsewhere). */
const MODES: Record<PlayMode, { icon: string; name: string }> = {
  playOrder: { icon: ICON.order, name: '顺序播放' },
  playCycle: { icon: ICON.loop, name: '列表循环' },
  playOneCycle: { icon: ICON.loopOne, name: '单曲循环' },
  playRandom: { icon: ICON.shuffle, name: '随机播放' },
  playAi: { icon: ICON.sparkle, name: '心动模式' },
  playFm: { icon: ICON.loop, name: '私人 FM' },
};
const MODE_CYCLE: PlayMode[] = ['playOrder', 'playCycle', 'playOneCycle', 'playRandom'];
/** A section of the song for the progress bar: loud ones (choruses, drops) are marked. */
export interface BarSection { start: number; end: number; name: string; loud: boolean }
/** The song under the controls. */
export interface SongInfo { name: string; artists: string[]; cover: string | null }
/** A track of NetEase's play list. */
export interface QueueTrack { name: string; artists: string[]; duration: number }
/** How the MV shows the song: its style, why it was chosen (null: chosen by hand), the lyrics' word times. */
export interface MvInfo { style: string; why: string | null; lyrics: 'aligning' | 'aligned' | null }
const svg = (d: string, size: number) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
const stroke = (d: string, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
/** NetEase's covers come in any size: a small one for the thumbnail. */
const thumb = (url: string) => url.replace(/^http:/, 'https:') + (/\?/.test(url) ? '' : '?param=96y96');
const clock = (s: number) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

export function mvButton(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = 'MV';
  b.title = 'BetterMV：为当前歌曲生成 MV（Ctrl+Shift+M）';
  b.style.cssText = `position:fixed;right:22px;bottom:92px;z-index:2147480000;height:30px;padding:0 13px;border:1px solid rgba(255,255,255,.18);` +
    `border-radius:15px;background:rgba(18,18,22,.72);color:#fff;font:700 12px/28px ${FONT};letter-spacing:.14em;cursor:pointer;` +
    `backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,.25);transition:background .2s,transform .2s`;
  b.onmouseenter = () => { b.style.background = 'rgba(236,65,65,.92)'; b.style.transform = 'translateY(-1px)'; };
  b.onmouseleave = () => { b.style.background = 'rgba(18,18,22,.72)'; b.style.transform = ''; };
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
  /** The settings panel's contents, built each time it opens (so it shows the settings as they are now). */
  settings: () => HTMLElement;
}

/** Width of the MV page's settings panel, px. */
const PANEL = 400;

/** Mouse and touch events that must not reach the page under the MV (NetEase or other plugins' listeners). */
const SWALLOW = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend'];

export class Overlay {
  readonly root = document.createElement('div');
  readonly stage = document.createElement('div');
  private backdrop = document.createElement('div');
  private statusEl = document.createElement('div');
  private dragEl = document.createElement('div');
  private grips: HTMLElement[] = [];
  /** Along the top: a shade, and the settings and window buttons (they make room for an open panel). */
  private top = document.createElement('div');
  private topButtons = document.createElement('div');
  private gearEl!: HTMLButtonElement;
  private maxEl!: HTMLButtonElement;
  private closeEl!: HTMLButtonElement;
  private panel = document.createElement('div');
  private panelTitle = document.createElement('div');
  private panelAside = document.createElement('div');
  private panelBody = document.createElement('div');
  /** Which panel slides in from the right: the settings or the play list (the controls and the cursor then stay up). */
  private open: 'settings' | 'queue' | null = null;
  get panelOpen(): boolean { return this.open !== null; }
  private bar = document.createElement('div');
  /** The song: cover, name, artists. */
  private songEl = document.createElement('div');
  private coverEl = document.createElement('img');
  private nameEl = document.createElement('div');
  private artistEl = document.createElement('div');
  private likeEl!: HTMLButtonElement;
  private modeEl!: HTMLButtonElement;
  private liked: boolean | null | undefined;
  private mode: PlayMode | null | undefined;
  /** The MV's style (opens the settings). */
  private styleEl = document.createElement('button');
  private mv: MvInfo | null = null;
  private listEl!: HTMLButtonElement;
  private rightCol!: HTMLDivElement;
  private rightItems = document.createElement('div');
  private playEl = document.createElement('button');
  private track = document.createElement('div');
  private fill = document.createElement('div');
  private knob = document.createElement('div');
  private timeEl = document.createElement('div');
  private lengthEl = document.createElement('div');
  /** The song's sections along the progress bar: dim, and a bright copy clipped to what has been played. */
  private segDim = document.createElement('div');
  private segLit = document.createElement('div');
  private tipEl = document.createElement('div');
  private sections: BarSection[] = [];
  private accent = '#ffffff';
  private volTrack = document.createElement('div');
  private volFill = document.createElement('div');
  private volKnob = document.createElement('div');
  private volIcon = document.createElement('button');
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
    const r = this.root;
    r.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:#000;display:none;overflow:hidden;font-family:${FONT};user-select:none`;
    this.backdrop.style.cssText = 'position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(40px) brightness(.45);transition:opacity .6s';
    this.stage.style.cssText = 'position:absolute;inset:0';
    this.statusEl.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#eee;font-size:15px;letter-spacing:.08em;text-shadow:0 1px 8px rgba(0,0,0,.6);pointer-events:none';
    this.buildTop();
    this.buildBar();
    this.buildDrag();
    this.buildGrips();
    this.buildPanel();
    r.append(this.backdrop, this.stage, this.statusEl, this.dragEl, this.top, this.bar, this.panel, ...this.grips);
    document.body.appendChild(r);
    r.addEventListener('mousemove', () => this.wake());
    // Leaving the window puts the controls away at once.
    r.addEventListener('mouseleave', () => this.sleep());
    // Clicks on the MV are the MV's: page-wide listeners (NetEase's, other plugins') never see them.
    for (const type of SWALLOW) r.addEventListener(type, e => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
    this.stage.addEventListener('dblclick', () => handlers.onTogglePlay());
    // A click on the picture puts the open panel away.
    this.stage.addEventListener('pointerdown', () => { if (this.panelOpen) this.closePanel(); });
    window.addEventListener('keydown', e => {
      if (!this.visible) return;
      // NetEase's own shortcuts (Ctrl+← → for the previous / next song, …) go through.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      // Keys on the settings panel's own controls are theirs (Esc still closes the panel).
      if (e.key !== 'Escape' && t?.closest?.('[data-bmv-settings]')) return;
      let hit = true;
      if (e.key === 'Escape') { if (this.panelOpen) this.closePanel(); else handlers.onClose(); }
      else if (e.code === 'Space') handlers.onTogglePlay();
      else if (e.code === 'ArrowRight') handlers.onSeek(this.current + 5);
      else if (e.code === 'ArrowLeft') handlers.onSeek(this.current - 5);
      else if (e.code === 'ArrowUp') this.nudgeVolume(0.05);
      else if (e.code === 'ArrowDown') this.nudgeVolume(-0.05);
      else hit = false;
      if (hit) { e.preventDefault(); e.stopPropagation(); this.wake(); }
    }, true);
  }

  private current = 0;

  /** An icon button of the controls: round, lit on hover. */
  private button(icon: string, title: string, fn: () => void): HTMLButtonElement {
    const e = document.createElement('button');
    e.innerHTML = icon;
    e.title = title;
    e.style.cssText = 'flex:none;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:#fff;cursor:pointer;padding:6px;border-radius:50%;' +
      'opacity:.85;transition:opacity .15s,background .15s';
    e.onmouseenter = () => { e.style.opacity = '1'; e.style.background = 'rgba(255,255,255,.12)'; };
    e.onmouseleave = () => { e.style.opacity = '.85'; e.style.background = 'transparent'; };
    e.onclick = ev => { ev.stopPropagation(); fn(); this.wake(); };
    return e;
  }

  /** Top right, as on NetEase's play page: the settings, then minimise, maximise / restore and leave the MV. */
  private buildTop(): void {
    this.top.style.cssText = 'position:absolute;left:0;right:0;top:0;height:76px;pointer-events:none;transition:opacity .4s;' +
      'background:linear-gradient(to bottom,rgba(0,0,0,.4),rgba(0,0,0,0))';
    const g = this.topButtons;
    g.style.cssText = 'position:absolute;top:10px;right:10px;display:flex;align-items:center;pointer-events:auto;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45));' +
      'transition:right .3s cubic-bezier(.2,.8,.2,1)';
    const win = (icon: string, title: string, fn: () => void) => {
      const b = this.button(icon, title, fn);
      b.style.width = '36px';
      b.style.height = '32px';
      b.style.borderRadius = '6px';
      return b;
    };
    this.gearEl = win(svg(ICON.gear, 18), '设置', () => this.togglePanel('settings'));
    const rule = document.createElement('div');
    rule.style.cssText = 'width:1px;height:14px;margin:0 8px;background:rgba(255,255,255,.3)';
    this.maxEl = win(stroke(LINE.maximize, 18), '最大化', () => this.handlers.onToggleMaximize());
    this.closeEl = win(stroke(LINE.close, 18), '退出 MV（Esc）', () => this.handlers.onClose());
    g.append(this.gearEl, rule, win(stroke(LINE.minimize, 18), '最小化', () => this.handlers.onMinimize()), this.maxEl, this.closeEl);
    this.top.append(g);
  }

  /**
   * The controls: the progress bar, then the song (left), the playback buttons (centred, as on NetEase's play bar:
   * like, previous, play, next, play mode) and the MV's style, the volume and the play list (right).
   */
  private buildBar(): void {
    const b = this.bar;
    b.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:40px 24px 14px;transition:opacity .4s,right .3s cubic-bezier(.2,.8,.2,1);' +
      'background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,.4) 55%,rgba(0,0,0,0));color:#fff';
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;column-gap:16px;margin-top:8px';

    // The song: name and artists on lines of their own, each cut short with an ellipsis (whole on hover).
    this.songEl.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:0';
    this.coverEl.style.cssText = 'flex:none;width:40px;height:40px;border-radius:4px;object-fit:cover;background:rgba(255,255,255,.08);display:none';
    this.coverEl.onerror = () => { this.coverEl.style.display = 'none'; };
    const text = document.createElement('div');
    text.style.cssText = 'min-width:0;line-height:1.35';
    this.nameEl.style.cssText = 'font-size:14px;font-weight:600;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    this.artistEl.style.cssText = 'margin-top:2px;font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    text.append(this.nameEl, this.artistEl);
    this.songEl.append(this.coverEl, text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;align-items:center;gap:8px';
    this.likeEl = this.button(svg(ICON.heartLine, 20), '喜欢', () => this.handlers.onToggleLike());
    this.modeEl = this.button(svg(ICON.loop, 20), '', () => {
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(this.mode as PlayMode) + 1) % MODE_CYCLE.length];
      this.handlers.onPlayMode(next);
    });
    // Until NetEase says (and when it can't: not signed in, private FM), they keep their place but don't show.
    this.likeEl.style.visibility = this.modeEl.style.visibility = 'hidden';
    this.playEl = this.button(svg(ICON.pause, 26), '播放 / 暂停（空格）', () => this.handlers.onTogglePlay());
    buttons.append(this.likeEl, this.button(svg(ICON.prev, 20), '上一首（Ctrl+←）', () => this.handlers.onPrev()), this.playEl,
      this.button(svg(ICON.next, 20), '下一首（Ctrl+→）', () => this.handlers.onNext()), this.modeEl);

    // The right column, and in it what it holds at its natural width (to see what fits).
    const right = document.createElement('div');
    right.style.cssText = 'display:flex;justify-content:flex-end;min-width:0';
    const rightItems = this.rightItems;
    rightItems.style.cssText = 'flex:none;display:flex;align-items:center;gap:4px';
    right.append(rightItems);
    const s = this.styleEl;
    s.style.cssText = `flex:none;display:none;margin-right:8px;padding:4px 11px;border:1px solid rgba(255,255,255,.28);border-radius:13px;background:transparent;color:#fff;` +
      `font:12px/1.2 ${FONT};letter-spacing:.04em;white-space:nowrap;cursor:pointer;opacity:.85;transition:opacity .15s,background .15s`;
    s.onmouseenter = () => { s.style.opacity = '1'; s.style.background = 'rgba(255,255,255,.12)'; };
    s.onmouseleave = () => { s.style.opacity = '.85'; s.style.background = 'transparent'; };
    s.onclick = ev => { ev.stopPropagation(); this.togglePanel('settings'); };
    this.listEl = this.button(svg(ICON.list, 20), '播放列表', () => this.togglePanel('queue'));
    rightItems.append(s, this.buildVolume(), this.listEl);
    this.rightCol = right;
    row.append(this.songEl, buttons, right);
    // A narrow bar (a small window, or a panel open beside it) drops the volume slider, then the style.
    new ResizeObserver(() => this.fit()).observe(right);

    const seek = document.createElement('div');
    seek.style.cssText = 'display:flex;align-items:center;gap:12px;font:11px/1 Consolas,monospace;opacity:.85';
    this.track.style.cssText = 'position:relative;flex:1;height:18px;cursor:pointer';
    // The bar is the song's structure: a segment a section, dim ahead of the playhead, lit behind it.
    for (const layer of [this.segDim, this.segLit]) layer.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none';
    this.segLit.style.clipPath = 'inset(0 100% 0 0)';
    this.fill.style.cssText = 'display:none';
    this.knob.style.cssText = 'position:absolute;top:4px;width:10px;height:10px;margin-left:-5px;border-radius:5px;background:#fff;left:0;opacity:0;transition:opacity .2s;box-shadow:0 0 6px rgba(0,0,0,.4)';
    this.tipEl.style.cssText = 'position:absolute;bottom:20px;transform:translateX(-50%);padding:3px 8px;border-radius:4px;background:rgba(0,0,0,.72);' +
      `font:12px/1.4 ${FONT};letter-spacing:.04em;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s`;
    this.track.append(this.segDim, this.segLit, this.knob, this.tipEl);
    this.renderSections();
    this.track.onmouseenter = () => { this.knob.style.opacity = '1'; this.tipEl.style.opacity = '1'; };
    this.track.onmouseleave = () => { if (!this.dragging) this.knob.style.opacity = '0'; this.tipEl.style.opacity = '0'; };
    const at = (x: number) => { const r = this.track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    // Pointer capture keeps the drag on the track (no window listeners, so nothing leaks to the page).
    this.track.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.track.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.showAt(at(e.clientX));
    };
    this.track.onpointermove = e => { const k = at(e.clientX); this.tip(k); if (this.dragging) this.showAt(k); };
    this.track.onpointerup = e => {
      if (!this.dragging) return;
      this.dragging = false;
      this.track.releasePointerCapture(e.pointerId);
      this.handlers.onSeek(at(e.clientX) * this.duration);
    };
    this.track.onpointercancel = () => { this.dragging = false; };
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
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;display:flex;align-items:center;gap:4px';
    const icon = this.volIcon;
    icon.style.cssText = 'display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:#fff;cursor:pointer;padding:6px;border-radius:50%;opacity:.85';
    icon.onmouseenter = () => { icon.style.opacity = '1'; icon.style.background = 'rgba(255,255,255,.12)'; };
    icon.onmouseleave = () => { icon.style.opacity = '.85'; icon.style.background = 'transparent'; };
    icon.onclick = ev => {
      ev.stopPropagation();
      if (this.vol > 0.001) { this.unmuted = this.vol; this.setVol(0); } else this.setVol(this.unmuted > 0.02 ? this.unmuted : 0.6);
      this.wake();
    };
    const t = this.volTrack;
    t.style.cssText = 'position:relative;width:96px;height:18px;margin-right:8px;cursor:pointer';
    const rail = document.createElement('div');
    rail.style.cssText = 'position:absolute;left:0;right:0;top:8px;height:2px;border-radius:1px;background:rgba(255,255,255,.25)';
    this.volFill.style.cssText = 'position:absolute;left:0;top:8px;height:2px;border-radius:1px;background:#fff;width:0';
    this.volKnob.style.cssText = 'position:absolute;top:4px;width:10px;height:10px;margin-left:-5px;border-radius:5px;background:#fff;left:0';
    t.append(rail, this.volFill, this.volKnob);
    const at = (x: number) => { const r = t.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    t.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      this.volDragging = true;
      this.setVol(at(e.clientX));
    };
    t.onpointermove = e => { if (this.volDragging) this.setVol(at(e.clientX)); };
    t.onpointerup = e => { if (!this.volDragging) return; this.volDragging = false; t.releasePointerCapture(e.pointerId); };
    t.onpointercancel = () => { this.volDragging = false; };
    box.onwheel = e => { e.preventDefault(); this.nudgeVolume(e.deltaY < 0 ? 0.05 : -0.05); };
    box.append(icon, t);
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
    if (was < 0 || (was > 0.001) !== (v > 0.001)) this.volIcon.innerHTML = svg(v > 0.001 ? ICON.volume : ICON.muted, 20);
    this.volIcon.title = v > 0.001 ? '静音' : '取消静音';
  }

  /** NetEase's volume as it is now (it may change from its own controls); ignored while the slider is held. */
  volume(v: number | null): void {
    if (v === null || this.volDragging) return;
    this.showVol(v);
  }

  /** The song's structure along the progress bar ([] while none is known: one plain bar). */
  setStructure(sections: BarSection[], accent: string): void {
    this.sections = sections;
    this.accent = accent;
    this.renderSections();
  }

  private renderSections(): void {
    const d = this.duration || this.sections[this.sections.length - 1]?.end || 1;
    const list = this.sections.length ? this.sections : [{ start: 0, end: d, name: '', loud: false }];
    const draw = (layer: HTMLElement, lit: boolean) => {
      layer.textContent = '';
      for (const s of list) {
        const e = document.createElement('div');
        const left = (s.start / d) * 100, width = ((s.end - s.start) / d) * 100;
        const h = s.loud ? 4 : 2;
        const color = s.loud ? this.accent : lit ? '#fff' : 'rgba(255,255,255,.28)';
        e.style.cssText = `position:absolute;top:${9 - h / 2}px;height:${h}px;left:calc(${left}% + 1px);width:calc(${width}% - 2px);` +
          `border-radius:1px;background:${color};opacity:${s.loud && !lit ? 0.45 : 1}`;
        layer.append(e);
      }
    };
    draw(this.segDim, false);
    draw(this.segLit, true);
  }

  /** The hover label: the section under the cursor and its time. */
  private tip(k: number): void {
    const t = k * this.duration, s = this.sections.find(x => t >= x.start && t < x.end);
    this.tipEl.textContent = s ? `${s.name} · ${clock(t)}` : clock(t);
    this.tipEl.style.left = k * 100 + '%';
  }

  /**
   * The panel that slides in from the right over the picture, for the settings or the play list (one at a time); the
   * MV keeps playing beside it.
   */
  private buildPanel(): void {
    const p = this.panel;
    p.style.cssText = `position:absolute;top:0;right:0;bottom:0;width:${PANEL}px;max-width:100%;box-sizing:border-box;display:flex;flex-direction:column;` +
      'background:rgba(14,14,18,.9);backdrop-filter:blur(20px);border-left:1px solid rgba(255,255,255,.08);box-shadow:-24px 0 60px rgba(0,0,0,.4);' +
      'color:#e8e8e8;transform:translateX(105%);visibility:hidden;transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s .3s';
    const head = document.createElement('div');
    head.style.cssText = 'flex:none;display:flex;align-items:baseline;gap:10px;padding:18px 16px 10px 22px';
    this.panelTitle.style.cssText = 'font-size:16px;font-weight:700;letter-spacing:.1em';
    this.panelAside.style.cssText = 'flex:1;min-width:0;font-size:12px;opacity:.5;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const close = document.createElement('button');
    close.innerHTML = stroke(LINE.close, 16);
    close.title = '收起（Esc）';
    close.style.cssText = 'flex:none;align-self:center;display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:16px;' +
      'background:rgba(255,255,255,.08);color:#fff;cursor:pointer';
    close.onclick = () => this.closePanel();
    head.append(this.panelTitle, this.panelAside, close);
    this.panelBody.className = 'bmv-scroll';
    const scroll = document.createElement('style');
    scroll.textContent = '.bmv-scroll::-webkit-scrollbar{width:8px}.bmv-scroll::-webkit-scrollbar-track{background:transparent}' +
      '.bmv-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px}.bmv-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}';
    p.append(scroll, head, this.panelBody);
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
    body.style.cssText = 'position:relative;flex:1;overflow-y:auto;overscroll-behavior:contain;' + (which === 'settings' ? 'padding:0 22px' : 'padding:0 0 12px');
    if (which === 'settings') {
      this.panelTitle.textContent = '设置';
      this.panelAside.textContent = VERSION ? `BetterMV v${VERSION}` : '';
      body.append(this.handlers.settings());
    } else {
      this.panelTitle.textContent = '播放列表';
      this.rowsFor = null;
      this.drawQueue();
      // The playing track in the middle of the list.
      const row = this.rows[this.queueAt];
      if (row) body.scrollTop = row.offsetTop - (body.clientHeight - row.offsetHeight) / 2;
    }
    this.panel.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1)';
    this.panel.style.visibility = 'visible';
    this.panel.style.transform = 'none';
    // The controls make room for it.
    this.bar.style.right = PANEL + 'px';
    this.topButtons.style.right = PANEL + 10 + 'px';
    this.listEl.style.color = which === 'queue' ? ACCENT : '#fff';
    this.wake();
  }

  closePanel(): void {
    if (!this.open) return;
    if (this.open === 'settings') hideSketch();
    this.open = null;
    this.panel.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s .3s';
    this.panel.style.visibility = 'hidden';
    this.panel.style.transform = 'translateX(105%)';
    this.bar.style.right = '0';
    this.topButtons.style.right = '10px';
    this.listEl.style.color = '#fff';
    this.wake();
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
      this.panelAside.textContent = this.tracks.length ? `共 ${this.tracks.length} 首` : '';
      const body = this.panelBody;
      body.textContent = '';
      if (!this.tracks.length) body.append(el('div', 'padding:40px 22px;text-align:center;font-size:13px;opacity:.5', '播放列表为空'));
      // A long list costs little: rows off screen are skipped until scrolled to.
      this.rows = this.tracks.map((t, i) => {
        const row = el('div', 'display:flex;align-items:center;gap:12px;height:52px;padding:0 22px;cursor:pointer;content-visibility:auto;contain-intrinsic-size:52px');
        const num = el('div', 'flex:none;display:flex;justify-content:flex-end;width:26px;font:12px/1 Consolas,monospace;opacity:.45', String(i + 1).padStart(2, '0'));
        const text = el('div', 'flex:1;min-width:0;line-height:1.4');
        const artists = t.artists.join(' / ');
        text.append(el('div', 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', t.name || '未知歌曲'),
          el('div', 'font-size:12px;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', artists));
        row.title = artists ? `${t.name} — ${artists}` : t.name;
        row.append(num, text, el('div', 'flex:none;font:12px/1 Consolas,monospace;opacity:.45', t.duration ? clock(t.duration) : ''));
        row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,.07)'; };
        row.onmouseleave = () => { row.style.background = ''; };
        row.onclick = () => this.handlers.onPlayAt(i);
        this.panelBody.append(row);
        return row;
      });
    }
    if (this.litRow === this.queueAt) return;
    // The playing track in red, a speaker in place of its number.
    const paint = (i: number, on: boolean) => {
      const row = this.rows[i];
      if (!row) return;
      const num = row.firstElementChild as HTMLElement, name = row.children[1].firstElementChild as HTMLElement;
      num.innerHTML = on ? svg(ICON.volume, 14) : String(i + 1).padStart(2, '0');
      num.style.color = name.style.color = on ? ACCENT : '';
      num.style.opacity = on ? '1' : '.45';
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
    d.style.cssText = 'position:absolute;left:0;right:0;top:0;height:56px';
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
      const g = document.createElement('div');
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
    this.maxEl.innerHTML = stroke(on ? LINE.restore : LINE.maximize, 18);
    this.maxEl.title = on ? '向下还原' : '最大化';
  }
  private isMax = false;

  private showAt(k: number): void {
    this.fill.style.width = k * 100 + '%';
    this.segLit.style.clipPath = `inset(0 ${(1 - k) * 100}% 0 0)`;
    this.knob.style.left = k * 100 + '%';
    this.timeEl.textContent = clock(k * this.duration);
  }

  /** True while the close button and controls are up (after the mouse moved). */
  awake = false;

  private wake(): void {
    this.awake = true;
    this.top.style.opacity = '1';
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
    this.bar.style.opacity = '0';
    this.bar.style.pointerEvents = 'none';
    this.root.style.cursor = 'none';
  }

  show(): void {
    this.visible = true;
    // Last in the page, so nothing another plugin added at the same z-index sits over the MV.
    if (this.root !== document.body.lastElementChild) document.body.appendChild(this.root);
    this.root.style.display = 'block';
    this.wake();
  }
  hide(): void { this.closePanel(); this.visible = false; this.root.style.display = 'none'; }

  status(text: string | null): void {
    this.statusEl.textContent = text ?? '';
    this.backdrop.style.opacity = text ? '1' : '0';
  }

  /** The song under the controls (null: none playing). */
  song(info: SongInfo | null): void {
    const name = info?.name || '', artists = info?.artists.join(' / ') || '';
    this.nameEl.textContent = name;
    this.artistEl.textContent = artists;
    this.songEl.title = artists ? `${name} — ${artists}` : name;
    const cover = info?.cover ? thumb(info.cover) : '';
    if (cover && this.coverEl.getAttribute('src') !== cover) this.coverEl.src = cover;
    this.coverEl.style.display = cover ? '' : 'none';
  }

  /** The MV's style beside the volume (null while the MV is being made); the reason and the lyrics' state on hover. */
  mvInfo(info: MvInfo | null): void {
    this.mv = info;
    const s = this.styleEl;
    s.textContent = '';
    if (info) {
      s.append(el('span', 'opacity:.6;margin-right:6px', '风格'), info.style);
      if (info.lyrics === 'aligning') s.append(el('span', 'opacity:.6;margin-left:6px', '· 歌词对齐中'));
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
      this.liked = liked;
      const l = this.likeEl;
      l.style.visibility = liked === null ? 'hidden' : 'visible';
      l.innerHTML = svg(liked ? ICON.heart : ICON.heartLine, 20);
      l.style.color = liked ? ACCENT : '#fff';
      l.title = liked ? '取消喜欢' : '喜欢';
    }
    if (mode !== this.mode) {
      this.mode = mode;
      const m = this.modeEl, known = mode && mode !== 'playFm' ? MODES[mode] : null;
      m.style.visibility = known ? 'visible' : 'hidden';
      if (known) { m.innerHTML = svg(known.icon, 20); m.title = known.name; }
    }
  }

  /** Called every frame with the song position. Touches the DOM only when something visible changed. */
  progress(seconds: number, duration: number, playing: boolean): void {
    this.current = seconds;
    if (duration && Math.abs(duration - this.duration) > 0.5) { this.duration = duration; this.renderSections(); }
    this.duration = duration;
    if (playing !== this.playing) {
      this.playing = playing;
      this.playEl.innerHTML = svg(playing ? ICON.pause : ICON.play, 26);
    }
    if (this.dragging || !duration) return;
    const second = Math.floor(seconds * 4);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    this.showAt(Math.max(0, Math.min(1, seconds / duration)));
    this.lengthEl.textContent = clock(duration);
  }

  setBackdrop(url: string | null): void {
    this.backdrop.style.backgroundImage = url ? `url("${url.replace(/^http:/, 'https:')}")` : '';
  }
}


const ACCENT = '#ec4141';
/** The picture delay's range, ms. */
const LATENCY_MIN = -200, LATENCY_MAX = 400;
/** Greys that read on a light and on a dark settings panel alike (the text keeps the panel's own colour). */
const TINT = (a: number) => `rgba(127,127,127,${a})`;
const CHECK = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const STYLE_NOTE: Record<Config['style'], string> = {
  auto: '根据网易云的曲风标签选择：说唱为“字”，国风为“墨”，电子、舞曲、摇滚为“律动”，民谣、古典、轻音乐为“抒情”；无标签时依据鼓点和 drop 判断。',
  pulse: '踩拍硬切，细线与光效，drop 处进入推进隧道。适合电子、舞曲、摇滚。',
  ballad: '长镜头、柔光、缓慢推移，转场柔和、无闪烁。适合慢歌、民谣、轻音乐。',
  word: '以歌词为画面主体：字墙、海报排版、网点印刷。适合说唱。',
  ink: '封面呈现为宣纸水墨，歌词竖排，以墨迹晕染转场。适合国风、古风。',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

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
  const root = el('div', `position:fixed;left:0;top:0;z-index:2147483647;width:320px;border-radius:10px;overflow:hidden;background:#141418;color:#eee;font:12px/1.6 ${FONT};` +
    'box-shadow:0 14px 40px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.07);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .14s,transform .14s');
  const frame = el('div', 'position:relative;width:320px;height:180px;background:#0b0b0e');
  const img = el('img', 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block;visibility:hidden');
  const blank = el('div', 'position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;opacity:.45;letter-spacing:.08em');
  frame.append(img, blank);
  const body = el('div', 'padding:10px 12px 12px');
  const title = el('div', 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;letter-spacing:.04em');
  const note = el('div', 'margin-top:4px;opacity:.8');
  const foot = el('div', 'margin-top:6px;font-size:11px;opacity:.5;letter-spacing:.03em');
  body.append(title, note, foot);
  root.append(frame, body);
  document.body.append(root);
  return (sketch = { root, img, blank, title, note, foot, token: 0, timer: 0 });
}

function hideSketch(): void {
  if (!sketch) return;
  sketch.token++;
  clearTimeout(sketch.timer);
  sketch.root.style.opacity = '0';
  sketch.root.style.transform = 'translateY(4px)';
}

/**
 * Settings page for BetterNCM's plugin panel, or (`compact`) the MV page's own settings panel: narrower, without the
 * introduction, the sketches shown beside the panel. `preview` gives a scene's sketch (an image URL), or null when
 * there is none.
 */
export function settingsView(config: Config, onChange: (c: Config) => void, preview: (id: string) => Promise<string | null>, compact = false): HTMLElement {
  const view = el('div', `font:13px/1.6 ${FONT};color:inherit;` + (compact ? 'padding:0 0 28px' : 'padding:4px 2px 28px;max-width:660px'));
  view.dataset.bmvSettings = '';

  // Header: what it is (and which version), and the keys. The MV page's panel shows the version in its own head.
  if (!compact) {
    const name = el('div', 'display:flex;align-items:baseline;gap:8px');
    name.append(el('span', 'font-size:20px;font-weight:800;letter-spacing:.02em', 'BetterMV'));
    if (VERSION) name.append(el('span', 'font:12px Consolas,monospace;opacity:.55', `v${VERSION}`));
    view.append(name);
  }
  if (!compact) view.append(el('div', 'opacity:.7;margin-top:2px', '为正在播放的歌曲实时生成 3D MV：以封面构建场景，按歌曲结构剪辑镜头，按曲风自动选择风格。'));
  const keys = el('div', 'display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12px;opacity:.85');
  for (const [key, what] of [['Ctrl+Shift+M', '打开（或点击播放栏上方的 MV）'], ['Esc', '退出'], ['空格', '播放 / 暂停'], ['← →', '快退 / 快进'], ['↑ ↓', '音量']]) {
    const item = el('span', 'display:inline-flex;align-items:center;gap:6px');
    item.append(el('kbd', `font:11px/1 Consolas,${FONT};padding:3px 6px;border-radius:4px;border:1px solid ${TINT(0.4)};border-bottom-width:2px`, key), document.createTextNode(what));
    keys.append(item);
  }
  if (!compact) view.append(keys);

  const section = (title: string, aside?: HTMLElement) => {
    const head = el('div', `display:flex;align-items:center;gap:10px;margin:${compact && !view.childElementCount ? 4 : 24}px 0 4px;padding-bottom:6px;border-bottom:1px solid ${TINT(0.22)}`);
    head.append(el('div', 'font-size:14px;font-weight:700;letter-spacing:.06em', title));
    if (aside) { aside.style.marginLeft = 'auto'; head.append(aside); }
    view.append(head);
  };
  const row = (label: string, control: HTMLElement, note?: string | HTMLElement) => {
    const r = el('div', `display:grid;grid-template-columns:${compact ? '64px 1fr;column-gap:12px' : '84px 1fr;column-gap:16px'};row-gap:4px;align-items:center;padding:9px 0`);
    control.style.justifySelf = 'start';
    r.append(el('div', 'font-weight:600', label), control);
    if (note) r.append(el('div', ''), typeof note === 'string' ? el('div', 'font-size:12px;opacity:.6', note) : note);
    view.append(r);
  };
  const ghost = (text: string, fn: () => void) => {
    const b = el('button', `border:1px solid ${TINT(0.35)};background:transparent;color:inherit;font:12px/1 ${FONT};padding:5px 10px;border-radius:6px;cursor:pointer`, text);
    b.onclick = fn;
    return b;
  };
  const segmented = <K extends 'style' | 'quality'>(key: K, options: Array<[Config[K], string]>, then?: () => void) => {
    const g = el('div', `display:inline-flex;gap:2px;padding:3px;border-radius:9px;background:${TINT(0.14)}`);
    const paint = () => g.querySelectorAll('button').forEach(b => {
      const on = b.dataset.value === String(config[key]);
      b.style.background = on ? ACCENT : 'transparent';
      b.style.color = on ? '#fff' : 'inherit';
      b.style.fontWeight = on ? '600' : '400';
      b.style.boxShadow = on ? '0 1px 4px rgba(236,65,65,.35)' : 'none';
    });
    for (const [value, text] of options) {
      const b = el('button', 'border:0;border-radius:7px;padding:3px 14px;cursor:pointer;font:inherit;transition:background .15s', text);
      b.dataset.value = String(value);
      b.onclick = () => { config[key] = value; plugin.setConfig(key, value); paint(); then?.(); onChange(config); };
      g.append(b);
    }
    paint();
    return g;
  };
  const toggle = (key: 'button' | 'controls') => {
    const b = el('button', 'position:relative;width:36px;height:20px;border:0;border-radius:10px;padding:0;cursor:pointer;transition:background .18s');
    const knob = el('span', 'position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s');
    b.append(knob);
    b.setAttribute('role', 'switch');
    const paint = () => {
      b.style.background = config[key] ? ACCENT : TINT(0.4);
      knob.style.transform = config[key] ? 'translateX(16px)' : '';
      b.setAttribute('aria-checked', String(config[key]));
    };
    b.onclick = () => { config[key] = !config[key]; plugin.setConfig(key, config[key]); paint(); onChange(config); };
    paint();
    return b;
  };

  section('画面');
  const styleNote = el('div', 'font-size:12px;opacity:.6', STYLE_NOTE[config.style]);
  row('风格', segmented('style', [['auto', '自动'], ['pulse', '律动'], ['ballad', '抒情'], ['word', '字'], ['ink', '墨']], () => { styleNote.textContent = STYLE_NOTE[config.style]; }), styleNote);
  row('画质', segmented('quality', [['high', '高'], ['mid', '中'], ['low', '低']]), '画面卡顿时调低');
  // Picture delay, no slider: − and + step 10 ms (held, they repeat), the number can be typed, and back to zero.
  const lat = el('div', 'display:flex;align-items:center;gap:10px');
  const stepper = el('div', `display:inline-flex;align-items:stretch;height:28px;border:1px solid ${TINT(0.35)};border-radius:8px;overflow:hidden`);
  const latency = el('input', `width:64px;border:0;border-left:1px solid ${TINT(0.25)};border-right:1px solid ${TINT(0.25)};background:transparent;` +
    'color:inherit;text-align:center;font:13px Consolas,monospace;outline:none;padding:0');
  latency.inputMode = 'numeric';
  latency.title = '可直接输入；↑ ↓ 键每次调整 10 ms';
  const showLatency = () => { const ms = config.latencyMs; latency.value = (ms > 0 ? '+' : '') + ms; zero.style.visibility = ms ? 'visible' : 'hidden'; };
  const setLatency = (ms: number) => {
    ms = Math.max(LATENCY_MIN, Math.min(LATENCY_MAX, Math.round(ms)));
    if (ms !== config.latencyMs) { config.latencyMs = ms; plugin.setConfig('latencyMs', ms); onChange(config); }
    showLatency();
  };
  const step = (text: string, d: number, title: string) => {
    const b = el('button', `width:30px;border:0;background:${TINT(0.1)};color:inherit;font:16px/1 ${FONT};cursor:pointer;padding:0`, text);
    b.title = title;
    // Held down, it repeats after 0.4 s, every 60 ms.
    let timer = 0;
    const stop = () => { clearTimeout(timer); timer = 0; };
    b.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      setLatency(config.latencyMs + d);
      const again = (wait: number) => { timer = window.setTimeout(() => { setLatency(config.latencyMs + d); again(60); }, wait); };
      again(400);
    };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = stop;
    b.onclick = e => { if (e.detail === 0) setLatency(config.latencyMs + d); }; // Enter / Space on the focused button
    return b;
  };
  latency.onkeydown = e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setLatency(config.latencyMs + (e.key === 'ArrowUp' ? 10 : -10)); }
    else if (e.key === 'Enter') latency.blur();
    else if (e.key === 'Escape') { showLatency(); latency.blur(); }
  };
  latency.onblur = () => { const ms = parseInt(latency.value.replace(/[^\d-]/g, ''), 10); if (Number.isFinite(ms)) setLatency(ms); else showLatency(); };
  latency.onfocus = () => latency.select();
  const zero = ghost('归零', () => setLatency(0));
  stepper.append(step('−', -10, '画面提前 10 ms'), latency, step('+', 10, '画面推后 10 ms'));
  lat.append(stepper, el('span', 'font-size:12px;opacity:.7', 'ms'), zero);
  showLatency();
  row('画面延迟', lat, compact ? '画面早于声音时调大（蓝牙耳机通常需 +150～250 ms），可在播放中实时调整' : '画面早于声音时调大（蓝牙耳机通常需 +150～250 ms）；也可在 MV 页右上角的设置中实时调整');

  section('界面');
  row('MV 按钮', toggle('button'), '显示在播放栏上方；关闭后可用 Ctrl+Shift+M 打开');
  row('控制栏', toggle('controls'), 'MV 页底部的播放控制，鼠标静止时自动隐藏');

  // The optional aligner pack: its state follows the download while the page is open.
  section('歌词');
  const pack = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap');
  const packNote = el('div', 'font-size:12px;opacity:.6',
    '适用于仅有逐句歌词的歌曲：按音频识别每个字的演唱时间，替代按音节的估算。首次播放时在本机后台分析，耗时数秒至半分钟，结果缓存后复用。全程本地运行，不上传数据。');
  const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
  const stopWatching = watchPack(st => {
    if (!view.isConnected && pack.childElementCount) { stopWatching(); return; }
    pack.textContent = '';
    const text = (t: string, accent = false) => pack.append(el('span', `font-size:12px;${accent ? `color:${ACCENT}` : 'opacity:.75'}`, t));
    if (st.kind === 'checking') text('检查中…');
    else if (st.kind === 'none') pack.append(ghost('下载对齐包（约 400 MB）', () => void installPack()));
    else if (st.kind === 'installing') {
      const pct = st.total ? st.done / st.total : 0;
      const bar = el('div', `width:160px;height:6px;border-radius:3px;background:${TINT(0.2)};overflow:hidden`);
      bar.append(el('div', `height:100%;width:${(pct * 100).toFixed(1)}%;background:${ACCENT}`));
      pack.append(bar);
      text(st.total ? `${st.note} · ${Math.round(pct * 100)}%（${mb(st.done)} / ${mb(st.total)}）` : st.note);
    } else if (st.kind === 'ready') { text('已安装'); pack.append(ghost('删除', () => void removePack())); }
    else if (st.kind === 'removing') text('删除中…');
    else { text('安装失败：' + st.message, true); pack.append(ghost('重试', () => void installPack())); }
  });
  row('逐字对齐', pack, packNote);

  // Scenes: each one on or off; resting on one shows its sketch.
  const off = new Set(config.off);
  const using = stylesUsing();
  const count = el('span', 'font-size:12px;opacity:.6');
  const allOn = ghost('全部开启', () => { off.clear(); refresh(); save(); });
  const aside = el('div', 'display:flex;align-items:center;gap:10px');
  aside.append(count, allOn);
  section('场景', aside);
  view.append(el('div', 'font-size:12px;opacity:.6;margin:8px 0 2px', '点击切换开关，鼠标悬停可查看示意图。关闭的场景由同一段落的其他场景替代，修改即时生效。'));
  const paints: Array<() => void> = [];
  let warnTimer = 0;
  const refresh = () => {
    paints.forEach(p => p());
    count.textContent = `已开启 ${SCENES.length - off.size} / ${SCENES.length}`;
    count.style.color = '';
    allOn.style.display = off.size ? '' : 'none';
  };
  const save = () => {
    config.off = SCENES.map(s => s.id).filter(id => off.has(id));
    plugin.setConfig('offScenes', config.off.join(','));
    onChange(config);
  };
  /** The card for a scene or a look: `image` is its sketch's name, `by` the styles that use it. */
  const showSketch = (info: { name: string; note: string }, image: string, by: string[], isOff: boolean, anchor: HTMLElement) => {
    const s = sketchCard(), token = ++s.token;
    s.title.textContent = info.name;
    if (isOff) s.title.append(el('span', `font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${ACCENT};color:#fff`, '已关闭'));
    s.note.textContent = info.note;
    const chosen = config.style === 'auto' ? null : STYLES[config.style].name;
    s.foot.textContent = `用于：${by.join(' · ') || '—'}` + (chosen && !by.includes(chosen) ? `（当前风格“${chosen}”不使用）` : '');
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
    const r = anchor.getBoundingClientRect(), h = s.root.offsetHeight || 290;
    const side = compact ? view.getBoundingClientRect().left - 344 : -1;
    let top = r.bottom + 8, left = Math.max(8, Math.min(window.innerWidth - 328, r.left));
    if (side >= 8) { left = side; top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2)); }
    else if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 8 - h);
    s.root.style.left = left + 'px';
    s.root.style.top = top + 'px';
    s.root.style.opacity = '1';
    s.root.style.transform = 'none';
    // The panel may close under the pointer (no mouseleave then): the card goes when its scene does.
    clearTimeout(s.timer);
    const watch = () => {
      if (s.token !== token) return;
      if (!anchor.isConnected || !anchor.matches(':hover, :focus')) hideSketch();
      else s.timer = window.setTimeout(watch, 300);
    };
    s.timer = window.setTimeout(watch, 300);
  };
  /** A grid of on/off buttons; resting on one shows its card. */
  const toggles = <T extends { name: string }>(items: T[], isOff: (it: T) => boolean, flip: (it: T, b: HTMLElement) => void, card: (it: T, b: HTMLElement) => void) => {
    const grid = el('div', `display:grid;grid-template-columns:repeat(auto-fill,minmax(${compact ? 100 : 108}px,1fr));gap:6px`);
    for (const info of items) {
      const b = el('button', `display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid ${TINT(0.22)};background:${TINT(0.05)};` +
        'color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .12s,border-color .12s');
      const box = el('span', 'flex:none;display:flex;align-items:center;justify-content:center;width:14px;height:14px;box-sizing:border-box;border-radius:4px;border:1.5px solid;transition:background .12s');
      const name = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .12s', info.name);
      b.append(box, name);
      paints.push(() => {
        const on = !isOff(info);
        box.style.background = on ? ACCENT : 'transparent';
        box.style.borderColor = on ? ACCENT : TINT(0.6);
        box.innerHTML = on ? CHECK : '';
        name.style.opacity = on ? '1' : '.5';
        b.setAttribute('aria-pressed', String(on));
      });
      b.onclick = () => flip(info, b);
      const lit = (on: boolean) => { b.style.borderColor = TINT(on ? 0.5 : 0.22); b.style.background = TINT(on ? 0.12 : 0.05); };
      b.onmouseenter = () => { lit(true); card(info, b); };
      b.onmouseleave = () => { lit(false); hideSketch(); };
      b.onfocus = () => card(info, b);
      b.onblur = () => hideSketch();
      grid.append(b);
    }
    return grid;
  };
  const sceneCard = (info: typeof SCENES[number], b: HTMLElement) => showSketch(info, info.id, using.get(info.id) ?? [], off.has(info.id), b);
  for (const group of SCENE_GROUPS) {
    view.append(el('div', 'font-size:12px;opacity:.55;margin:14px 0 6px;letter-spacing:.06em', group.name));
    view.append(toggles(group.scenes, info => off.has(info.id), (info, b) => {
      if (!off.has(info.id) && off.size >= SCENES.length - 1) {
        count.textContent = '至少保留一个场景';
        count.style.color = ACCENT;
        clearTimeout(warnTimer);
        warnTimer = window.setTimeout(refresh, 1800);
        return;
      }
      if (off.has(info.id)) off.delete(info.id); else off.add(info.id);
      refresh();
      save();
      sceneCard(info, b);
    }, sceneCard));
  }

  // Looks: each one on or off, like the scenes.
  const offLooks = new Set(config.offLooks);
  section('画风');
  view.append(el('div', 'font-size:12px;opacity:.6;margin:8px 0 8px', '部分段落会改用另一种画风呈现，使整首歌不止一种面貌。关闭的画风不再使用。'));
  const lookCard = (info: typeof LOOKS[number], b: HTMLElement) => showSketch(info, `look-${info.id}`, info.styles, offLooks.has(info.id), b);
  view.append(toggles(LOOKS, info => offLooks.has(info.id), (info, b) => {
    if (offLooks.has(info.id)) offLooks.delete(info.id); else offLooks.add(info.id);
    config.offLooks = LOOKS.map(l => l.id).filter(id => offLooks.has(id));
    plugin.setConfig('offLooks', config.offLooks.join(','));
    onChange(config);
    refresh();
    lookCard(info, b);
  }, lookCard));
  refresh();
  // The sketches load in the background while the page is read.
  for (const s of SCENES) void preview(s.id);
  for (const l of LOOKS) void preview(`look-${l.id}`);
  return view;
}
