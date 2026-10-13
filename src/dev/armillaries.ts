// Dev page: the armillary of each of a list of songs, side by side (?ids=a,b,… or the evaluation set), to judge that
// every song gets its own figure and that all of them look good. Saves the sheet to dev/stills/armillaries.png.
import * as THREE from 'three';
import { parseWiki } from '../meta/wiki.ts';
import { prepareSong } from '../app/prepare.ts';
import { LineBatch } from '../render/lines.ts';
import { Armillary, armillarySpec } from '../sigil/armillary.ts';

const EVAL = [3359522924, 2068401809, 2142927883, 565841089, 1417849873, 1874585362, 18969069, 1836011652, 3364903300, 31877908, 3325660944, 1294951288];
const params = new URLSearchParams(location.search);
const ids = params.get('ids') ? params.get('ids')!.split(',').map(Number) : EVAL;
const status = document.getElementById('status')!;
const CELL = 360, COLS = 4;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
}

async function main() {
  const rows = Math.ceil(ids.length / COLS);
  const sheet = document.createElement('canvas');
  sheet.width = CELL * COLS; sheet.height = (CELL + 70) * rows;
  document.body.appendChild(sheet);
  const g = sheet.getContext('2d')!;
  g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(CELL, CELL, false);
  const out: unknown[] = [];
  for (const [n, id] of ids.entries()) {
    status.textContent = `分析 ${n + 1}/${ids.length}…`;
    try {
      const [detail, wikiDoc, lyricDoc, audio, img] = await Promise.all([
        fetch(`/ncm/detail/${id}`).then(r => r.json()),
        fetch(`/ncm/wiki/${id}`).then(r => r.json()).catch(() => null),
        fetch(`/ncm/lyric/${id}`).then(r => r.json()).catch(() => null),
        fetch(`/ncm/audio/${id}`).then(r => r.arrayBuffer()),
        loadImage(`/ncm/cover/${id}`),
      ]);
      const song = await prepareSong({ id, name: detail?.name, artists: detail?.artists, audio, lyric: lyricDoc, wiki: wikiDoc ? parseWiki(wikiDoc) : undefined, cover: img }, { pause: () => new Promise(r => setTimeout(r, 0)) });
      const spec = armillarySpec(song.analysis, id);
      const arm = new Armillary(spec, song.palette, song.cover, song.name);
      const scene = new THREE.Scene();
      scene.background = song.palette.ink.clone();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
      camera.position.set(0, 0, 3.4);
      const lines = new LineBatch(8000);
      scene.add(arm.group, lines.mesh);
      arm.set({ turn: 0.7, beat: 0, bar: 0, whirl: 0, open: 1, align: 0, recede: 0, merge: 0, pulse: 0, alpha: 1 });
      lines.clear();
      arm.lines(lines, 1.3, 1.1, camera.position);
      lines.commit(new THREE.Vector2(CELL, CELL), 1);
      renderer.render(scene, camera);
      const x = (n % COLS) * CELL, y = Math.floor(n / COLS) * (CELL + 70);
      g.drawImage(renderer.domElement, x, y);
      g.fillStyle = '#eee9df'; g.font = '15px "Microsoft YaHei UI"';
      g.fillText(`${song.name ?? id}`.slice(0, 26), x + 10, y + CELL + 20);
      g.fillStyle = '#9c978f'; g.font = '12px Consolas, monospace';
      const w = spec.why;
      g.fillText(`${arm.label}   ${w.bpm} BPM   ${w.meter}/4`, x + 10, y + CELL + 40);
      g.fillText(`段落 ${w.sections}   鼓 ${w.drums}/s`, x + 10, y + CELL + 58);
      out.push({ id, name: song.name, rings: spec.rings.length, label: arm.label, why: w });
    } catch (e) {
      out.push({ id, error: String(e) });
    }
  }
  status.textContent = '完成';
  const blob = await new Promise<Blob | null>(r => sheet.toBlob(r, 'image/png'));
  await fetch('/stills/armillaries.png', { method: 'POST', body: blob });
  (window as any).armillaries = out;
}
main();
