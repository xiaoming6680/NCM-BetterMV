// Dev harness: plays a song from the NetEase cache (?id=, default Clarity) with its lyrics and renders the MV.
// ?style=pulse|ballad|word|ink overrides the automatic choice · ?analysis=reference uses the hand-made Clarity analysis
// ?t= start time · ?debug shows section / camera / tempo · ?plate=<scene>&variants=a,b puts every shot on one plate ·
// ?off=drive,tunnel turns plates off as the settings page does · ?demo keeps the song's timing but shows an original
// cover and made-up words (for the settings page's scene sketches, tools/render-previews.ts).
// Keys: Space play/pause · ←/→ ±5 s · S back to the sample start · H hide the UI · D debug line · click the bar to seek.
import { loadFonts } from '../render/text.ts';
import { parseWiki } from '../meta/wiki.ts';
import { prepareSong, styleFor } from '../app/prepare.ts';
import { MvPlayer } from '../app/player.ts';
import type { StyleId } from '../style/style.ts';
import type { SceneId } from '../scenes/types.ts';
import { fromReference } from './reference.ts';

const CLARITY = 3359522924;
const params = new URLSearchParams(location.search);
const songId = Number(params.get('id') || CLARITY);
const stage = document.getElementById('stage')!;

function overlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;' +
    'font:500 15px/1.6 "Noto Sans SC","Microsoft YaHei UI",sans-serif;color:#eee9df;background:rgba(10,10,11,.72);z-index:5;cursor:pointer;letter-spacing:.04em;text-align:center';
  document.body.appendChild(el);
  return el;
}

// onload rather than img.decode(): decode() never settles while the page is hidden.
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const nextTick = () => new Promise<void>(r => setTimeout(r, 0));

const demo = params.has('demo');
const DEMO_LINES = ['光从山的背面升起', '我们沿着隧道一直跑', '每一拍都是新的开始', '把夜色折成三角形', '远处的声音亮起来', '别停下 跟着节拍走', '世界在这一刻展开', '听见心跳的回声', '风把星星吹成线', '直到天亮也不回头'];
/** The song's lyric timing with the demo lines in place of its words (a line sung again gets the same demo line). */
function demoLyric(doc: any): any {
  const names = new Map<string, string>();
  const lrc = String(doc?.lrc?.lyric ?? '').split('\n').map(line => {
    const m = line.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/);
    const text = m?.[2].trim();
    if (!m || !text || /[:：]/.test(text)) return '';
    if (!names.has(text)) names.set(text, DEMO_LINES[names.size % DEMO_LINES.length]);
    return m[1] + names.get(text);
  }).filter(Boolean).join('\n');
  return { code: 200, lrc: { lyric: lrc } };
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

