// The plugin's surface inside NetEase: a small "MV" button, the full-window MV view with its controls, and the
// settings page.
import { STYLES, type StyleId } from '../style/style.ts';
import type { SceneId } from '../scenes/types.ts';
import { SCENE_GROUPS, SCENES } from '../scenes/catalog.ts';
import { SECTION_LABELS, type Section } from '../types.ts';
import { installPack, removePack, watchPack } from './aligner.ts';

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
};
/** A section of the song for the progress bar: loud ones (choruses, drops) are marked. */
export interface BarSection { start: number; end: number; name: string; loud: boolean }
const svg = (d: string, size: number) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`;
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

export interface OverlayHandlers {
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Seek to a song time in seconds. */
  onSeek: (seconds: number) => void;
  /** Set NetEase's volume, 0..1. */
  onVolume: (v: number) => void;
  /** Hand the window to the system's move loop (the title bar's drag). */
  onDragWindow: () => void;
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
  private closeEl = document.createElement('button');
  private gearEl = document.createElement('button');
  private panel = document.createElement('div');
  private panelBody = document.createElement('div');
  /** The settings panel is open (the controls and the cursor then stay up). */
  panelOpen = false;
  private bar = document.createElement('div');
  private titleEl = document.createElement('div');
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
  showControls = true;
  visible = false;

  constructor(private handlers: OverlayHandlers) {
    const r = this.root;
    r.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:#000;display:none;overflow:hidden;font-family:${FONT};user-select:none`;
    this.backdrop.style.cssText = 'position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(40px) brightness(.45);transition:opacity .6s';
    this.stage.style.cssText = 'position:absolute;inset:0';
    this.statusEl.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#eee;font-size:15px;letter-spacing:.08em;text-shadow:0 1px 8px rgba(0,0,0,.6);pointer-events:none';
    this.closeEl.textContent = '✕';
    this.closeEl.title = '退出 MV（Esc）';
    this.closeEl.style.cssText = 'position:absolute;right:18px;top:14px;width:34px;height:34px;border:0;border-radius:17px;background:rgba(0,0,0,.35);color:#fff;font-size:15px;cursor:pointer;transition:opacity .4s';
    this.closeEl.onclick = () => handlers.onClose();
    this.gearEl.innerHTML = svg(ICON.gear, 18);
    this.gearEl.title = '设置';
    this.gearEl.style.cssText = 'position:absolute;right:58px;top:14px;width:34px;height:34px;border:0;border-radius:17px;background:rgba(0,0,0,.35);color:#fff;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;padding:0;transition:opacity .4s';
    this.gearEl.onclick = () => (this.panelOpen ? this.closePanel() : this.openPanel());
    this.buildBar();
    this.buildDrag();
    this.buildPanel();
    r.append(this.backdrop, this.stage, this.statusEl, this.dragEl, this.bar, this.gearEl, this.closeEl, this.panel);
    document.body.appendChild(r);
    r.addEventListener('mousemove', () => this.wake());
    // Leaving the window puts the controls away at once.
    r.addEventListener('mouseleave', () => this.sleep());
    // Clicks on the MV are the MV's: page-wide listeners (NetEase's, other plugins') never see them.
    for (const type of SWALLOW) r.addEventListener(type, e => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
    this.stage.addEventListener('dblclick', () => handlers.onTogglePlay());
    // A click on the picture puts the settings panel away.
    this.stage.addEventListener('pointerdown', () => { if (this.panelOpen) this.closePanel(); });
    window.addEventListener('keydown', e => {
      if (!this.visible) return;
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

  private buildBar(): void {
    const b = this.bar;
    b.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:34px 28px 18px;transition:opacity .4s,right .3s cubic-bezier(.2,.8,.2,1);' +
      'background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,0));color:#fff';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:14px;margin-top:10px';
    this.titleEl.style.cssText = 'flex:1;min-width:0;font-size:12px;letter-spacing:.05em;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;align-items:center;gap:10px';
    const btn = (d: string, size: number, title: string, fn: () => void) => {
      const e = document.createElement('button');
      e.innerHTML = svg(d, size);
      e.title = title;
      e.style.cssText = 'display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:#fff;cursor:pointer;padding:6px;border-radius:50%;opacity:.85';
      e.onmouseenter = () => { e.style.opacity = '1'; e.style.background = 'rgba(255,255,255,.12)'; };
      e.onmouseleave = () => { e.style.opacity = '.85'; e.style.background = 'transparent'; };
      e.onclick = ev => { ev.stopPropagation(); fn(); this.wake(); };
      return e;
    };
    this.playEl = btn(ICON.pause, 26, '播放 / 暂停（空格）', () => this.handlers.onTogglePlay());
    buttons.append(btn(ICON.prev, 20, '上一首', () => this.handlers.onPrev()), this.playEl, btn(ICON.next, 20, '下一首', () => this.handlers.onNext()));
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1';
    row.append(this.titleEl, buttons, spacer);

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
    row.replaceChild(this.buildVolume(), spacer);
    this.bar.append(seek, row);
  }

  /** NetEase's volume: a speaker (mute / unmute) and a slider; the wheel over it and the up / down keys nudge it. */
  private buildVolume(): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:flex-end;gap:6px';
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
    t.style.cssText = 'position:relative;width:96px;height:18px;cursor:pointer';
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

  /** The settings panel: slides in from the right over the picture; the MV keeps playing beside it. */
  private buildPanel(): void {
    const p = this.panel;
    p.style.cssText = `position:absolute;top:0;right:0;bottom:0;width:${PANEL}px;max-width:100%;box-sizing:border-box;display:flex;flex-direction:column;` +
      'background:rgba(14,14,18,.9);backdrop-filter:blur(20px);border-left:1px solid rgba(255,255,255,.08);box-shadow:-24px 0 60px rgba(0,0,0,.4);' +
      'color:#e8e8e8;transform:translateX(105%);visibility:hidden;transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s .3s';
    const head = document.createElement('div');
    head.style.cssText = 'flex:none;display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px 22px';
    const title = document.createElement('div');
    title.textContent = '设置';
    title.style.cssText = 'font-size:16px;font-weight:700;letter-spacing:.1em';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.title = '收起设置（Esc）';
    close.style.cssText = 'width:32px;height:32px;border:0;border-radius:16px;background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer';
    close.onclick = () => this.closePanel();
    head.append(title, close);
    this.panelBody.className = 'bmv-scroll';
    this.panelBody.style.cssText = 'flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 22px';
    const scroll = document.createElement('style');
    scroll.textContent = '.bmv-scroll::-webkit-scrollbar{width:8px}.bmv-scroll::-webkit-scrollbar-track{background:transparent}' +
      '.bmv-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px}.bmv-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}';
    p.append(scroll, head, this.panelBody);
  }

  openPanel(): void {
    this.panelBody.textContent = '';
    this.panelBody.append(this.handlers.settings());
    this.panelOpen = true;
    this.panel.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1)';
    this.panel.style.visibility = 'visible';
    this.panel.style.transform = 'none';
    // The controls make room for it.
    this.bar.style.right = PANEL + 'px';
    this.wake();
  }

  closePanel(): void {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    hideSketch();
    this.panel.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s .3s';
    this.panel.style.visibility = 'hidden';
    this.panel.style.transform = 'translateX(105%)';
    this.bar.style.right = '0';
    this.wake();
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
    this.closeEl.style.opacity = '1';
    this.gearEl.style.opacity = '1';
    this.bar.style.opacity = this.showControls ? '1' : '0';
    this.bar.style.pointerEvents = this.showControls ? 'auto' : 'none';
    this.root.style.cursor = '';
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => (this.dragging ? this.wake() : this.sleep()), 2500);
  }

  /** Put the close button, the controls and the cursor away (not while the settings panel is open). */
  private sleep(): void {
    if (this.dragging || this.panelOpen) return;
    clearTimeout(this.idleTimer);
    this.awake = false;
    this.closeEl.style.opacity = '0';
    this.gearEl.style.opacity = '0';
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

  info(text: string): void { this.titleEl.textContent = text; }

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
export function settingsView(config: Config, onChange: (c: Config) => void, preview: (id: SceneId) => Promise<string | null>, compact = false): HTMLElement {
  const view = el('div', `font:13px/1.6 ${FONT};color:inherit;` + (compact ? 'padding:0 0 28px' : 'padding:4px 2px 28px;max-width:660px'));
  view.dataset.bmvSettings = '';

  // Header: what it is, and the keys.
  if (!compact) view.append(el('div', 'font-size:20px;font-weight:800;letter-spacing:.02em', 'BetterMV'));
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
  const showSketch = (info: typeof SCENES[number], anchor: HTMLElement) => {
    const s = sketchCard(), token = ++s.token;
    s.title.textContent = info.name;
    if (off.has(info.id)) s.title.append(el('span', `font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${ACCENT};color:#fff`, '已关闭'));
    s.note.textContent = info.note;
    const by = using.get(info.id) ?? [];
    const chosen = config.style === 'auto' ? null : STYLES[config.style].name;
    s.foot.textContent = `用于：${by.join(' · ') || '—'}` + (chosen && !by.includes(chosen) ? `（当前风格“${chosen}”不使用）` : '');
    s.img.style.visibility = 'hidden';
    s.blank.textContent = '';
    void preview(info.id).then(url => {
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
  for (const group of SCENE_GROUPS) {
    view.append(el('div', 'font-size:12px;opacity:.55;margin:14px 0 6px;letter-spacing:.06em', group.name));
    const grid = el('div', `display:grid;grid-template-columns:repeat(auto-fill,minmax(${compact ? 100 : 108}px,1fr));gap:6px`);
    for (const info of group.scenes) {
      const b = el('button', `display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid ${TINT(0.22)};background:${TINT(0.05)};` +
        'color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .12s,border-color .12s');
      const box = el('span', 'flex:none;display:flex;align-items:center;justify-content:center;width:14px;height:14px;box-sizing:border-box;border-radius:4px;border:1.5px solid;transition:background .12s');
      const name = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .12s', info.name);
      b.append(box, name);
      paints.push(() => {
        const on = !off.has(info.id);
        box.style.background = on ? ACCENT : 'transparent';
        box.style.borderColor = on ? ACCENT : TINT(0.6);
        box.innerHTML = on ? CHECK : '';
        name.style.opacity = on ? '1' : '.5';
        b.setAttribute('aria-pressed', String(on));
      });
      b.onclick = () => {
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
        showSketch(info, b);
      };
      const lit = (on: boolean) => { b.style.borderColor = TINT(on ? 0.5 : 0.22); b.style.background = TINT(on ? 0.12 : 0.05); };
      b.onmouseenter = () => { lit(true); showSketch(info, b); };
      b.onmouseleave = () => { lit(false); hideSketch(); };
      b.onfocus = () => showSketch(info, b);
      b.onblur = () => hideSketch();
      grid.append(b);
    }
    view.append(grid);
  }
  refresh();
  // The sketches load in the background while the page is read.
  for (const s of SCENES) void preview(s.id);
  return view;
}
