// Evaluates src/analysis on local test songs:
//   bun tools/eval-analysis.ts [--song id[,id…]] [--no-hint] [--no-lyrics] [--quick | --no-timing] [--bars] [--debug-sections]
//                              [--json out.json]
// Local files are decoded in place with ffmpeg (mono, 22050 Hz, f32le); NetEase songs (ncmId) are fetched from the
// main session's dev server (NCM_DEV, default http://localhost:5190: /ncm/audio/<id>, /ncm/lyric/<id>, and the wiki
// BPM from /ncm/wiki/<id> unless the song lists it; passed as bpmHint). Decoded audio goes to a temp cache outside the
// project, deleted afterwards unless EVAL_PCM_CACHE=<dir> keeps it for the next run; nothing is copied into the repo.
// --bars prints per bar the levels and which lyric lines start there, and per line its sung span, as repeat-group ids
// and times only (for annotating truth without handling lyric text); --no-timing runs each song once, untimed.
// The analysis runs in a child process with raised priority: on this Windows machine a process that has waited on
// ffmpeg, or a background child, runs JS several times slower, which would distort the timings.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Analysis, LyricLine } from '../src/types.ts';

const FFMPEG = process.env.FFMPEG || 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const NCM_DEV = process.env.NCM_DEV || 'http://localhost:5190';
const SR = 22050;
const TOL = 0.07;
const CLARITY_TRUTH = 'D:/!XM的项目/个人项目/Clarity_MV/data/audio.json';

interface Song {
  id: string;
  name: string;
  /** Local audio file (read in place). */
  file?: string;
  /** NetEase song id: audio and lyrics from the dev server, BPM from the song wiki. */
  ncmId?: number;
  truth?: string;
  /** Local NetEase lyric JSON. */
  lyric?: string;
  /** Wiki BPM (asked from the dev server's cached song wiki when not given here). */
  wikiBpm?: number;
}

const SONGS: Song[] = [
  {
    id: 'clarity',
    name: 'Zedd - Clarity (BUNT. Remix) [local hi-res FLAC]',
    file: 'E:/CloudMusic/VipSongsDownload/unlock/Zedd,VALORANT,Foxes - Clarity (BUNT. Remix).flac',
    truth: CLARITY_TRUTH,
    lyric: 'dev/lyric-3359522924.json',
    wikiBpm: 127,
  },
  { id: 'clarity-ncm', name: 'Zedd - Clarity (BUNT. Remix) [NetEase cache]', ncmId: 3359522924, truth: CLARITY_TRUTH, wikiBpm: 127 },
  // Sections-only truth (tools/truth/), annotated from --bars / --lines (levels, lyric repeat groups, no words); the
  // first three are the user's reports that the parts of these songs were misread.
  { id: 'ticking', name: 'VALORANT / Grabbitz / bbno$ - Ticking Away (pop EDM, chorus + drop)', ncmId: 2068401809, wikiBpm: 95, truth: 'tools/truth/ticking-away.json' },
  { id: 'maybe', name: 'BUNT. / Graham - Maybe (folk EDM, half-time)', ncmId: 2142927883, wikiBpm: 86, truth: 'tools/truth/maybe.json' },
  { id: 'falling', name: 'NURKO / Roniit - Falling Again (melodic bass, half-time drops)', ncmId: 565841089, wikiBpm: 76, truth: 'tools/truth/falling-again.json' },
  { id: 'shanlu', name: '毛不易 - 一程山路 (ballad)', ncmId: 1417849873, wikiBpm: 69, truth: 'tools/truth/shanlu.json' },
  { id: 'uify', name: 'Stephen Sanchez - Until I Found You (slow, swing)', ncmId: 1874585362, wikiBpm: 67, truth: 'tools/truth/until-i-found-you.json' },
  { id: 'stronger', name: 'Kanye West - Stronger (hip-hop)', ncmId: 18969069, wikiBpm: 103, truth: 'tools/truth/stronger.json' },
  { id: 'hurricane', name: 'BUNT. / HON / SMBDY - Hurricane (pop EDM, drops)', ncmId: 1836011652, wikiBpm: 109, truth: 'tools/truth/hurricane.json' },
  { id: 'takemylove', name: 'TIC / Paperman - TAKE MY LOVE (EDM, drops)', ncmId: 3364903300, wikiBpm: 122, truth: 'tools/truth/take-my-love.json' },
  { id: 'combine', name: 'Bustre - Combine (drum & bass, instrumental)', ncmId: 31877908, wikiBpm: 86, truth: 'tools/truth/combine.json' },
  { id: 'timeflies', name: '水仙LONE - Time Flies (instrumental)', ncmId: 3325660944, wikiBpm: 101, truth: 'tools/truth/time-flies.json' },
  { id: 'su', name: 'CORSAK胡梦周 / 马吟吟 - 溯 Reverse (Chinese future bass, drops)', ncmId: 1294951288, wikiBpm: 139, truth: 'tools/truth/su.json' },
  { id: 'spacewalk', name: 'HOYO-MiX - 太空漫步 Space Walk (instrumental)', file: 'E:/CloudMusic/HOYO-MiX - 太空漫步 Space Walk.flac' },
  { id: 'limit', name: 'Paperman - LIMIT (instrumental)', file: 'E:/CloudMusic/Paperman - LIMIT.flac' },
  { id: 'her', name: 'JVKE - her (no lyrics file)', file: 'E:/CloudMusic/VipSongsDownload/unlock/JVKE - her.flac' },
];