async function main() {
  const cover = overlay();
  cover.textContent = '加载中…';
  const [, detail, wikiDoc, lyricDoc, audioBuf, img] = await Promise.all([
    loadFonts('/fonts/'),
    fetch(`/ncm/detail/${songId}`).then(r => r.json()),
    fetch(`/ncm/wiki/${songId}`).then(r => r.json()).catch(() => null),
    fetch(`/ncm/lyric/${songId}`).then(r => r.json()),
    fetch(`/ncm/audio/${songId}`).then(r => { if (!r.ok) throw new Error('这首歌不在网易云缓存里（先在网易云里完整播放一遍）'); return r.arrayBuffer(); }),
    loadImage(demo ? '/tools/previews/demo-cover.jpg' : `/ncm/cover/${songId}`),
  ]);
  const audio = new Audio(URL.createObjectURL(new Blob([audioBuf])));
  audio.preload = 'auto';

  const useReference = songId === CLARITY && params.get('analysis') === 'reference';
  const song = await prepareSong(
    demo
      ? { id: songId, name: '示例', artists: ['BetterMV'], audio: audioBuf, lyric: demoLyric(lyricDoc), wiki: wikiDoc ? parseWiki(wikiDoc) : undefined, cover: img }
      : { id: songId, name: detail?.name, artists: detail?.artists, audio: audioBuf, lyric: lyricDoc, wiki: wikiDoc ? parseWiki(wikiDoc) : undefined, cover: img },
    {
      pause: nextTick,
      onProgress: (stage, p) => { cover.textContent = stage === 'decode' ? '解码中…' : '分析中… ' + Math.round(p * 100) + '%'; },
      analysis: useReference ? async lines => fromReference(await fetch('/reference/audio.json').then(r => r.json()), lines) : undefined,
    },
  );
  const style = styleFor(song, (params.get('style') as StyleId) || 'auto');
  const player = new MvPlayer(stage);
  // ?plate=ridges&variants=front,low: every shot on one plate (for reviewing a plate).
  const plate = params.get('plate') as SceneId | null;
  const off = new Set((params.get('off') || '').split(',').filter(Boolean) as SceneId[]);
  player.load(song, style, off, plate ? { scene: plate, variants: (params.get('variants') || 'front').split(',') } : undefined);
  cover.textContent = '准备画面…';
  await player.warm(nextTick);
  window.addEventListener('resize', () => player.resize());
  const { analysis, duration, palette, choice, wiki } = song;

  // Default start: Clarity's build, otherwise twelve seconds before the first chorus.
  const firstChorus = analysis.sections.find(s => s.label === 'chorus' || s.label === 'drop');
  const sampleAt = Number(params.get('t') ?? (songId === CLARITY ? 137 : Math.max(0, (firstChorus?.start ?? 12) - 12)));

  // UI: section bar with playhead, debug line.
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:24px;right:24px;bottom:18px;height:22px;z-index:4;cursor:pointer';
  const colors: Record<string, string> = { chorus: palette.css.signal, drop: palette.css.signal, build: palette.css.accent, pre: palette.css.accent };
  for (const s of analysis.sections) {
    const b = document.createElement('div');
    b.title = s.label;
    b.style.cssText = `position:absolute;top:9px;height:4px;left:${(s.start / duration) * 100}%;width:calc(${((s.end - s.start) / duration) * 100}% - 2px);` +
      `background:${colors[s.label] ?? '#eee9df'};opacity:${0.25 + s.energy * 0.6}`;
    ui.appendChild(b);
  }
  const head = document.createElement('div');
  head.style.cssText = 'position:absolute;top:2px;width:2px;height:18px;background:#fff';
  ui.appendChild(head);
  document.body.appendChild(ui);
  ui.addEventListener('click', e => { audio.currentTime = ((e.clientX - ui.getBoundingClientRect().left) / ui.clientWidth) * duration; });
  const debug = document.createElement('div');
  debug.style.cssText = 'position:fixed;left:24px;top:18px;z-index:4;font:12px/1.5 Consolas,monospace;color:#eee9df;opacity:.7;white-space:pre';
  document.body.appendChild(debug);
  let showUi = true, showDebug = params.has('debug');

  audio.currentTime = sampleAt;
  const title = `《${song.name ?? songId}》 ${song.artists?.join(' / ') ?? ''}`;
  cover.innerHTML = `<div style="font-size:22px;font-weight:700">点击播放</div>` +
    `<div style="opacity:.8">${title}</div>` +
    `<div style="opacity:.7">风格：${style.name}${params.get('style') ? '（手动指定）' : `（自动：${choice.reason}）`} · 从 ${fmt(sampleAt)} 开始</div>` +
    `<div style="opacity:.55;font-size:12px">空格暂停 · ←/→ 快进快退 · S 回到开头 · H 隐藏界面 · D 调试信息</div>` +
    `<div style="opacity:.45;font-size:12px">分析：${useReference ? 'Clarity 项目的手工分析（对照用）' : '插件自动分析'} · ${song.ms} ms · ${Math.round(analysis.bpm)} BPM（百科 ${wiki?.bpm ?? '—'}）· 鼓 ${choice.features.drumsPerSecond}/s</div>` +
    `<div style="opacity:.45;font-size:12px">百科：${wiki ? [...wiki.genres, ...wiki.tags].join(' · ') || '无标签' : '—'}</div>`;
  cover.onclick = () => { cover.remove(); audio.play(); };
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
    else if (e.code === 'ArrowRight') audio.currentTime = Math.min(duration, audio.currentTime + 5);
    else if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    else if (e.code === 'KeyS') { audio.currentTime = sampleAt; audio.play(); }
    else if (e.code === 'KeyH') { showUi = !showUi; ui.style.display = showUi ? '' : 'none'; }
    else if (e.code === 'KeyD') showDebug = !showDebug;
  });

  const barAt = (t: number) => { const d = analysis.downbeats; let i = 0; while (i + 1 < d.length && d[i + 1] <= t) i++; return i + 1; };
  let last = performance.now(), frames = 0, fps = 0, fpsAt = last;
  let held: number | null = null;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = held ?? audio.currentTime;
    const shot = player.frame(t, dt);
    head.style.left = (t / duration) * 100 + '%';
    frames++;
    if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; }
    debug.textContent = showDebug && shot
      ? `${fmt(t)}  ${style.name}  ${shot.section.label}(${shot.section.energy.toFixed(2)})  ${shot.scene}/${shot.variant}  bar ${barAt(t)}  ${fps} fps` : '';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // For checking frames without playback (the render loop pauses while the page is hidden).
  const renderAt = (t: number) => player.frame(t, 1 / 60);
  // hold(t): keep showing time t (the loop would otherwise follow the audio); hold(null) releases.
  const hold = (t: number | null) => { held = t; if (t != null) renderAt(t); };
  const shotAt = (t: number) => player.shots.find(s => t >= s.start && t < s.end);
  // Stills for review: snap(t, name) renders time t (after 24 frames of run-up, so trails and eases settle) and saves
  // it to dev/stills/<name>.png; sheet(prefix, times) does a series; label(times) says what is on screen at each.
  const snap = async (t: number, name: string, w = 960) => {
    audio.pause();
    for (let i = 24; i >= 1; i--) renderAt(t - i / 60);
    hold(t);
    const src = player.engine.renderer.domElement, c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((w * src.height) / src.width);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
    await fetch(`/stills/${name}.png`, { method: 'POST', body: blob });
    return name;
  };
  const sheet = async (prefix: string, times: number[]) => {
    for (const [i, t] of times.entries()) await snap(t, `${prefix}-${String(i).padStart(2, '0')}`);
    return times.length;
  };
  const label = (times: number[]) => times.map(t => { const s = shotAt(t); return s ? `${t} ${s.section.label} ${s.scene}/${s.variant}` : `${t} end`; });
  // Frame cost of each plate: 40 frames inside its first shot, synced by a one-pixel readback.
  const perf = () => {
    const gl = player.engine.renderer.getContext(), px = new Uint8Array(4), out: Record<string, number> = {};
    for (const s of player.shots) {
      if (s.scene in out || s.end - s.start < 1.5) continue;
      for (let i = 0; i < 5; i++) renderAt(s.start + 0.3 + i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) renderAt(s.start + 0.4 + i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out[s.scene] = +((performance.now() - t0) / 40).toFixed(1);
    }
    return out;
  };
  (window as any).bmv = {
    audio, song, analysis, player, palette, renderAt, hold, style, choice, lines: song.lines, wiki,
    shotAt, snap, sheet, label, perf,
  };
}

main().catch(e => {
  console.error(e);
  const el = overlay();
  el.textContent = '出错：' + (e && e.message ? e.message : e);
});
