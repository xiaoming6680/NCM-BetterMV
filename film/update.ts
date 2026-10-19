// BetterMV 0.10 的更新片（docs/FILM.md“更新片”），竖屏。The user: “做一个更新性质的宣传片，展示这次更新的 4 个场景，
// 着重展示叠字，用这首歌（world.execute (me) ;），但是也要说明插件的亮点（如有很多场景）”, then “做成竖屏的”, and
// “开头加一个钩子：接下来的画面，都是网易云自己生成的”. One song played straight through, the plugin's real player on a
// portrait stage (its own portrait framing), the film's plates carved into the song's plan bar by bar:
//   the armillary's run-in out of focus under the opening line; on the drop, a plate a bar under three of the plugin's
//   designs; the stutter of single words: 叠字, eight bars; the last chorus: 黑洞, 条纹方块, 点阵, four bars each;
//   叠字 again; the name over it.
// Every frame is a pure function of film time t (window.PROMO.renderAt), so film/render.ts --update can shoot it.
//   /film/update.html · ?t=20 preview from 20 s · ?render (the clock is film/render.ts's)
import { loadFonts } from '../src/render/text.ts';
import { styleFor } from '../src/app/prepare.ts';
import { MvPlayer } from '../src/app/player.ts';
import { carve } from '../src/director/director.ts';
import type { Music } from '../src/director/music.ts';
import { inOutCubic, smooth, type SceneId, type Shot } from '../src/scenes/types.ts';
import { appear, downbeat, draw, esc, fit, html, k, loadSong, nearest, show, tick, watchContexts, type AudioPart, type Sfx } from './shared.ts';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render');
const frame = document.getElementById('frame') as HTMLDivElement;
const W = 720, H = 1280;

/** world.execute (me) ; - Mili. */
const SONG = 435278010;
/** The plugin's draw of plates and cameras where the film leaves it the plan (the drop's push tunnel, the run-in). */
const SEED = 1;
/** The film starts this many bars before the song's first drop (the armillary's run-in). */
const LEAD_BARS = 2;
/** Plates over the bars from the film's start, in order (`plan`: the plugin's own plan there). */
type Plate = [scene: SceneId | 'plan', variant: string, bars: number];
const PLATES: Plate[] = [
  ['plan', '', 2],
  // The drop (instrumental): the push tunnel, then a plate a bar.
  ['drive', 'push', 2], ['channel', 'axis', 1], ['kaleido', 'petal', 1], ['city', 'canyon', 1], ['orb', 'orbit', 1], ['menger', 'glide', 0.75],
  // The stutter: one word sung over and over, faster at the end. In a beat early: the plugin keeps the frame at the
  // stutter's first word for its flashbacks, and on the downbeat that frame was still the sponge's, blurred blue over
  // the words for the whole stretch; a beat early it is the words' own.
  ['kinetic', 'flat', 4.25], ['kinetic', 'tilt', 4],
  // The last chorus.
  ['blackhole', 'edge', 4], ['cubes', 'flow', 4], ['dots', 'flat', 4],
  ['kinetic', 'flat', 4],
];
/** Words over the film: from `at` bars after its start, for `bars` bars. `kicker`: the small line above. */
interface Caption { kicker?: string; title: string; line?: string; at: number; bars: number; small?: boolean }
const CAPTIONS: Caption[] = [
  { title: '先读懂整首歌', line: '速度、段落和高潮，再编排每一个镜头', at: 2, bars: 2.5, small: true },
  { title: '39 个场景', line: '颜色都取自这首歌的封面', at: 4.5, bars: 2.5, small: true },
  { title: '每次播放都不一样', line: '场景、镜头和画风重新编排', at: 7, bars: 1.75, small: true },
  { kicker: '0.10 新场景', title: '叠字', line: '唱到的词放大、重复叠起，随鼓点错位滑动', at: 9, bars: 3 },
  { kicker: '0.10 新场景', title: '黑洞', line: '吸积盘由声音点亮，底鼓是一圈光波', at: 17, bars: 2.5 },
  { kicker: '0.10 新场景', title: '条纹方块', line: '成千方块涌来，随各频段的响度胀缩', at: 21, bars: 2.5 },
  { kicker: '0.10 新场景', title: '点阵', line: 'LED 点阵屏，每小节换一个构图', at: 25, bars: 2.5 },
];
/** The opening line until the drop (LEAD_BARS), when the picture snaps into focus. */
const HOOK = ['接下来的画面', '都是网易云<span class="g">实时生成</span>的'];
/** The name: over the last bars of the film (the picture going dark under it). */
const NAME_BARS = 2;
/** After the last bar: the song rings on into black. */
const TAIL = 1.2;