interface Prepared {
  pcm: string;
  lyric?: string;
  wikiBpm?: number;
  /** NetEase gave no lyrics this time (rate limit): asked again on the next run with a kept cache. */
  lyricMissing?: boolean;
}

const key = (s: Song) => (s.file ? Bun.hash(s.file).toString(16) : 'ncm' + s.ncmId);

function decode(src: string, out: string): void {
  const r = Bun.spawnSync([FFMPEG, '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', String(SR), '-f', 'f32le', out], { stdout: 'ignore', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error('ffmpeg failed for ' + src + ': ' + r.stderr.toString());
}

/** Wiki BPM through the dev server (/ncm/wiki keeps NetEase's first good answer in dev/ncm-cache/). */
async function wikiBpm(id: number): Promise<number | undefined> {
  try {
    const res = await fetch(`${NCM_DEV}/ncm/wiki/${id}`, { signal: AbortSignal.timeout(15000) });
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
  } catch {
    return undefined;
  }
}

async function prepare(song: Song, dir: string, wantHint: boolean): Promise<Prepared | string> {
  const pcm = join(dir, key(song) + '.f32');
  const meta = join(dir, key(song) + '.json');
  let p: Prepared = { pcm, lyric: song.lyric, wikiBpm: song.wikiBpm };
  if (existsSync(pcm) && existsSync(meta)) {
    p = JSON.parse(readFileSync(meta, 'utf8'));
    if (song.wikiBpm) p.wikiBpm = song.wikiBpm;
    if (!song.ncmId || (!p.lyricMissing && (p.wikiBpm || !wantHint))) return p;
  } else if (song.file) {
    if (!existsSync(song.file)) return 'file not found';
    decode(song.file, pcm);
  } else if (song.ncmId) {
    try {
      const audio = await fetch(`${NCM_DEV}/ncm/audio/${song.ncmId}`, { signal: AbortSignal.timeout(30000) });
      if (!audio.ok) return `dev server: audio ${audio.status}`;
      const src = join(dir, key(song) + '.src');
      writeFileSync(src, new Uint8Array(await audio.arrayBuffer()));
      decode(src, pcm);
      rmSync(src, { force: true });
    } catch (e) {
      return `dev server ${NCM_DEV} not reachable (${(e as Error).message})`;
    }
    p.lyricMissing = true;
  }
  if (song.ncmId) {
    if (p.lyricMissing) {
      try {
        const lyr = await fetch(`${NCM_DEV}/ncm/lyric/${song.ncmId}`, { signal: AbortSignal.timeout(15000) });
        const body = lyr.ok ? await lyr.text() : '';
        // (A rate-limited answer is {"code":405,…}: keep asking on later runs instead of analysing without lyrics.)
        if (body && JSON.parse(body)?.code === 200) {
          p.lyric = join(dir, key(song) + '.lyric.json');
          writeFileSync(p.lyric, body);
          p.lyricMissing = false;
        }
      } catch {}
    }
    // (NetEase rate-limits: a known wiki BPM is not asked for again.)
    if (!p.wikiBpm && wantHint) p.wikiBpm = await wikiBpm(song.ncmId);
  }
  writeFileSync(meta, JSON.stringify(p));
  return p;
}

// ---------- metrics ----------
function matchCount(est: number[], ref: number[], tol: number): number {
  // Greedy one-to-one matching in order of distance (tolerance is well under half a beat).
  const pairs: Array<[number, number, number]> = [];
  let j0 = 0;
  for (let i = 0; i < ref.length; i++) {
    while (j0 < est.length && est[j0] < ref[i] - tol) j0++;
    for (let j = j0; j < est.length && est[j] <= ref[i] + tol; j++) pairs.push([Math.abs(est[j] - ref[i]), i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const ur = new Set<number>(), ue = new Set<number>();
  let n = 0;
  for (const [, i, j] of pairs) {
    if (ur.has(i) || ue.has(j)) continue;
    ur.add(i); ue.add(j); n++;
  }
  return n;
}

function fMeasure(est: number[], ref: number[], tol = TOL, from = -Infinity, to = Infinity) {
  const e = est.filter(t => t >= from && t < to), r = ref.filter(t => t >= from && t < to);
  if (!e.length || !r.length) return { f: 0, p: 0, r: 0, n: r.length };
  const m = matchCount(e, r, tol);
  const p = m / e.length, rc = m / r.length;
  return { f: p + rc ? (2 * p * rc) / (p + rc) : 0, p, r: rc, n: r.length };
}

function signedErrors(est: number[], ref: number[], tol: number, from = -Infinity, to = Infinity): number[] {
  const out: number[] = [];
  for (const r of ref) {
    if (r < from || r >= to) continue;
    let best = Infinity;
    for (const e of est) if (Math.abs(e - r) < Math.abs(best)) best = e - r;
    if (Math.abs(best) <= tol) out.push(best);
  }
  return out;
}

const med = (a: number[]) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
};

function quant(a: number[], q: number) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function tempoAt(beats: number[], tempo: number[], t: number): number {
  let i = 0;
  while (i + 1 < beats.length && beats[i + 1] <= t) i++;
  return tempo[i];
}

function barLengthAt(down: number[], t: number): number {
  let i = 0;
  while (i + 1 < down.length && down[i + 1] <= t) i++;
  const j = Math.min(down.length - 1, i + 1);
  return j > i ? down[j] - down[i] : 1.875;
}

const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

// ---------- reports ----------
function evalTruth(a: Analysis, truth: any) {
  if (!truth.beats) return evalSections(a, truth, Array.from(a.downbeats));
  const gtBeats: number[] = truth.beats, gtDown: number[] = truth.downbeats, gtTempo: number[] = truth.tempo;
  const split = 138.8;
  const bAll = fMeasure(a.beats, gtBeats), bConst = fMeasure(a.beats, gtBeats, TOL, -Infinity, split), bFast = fMeasure(a.beats, gtBeats, TOL, split);
  const dAll = fMeasure(a.downbeats, gtDown), dConst = fMeasure(a.downbeats, gtDown, TOL, -Infinity, split), dFast = fMeasure(a.downbeats, gtDown, TOL, split);
  const err = (lo: number, hi: number) => med(gtBeats.map((t, i) => (t >= lo && t < hi ? Math.abs(tempoAt(a.beats, a.tempo, t) - gtTempo[i]) : NaN)).filter(Number.isFinite));
  const off = signedErrors(a.beats, gtBeats, TOL, -Infinity, split);
  console.log('\n  == vs ground truth (±70 ms) ==');
  console.log(`  beats est ${a.beats.length} / gt ${gtBeats.length}; downbeats est ${a.downbeats.length} / gt ${gtDown.length}`);
  console.log('  ' + pad('metric', 34) + pad('all', 10) + pad('<138.8 s', 10) + '≥138.8 s');
  console.log('  ' + pad('beat F', 34) + pad(fmt(bAll.f), 10) + pad(fmt(bConst.f), 10) + fmt(bFast.f));
  console.log('  ' + pad('downbeat F', 34) + pad(fmt(dAll.f), 10) + pad(fmt(dConst.f), 10) + fmt(dFast.f));
  console.log('  ' + pad('median |tempo err| BPM', 34) + pad(fmt(err(-Infinity, Infinity), 2), 10) + pad(fmt(err(-Infinity, split), 2), 10) + fmt(err(split, Infinity), 2));
  console.log('  ' + pad('beat offset est−gt median / p90 |.|', 34) + fmt(med(off) * 1000, 1) + ' / ' + fmt(quant(off.map(Math.abs), 0.9) * 1000, 1) + ' ms');
  let hitF = '';
  if (truth.onsets) {
    // Drum hits against the onsets of the separated drum stem (±50 ms): all reference onsets, and the clear ones
    // (strength ≥ 0.25) against the hits the sections count as percussive (strength ≥ 0.25).
    console.log('\n  -- drum hits vs the drum stem (±50 ms): precision / recall / F --');
    const parts: string[] = [];
    for (const kind of ['kick', 'snare'] as const) {
      const ref: Array<[number, number]> = truth.onsets[kind] || [];
      const row = (minEst: number, minRef: number) => {
        const m = fMeasure(a.hits[kind].filter(h => h[1] >= minEst).map(h => h[0]), ref.filter(h => h[1] >= minRef).map(h => h[0]), 0.05);
        return `${fmt(m.p, 2)} / ${fmt(m.r, 2)} / ${fmt(m.f, 2)}`;
      };
      console.log(`  ${pad(kind, 6)} all: ${row(0, 0)}   clear (≥ 0.25 both): ${row(0.25, 0.25)}`);
      parts.push(`${kind} ${row(0, 0)}`);
    }
    hitF = ' ' + parts.join(', ');
  }
  return { bF: bAll.f, bC: bConst.f, bFast: bFast.f, dF: dAll.f, tempoErr: err(-Infinity, Infinity), hitF, ...evalSections(a, truth, gtDown) };
}

/**
 * Section boundaries and labels against the truth's sections. A truth name may list alternatives ("drop|chorus");
 * bar lengths for the ±1 bar tolerance come from `downbeats` (the truth's, or the analysis' own when the truth has
 * sections only).
 */
function evalSections(a: Analysis, truth: any, gtDown: number[]) {
  const gtSec: Array<{ name: string; start: number; end: number }> = truth.sections;
  const gtB = gtSec.slice(1).map(s => s.start);
  const estB = a.sections.slice(1).map(s => s.start);
  console.log('\n  -- section boundaries (gt → nearest est) --');
  let hitHalf = 0, hitBar = 0;
  for (const g of gtB) {
    let near = NaN;
    for (const e of estB) if (!(Math.abs(e - g) >= Math.abs(near - g))) near = e;
    const bar = barLengthAt(gtDown, g);
    const d = near - g;
    const h1 = Math.abs(d) <= 0.5, h2 = Math.abs(d) <= bar + 0.05;
    if (h1) hitHalf++;
    if (h2) hitBar++;
    console.log(`  ${pad(fmt(g, 2), 8)} → ${pad(fmt(near, 2), 8)} Δ ${pad(fmt(d, 2), 7)} ${h1 ? '±0.5s' : '     '} ${h2 ? '±1bar' : ''}`);
  }
  // Precision: estimated boundaries near some truth boundary (cutting too often is not caught by the hit rates).
  const precHalf = estB.filter(e => gtB.some(g => Math.abs(e - g) <= 0.5)).length;
  const precBar = estB.filter(e => gtB.some(g => Math.abs(e - g) <= barLengthAt(gtDown, g) + 0.05)).length;
  console.log(`  hit rate ±0.5 s: ${hitHalf}/${gtB.length}, ±1 bar: ${hitBar}/${gtB.length}; est boundaries ${estB.length} (${precHalf} within ±0.5 s, ${precBar} within ±1 bar of a gt boundary)`);
  console.log('\n  -- labels (gt | est by overlap) --');
  let agree = 0, timeOk = 0, timeAll = 0;
  for (const g of gtSec) {
    const over = a.sections.map(s => ({ s, o: Math.min(s.end, g.end) - Math.max(s.start, g.start) })).filter(x => x.o > 0.5);
    const names = g.name.split('|').map(n => n.replace(/\d+b?$/, ''));
    const ok = over.length > 0 && names.includes(over.sort((x, y) => y.o - x.o)[0].s.label);
    if (ok) agree++;
    // By time: the share of the song whose label the truth accepts (what the viewer sees, short pieces included).
    for (const x of over) if (names.includes(x.s.label)) timeOk += x.o;
    timeAll += g.end - g.start;
    console.log(`  ${pad(g.name, 9)} ${pad(fmt(g.start, 2), 8)}–${pad(fmt(g.end, 2), 8)} | ${over.map(x => `${x.s.label}${x.s.group}`).join(' ')}${ok ? '' : '   ✗'}`);
  }
  const pct = (100 * timeOk) / Math.max(1e-6, timeAll);
  console.log(`  label agreement (majority overlap, name without number): ${agree}/${gtSec.length}; by time ${fmt(pct, 1)} %`);
  return { hitHalf, hitBar, nB: gtB.length, precHalf, precBar, nEst: estB.length, agree, nSec: gtSec.length, timeOk, timeAll, labels: `${agree}/${gtSec.length} (${fmt(pct, 0)} % of time)` };
}

function printSummary(a: Analysis, dur: number) {
  const tmin = Math.min(...a.tempo), tmax = Math.max(...a.tempo);
  const rate = (h: Array<[number, number]>) => (h.length / dur).toFixed(2);
  const strong = (h: Array<[number, number]>) => h.filter(v => v[1] >= 0.5).length / dur;
  console.log(`  bpm ${a.bpm}, meter ${a.meter}, beats ${a.beats.length} (${fmt(a.beats[0], 2)}…${fmt(a.beats[a.beats.length - 1], 2)}), downbeats ${a.downbeats.length}, tempo ${fmt(tmin, 1)}–${fmt(tmax, 1)} BPM`);
  console.log(`  hits/s: kick ${rate(a.hits.kick)}, snare ${rate(a.hits.snare)}, hat ${rate(a.hits.hat)}, accent ${rate(a.hits.accent)}; strong (≥0.5) kick + ½ snare ${(strong(a.hits.kick) + 0.5 * strong(a.hits.snare)).toFixed(2)}/s`);
  console.log('  sections:');
  for (const s of a.sections) {
    const bars = a.downbeats.filter(d => d >= s.start - 0.05 && d < s.end - 0.05).length;
    console.log(`    ${pad(fmt(s.start, 2), 8)}–${pad(fmt(s.end, 2), 8)} ${pad(s.label, 7)} g${pad(String(s.group), 3)} e ${fmt(s.energy, 2)} ${s.vocal ? 'vocal' : '     '} ${pad(String(bars), 3)} bars ~${fmt(tempoAt(a.beats, a.tempo, (s.start + s.end) / 2), 1)} BPM`);
  }
}

// ---------- main ----------
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = opt('--song') ? opt('--song').split(',') : [];
const jsonOut = opt('--json');
const selected = SONGS.filter(s => !only.length || only.indexOf(s.id) >= 0);

if (!args.includes('--child')) {
  const keep = process.env.EVAL_PCM_CACHE;
  const dir = keep || mkdtempSync(join(tmpdir(), 'bettermv-pcm-'));
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, Prepared | string> = {};
  for (const song of selected) manifest[song.id] = await prepare(song, dir, !args.includes('--no-hint'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const r = Bun.spawnSync([process.execPath, import.meta.path, ...args, '--child'], {
    stdout: 'inherit', stderr: 'inherit', env: { ...process.env, EVAL_PCM_CACHE: dir },
  });
  if (!keep) rmSync(dir, { recursive: true, force: true });
  process.exit(r.exitCode ?? 1);
}

try {
  // Windows throttles long-running background children; ask for normal-foreground scheduling.
  const os = await import('node:os');
  os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
} catch {}
// Imported only in the child (importing them in the parent made the child's timings unstable here).
const { analyze, analyzeSteps } = await import('../src/analysis/index.ts');
const { parseNeteaseLyric } = await import('../src/lyrics/parse.ts');
const dir = process.env.EVAL_PCM_CACHE!;
const manifest: Record<string, Prepared | string> = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const useHint = !args.includes('--no-hint');
const timedRuns = args.includes('--quick') ? 1 : 3;
const noTiming = args.includes('--no-timing');
const dump: Record<string, unknown> = {};
const table: string[] = [];
const total = { hitHalf: 0, hitBar: 0, nB: 0, nEst: 0, precHalf: 0, precBar: 0, agree: 0, nSec: 0, timeOk: 0, timeAll: 0, songs: 0 };

for (const song of selected) {
  const p = manifest[song.id];
  if (!p || typeof p === 'string') {
    console.log(`\n### ${song.name}: skipped (${p || 'not prepared'})`);
    continue;
  }
  const x = new Float32Array(readFileSync(p.pcm).buffer.slice(0)).slice();
  const duration = x.length / SR;
  let lyrics: LyricLine[] = [];
  if (p.lyric && existsSync(p.lyric) && !args.includes('--no-lyrics')) lyrics = parseNeteaseLyric(JSON.parse(readFileSync(p.lyric, 'utf8')), duration);
  const bpmHint = useHint ? p.wikiBpm : undefined;
  console.log(`\n### ${song.name} (${fmt(duration, 2)} s, ${lyrics.length} lyric lines${p.lyricMissing ? ' (NetEase gave none: rate limit?)' : ''}, wiki BPM ${p.wikiBpm ?? '—'}${bpmHint ? ' → bpmHint' : ''})`);

  // (--no-timing: one untimed run, for quick checks of the results.)
  if (!noTiming) analyze(x, SR, { lyrics, bpmHint }); // JIT warm-up
  const runs: number[] = [];
  let a!: Analysis;
  for (let r = 0; r < (noTiming ? 1 : timedRuns); r++) {
    const t0 = performance.now();
    a = analyze(x, SR, { lyrics, bpmHint });
    runs.push(performance.now() - t0);
  }
  let slices = 0, longest = 0;
  const it = analyzeSteps(x, SR, { lyrics, bpmHint, sliceMs: 8 });
  let last = performance.now();
  for (; !noTiming;) {
    const r = it.next();
    longest = Math.max(longest, performance.now() - last);
    if (r.done) break;
    slices++;
    last = performance.now();
  }
  if (!noTiming) console.log(`  runtime (decode excluded): ${runs.map(r => r.toFixed(0)).join(' / ')} ms; sliced @8 ms: ${slices} yields, longest slice ${longest.toFixed(1)} ms`);
  printSummary(a, duration);
  // Invariants the player relies on: beats strictly increasing inside the song, positive finite tempo, downbeats a
  // subset of the beats, sections contiguous.
  const broken: string[] = [];
  for (let i = 0; i < a.beats.length; i++) {
    const b = a.beats[i];
    if (!Number.isFinite(b) || b < 0 || b > duration + 0.05 || (i > 0 && b <= a.beats[i - 1])) { broken.push(`beat ${i} = ${fmt(b, 3)}`); break; }
  }
  if (a.tempo.some(v => !(v > 0) || !Number.isFinite(v))) broken.push('tempo ≤ 0 or not finite');
  const beatSet = new Set(Array.from(a.beats, b => b.toFixed(4)));
  if (Array.from(a.downbeats).some((d, i, arr) => !beatSet.has(d.toFixed(4)) || (i > 0 && d <= arr[i - 1]))) broken.push('downbeats not an ordered subset of beats');
  if (a.sections.some((s, i) => s.end <= s.start || (i > 0 && Math.abs(s.start - a.sections[i - 1].end) > 1e-6))) broken.push('sections not contiguous');
  if (broken.length) console.log(`  !! INVARIANTS BROKEN: ${broken.join('; ')}`);
  if (args.includes('--bars')) {
    // For annotating truth without handling lyric text: per bar its levels and the lines starting in it, as
    // "L<index>:G<repeat group>×<times the group's text occurs>" (b = sung wholly in brackets). No words are printed.
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const groups = new Map<string, number>(), counts = new Map<string, number>();
    for (const l of lyrics) { const k = norm(l.text); counts.set(k, (counts.get(k) || 0) + 1); if (!groups.has(k)) groups.set(k, groups.size + 1); }
    const env = a.env, fps = env.fps, down = Array.from(a.downbeats);
    const avgDb = (arr: ArrayLike<number>, t0: number, t1: number) => {
      let s = 0, n = 0;
      for (let i = Math.floor(t0 * fps); i < Math.min(arr.length, Math.floor(t1 * fps)); i++) { s += arr[i]; n++; }
      return 20 * Math.log10((n ? s / n : 0) + 1e-9);
    };
    console.log('  -- bars: time, rms / low / high dB (envelopes), sung share, lines starting (L index:G group×count) --');
    for (let j = 0; j < down.length; j++) {
      const t0 = down[j], t1 = j + 1 < down.length ? down[j + 1] : duration;
      let sung = 0;
      for (const l of lyrics) { const s = l.words.length ? l.words[0].start : l.start, e = l.words.length ? l.words[l.words.length - 1].end : l.end; sung += Math.max(0, Math.min(e, t1) - Math.max(s, t0)); }
      const starts = lyrics.map((l, i) => ({ l, i })).filter(({ l }) => l.start >= t0 - 0.3 && l.start < t1 - 0.3)
        .map(({ l, i }) => { const k = norm(l.text); return `L${i}:G${groups.get(k)}×${counts.get(k)}${l.backing ? 'b' : ''}`; });
      console.log(`  ${pad(String(j), 4)}${pad(fmt(t0, 1), 7)} rms ${pad(fmt(avgDb(env.rms, t0, t1), 0), 5)} low ${pad(fmt(avgDb(env.low, t0, t1), 0), 5)} high ${pad(fmt(avgDb(env.high, t0, t1), 0), 5)} sung ${pad(fmt(Math.min(1, sung / Math.max(1e-6, t1 - t0)), 2), 5)} ${starts.join(' ')}`);
    }
    // Each line's sung span and where it starts in the bar grid (bar index + fraction of the bar). No words.
    console.log('  -- lines: L index:G group×count, sung start–end (s), start as bar + fraction --');
    for (let i = 0; i < lyrics.length; i++) {
      const l = lyrics[i], k = norm(l.text);
      const s = l.words.length ? l.words[0].start : l.start, e = l.words.length ? l.words[l.words.length - 1].end : l.end;
      let j = 0;
      while (j + 1 < down.length && down[j + 1] <= s) j++;
      const len = (j + 1 < down.length ? down[j + 1] : duration) - down[j];
      console.log(`  L${pad(i + ':G' + groups.get(k) + '×' + counts.get(k) + (l.backing ? 'b' : ''), 10)} ${pad(fmt(s, 2), 7)}–${pad(fmt(e, 2), 7)} bar ${fmt(j + (s - down[j]) / Math.max(1e-6, len), 2)}`);
    }
  }
  if (args.includes('--debug-sections')) {
    // Novelty per bar boundary from the last analysis run (sections.ts calls the hook).
    let dbg: Record<string, ArrayLike<number>> | null = null;
    let secInfo: Array<Record<string, number | string>> = [];
    (globalThis as any).__bmvSectionDebug = (d: Record<string, ArrayLike<number>>) => { dbg = d; };
    (globalThis as any).__bmvSectionInfo = (d: Array<Record<string, number | string>>) => { secInfo = d; };
    analyze(x, SR, { lyrics, bpmHint });
    (globalThis as any).__bmvSectionDebug = (globalThis as any).__bmvSectionInfo = undefined;
    console.log('  -- labelling inputs per section --');
    for (const s of secInfo) console.log('  ' + Object.entries(s).map(([k, v]) => `${k} ${typeof v === 'number' ? fmt(v, 2) : v}`).join('  '));
    if (dbg) {
      const d: Record<string, ArrayLike<number>> = dbg;
      console.log('  -- boundary novelty per bar (nov = total; cue = lyrics; z4 z8 zj zb zh = audio parts) --');
      for (let j = 1; j < d.time.length; j++) {
        const f = (k: string, n = 1) => pad(fmt(Number(d[k][j]), n), 6);
        console.log(`  ${pad(String(j), 4)}${pad(fmt(Number(d.time[j]), 1), 7)} nov ${f('nov')} cue ${f('cue')} z4 ${f('z4')} z8 ${f('z8')} zj ${f('zj')} zb ${f('zb')} zh ${f('zh')} low ${f('lowDb', 0)} sung ${f('sung', 2)}`);
      }
    }
  }
  let gt = '';
  if (song.truth && existsSync(song.truth)) {
    const m: any = evalTruth(a, JSON.parse(readFileSync(song.truth, 'utf8')));
    const beatPart = m.bF !== undefined ? ` beatF ${fmt(m.bF)} (const ${fmt(m.bC)}, fast ${fmt(m.bFast)}) downF ${fmt(m.dF)} tempoErr ${fmt(m.tempoErr, 2)}${m.hitF}` : '';
    gt = `${beatPart} bounds ±0.5s ${m.hitHalf}/${m.nB} ±1bar ${m.hitBar}/${m.nB} (est ${m.nEst}: ${m.precHalf} / ${m.precBar} near) labels ${m.labels}`;
    // (The local Clarity file is left out of the totals: clarity-ncm is the same song.)
    if (song.id !== 'clarity') {
      total.hitHalf += m.hitHalf; total.hitBar += m.hitBar; total.nB += m.nB; total.agree += m.agree; total.nSec += m.nSec; total.songs++;
      total.timeOk += m.timeOk; total.timeAll += m.timeAll; total.nEst += m.nEst; total.precHalf += m.precHalf; total.precBar += m.precBar;
    }
  }
  table.push(`${pad(song.id, 12)} bpm ${pad(String(a.bpm), 8)} wiki ${pad(String(p.wikiBpm ?? '—'), 4)} meter ${a.meter} sections ${pad(String(a.sections.length), 3)} ${pad(med(runs).toFixed(0) + ' ms', 7)}${broken.length ? ' !! INVARIANTS BROKEN' : ''}${gt}`);
  if (jsonOut) dump[song.id] = { ...a, env: undefined };
}
console.log('\n=== summary ===\n' + table.join('\n'));
if (total.songs) console.log(`total over ${total.songs} songs with section truth (local Clarity left out): bounds ±0.5s ${total.hitHalf}/${total.nB} ±1bar ${total.hitBar}/${total.nB}, precision ±0.5s ${total.precHalf}/${total.nEst} ±1bar ${total.precBar}/${total.nEst}, labels ${total.agree}/${total.nSec} (${fmt((100 * total.timeOk) / Math.max(1e-6, total.timeAll), 1)} % of time)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(dump));
