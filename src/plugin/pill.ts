// A download going on (or just finished) while the MV page is closed: a small pill above the MV button, with how far
// along it is and its buttons; pressed elsewhere than a button, it opens the MV page. Styled in uiStyle.ts (bmv-pill).
import { ensureStyles } from './uiStyle.ts';

export interface PillOptions {
  /** 0..1: a ring before the text. */
  progress?: number;
  /** A quieter part after the text (a file's name). */
  sub?: string;
  /** Buttons at its end (取消, 在文件夹中显示). */
  actions?: Array<{ label: string; run: () => void }>;
  /** Pressed on the pill itself (not a button). */
  onOpen?: () => void;
  /** Goes by itself after this many ms. */
  hideAfter?: number;
}

export class Pill {
  readonly el = document.createElement('div');
  private ring = document.createElement('span');
  private text = document.createElement('span');
  private sub = document.createElement('span');
  private buttons = document.createElement('span');
  private timer = 0;
  private open: (() => void) | undefined;

  constructor() {
    ensureStyles();
    this.el.className = 'bmv-ui bmv-pill';
    this.el.setAttribute('role', 'status');
    this.ring.className = 'bmv-pill-ring';
    this.sub.className = 'bmv-pill-sub';
    this.buttons.style.cssText = 'display:inline-flex;gap:4px';
    this.el.append(this.ring, this.text, this.sub, this.buttons);
    this.el.addEventListener('click', () => this.open?.());
    document.body.appendChild(this.el);
  }

  get shown(): boolean { return this.el.classList.contains('is-on'); }

  show(text: string, o: PillOptions = {}): void {
    clearTimeout(this.timer);
    if (this.text.textContent !== text) this.text.textContent = text;
    this.ring.style.display = o.progress === undefined ? 'none' : '';
    if (o.progress !== undefined) this.ring.style.setProperty('--p', String(Math.round(Math.min(1, Math.max(0, o.progress)) * 100)));
    const sub = o.sub ?? '';
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
    this.sub.style.display = sub ? '' : 'none';
    this.open = o.onOpen;
    // (The buttons are made anew only when their labels changed: a press must not land on one replaced under it.)
    const labels = (o.actions ?? []).map(a => a.label).join('|');
    if (this.buttons.dataset.labels !== labels) {
      this.buttons.dataset.labels = labels;
      this.buttons.replaceChildren(...(o.actions ?? []).map(() => document.createElement('button')));
      (Array.from(this.buttons.children) as HTMLButtonElement[]).forEach((b, i) => { b.className = 'bmv-pill-btn'; b.textContent = o.actions![i].label; });
    }
    (Array.from(this.buttons.children) as HTMLButtonElement[]).forEach((b, i) => { b.onclick = ev => { ev.stopPropagation(); o.actions![i].run(); }; });
    this.el.style.paddingRight = o.actions?.length ? '5px' : '12px';
    this.el.classList.add('is-on');
    if (o.hideAfter) this.timer = window.setTimeout(() => this.hide(), o.hideAfter);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.el.classList.remove('is-on');
  }
}
