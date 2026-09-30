// Cards: the opening — the song read out, in the motion-graphics language of the user's 《△ 三角》 (hairlines on ink,
// a Swiss grid, big type beside small notes, one move per beat). Over the intro's first two bars, a step a beat
// (more beats, the steps spread out):
//   1  the timeline sweeps across the foot of the frame
//   2  the whole song's loudness draws itself along it
//   3  the section boundaries drop in, the choruses and drops marked in the signal colour; a playhead at the start
//   4  the tempo lights up like a neon tube, big, with metre, length and sections under it; beat squares tick the bar
//   5  the song's crystal gathers from its shards, its notation under it
//   6  three leader lines say why it looks so (tempo → seed, drums → carving, voice → height)
//   7  the title slams in over the artists
//   8  hold — then the cut pushes on through into the first plate
// Everything is the analysis itself: nothing on screen is decoration.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, outExpo, smooth } from './types.ts';
import { textMesh, type Face } from '../render/text.ts';
import { LineBatch } from '../render/lines.ts';
import { Crystal } from '../sigil/crystal.ts';
import type { SectionLabel } from '../types.ts';

type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
const NAMES: Record<SectionLabel, string> = { intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏' };
const SEED: Record<string, string> = { T: '四面体', C: '立方体', O: '八面体', D: '十二面体', I: '二十面体' };
const DIST = 10, FOV = (2 * Math.atan(1 / DIST) * 180) / Math.PI; // the plane z = 0 is exactly 2 units tall
const LINE_Y = -0.66, ENV_H = 0.26; // the timeline and the loudness above it
const POINTS = 240;

/** A neon tube striking at `age` seconds: a strike, dark, a flicker, dark, then on (overshooting), all in 0.12 s. */
function neon(age: number): number {
  if (age < 0) return 0;
  if (age < 0.03) return 0.95;
  if (age < 0.055) return 0.1;
  if (age < 0.085) return 0.6;
  if (age < 0.11) return 0.08;
  return 1 + 0.4 * Math.exp(-(age - 0.11) / 0.14);
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class CardsScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100);
  private lines = new LineBatch(4000);
  private crystal: Crystal;
  private env: Float32Array;
  private aspect = 16 / 9;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  private t: Record<string, Mesh> = {};
  private digits: Mesh[] = [];
  private sectionLabels: Array<{ mesh: Mesh; x: number }> = [];
  private notes: Mesh[] = [];

  constructor(private init: SceneInit) {
    const { palette, music } = init;
    const a = music.a;
    this.scene.background = palette.ink.clone();
    this.camera.position.set(0, 0, DIST);
    this.camera.lookAt(0, 0, 0);

    // The loudness of the whole song, POINTS wide (the loudest moment in each slice).
    const e = a.env, env = new Float32Array(POINTS);
    const per = Math.max(1, Math.floor(e.rms.length / POINTS));
    for (let i = 0; i < POINTS; i++) {
      let m = 0;
      for (let k = i * per; k < Math.min(e.rms.length, (i + 1) * per); k++) m = Math.max(m, e.rms[k]);
      // (Squared: a mastered song sits near the top most of the time; this opens its dynamics up.)
      env[i] = Math.pow(Math.min(1, m), 1.8);
    }
    this.env = env;

    const mk = (key: string, s: string, face: Face, h: number) => {
      const m = textMesh(s, face, h, { px: face === 'display' ? 200 : 96, halo: 'none' });
      m.material.toneMapped = false;
      m.visible = false;
      this.scene.add(m);
      this.t[key] = m;
      return m;
    };
    mk('system', 'BETTERMV · 歌曲分析', 'bold', 0.044);
    mk('title', init.title || '正在播放', 'display', 0.17);
    mk('artists', (init.artists ?? []).join(' / ') || ' ', 'bold', 0.056);
    mk('bpmUnit', 'BPM', 'bold', 0.06);
    mk('facts', `${a.meter}/4  ·  ${fmt(a.duration)}  ·  ${a.sections.length} 段`, 'light', 0.046);
    mk('t0', '0:00', 'light', 0.032);
    mk('t1', fmt(a.duration), 'light', 0.032);
    // The tempo, a mesh a digit so each can strike on its own.
    this.digits = String(Math.round(a.bpm)).split('').map((d, i) => mk('d' + i, d, 'display', 0.3));
    // Section names under the timeline, only where there is room for them.
    for (const s of a.sections) {
      const x = (s.start + s.end) / 2 / a.duration;
      const m = mk('sec' + s.start, NAMES[s.label], 'light', 0.036);
      this.sectionLabels.push({ mesh: m, x });
    }
    // Why the crystal looks as it does.
    const spec = init.crystal, w = spec.why;
    const carve = spec.spike > 0.8 ? '长刺' : spec.spike > 0 ? '短刺' : spec.ops.includes('g') ? '扭转' : spec.ops.includes('a') ? '圆润' : '截角';
    this.crystal = new Crystal(spec, palette, init.cover);
    mk('notation', `${this.crystal.label} · ${this.crystal.triangles} △`, 'bold', 0.05);
    this.notes = [
      `速度 ${w.bpm} → ${SEED[spec.seed]}`,
      `鼓 ${w.drums}/秒 → ${carve}`,
      `人声 ${Math.round(w.sung * 100)}% → ${spec.stretch > 1.3 ? '修长' : spec.stretch > 1.1 ? '略长' : '矮胖'}`,
    ].map((s, i) => mk('note' + i, s, 'bold', 0.048));
    this.scene.add(this.crystal.group, this.lines.mesh);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const { paper, signal } = palette;
    const a = music.a, info = music.at(t), beat = 60 / Math.max(40, info.bpm);
    const b0 = music.beatPos(shot.start), N = Math.max(4, music.beatPos(shot.end) - b0), pos = music.beatPos(t) - b0;
    /** Seconds since step k (0–7) began. */
    const at = (k: number) => (pos - (k * N) / 8) * beat;
    const L = this.lines;
    L.clear();
    const x0 = -this.aspect + 0.16, x1 = this.aspect - 0.16, W = x1 - x0;
    const seg = (ax: number, ay: number, bx: number, by: number, w: number, c: THREE.Color, k: number) => {
      if (k > 0.004) L.seg(ax, ay, 0, bx, by, 0, w, c.r * k, c.g * k, c.b * k);
    };
    const show = (m: Mesh, x: number, y: number, alpha: number, color: THREE.Color, k = 1) => {
      m.visible = alpha > 0.01;
      m.position.set(x, y, 0);
      m.material.color.copy(color).multiplyScalar(k);
      m.material.opacity = Math.min(1, alpha);
    };
    const T = this.t;

    // The grid: twelve faint columns and a rule under the system line, wiping on with the first step.
    const g0 = outExpo(clamp01((at(0) + 0.1) / (beat * 0.4)));
    for (let c = 0; c <= 12; c++) {
      const x = x0 + (c / 12) * W;
      seg(x, 0.7, x, 0.7 - 1.44 * g0, 0.8, paper, 0.08);
    }
    seg(x0, 0.66, x0 + W * g0, 0.66, 1, paper, 0.3);
    show(T.system, x0, 0.72, g0, paper, 0.7);

    // 1 — the timeline.
    const s1 = outExpo(clamp01(at(0) / (beat * 0.5)));
    seg(x0, LINE_Y, x0 + W * s1, LINE_Y, 1.2, paper, 0.8);
    show(T.t0, x0, -0.86, s1, paper, 0.55);
    show(T.t1, x1 - (T.t1.userData.width as number), -0.86, s1, paper, 0.55);

    // 2 — the loudness, drawn left to right over a beat.
    const s2 = clamp01(at(1) / beat), drawn = Math.floor(s2 * (POINTS - 1));
    for (let i = 0; i < drawn; i++) {
      const xa = x0 + (i / (POINTS - 1)) * W, xb = x0 + ((i + 1) / (POINTS - 1)) * W;
      seg(xa, LINE_Y + this.env[i] * ENV_H, xb, LINE_Y + this.env[i + 1] * ENV_H, 1, paper, 0.75);
      // A faint hatch under the curve gives it body.
      if (i % 2 === 0) seg(xa, LINE_Y, xa, LINE_Y + this.env[i] * ENV_H, 1, paper, 0.1);
    }
    if (drawn > 0 && s2 < 1) { const xh = x0 + (drawn / (POINTS - 1)) * W; seg(xh, LINE_Y, xh, LINE_Y + ENV_H * 1.1, 1.2, signal, 1.4); }

    // 3 — the sections: a tick at each boundary, one after another through the beat; the loud ones underlined.
    const n = a.sections.length;
    a.sections.forEach((s, i) => {
      const k = clamp01((at(2) - (i / n) * beat * 0.8) / 0.08);
      const lab = this.sectionLabels[i];
      if (k <= 0) { lab.mesh.visible = false; return; }
      const xa = x0 + (s.start / a.duration) * W, xb = x0 + (s.end / a.duration) * W;
      seg(xa, LINE_Y + 0.02, xa, LINE_Y - 0.05 * k, 1, paper, 0.6);
      const loud = s.label === 'chorus' || s.label === 'drop';
      if (loud) seg(xa + 0.004, LINE_Y - 0.025, xa + (xb - xa - 0.008) * k, LINE_Y - 0.025, 4, signal, 1.3);
      const lw = lab.mesh.userData.width as number;
      if (xb - xa > lw + 0.03) show(lab.mesh, x0 + lab.x * W - lw / 2, -0.735, k, loud ? signal : paper, loud ? 1.2 : 0.55);
      else lab.mesh.visible = false;
    });
    // The playhead: where the song is now (just past the start), flashing on the kicks.
    if (at(2) > 0) {
      const xp = x0 + (t / a.duration) * W, kick = music.pulse('kick', t, 0.12);
      seg(xp, LINE_Y - 0.05, xp, LINE_Y + ENV_H * 1.15, 1.4, signal, (1 + 1.5 * kick) * clamp01(at(2) / 0.2));
    }

    // 4 — the tempo, digit by digit like neon, the facts under it, and the bar's beats as squares.
    let dx = x0;
    this.digits.forEach((m, i) => {
      const lit = neon(at(3) - i * 0.07);
      show(m, dx, 0.02, Math.min(1, lit), paper, Math.max(0.3, lit));
      dx += m.userData.width as number;
    });
    const s4 = clamp01(at(3) / 0.2);
    show(T.bpmUnit, dx + 0.03, -0.07, s4, signal, 1.2);
    show(T.facts, x0, -0.23, clamp01((at(3) - 0.15) / 0.2), paper, 0.7);
    if (at(3) > 0) {
      const inBar = Math.floor(info.inBar) % a.meter;
      for (let q = 0; q < a.meter; q++) {
        const x = x0 + q * 0.07, y = -0.32, on = q === inBar;
        seg(x, y, x + 0.04, y, on ? 16 : 1, on ? signal : paper, on ? 1.3 : 0.5);
      }
    }

    // 5 — the crystal gathers, then turns; its notation under it.
    const cx = 0.3 * this.aspect, cy = 0.22, r = 0.3;
    const s5 = at(4);
    const cr = this.crystal;
    cr.group.position.set(cx, cy, 0);
    cr.group.scale.setScalar(r);
    cr.set({ turn: t * 0.5 + 3 * Math.pow(1 - clamp01(s5 / (beat * 0.9)), 2), tilt: 0.35, flash: music.pulse('kick', t, 0.1), burst: 2.2 * Math.pow(1 - smooth(s5 / (beat * 0.9)), 2), alpha: s5 > 0 ? clamp01(s5 / 0.25) : 0 });
    cr.group.updateMatrixWorld();
    if (s5 > 0) cr.lines(L, 1.2, 1);
    show(T.notation, cx - (T.notation.userData.width as number) / 2, cy - r - 0.1, clamp01((s5 - beat * 0.6) / 0.2), paper, 0.85);

    // 6 — why: leader lines out from the crystal's right, then the note on each.
    this.notes.forEach((m, i) => {
      const k = at(5) - i * beat * 0.18, y = cy + 0.12 - i * 0.12;
      const lead = outExpo(clamp01(k / 0.15)), xa = cx + r + 0.04, xb = xa + 0.14;
      seg(xa, y, xa + (xb - xa) * lead, y, 1, signal, 1.2);
      show(m, xb + 0.03 + (1 - outExpo(clamp01((k - 0.1) / 0.2))) * 0.05, y, clamp01((k - 0.1) / 0.2), paper, 0.85);
    });

    // 7 — the title, slammed in over the artists.
    const s7 = at(6), tk = outExpo(clamp01(s7 / 0.18));
    const tw = T.title.userData.width as number, maxW = cx - r - 0.12 - x0, fit = Math.min(1, maxW / tw);
    T.title.scale.setScalar(fit * (1 + 0.12 * (1 - tk)));
    show(T.title, x0, 0.5, s7 > 0 ? tk : 0, paper);
    const aw = T.artists.userData.width as number;
    T.artists.scale.setScalar(Math.min(1, maxW / aw));
    show(T.artists, x0, 0.36, clamp01((s7 - 0.12) / 0.2), paper, 0.75);

    L.commit(this.resolution, this.pixelRatio);
    // 8 — the hold: the picture leans in a touch before the cut carries on through it.
    const hold = smooth(at(7) / (beat * (N / 8)));
    this.camera.position.set(0, 0, DIST * (1 - 0.03 * hold));
    this.camera.updateMatrixWorld();
    ctx.fx.bloom = 0.3;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.04;
  }
}
