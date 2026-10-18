// The sheet "下载 MV…" brings up over the MV page: what to make (picture shape and size, frame rate, quality, the part of
// the song, the encoder), and what that comes to before it begins (size, file, time). Built like menu.ts's alert (a
// scrim, a frosted box, Esc and Enter), with the controls of a settings sheet; styled in uiStyle.ts (bmv-export).
import { appIcon } from './icons.ts';
import {
  ASPECTS, ENCODERS, FPS, PARTS, QUALITIES, SIZES, clock, estimate, loadSpeed, parseClock, partOf, videoSize, type ExportOptions, type Span,
} from './exportOptions.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * A change of size starts and ends at rest (the page's own curve, --ease, is front-loaded: it suits things that arrive, not
 * a box that stretches; a speed that jumps at the first frame reads as a snap).
 */
const EASE = 'cubic-bezier(.4,0,.2,1)';
const still = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A part of the sheet that comes and goes (a line under a choice): closed, it takes no room and can't be tabbed to. */
function collapsible(child: HTMLElement): HTMLElement {
  const w = el('div', 'bmv-xcol');
  w.style.display = 'none';
  w.append(child);
  return w;
}

/**
 * Opens or closes such a part: its height and opacity go to the new value, so the sheet — centred, as it stands — grows
 * and shrinks with it instead of jumping when a line comes or goes. `animated` off (the sheet's first drawing), or the
 * system asking for less motion: at once. Read from where it is, so a change in the middle of one carries on from there.
 */
function setOpen(w: HTMLElement, open: boolean, animated: boolean): void {
  if (w.dataset.open === (open ? '1' : '0')) return;
  w.dataset.open = open ? '1' : '0';
  const live = animated && !still() && typeof w.animate === 'function';
  const from = w.style.display === 'none' ? 0 : w.getBoundingClientRect().height;
  const fromOpacity = from ? Number(getComputedStyle(w).opacity) : 0;
  for (const a of w.getAnimations()) a.cancel();
  w.style.display = open || (live && from) ? '' : 'none';
  if (!live) return;
  if (open) {
    w.animate([{ height: `${from}px`, opacity: fromOpacity }, { height: `${w.scrollHeight}px`, opacity: 1 }], { duration: 320, easing: EASE });
  } else if (from) {
    const a = w.animate([{ height: `${from}px`, opacity: fromOpacity }, { height: '0px', opacity: 0 }], { duration: 260, easing: EASE, fill: 'forwards' });
    a.onfinish = () => { a.cancel(); if (w.dataset.open === '0') w.style.display = 'none'; };
  }
}

export interface SheetInit {
  name: string;
  artists: string;
  duration: number;
  sections: readonly Span[];
  options: ExportOptions;
  /** Where the file goes. */
  folder: string;
  /** Where the song is playing now, s (a custom part starts there at first). */
  playhead: number;
}

