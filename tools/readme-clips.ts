// The README's (and the release notes') pictures of the MV itself, from the dev page in demo mode (the demo cover and
// lines over a cached song's timing: Burn, which has to be in the NetEase cache), each plate forced on (?plate=):
//   hero.webp            the push tunnel, the spectrum tube, the black hole, the kaleidoscope, 2.6 s each
//   feat-lyrics.webp     kinetic type, 5 s;  feat-armillary.webp  the armillary, 5 s
//   style-*.jpg          a still of each style;  look-*.jpg  the rings in each look
//   bun tools/readme-clips.ts [name …]          (default: all)
// Needs the frozen dev server (BMV_SERVER, as tools/render-clip.ts), Edge, ffmpeg (BMV_FFMPEG) and playwright-core
// (through tools/render-clip.ts). Animated WebP at 15 frames a second (the MV changes every frame: GIF would be 4–7×
// bigger); the clips and stills stay in build/readme/clips/.
import fs from 'node:fs';
import path from 'node:path';

const FF = process.env.BMV_FFMPEG ?? 'E:/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe';
const ROOT = path.resolve(import.meta.dir, '..');
const DOCS = path.join(ROOT, 'docs', 'images'), BUILD = path.join(ROOT, 'build', 'readme', 'clips');
fs.mkdirSync(BUILD, { recursive: true });

const SONG = 'demo&id=1395338963&seed=3';
/** A forced plate over [from, to) (song seconds), in a style and look. */
interface Part { q: string; from: number; to: number }
const CLIPS: Record<string, { parts: Part[]; width: number }> = {
  // (Times with a demo line being sung: in the second drop, the chorus before the first, the end of the second.)
  hero: {
    width: 880,
    parts: [
      { q: 'plate=drive&variants=push', from: 99.6, to: 102.2 },
      { q: 'plate=channel&variants=axis', from: 102.2, to: 104.8 },
      { q: 'plate=blackhole&variants=edge', from: 81.0, to: 83.6 },
      { q: 'plate=kaleido&variants=spiral', from: 126.0, to: 128.6 },
    ],
  },
  // (A verse: shots of four bars, so the armillary's orbit isn't cut short to face its rings every two.)
  'feat-lyrics': { width: 720, parts: [{ q: 'plate=kinetic&variants=flat', from: 68.4, to: 73.4 }] },
  'feat-armillary': { width: 720, parts: [{ q: 'plate=crystal&variants=orbit', from: 68.4, to: 73.0 }] },
};
/** Stills, 640 wide, most of the way through the line “远处的声音亮起来” (68.1–75.3 s). */
const AT = 71;
const STILLS: Record<string, string | [string, number]> = {
  'style-pulse': 'style=pulse&plate=city&variants=canyon',
  'style-ballad': 'style=ballad&plate=kaleido&variants=petal',
  'style-word': 'style=word&plate=neon&variants=walk',
  // (Ink's brush writes the last character later: the line whole.)
  'style-ink': ['style=ink&plate=clouds&variants=over', 72],
  'look-riso': 'style=pulse&plate=rings&variants=front&look=riso',
  'look-hibit': 'style=pulse&plate=rings&variants=front&look=hibit',
  'look-ascii': 'style=pulse&plate=rings&variants=front&look=ascii',
  'look-vhs': 'style=pulse&plate=rings&variants=front&look=vhs',
};

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} 失败：${cmd.slice(1, 4).join(' ')}`);
}
// (This bun itself, not `bun`: on Windows that is a .cmd shim, which won't take the queries' `&`.)
const BUN = process.execPath;
const query = (q: string) => `${SONG}&${q.includes('look=') ? '' : 'look=none&'}${q}`;
const clip = (q: string, from: number, to: number, out: string) =>
  run([BUN, path.join(ROOT, 'tools', 'render-clip.ts'), query(q), String(from), String(to), out, '--fps', '30', '--size', '1280x720']);

const only = process.argv.slice(2);
const wanted = (name: string) => !only.length || only.includes(name);

for (const [name, { parts, width }] of Object.entries(CLIPS)) {
  if (!wanted(name)) continue;
  const files = parts.map((p, i) => { const f = path.join(BUILD, `${name}-${i}.mp4`); clip(p.q, p.from, p.to, f); return f; });
  // Joined with hard cuts, 15 frames a second, looping.
  const inputs = files.flatMap(f => ['-i', f]);
  const join = files.map((_, i) => `[${i}:v]`).join('') + `concat=n=${files.length}:v=1:a=0,fps=15,scale=${width}:-2:flags=lanczos[v]`;
  run([FF, '-y', '-loglevel', 'error', ...inputs, '-filter_complex', join, '-map', '[v]', '-c:v', 'libwebp', '-quality', '72', '-compression_level', '6', '-loop', '0', path.join(DOCS, `${name}.webp`)]);
  console.log(path.join(DOCS, `${name}.webp`));
}
for (const [name, still] of Object.entries(STILLS)) {
  if (!wanted(name)) continue;
  const [q, at] = typeof still === 'string' ? [still, AT] : still;
  const prefix = path.join(BUILD, name);
  run([BUN, path.join(ROOT, 'tools', 'render-clip.ts'), query(q), '--stills', String(at), prefix, '--size', '1280x720']);
  run([FF, '-y', '-loglevel', 'error', '-i', `${prefix}-${at}.png`, '-vf', 'scale=640:-2:flags=lanczos', '-q:v', '2', path.join(DOCS, `${name}.jpg`)]);
  console.log(path.join(DOCS, `${name}.jpg`));
}
