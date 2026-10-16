// Prints a bench result file (tools/bench/run.ts) as a Markdown table.
//   bun tools/bench/table.ts dev/bench/scenes-1.json
import fs from 'node:fs';
import { SCENE_GROUPS } from '../../src/scenes/catalog.ts';

const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const names = new Map<string, string>(SCENE_GROUPS.flatMap(g => g.scenes.map(s => [s.id, s.name] as [string, string])));
const STYLE: Record<string, string> = { pulse: '律动', ballad: '抒情', word: '字', ink: '墨' };
const rows = (data.results as any[]).filter(Boolean);
const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d));

if (data.suite === 'scenes') {
  // One row per plate: post on, then off (lens + finish), side by side.
  const by = new Map<string, any[]>();
  for (const r of rows) by.set(r.scene, [...(by.get(r.scene) ?? []), r]);
  console.log('| 场景 | 风格 | GPU 中位 / p95（ms） | 关后处理 GPU 中位 | CPU 中位 / p95（ms） | 帧率 | 帧间隔 p95 / 最长（ms） | 网易云 CPU（单核 %） | GPU 3D 占用 | 其他进程 3D |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [scene, rs] of by) {
    const on = rs.find(r => r.lens === 1 && r.film === 1), off = rs.find(r => r.lens === 0);
    if (!on) continue;
    console.log(`| ${names.get(scene) ?? scene} | ${STYLE[on.style] ?? on.style} | ${f(on.gpu.p50, 2)} / ${f(on.gpu.p95)} | ${f(off?.gpu.p50, 2)} | ${f(on.cpu.p50)} / ${f(on.cpu.p95)} | ${f(on.fps, 0)} | ${f(on.gap.p95)} / ${f(on.gap.max, 0)} | ${f(on.load?.ncmCpu, 0)} | ${f(on.load?.gpu3d, 0)}% | ${f(on.load?.others3d, 0)}% |`);
  }
} else if (data.suite === 'passes') {
  const keys = ['keepUp', 'shots', 'lens', 'memory', 'echo', 'words', 'bloom', 'grade', 'finish', 'look', 'other'];
  const used = keys.filter(k => rows.some(r => r.passes?.[k]));
  console.log(`| 场景 | 合计 | ${used.join(' | ')} |`);
  console.log(`|---|---|${used.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${names.get(r.scene) ?? r.scene} | ${f(r.gpu.p50, 2)} | ${used.map(k => f(r.passes?.[k], 2)).join(' | ')} |`);
} else {
  console.log('| 场景 | 风格 | 画风 | 画布 | 上限 | 镜头 / 后期 / 泛光 | GPU 中位 / p95（ms） | CPU 中位 / p95 | 帧率 | 帧间隔 p95 / 最长 | 网易云 CPU | GPU 3D | 其他 3D | 显存（MB） |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.label ?? names.get(r.scene) ?? r.scene} | ${STYLE[r.style] ?? r.style ?? ''} | ${r.look ?? ''} | ${r.canvas?.join('×') ?? ''} | ${r.cap || '不限'} | ${r.lens ?? ''}/${r.film ?? ''}/${r.bloom === false ? 0 : 1} | ${f(r.gpu.p50, 2)} / ${f(r.gpu.p95)} | ${f(r.cpu.p50)} / ${f(r.cpu.p95)} | ${f(r.fps, 0)} | ${f(r.gap.p95)} / ${f(r.gap.max, 0)} | ${f(r.load?.ncmCpu, 0)} | ${f(r.load?.gpu3d, 0)}% | ${f(r.load?.others3d, 0)}% | ${r.load?.gpuMemMB ?? '–'} |`);
  }
}
