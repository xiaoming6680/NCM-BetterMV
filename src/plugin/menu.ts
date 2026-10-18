// What comes up over the MV page for a moment: the menu of a right click, a notice along the top (a download going on,
// a file saved) and an alert that asks before something long or disruptive. Styled in uiStyle.ts (bmv-menu,
// bmv-notice, bmv-alert); they move by transform and opacity only, beside the MV's frames.
import { appIcon, icon } from './icons.ts';

export interface MenuItem {
  label: string;
  /** On the right: the key that does the same. */
  hint?: string;
  /** A tick before the label (a choice, or a setting that is on); the menu keeps a column for it. */
  checked?: boolean;
  disabled?: boolean;
  /** A submenu, opened beside the item. */
  items?: MenuEntry[];
  run?: () => void;
}
/** An item, or `'-'` for a line between groups; null is left out (lists written with conditions). */
export type MenuEntry = MenuItem | '-' | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const still = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function fade(e: HTMLElement, from: number, to: number, ms: number): void {
  if (still() || typeof e.animate !== 'function') return;
  e.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
}

interface Level {
  box: HTMLElement;
  rows: Array<{ row: HTMLElement; item: MenuItem }>;
  at: number;
  /** The submenus of its items, built with it (hidden until their item is lit). */
  subs: Map<number, Level>;
}

/** Room kept between a menu and the window's edges, px. */
const EDGE = 8;
/** A menu's padding, px: a submenu's first item lines up with the item that opened it. */
const PAD = 5;

/**
 * A menu as a desktop's: it comes up at the cursor (moved in to stay in the window), the item under the pointer or
 * picked with the arrow keys lit, submenus beside their item. A choice blinks before the menu goes; a press elsewhere
 * only closes it.
 *
 * Its submenus are built and placed with it, hidden: lighting their item only shows one. (Built on the hover, a
 * submenu cost a layout and its words' first shaping in the middle of the MV's frames: the whole menu stopped for a
 * moment, in NetEase, as the pointer reached 风格.) warm() lays a menu out once, out of sight, while the MV is made.
 */
export class Menu {
  /** Over the page while the menu is up: a press outside lands on it, not on what is under it. */
  private catcher = el('div', 'bmv-menu-catch');
  /** The levels shown, the menu first; and every box of the menu, shown or not. */
  private levels: Level[] = [];
  private boxes: HTMLElement[] = [];
  private switching = 0;
  /** The click that closed the menu is still going on (the catcher stays for its release and click). */
  private holding = false;
  private draining = 0;
  /** Called after the menu has gone (the controls may go to sleep again). */
  onClosed: (() => void) | null = null;