const bytes = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`);
const spent = (s: number) => (s < 90 ? `${Math.max(5, Math.round(s / 5) * 5)} 秒` : `${Math.round(s / 60)} 分钟`);

/** The sheet on `host`; returns its key handler (the page sends every key to it while it is up). `gone`: once it has been answered. */
export function exportSheet(host: HTMLElement, init: SheetInit, onStart: (o: ExportOptions) => void, gone: () => void): (e: KeyboardEvent) => boolean {
  const o: ExportOptions = { ...init.options };
  // (A first custom part: the half minute from where the song is.)
  if (!(o.to > o.from) || o.to > init.duration) {
    o.from = Math.min(Math.floor(init.playhead), Math.max(0, Math.floor(init.duration) - 1));
    o.to = Math.min(init.duration, o.from + 30);
  }
  const scrim = el('div', 'bmv-alert-scrim');
  const box = el('div', 'bmv-alert bmv-export');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '导出 MV');
  const head = el('div', 'bmv-export-head');
  const mark = el('div', 'bmv-export-icon');
  mark.innerHTML = appIcon(36);
  const titles = el('div', 'bmv-export-titles');
  titles.append(el('div', 'bmv-alert-title', '导出 MV'), el('div', 'bmv-export-song', `${init.name}${init.artists ? ' - ' + init.artists : ''}`));
  head.append(mark, titles);
  box.append(head);

  const refresh: Array<() => void> = [];
  const rows = el('div', 'bmv-export-rows');
  const row = (label: string, control: HTMLElement, note?: HTMLElement) => {
    const r = el('div', 'bmv-xr'), l = el('span', 'bmv-xl', label), c = el('div', 'bmv-xc');
    c.append(control);
    if (note) c.append(note);
    r.append(l, c);
    rows.append(r);
    return r;
  };
  const seg = <T extends string | number>(list: ReadonlyArray<[T, string]>, get: () => T, set: (v: T) => void) => {
    const g = el('div', 'bmv-xseg');
    const buttons = list.map(([v, label]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.onclick = ev => { ev.stopPropagation(); set(v); sync(); };
      g.append(b);
      return [v, b] as const;
    });
    refresh.push(() => buttons.forEach(([v, b]) => b.classList.toggle('is-on', v === get())));
    return g;
  };

  row('画幅', seg(ASPECTS, () => o.aspect, v => { o.aspect = v; }));
  row('清晰度', seg(SIZES, () => o.size, v => { o.size = v; }));
  row('帧率', seg(FPS, () => o.fps, v => { o.fps = v; }));
  row('画质', seg(QUALITIES, () => o.quality, v => { o.quality = v; }));
  const partNote = el('div', 'bmv-xnote');
  const noteWrap = collapsible(partNote);
  const partRow = row('范围', seg(PARTS, () => o.part, v => { o.part = v; }), noteWrap);
  // The custom part's two times, under the choice.
  const custom = el('div', 'bmv-xrange');
  const from = el('input', 'bmv-xin'), to = el('input', 'bmv-xin');
  for (const i of [from, to]) { i.type = 'text'; i.inputMode = 'decimal'; i.maxLength = 8; i.spellcheck = false; }
  from.setAttribute('aria-label', '开始时间');
  to.setAttribute('aria-label', '结束时间');
  custom.append(from, el('span', '', '到'), to);
  const rangeWrap = collapsible(custom);
  partRow.querySelector('.bmv-xc')!.append(rangeWrap);
  const read = (): boolean => {
    const a = parseClock(from.value), b = parseClock(to.value);
    const ok = a !== null && b !== null && a >= 0 && b <= init.duration + 0.5 && b - a >= 1;
    from.classList.toggle('is-bad', !ok && (a === null || (b !== null && b - a < 1)));
    to.classList.toggle('is-bad', !ok && (b === null || b > init.duration + 0.5 || (a !== null && b - a < 1)));
    if (ok) { o.from = a!; o.to = Math.min(b!, init.duration); }
    return ok;
  };
  const settle = () => { if (read()) { from.value = clock(o.from); to.value = clock(o.to); } sync(); };
  from.value = clock(o.from);
  to.value = clock(o.to);
  for (const i of [from, to]) { i.oninput = () => { read(); sync(); }; i.onchange = settle; i.onclick = ev => ev.stopPropagation(); }
  row('编码', seg(ENCODERS, () => o.encoder, v => { o.encoder = v; }), el('div', 'bmv-xnote', '自动：有显卡编码器时用它，否则用处理器'));
  box.append(rows);

  const sum = el('div', 'bmv-export-sum');
  const where = el('div', 'bmv-export-where');
  init.folder.split('\\').forEach((part, i) => { if (i) where.append('\\', el('wbr')); where.append(part); });
  box.append(sum, el('div', 'bmv-export-to', '保存到'), where);

  const btns = el('div', 'bmv-alert-btns');
  const no = el('button', '', '取消'), yes = el('button', 'is-primary', '导出');
  no.type = yes.type = 'button';
  btns.append(no, yes);
  box.append(btns);
  scrim.append(box);
  host.append(scrim);

  const range = (): [number, number] => partOf(o, init.duration, init.sections);
  function sync(animated = true): void {
    for (const f of refresh) f();
    const r = range(), size = videoSize(o.aspect, o.size), e = estimate(o, r, loadSpeed(size.width, size.height, o.fps));
    // (The note's words stay while it closes.)
    if (o.part === 'chorus') partNote.textContent = `${clock(r[0])} – ${clock(r[1])}，共 ${clock(r[1] - r[0])}`;
    setOpen(noteWrap, o.part === 'chorus', animated);
    setOpen(rangeWrap, o.part === 'custom', animated);
    sum.textContent = `${size.width}×${size.height} · ${o.fps} 帧 · 约 ${(e.rate / 1e6).toFixed(0)} Mbps · 约 ${bytes(e.bytes)} · 预计 ${spent(e.seconds)}`;
    yes.disabled = o.part === 'custom' && !read();
  }
  sync(false);

  let open = true;
  const end = (then?: () => void) => {
    if (!open) return;
    open = false;
    scrim.classList.remove('is-on');
    window.setTimeout(() => scrim.remove(), 220);
    gone();
    then?.();
  };
  const start = () => { if (o.part === 'custom' && !read()) { sync(); return; } end(() => onStart({ ...o })); };
  no.onclick = ev => { ev.stopPropagation(); end(); };
  yes.onclick = ev => { ev.stopPropagation(); start(); };
  // A press on the dimmed picture around it is nothing (a sheet waits for its answer).
  scrim.addEventListener('pointerdown', ev => { if (ev.target === scrim) ev.preventDefault(); });
  void scrim.offsetWidth;
  scrim.classList.add('is-on');
  return e => {
    if (!open) return false;
    const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
    if (e.key === 'Escape') { if (typing && document.activeElement instanceof HTMLElement) document.activeElement.blur(); end(); return true; }
    if (e.key === 'Enter') { if (typing) settle(); start(); return true; }
    // (Typing in a time field, and Tab between the controls, are the page's own.)
    if (typing || e.key === 'Tab') return false;
    if (e.key === ' ' && document.activeElement instanceof HTMLButtonElement) { document.activeElement.click(); return true; }
    return true;
  };
}
