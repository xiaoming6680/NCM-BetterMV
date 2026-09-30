// The motion-graphics detail layer over every plate, after the counter and plate names of the user's 《△ 三角》:
// hairline corner marks, the plate number and name (top left), a bar counter (bottom left), section and tempo
// (bottom right). DOM, so it stays crisp; it only touches the page when a value changes.
import type { Shot } from '../scenes/types.ts';
import type { SectionLabel } from '../types.ts';
import { SCENE_NAME } from '../scenes/catalog.ts';

const SECTION: Record<SectionLabel, string> = {
  intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏',
};

export class Hud {
  readonly root = document.createElement('div');
  private plate = document.createElement('div');
  private counter = document.createElement('div');
  private section = document.createElement('div');
  private crystal = document.createElement('div');
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
    // Beside the crystal badge the overlay draws top right: its Conway notation and triangle count.
    this.crystal.style.cssText = 'position:absolute;right:86px;top:33px;text-align:right;opacity:.8';
    r.append(this.plate, this.counter, this.section, this.crystal);
    parent.append(r);
  }

  /** The song's crystal, e.g. `kI · 60△`. */
  set crystalLabel(text: string) { this.crystal.textContent = text; }

  get visible(): boolean { return !this.hidden; }

  /** Hide or show the whole layer (e.g. while the playback controls are up). */
  set visible(v: boolean) {
    if (v === !this.hidden) return;
    this.hidden = !v;
    this.root.style.opacity = v ? '1' : '0';
  }

  update(shot: Shot, index: number, total: number, bar: number, bpm: number): void {
    const poster = shot.scene === 'poster';
    if (shot !== this.last.shot) {
      this.last.shot = shot;
      this.plate.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}   ${SCENE_NAME[shot.scene]}`;
      this.counter.style.opacity = this.section.style.opacity = poster ? '0' : '1';
    }
    if (bar !== this.last.bar) {
      this.last.bar = bar;
      this.counter.textContent = `${this.glyph} ${String(bar).padStart(3, '0')}`;
    }
    const section = `${SECTION[shot.section.label]} · ${Math.round(bpm)} BPM`;
    if (section !== this.last.section) {
      this.last.section = section;
      this.section.textContent = section;
    }
  }

  dispose(): void { this.root.remove(); }
}