  constructor(private host: HTMLElement) {
    // The press that closes the menu is the catcher's, and so is its release and click (a right press then opens the
    // menu again where it was made: its contextmenu reaches the page once the catcher is gone).
    this.catcher.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.holding = true;
      this.close();
      this.drain();
    });
    this.catcher.addEventListener('wheel', () => this.close(), { passive: true });
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  get isOpen(): boolean { return this.levels.length > 0; }

  open(x: number, y: number, entries: MenuEntry[]): void {
    this.dismiss();
    clearTimeout(this.draining);
    this.holding = false;
    if (!this.catcher.isConnected) this.host.append(this.catcher);
    const level = this.build(entries, 0);
    this.levels = [level];
    this.boxes = this.place(level, x, y);
    fade(level.box, 0, 1, 90);
  }

  /**
   * The menu and its submenus in the page, the menu at (x, y) and each submenu beside its item, hidden: every size read
   * at once, then every place written (one layout).
   */
  private place(level: Level, x: number, y: number): HTMLElement[] {
    const all: Array<{ level: Level; parent?: Level; row?: number }> = [{ level }];
    for (let k = 0; k < all.length; k++) all[k].level.subs.forEach((sub, row) => all.push({ level: sub, parent: all[k].level, row }));
    for (const { level: l, parent } of all) {
      if (parent) l.box.style.visibility = 'hidden';
      this.host.append(l.box);
    }
    const r = this.host.getBoundingClientRect();
    const sizes = all.map(({ level: l, parent, row }) => ({ w: l.box.offsetWidth, h: l.box.offsetHeight, top: parent ? parent.rows[row!].row.offsetTop : 0 }));
    const at = new Map<Level, { left: number; top: number; w: number }>();
    all.forEach(({ level: l, parent }, k) => {
      const { w, h, top: rowTop } = sizes[k];
      let left: number, top: number;
      if (!parent) {
        left = x - r.left;
        top = y - r.top;
        // Past the right edge it opens to the left of the cursor; past the bottom it moves up (as a system menu does).
        if (left + w > r.width - EDGE) left = Math.max(EDGE, left - w);
      } else {
        const p = at.get(parent)!;
        left = p.left + p.w - 2;
        top = p.top + rowTop - PAD;
        if (left + w > r.width - EDGE) left = Math.max(EDGE, p.left - w + 2);
      }
      if (top + h > r.height - EDGE) top = Math.max(EDGE, r.height - EDGE - h);
      at.set(l, { left, top, w });
      l.box.style.transform = `translate(${left}px,${top}px)`;
    });
    return all.map(a => a.level.box);
  }

  /**
   * The menu laid out and drawn once, out of sight (its words' first shaping and drawing take tens of ms on NetEase's
   * busy page): done while the MV page waits for the MV, so the first menu and submenu don't stall.
   */
  warm(entries: MenuEntry[]): void {
    if (this.levels.length) return;
    const boxes = this.place(this.build(entries, 0), 0, 0);
    for (const b of boxes) {
      b.style.visibility = '';
      b.style.opacity = '0.01';
      b.style.pointerEvents = 'none';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => boxes.forEach(b => b.remove())));
  }

  /** Close every level (fading); `instant`: gone at once. */
  close(instant = false): void {
    if (!this.levels.length) return;
    clearTimeout(this.switching);
    const shown = this.levels, boxes = this.boxes;
    this.levels = [];
    this.boxes = [];
    for (const b of boxes) {
      b.style.pointerEvents = 'none';
      // (Removed on a timer, not when the fade ends: a page in the background doesn't run its animations.)
      if (instant) b.remove();
      else {
        if (shown.some(l => l.box === b)) fade(b, 1, 0, 160);
        window.setTimeout(() => b.remove(), 180);
      }
    }
    if (!this.holding) this.catcher.remove();
    this.onClosed?.();
  }

  /** Gone at once, nothing called (a new menu replacing it). */
  private dismiss(): void {
    clearTimeout(this.switching);
    for (const b of this.boxes) b.remove();
    this.levels = [];
    this.boxes = [];
  }

  /** Keep the catcher for the rest of the click that closed the menu. */
  private drain(): void {
    const up = () => {
      window.removeEventListener('pointerup', up, true);
      this.draining = window.setTimeout(() => {
        this.holding = false;
        if (!this.levels.length) this.catcher.remove();
      }, 250);
    };
    window.addEventListener('pointerup', up, true);
  }

  /** The keys while the menu is up (all of them are its): true when one was taken. */
  key(e: KeyboardEvent): boolean {
    if (!this.levels.length) return false;
    const level = this.levels[this.levels.length - 1];
    switch (e.key) {
      case 'ArrowDown': case 'Tab': this.step(level, e.shiftKey && e.key === 'Tab' ? -1 : 1); break;
      case 'ArrowUp': this.step(level, -1); break;
      case 'ArrowRight': if (level.at >= 0 && level.rows[level.at].item.items) this.openSub(this.levels.length - 1, level.at, true); break;
      case 'ArrowLeft': if (this.levels.length > 1) this.closeFrom(this.levels.length - 1); break;
      case 'Enter': case ' ': if (level.at >= 0) this.choose(this.levels.length - 1, level.at); break;
      case 'Escape': if (this.levels.length > 1) this.closeFrom(this.levels.length - 1); else this.close(); break;
      default: break;
    }
    return true;
  }

  private build(entries: MenuEntry[], depth: number): Level {
    const box = el('div', depth ? 'bmv-menu is-sub' : 'bmv-menu');
    box.setAttribute('role', 'menu');
    const level: Level = { box, rows: [], at: -1, subs: new Map() };
    // (No line first, last or twice in a row.)
    const list = entries.filter((e): e is MenuItem | '-' => e !== null)
      .filter((e, i, a) => e !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
    box.classList.toggle('has-checks', list.some(e => e !== '-' && e.checked !== undefined));
    for (const e of list) {
      if (e === '-') { box.append(el('div', 'bmv-msep')); continue; }
      const row = el('div', 'bmv-mi' + (e.disabled ? ' is-disabled' : '') + (e.checked ? ' is-checked' : ''));
      row.setAttribute('role', e.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
      if (e.checked !== undefined) row.setAttribute('aria-checked', String(e.checked));
      if (e.disabled) row.setAttribute('aria-disabled', 'true');
      const check = el('span', 'bmv-mi-check');
      check.innerHTML = icon('check', 12, 2.2);
      row.append(check, el('span', 'bmv-mi-label', e.label));
      if (e.items) { const more = el('span', 'bmv-mi-more'); more.innerHTML = icon('chevronRight', 12, 2); row.append(more); }
      else if (e.hint) row.append(el('span', 'bmv-mi-hint', e.hint));
      const i = level.rows.length;
      if (e.items && !e.disabled) level.subs.set(i, this.build(e.items, depth + 1));
      row.addEventListener('pointerenter', () => this.hover(depth, i));
      row.addEventListener('click', ev => { ev.stopPropagation(); this.choose(depth, i); });
      level.rows.push({ row, item: e });
      box.append(row);
    }
    // Leaving the menu clears what is lit, unless it opened the submenu the pointer went to.
    box.addEventListener('pointerleave', () => {
      const l = this.levels[depth];
      if (l === level && this.levels.length === depth + 1) this.light(level, -1);
    });
    box.addEventListener('pointermove', e => this.track(e));
    box.addEventListener('pointerenter', () => {
      // Back in a submenu on the way to it: the switch the parent was about to make is off.
      if (depth > 0) clearTimeout(this.switching);
    });
    return level;
  }

  private light(level: Level, i: number): void {
    if (level.at === i) return;
    if (level.at >= 0) level.rows[level.at]?.row.classList.remove('is-active');
    level.at = i;
    if (i >= 0) level.rows[i].row.classList.add('is-active');
  }

  private step(level: Level, d: number): void {
    const n = level.rows.length;
    for (let k = 1; k <= n; k++) {
      const i = ((level.at < 0 ? (d > 0 ? -1 : n) : level.at) + d * k + n * 2) % n;
      if (!level.rows[i].item.disabled) { this.light(level, i); return; }
    }
  }

  private hover(depth: number, i: number): void {
    const level = this.levels[depth];
    if (!level) return;
    clearTimeout(this.switching);
    const go = () => {
      if (this.levels[depth] !== level) return;
      if (this.levels.length > depth + 1) this.closeFrom(depth + 1);
      const { item } = level.rows[i];
      this.light(level, item.disabled ? -1 : i);
      if (item.items && !item.disabled) this.openSub(depth, i, false);
    };
    // With a submenu open from another item, the pointer may be crossing this one on its way there: only then (it is
    // heading for the submenu) the switch waits, and is looked at again a moment later. Swept up or down the menu, the
    // items light as it passes (waiting on every item, a quick sweep stayed on 风格 to its end).
    const check = () => {
      if (this.levels[depth] !== level) return;
      if (this.aiming(depth)) this.switching = window.setTimeout(check, 120);
      else go();
    };
    if (this.levels.length > depth + 1 && level.at !== i) check();
    else if (level.at !== i || !this.levels[depth + 1]) go();
  }

  /** The pointer's last places over the menu (the oldest first), to tell where it is heading. */
  private trail: Array<{ x: number; y: number }> = [];
  /** Where the pointer was when a switch last waited: if it hasn't moved since, it isn't heading anywhere. */
  private waitedAt: { x: number; y: number } | null = null;

  private track(e: PointerEvent): void {
    this.trail.push({ x: e.clientX, y: e.clientY });
    if (this.trail.length > 4) this.trail.shift();
  }

  /**
   * Whether the pointer is moving toward the submenu shown beside the menu at `depth`: its latest place lies in the
   * triangle between an earlier one and the submenu's near edge (widened a little above and below).
   */
  private aiming(depth: number): boolean {
    const sub = this.levels[depth + 1], parent = this.levels[depth];
    const now = this.trail[this.trail.length - 1], then = this.trail[0];
    if (!sub || !parent || !now || !then || (now.x === then.x && now.y === then.y)) return false;
    if (this.waitedAt && this.waitedAt.x === now.x && this.waitedAt.y === now.y) return false;
    const s = sub.box.getBoundingClientRect(), p = parent.box.getBoundingClientRect();
    const x = s.left >= p.left + p.width / 2 ? s.left : s.right;
    const a = { x, y: s.top - 12 }, b = { x, y: s.bottom + 12 };
    const side = (u: { x: number; y: number }, v: { x: number; y: number }, w: { x: number; y: number }) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
    const d1 = side(then, a, now), d2 = side(a, b, now), d3 = side(b, then, now);
    const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    this.waitedAt = inside ? now : null;
    return inside;
  }

  /** The submenu of item i shown (built and placed already). */
  private openSub(depth: number, i: number, keyboard: boolean): void {
    const parent = this.levels[depth], sub = parent.subs.get(i);
    if (!sub) return;
    if (this.levels[depth + 1] === sub) { if (keyboard) this.step(sub, 1); return; }
    if (this.levels.length > depth + 1) this.closeFrom(depth + 1);
    this.light(parent, i);
    this.levels.push(sub);
    sub.box.style.visibility = '';
    fade(sub.box, 0, 1, 90);
    if (keyboard) this.step(sub, 1);
  }

  /** The levels from `depth` on hidden again (kept: they show again when their item is lit). */
  private closeFrom(depth: number): void {
    for (const l of this.levels.splice(depth)) {
      l.box.style.visibility = 'hidden';
      this.light(l, -1);
    }
  }

  /** An item chosen: a submenu opens; an action blinks the item, the menu fades, then it runs. */
  private choose(depth: number, i: number): void {
    const level = this.levels[depth], entry = level?.rows[i];
    if (!entry || entry.item.disabled) return;
    if (entry.item.items) { this.openSub(depth, i, true); return; }
    const run = entry.item.run;
    if (still()) { this.close(true); run?.(); return; }
    for (const l of this.levels) l.box.style.pointerEvents = 'none';
    this.light(level, i);
    const row = entry.row;
    window.setTimeout(() => row.classList.remove('is-active'), 0);
    window.setTimeout(() => row.classList.add('is-active'), 70);
    window.setTimeout(() => { this.close(); run?.(); }, 140);
  }
}

export interface NoticeOptions {
  /** A quieter part after the text (a file's name). */
  sub?: string;
  /** A button at its end (在文件夹中显示). */
  action?: { label: string; run: () => void };
  /** Goes by itself after this many ms. */
  hideAfter?: number;
}

/** One line along the top of the MV page: what happened, and what can be done about it. */
export class Notice {
  readonly el = el('div', 'bmv-notice');
  private text = el('span');
  private sub = el('span', 'bmv-notice-sub');
  private button = el('button', 'bmv-notice-btn');
  private timer = 0;

  constructor() {
    this.el.setAttribute('role', 'status');
    this.el.append(this.text, this.sub, this.button);
  }

  show(text: string, o: NoticeOptions = {}): void {
    clearTimeout(this.timer);
    if (this.text.textContent !== text) this.text.textContent = text;
    const sub = o.sub ?? '';
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
    this.sub.style.display = sub ? '' : 'none';
    const action = o.action;
    this.button.textContent = action?.label ?? '';
    this.button.style.display = action ? '' : 'none';
    this.button.onclick = action ? ev => { ev.stopPropagation(); action.run(); } : null;
    this.el.classList.toggle('has-action', !!action);
    this.el.classList.add('is-on');
    if (o.hideAfter) this.timer = window.setTimeout(() => this.hide(), o.hideAfter);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.el.classList.remove('is-on');
  }
}

export interface AskOptions {
  title: string;
  message: string;
  /** Smaller lines under the message (what is made, where it goes), split at \n. */
  detail?: string;
  confirm: string;
  cancel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

/**
 * An alert over the MV page, as a desktop's: the app's mark, a title, what will happen, then cancel and the action
 * (Enter takes the action, Esc cancels). Returns its key handler, which the page sends every key to while it is up,
 * and calls `gone` once it has been answered.
 */
export function ask(host: HTMLElement, o: AskOptions, gone: () => void): (e: KeyboardEvent) => boolean {
  const scrim = el('div', 'bmv-alert-scrim');
  const box = el('div', 'bmv-alert');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', o.title);
  const mark = el('div', 'bmv-alert-icon');
  mark.innerHTML = appIcon(44);
  box.append(mark, el('div', 'bmv-alert-title', o.title), el('div', 'bmv-alert-msg', o.message));
  if (o.detail) {
    // A line each; a path breaks after its backslashes, not inside a name.
    const detail = el('div', 'bmv-alert-detail');
    for (const line of o.detail.split('\n')) {
      const d = el('div');
      line.split('\\').forEach((part, i) => { if (i) d.append('\\', el('wbr')); d.append(part); });
      detail.append(d);
    }
    box.append(detail);
  }
  const row = el('div', 'bmv-alert-btns');
  const no = el('button', '', o.cancel ?? '取消'), yes = el('button', 'is-primary', o.confirm);
  row.append(no, yes);
  box.append(row);
  scrim.append(box);
  host.append(scrim);
  let open = true;
  const end = (then?: () => void) => {
    if (!open) return;
    open = false;
    scrim.classList.remove('is-on');
    window.setTimeout(() => scrim.remove(), 220);
    gone();
    then?.();
  };
  no.onclick = ev => { ev.stopPropagation(); end(o.onCancel); };
  yes.onclick = ev => { ev.stopPropagation(); end(o.onConfirm); };
  // A press on the dimmed picture around it is nothing (an alert waits for its answer).
  scrim.addEventListener('pointerdown', ev => { if (ev.target === scrim) ev.preventDefault(); });
  // (Its first style read, then the class: the fade-in plays without waiting for a frame.) The action is the default
  // (Enter) without taking the focus, which would ring it.
  void scrim.offsetWidth;
  scrim.classList.add('is-on');
  return e => {
    if (!open) return false;
    if (e.key === 'Escape') end(o.onCancel);
    else if (e.key === 'Enter') (document.activeElement === no ? no : yes).click();
    else if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') (document.activeElement === yes ? no : yes).focus();
    return true;
  };
}
