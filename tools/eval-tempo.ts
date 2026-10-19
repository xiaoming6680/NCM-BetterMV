// Tempo check against the BPM cited for songs of the NetEase cache (tools/truth/tempo.json):
//   bun tools/eval-tempo.ts [--song id[,id…]] [--no-hint] [--conf high|medium] [--json out.json] [--beats]
// For each song: the shown tempo (analysis.namedBpm) against the cited one — right (±4 %, or the listed alternative),
// an octave off, 3∶2 / 4∶3 off, or other — and the beat grid's tempo (analysis.bpm) octave-free, since the grid may
// follow a half-time pulse. The summary counts both, per confidence of the cited value.
// Audio: dev/eval-pcm/<id>.s16 (mono 22050 Hz, git-ignored and kept: NetEase drops songs from its cache, which is how
// eval-analysis lost most of its annotated songs); a song not there yet comes from the dev server (NCM_DEV, default
// http://localhost:5190, /ncm/audio/<id>; `bun run dev` first) through ffmpeg. The wiki BPM (/ncm/wiki/<id>, kept in
// dev/ncm-cache/ by the dev server, and in the .json beside the audio here) is the bpmHint, as in the plugin.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FFMPEG = process.env.FFMPEG || 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const NCM_DEV = process.env.NCM_DEV || 'http://localhost:5190';
const SR = 22050;
const ROOT = join(import.meta.dir, '..');
const PCM = join(ROOT, 'dev/eval-pcm');

interface Cited { id: number; song: string; bpm: number; alt?: number; confidence: 'high' | 'medium' | 'low'; source: string; note?: string }

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = opt('--song') ? new Set(opt('--song').split(',').map(Number)) : null;
const minConf = opt('--conf');
const useHint = !args.includes('--no-hint');
// --beats: with Beat This!'s beats (tools/eval-beats.ts), as the plugin with the aligner pack.
const useBeats = args.includes('--beats');
const rank = { high: 0, medium: 1, low: 2 };
const songs = (JSON.parse(readFileSync(join(ROOT, 'tools/truth/tempo.json'), 'utf8')).songs as Cited[])
  .filter(s => (!only || only.has(s.id)) && (!minConf || rank[s.confidence] <= rank[minConf as keyof typeof rank]));

/** Wiki BPM through the dev server (/ncm/wiki keeps NetEase's first good answer in dev/ncm-cache/). */
async function wikiBpm(id: number): Promise<number | undefined> {
  const res = await fetch(`${NCM_DEV}/ncm/wiki/${id}`, { signal: AbortSignal.timeout(20000) });
  let found: number | undefined;
  const walk = (o: any): void => {
    if (!o || typeof o !== 'object' || found) return;
    if (o.uiElement?.mainTitle?.title === 'BPM') {
      const v = Number(o.uiElement?.textLinks?.[0]?.text);
      if (v > 0) found = v;
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
  };
  walk(await res.json());
  return found;
}

/** Mono samples and the wiki BPM of a song, from dev/eval-pcm/ or else the dev server; a string says why not. */
async function load(id: number): Promise<{ x: Float32Array; wiki?: number } | string> {
  const pcm = join(PCM, `${id}.s16`), meta = join(PCM, `${id}.json`);
  if (!existsSync(pcm)) {
    let audio: Response;
    try { audio = await fetch(`${NCM_DEV}/ncm/audio/${id}`, { signal: AbortSignal.timeout(60000) }); } catch (e) { return `dev server not reachable (${(e as Error).message})`; }
    if (!audio.ok) return `not in NetEase's cache (dev server: ${audio.status})`;
    mkdirSync(PCM, { recursive: true });
    const src = join(PCM, `${id}.src`);
    writeFileSync(src, new Uint8Array(await audio.arrayBuffer()));
    const r = Bun.spawnSync([FFMPEG, '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', String(SR), '-f', 's16le', pcm], { stdout: 'ignore', stderr: 'pipe' });
    rmSync(src, { force: true });
    if (r.exitCode !== 0) { rmSync(pcm, { force: true }); return 'ffmpeg failed: ' + r.stderr.toString().slice(0, 200); }
  }
  let wiki: number | undefined;
  if (existsSync(meta)) wiki = JSON.parse(readFileSync(meta, 'utf8')).wikiBpm;
  else {
    try { wiki = await wikiBpm(id); writeFileSync(meta, JSON.stringify({ wikiBpm: wiki ?? null })); } catch {}
  }
  const buf = readFileSync(pcm), s = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
  const x = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) x[i] = s[i] / 32768;
  return { x, wiki: wiki ?? undefined };
}