async function main(): Promise<void> {
  const status = html(frame, 'note', '加载中…');
  await loadFonts('/fonts/');
  await document.fonts.load('900 64px PF');
  await document.fonts.load('600 40px PF');
  await document.fonts.load('500 20px PF');

  status.textContent = '分析歌曲…';
  const song = await loadSong(SONG);
  const a = song.prepared.analysis;
  const drop = a.sections.find(s => s.label === 'drop') ?? a.sections[0];
  /** Song time of the film's start, and of `bars` bars after it (whole bars on the downbeats, the rest on the beats). */
  const s0 = downbeat(a.downbeats, drop.start, -LEAD_BARS);
  const at = (bars: number) => {
    const whole = Math.floor(bars + 1e-6), d = downbeat(a.downbeats, s0, whole), n = Math.round((bars - whole) * a.meter);
    return n ? a.beats[nearest(a.beats, d) + n] ?? d + (n * 60) / a.bpm : d;
  };
  const total = PLATES.reduce((n, p) => n + p[2], 0);
  const sEnd = at(total);

  // ---------- the plates carved into the song's plan ----------
  const carves: Array<{ scene: SceneId; variant: string; from: number; to: number }> = [];
  {
    let b = 0;
    for (const [scene, variant, bars] of PLATES) {
      if (scene !== 'plan') carves.push({ scene, variant, from: at(b), to: at(b + bars) });
      b += bars;
    }
  }
  const retake = (shots: Shot[], music: Music): Shot[] => {
    for (const c of carves) {
      // (The section the shot's middle is in: by its start, a shot on a section's downbeat can fall in the one before.)
      const mid = (c.from + c.to) / 2, si = Math.max(0, music.a.sections.findIndex(s => mid >= s.start && mid < s.end));
      carve(shots, music, c.scene, c.from, c.to, si, c.variant, SEED);
    }
    // Only the plates the film shows are built: a shot it never shows takes the plate of one it does.
    const shown = (s: { start: number; end: number }) => s.start < sEnd + 1 && s.end > s0 - 3;
    const stand = shots.find(shown);
    if (stand) for (const s of shots) if (!shown(s)) { s.scene = stand.scene; s.variant = stand.variant; s.run = undefined; s.look = undefined; }
    return shots;
  };

  // ---------- the player, on a portrait stage ----------
  const stage = html(frame, 'stage');
  const player = new MvPlayer(stage, 1.5);
  // (No looks of the plugin's own drawing: the film shows the scenes as they are.)
  player.load(song.prepared, styleFor(song.prepared, 'auto'), new Set(), undefined, 'none', 0, SEED, retake);
  const p = { stage, player, lastDraw: -1e9, size: undefined as string | undefined };

  // ---------- film time ----------
  const T = (bars: number) => at(bars) - s0;
  const dropAt = T(LEAD_BARS), nameAt = T(total - NAME_BARS), lastBar = T(total), END = lastBar + TAIL;

  // The opening line.
  const hook = html(frame, 'hook');
  const w1 = html(hook, 'w1', HOOK[0]), w2 = html(hook, 'w2', HOOK[1]);
  const beat = 60 / Math.max(40, a.bpm);
  // (The first line is there on the first frame: it is the frame a feed shows before anything plays.)
  const w1At = -1, w2At = 2 * beat - 0.1, hookOut = dropAt - 0.22;

  // The words over the parts.
  frame.style.setProperty('--accent', song.prepared.palette.css.accent);
  const shade = html(frame, 'ushade');
  const caps = CAPTIONS.map(c => {
    const e = html(frame, `ucap${c.small ? ' small' : ''}`,
      `${c.kicker ? `<div class="k">${esc(c.kicker)}</div>` : ''}<div class="t">${esc(c.title)}</div>${c.line ? `<div class="l">${esc(c.line)}</div>` : ''}`);
    show(e, false);
    return { e, t0: T(c.at) + 0.08, t1: T(c.at + c.bars) - 0.25 };
  });

  // The name.
  const endName = html(frame, 'endname', '<img src="/film/logo.svg" alt=""><span>BetterMV</span>');
  const endLine = html(frame, 'endline', '网易云音乐插件');
  const endRepo = html(frame, 'endrepo', 'github.com/xiaoming6680/NCM-BetterMV');
  const fade = html(frame, 'fade');

  status.textContent = '准备画面…';
  fit(p, W, H);
  await player.warm(tick);
  const lost = watchContexts([player]);
  status.remove();

  // ---------- sound: the song straight through, ringing on into black ----------
  const audio: AudioPart[] = [{ id: SONG, from: s0, T0: 0, T1: END, fadeIn: 0.02, fadeOut: TAIL + 0.6, level: -13 }];
  const sfx: Sfx[] = [];

  function renderAt(t: number): void {
    draw(p, s0 + t);
    player.hud.visible = t >= dropAt + 0.25 && t < nameAt;
    // Under the line: out of focus and dark, up out of black; on the drop, into focus at once. Under the name: dark
    // and soft again.
    let filter = '', tf = '';
    if (t < dropAt + 0.2) {
      const g = 1 - smooth(k(t, dropAt - 0.04, dropAt + 0.16));
      filter = g > 0.001 ? `blur(${14 * g}px) brightness(${1 - 0.4 * g})` : '';
      const f = 1 + 0.06 * g;
      tf = `translate(${(W * (1 - f)) / 2}px,${(H * (1 - f)) / 2}px) scale(${f})`;
    } else if (t >= nameAt - 0.1) {
      const g = inOutCubic(k(t, nameAt - 0.1, nameAt + 0.7));
      filter = `blur(${12 * g}px) brightness(${1 - 0.62 * g})`;
      const f = 1 + 0.04 * g;
      tf = `translate(${(W * (1 - f)) / 2}px,${(H * (1 - f)) / 2}px) scale(${f})`;
    }
    stage.style.filter = filter;
    stage.style.transform = tf;

    // The opening line.
    const hOn = t < hookOut + 0.3;
    show(hook, hOn);
    if (hOn) { appear(w1, t, w1At, hookOut); appear(w2, t, w2At, hookOut); }

    // The words over the parts, and the shade under them.
    let shadeOn = 0;
    for (const c of caps) {
      appear(c.e, t, c.t0, c.t1);
      shadeOn = Math.max(shadeOn, smooth(k(t, c.t0 - 0.2, c.t0 + 0.4)) * (1 - smooth(k(t, c.t1, c.t1 + 0.4))));
    }
    show(shade, shadeOn > 0.001);
    shade.style.opacity = String(shadeOn);

    // The name, then black.
    const n = inOutCubic(k(t, nameAt + 0.1, nameAt + 0.9));
    show(endName, n > 0.001);
    show(endLine, n > 0.001);
    endName.style.opacity = String(n);
    endName.style.transform = `translateY(${(1 - n) * 10}px) scale(${0.985 + 0.015 * n})`;
    const l = inOutCubic(k(t, nameAt + 0.35, nameAt + 1.1));
    endLine.style.opacity = String(l * 0.66);
    endLine.style.transform = `translateY(${(1 - l) * 8}px)`;
    const rp = inOutCubic(k(t, nameAt + 0.7, nameAt + 1.45));
    show(endRepo, rp > 0.001);
    endRepo.style.opacity = String(rp * 0.52);
    endRepo.style.transform = `translateY(${(1 - rp) * 8}px)`;
    fade.style.opacity = String(inOutCubic(k(t, END - 0.8, END)));
  }

  Object.assign((window as any).PROMO, {
    duration: END, fps: 60, size: [W, H], audio, sfx,
    marks: Object.fromEntries([
      ['drop', dropAt], ...CAPTIONS.map((c, i) => [c.title, caps[i].t0]), ['name', nameAt], ['end', END],
    ]),
    renderAt: (t: number) => new Promise<void>(r => { renderAt(t); requestAnimationFrame(() => r()); }),
    lost,
    players: [player],
  });

  if (!RENDER) {
    let start = performance.now() - Number(q.get('t') ?? 0) * 1000;
    const loop = () => { renderAt(((performance.now() - start) / 1000) % END); requestAnimationFrame(loop); };
    window.addEventListener('keydown', e => { if (e.code === 'KeyR') start = performance.now(); });
    requestAnimationFrame(loop);
  }
}

const ready = main().catch(e => {
  console.error(e);
  html(frame, 'note', '出错：' + (e?.message ?? e)).style.color = '#f66';
  throw e;
});
(window as any).PROMO = { ready };
