// The motion-graphics detail layer over every plate, after the counter and plate names of the user's 《△ 三角》:
// hairline corner marks, the plate number and name (top left), a bar counter (bottom left), section and tempo
// (bottom right). DOM, so it stays crisp; it only touches the page when a value changes.
import type { Shot } from '../scenes/types.ts';
import type { SectionLabel } from '../types.ts';
import { SCENE_NAME } from '../scenes/catalog.ts';

const SECTION: Record<SectionLabel, string> = {
  intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏',
};

const HUD_FONT = '"Archivo","BMV Archivo Bold","Noto Sans SC","Microsoft YaHei UI",sans-serif';

export class Hud {
  readonly root = document.createElement('div');
  private plate = document.createElement('div');
  private counter = document.createElement('div');
  private section = document.createElement('div');
  private sigil = document.createElement('div');
  private last = { shot: null as Shot | null, bar: -1, section: '' };
  private hidden = false;

  constructor(parent: HTMLElement, public glyph = '△') {
    const r = this.root;
    r.style.cssText = 'position:absolute;inset:0;pointer-events:none;color:rgba(255,255,255,.72);' +
      'font:600 11px/1 "Archivo","BMV Archivo Bold","Noto Sans SC","Microsoft YaHei UI",sans-serif;letter-spacing:.16em;transition:opacity .3s';
    const corner = (css: string) => {
      const c = document.createElement('div');
      c.style.cssText = `position:absolute;width:14px;height:14px;opacity:.55;${css}`;
      r.append(c);
    };
    const line = '1px solid currentColor';
    corner(`left:18px;top:18px;border-left:${line};border-top:${line}`);
    corner(`right:18px;top:18px;border-right:${line};border-top:${line}`);
    corner(`left:18px;bottom:18px;border-left:${line};border-bottom:${line}`);
    corner(`right:18px;bottom:18px;border-right:${line};border-bottom:${line}`);
    this.plate.style.cssText = 'position:absolute;left:40px;top:22px';
    this.counter.style.cssText = 'position:absolute;left:40px;bottom:22px;font-size:13px;letter-spacing:.12em';
    this.section.style.cssText = 'position:absolute;right:40px;bottom:22px;text-align:right';
    // Beside the armillary badge the overlay draws top right: its rings and the marks on its meridian.
    this.sigil.style.cssText = 'position:absolute;right:86px;top:33px;text-align:right;opacity:.8';
    r.append(this.plate, this.counter, this.section, this.sigil);
    parent.append(r);
  }

  /** The song's armillary, e.g. `IV 32` (an em space between). */
  set sigilLabel(text: string) { this.sigil.textContent = text; }

  get visible(): boolean { return !this.hidden; }

  /** Hide or show the whole layer (e.g. while the playback controls are up). */
  set visible(v: boolean) {
    if (v === !this.hidden) return;
    this.hidden = !v;
    this.root.style.opacity = v && !this.opening ? '1' : '0';
  }

  /** Over the opening cards (the song's own title card) the layer stays away, and comes up with the first plate. */
  private opening = true;

  update(shot: Shot, index: number, total: number, bar: number, bpm: number): void {
    const poster = shot.scene === 'poster';
    if (shot !== this.last.shot) {
      this.last.shot = shot;
      this.opening = shot.scene === 'cards';
      this.root.style.opacity = !this.hidden && !this.opening ? '1' : '0';
      this.plate.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}   ${SCENE_NAME[shot.scene]}`;
      this.counter.style.opacity = this.section.style.opacity = poster ? '0' : '1';
    }
    if (bar !== this.last.bar) {
      this.last.bar = bar;
      this.counter.textContent = `${this.glyph} ${String(bar).padStart(3, '0')}`;
    }
    const section = `${SECTION[shot.section.label]}\u3000${Math.round(bpm)} BPM`;
    if (section !== this.last.section) {
      this.last.section = section;
      this.section.textContent = section;
    }
  }

  /**
   * The layer drawn into a picture of w × h px (a video's frame, a saved frame), as the page shows it over a 720-px-high
   * window, whether or not the controls hide it now. `dt`: the frames' step, s (a video's: the layer comes and goes
   * over 0.3 s of it, as on the page); none: as it stands.
   */
  draw(g: CanvasRenderingContext2D, w: number, h: number, dt?: number): void {
    const target = this.opening ? 0 : 1, step = dt === undefined ? 1 : dt / 0.3;
    this.alpha = target > this.alpha ? Math.min(target, this.alpha + step) : Math.max(target, this.alpha - step);
    if (this.alpha <= 0) return;
    const s = h / 720, poster = this.last.shot?.scene === 'poster';
    g.save();
    g.fillStyle = g.strokeStyle = '#fff';
    // The corner marks.
    g.globalAlpha = this.alpha * 0.72 * 0.55;
    g.lineWidth = Math.max(1, Math.round(s));
    const m = 18 * s, k = 14 * s;
    g.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      g.moveTo(x + dx * k, y);
      g.lineTo(x, y);
      g.lineTo(x, y + dy * k);
    }
    g.stroke();
    const text = (t: string, size: number, spacing: number, x: number, y: number, right: boolean, bottom: boolean, alpha: number) => {
      if (!t || alpha <= 0) return;
      g.globalAlpha = this.alpha * 0.72 * alpha;
      g.font = `600 ${size * s}px ${HUD_FONT}`;
      g.textBaseline = bottom ? 'bottom' : 'top';
      const gap = spacing * size * s, chars = Array.from(t);
      let at = right ? w - x - chars.reduce((n, c) => n + g.measureText(c).width + gap, 0) : x;
      for (const c of chars) { g.fillText(c, at, y); at += g.measureText(c).width + gap; }
    };
    // (Runs of spaces show as one, as in the page.)
    text((this.plate.textContent ?? '').replace(/ +/g, ' '), 11, 0.16, 40 * s, 22 * s, false, false, 1);
    text(this.counter.textContent ?? '', 13, 0.12, 40 * s, h - 22 * s, false, true, poster ? 0 : 1);
    text(this.section.textContent ?? '', 11, 0.16, 40 * s, h - 22 * s, true, true, poster ? 0 : 1);
    text(this.sigil.textContent ?? '', 11, 0.16, 86 * s, 33 * s, true, false, 0.8);
    g.restore();
  }
  private alpha = 0;

  dispose(): void { this.root.remove(); }
}