const near = (r: number, k: number) => Math.abs(Math.log(r / k)) <= Math.log(1.04);
/** How `est` relates to the cited tempo: ok, ×2 / ×½, ×3/2-type, or other. */
function relation(est: number, c: Cited): string {
  if (near(est / c.bpm, 1) || (c.alt && near(est / c.alt, 1))) return 'ok';
  if (near(est / c.bpm, 2)) return '×2';
  if (near(est / c.bpm, 0.5)) return '×½';
  for (const [k, name] of [[1.5, '×3/2'], [2 / 3, '×2/3'], [4 / 3, '×4/3'], [0.75, '×3/4']] as const) if (near(est / c.bpm, k)) return name;
  return 'other';
}
/** The grid against the cited tempo, octave-free. */
const gridOk = (est: number, c: Cited) => [0.25, 0.5, 1, 2, 4].some(k => near(est / c.bpm, k) || (!!c.alt && near(est / c.alt, k)));

const { analyze } = await import('../src/analysis/index.ts');
const { evalBeats } = await import('./eval-beats.ts');
const { parseWiki } = await import('../src/meta/wiki.ts');
/** The wiki's genres, from the dev server's copy of the wiki (dev/ncm-cache/), as the plugin passes them. */
const genresOf = (id: number) => { try { return parseWiki(JSON.parse(readFileSync(join(ROOT, `dev/ncm-cache/wiki-${id}.json`), 'utf8'))).genres; } catch { return undefined; } };
const total: Record<string, Record<string, number>> = {};
const gridTotal: Record<string, [number, number]> = {};
const dump: unknown[] = [];
const wrong: string[] = [];
let skipped = 0;
for (const c of songs) {
  const s = await load(c.id);
  if (typeof s === 'string') { skipped++; console.log(`skip ${c.song}: ${s}`); continue; }
  const a = analyze(s.x, SR, { bpmHint: useHint ? s.wiki : undefined, genres: useHint ? genresOf(c.id) : undefined, beatThis: useBeats ? evalBeats(String(c.id)) : undefined });
  const named = a.namedBpm ?? a.bpm, rel = relation(named, c), g = gridOk(a.bpm, c);
  (total[c.confidence] ??= {})[rel] = (total[c.confidence][rel] ?? 0) + 1;
  const gt = (gridTotal[c.confidence] ??= [0, 0]);
  gt[0] += g ? 1 : 0; gt[1]++;
  dump.push({ id: c.id, song: c.song, cited: c.bpm, alt: c.alt, confidence: c.confidence, wiki: s.wiki, grid: a.bpm, named, relation: rel, gridOk: g });
  if (rel !== 'ok' || !g) wrong.push(`${rel.padEnd(5)} ${g ? '      ' : 'grid! '} shown ${named.toFixed(1).padStart(6)}  grid ${a.bpm.toFixed(1).padStart(6)}  cited ${String(c.bpm).padStart(7)}${c.alt ? ` (${c.alt})` : ''}  wiki ${String(s.wiki ?? '—').padStart(4)}  ${c.confidence.padEnd(6)} ${c.song}`);
}
console.log(`\n${useHint ? 'with the wiki BPM as hint' : 'without hint'}${useBeats ? ', with Beat This!' : ''}; ${songs.length - skipped} songs (${skipped} skipped)\n`);
console.log(wrong.sort().join('\n'));
console.log('\n=== shown tempo (namedBpm) vs cited; grid octave-free ===');
const all: Record<string, number> = {};
let gAll = 0, nAll = 0;
for (const conf of ['high', 'medium', 'low']) {
  const t = total[conf];
  if (!t) continue;
  const n = Object.values(t).reduce((p, q) => p + q, 0);
  for (const [k, v] of Object.entries(t)) all[k] = (all[k] ?? 0) + v;
  gAll += gridTotal[conf][0]; nAll += n;
  console.log(`${conf.padEnd(6)} ${String(t.ok ?? 0).padStart(3)}/${n} right  ${Object.entries(t).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${v}`).join(', ')}   grid ${gridTotal[conf][0]}/${n}`);
}
console.log(`all    ${String(all.ok ?? 0).padStart(3)}/${nAll} right  ${Object.entries(all).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${v}`).join(', ')}   grid ${gAll}/${nAll}`);
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(dump, null, 1));
