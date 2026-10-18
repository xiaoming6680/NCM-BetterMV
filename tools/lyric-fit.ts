// How much of the words leaves the frame (issue #4: a portrait monitor cut most plates' words off at both sides).
// Renders the dev harness in headless Edge at a size, takes a frame in each sung shot (most of the way through a line
// sung in it) and projects every glyph of the plate's lyrics (text meshes under a `userData.lyrics` group, at least 0.3
// opaque) through the plate's camera: a glyph whose middle is off the frame counts as out, one that only crosses an edge
// as cut. Words printed on a surface (LyricLayer) aren't in the plate's scene graph: look at the frames for those.
// Against the frozen dev server (BMV_SERVER, default http://127.0.0.1:5191: `bunx vite --config vite.frozen.config.ts`).
//   bun tools/lyric-fit.ts <song id> <WxH> <out dir> [--seed 7] [--style pulse|ballad|word|ink] [--max N] [--per 2]
//     [--plates "rings:front,tilt;relief:fly,side"]          each plate forced on every shot (?plate=), one after another
// Writes <out dir>/fit.json (a row per frame) and a small JPEG per frame; prints the frames with words off the frame
// and a line per plate.
const { chromium } = await import(process.env.BMV_PLAYWRIGHT ?? 'D:/!XM的项目/个人项目/NCM-BetterDownload/node_modules/playwright-core/index.mjs');
const fs = await import('node:fs');

const SERVER = process.env.BMV_SERVER ?? 'http://127.0.0.1:5191';
const args = process.argv.slice(2);
const flag = (name: string, def: string) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const seed = flag('--seed', '7');
const style = flag('--style', '');
const plates = flag('--plates', '').split(';').filter(Boolean);
/** Frames per plate, spread over the song (0: every sung shot). */
const max = Number(flag('--max', '0'));
/** Frames per shot at most (one per line sung in it). */
const per = Number(flag('--per', '2'));
const [id, size, outdir] = args;
const [W, H] = size.split('x').map(Number);
fs.mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e: Error) => console.error('[pageerror]', e.message));
page.on('console', (m: any) => { if (m.type() === 'error' && !/404/.test(m.text())) console.error('[console]', m.text()); });

type Row = { i: number; t: number; scene: string; variant: string; label: string; n: number; out: number; cut: number; outShare: number; img: string };
const rows: Row[] = [];
for (const pv of plates.length ? plates : ['']) {
  const [plate, variants] = pv.split(':');
  await page.goto(`${SERVER}/?id=${id}&seed=${seed}` + (plate ? `&plate=${plate}&variants=${variants ?? 'front'}` : '') + (style ? `&style=${style}` : ''));
  await page.waitForFunction(() => (window as any).bmv?.player?.director, null, { timeout: 300000 });
  await page.evaluate(() => { const b = (window as any).bmv; b.audio.pause(); b.player.hud.visible = false; b.player.resize(); });
  const plan: Array<{ t: number; label: string }> = await page.evaluate((per: number) => {
    const b = (window as any).bmv, out: Array<{ t: number; label: string }> = [];
    for (const s of b.player.shots) {
      const sung = b.lines.filter((l: any) => l.end > s.start + 0.3 && l.start < s.end - 0.1).slice(0, per);
      for (const l of sung) out.push({ t: Math.min(Math.max(l.start + 0.7 * (l.end - l.start), s.start + 0.3), s.end - 0.05), label: s.section.label });
    }
    return out;
  }, per);
  const picked = max && plan.length > max ? Array.from({ length: max }, (_, k) => plan[Math.floor(((k + 0.5) * plan.length) / max)]) : plan;
  console.log(`${plate || 'auto'}: ${picked.length} frames`);
  for (const p of picked) {
    const r = await page.evaluate((t: number) => {
      const b = (window as any).bmv, pl = b.player;
      for (let k = 20; k >= 1; k--) b.renderAt(t - k / 60);
      const shot = b.renderAt(t), sc = pl.scenes[shot.scene], cam = sc.camera;
      // The frame, small, right after drawing it.
      const src = pl.engine.renderer.domElement, c = document.createElement('canvas');
      c.width = 360; c.height = Math.round((360 * src.height) / src.width);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      const V = cam.position.constructor, glyphs: number[][] = [];
      const shown = (o: any) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
      const lyric = (o: any) => { for (let x = o; x; x = x.parent) if (x.userData?.lyrics) return true; return false; };
      sc.scene.traverse((o: any) => {
        if (!o.isMesh || typeof o.userData.width !== 'number' || o.userData.primer || !o.material?.map || !shown(o) || !lyric(o)) return;
        if ((o.material.opacity ?? 1) < 0.3) return;
        // The ink box: the plane less its halo margin (0.3 em round the type, src/render/text.ts).
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox, em = Math.min((bb.max.x - bb.min.x) / 1.6, (bb.max.y - bb.min.y) / 1.84), m = em * 0.3;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const x of [bb.min.x + m, bb.max.x - m]) for (const y of [bb.min.y + m, bb.max.y - m]) {
          const v = new V(x, y, 0).applyMatrix4(o.matrixWorld);
          if (v.clone().applyMatrix4(cam.matrixWorldInverse).z > -cam.near) return; // behind the lens
          v.project(cam);
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        glyphs.push([x0, x1, y0, y1]);
      });
      return { jpg: c.toDataURL('image/jpeg', 0.8), glyphs, scene: shot.scene, variant: shot.variant };
    }, p.t);
    let area = 0, outA = 0, out = 0, cut = 0;
    for (const [x0, x1, y0, y1] of r.glyphs) {
      const a = Math.max(1e-6, (x1 - x0) * (y1 - y0));
      const ix = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), iy = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
      area += a; outA += a - ix * iy;
      if (Math.abs((x0 + x1) / 2) > 1 || Math.abs((y0 + y1) / 2) > 1) out++;
      else if (x0 < -1 || x1 > 1 || y0 < -1 || y1 > 1) cut++;
    }
    const i = rows.length, img = `${String(i).padStart(3, '0')}-${r.scene}-${r.variant}.jpg`;
    fs.writeFileSync(`${outdir}/${img}`, Buffer.from(r.jpg.split(',')[1], 'base64'));
    const row: Row = { i, t: +p.t.toFixed(2), scene: r.scene, variant: r.variant, label: p.label, n: r.glyphs.length, out, cut, outShare: +(outA / Math.max(1e-6, area)).toFixed(3), img };
    rows.push(row);
    if (out || cut) console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(`${outdir}/fit.json`, JSON.stringify(rows, null, 1));
const by = new Map<string, { frames: number; bad: number; off: number; n: number }>();
for (const r of rows) {
  const e = by.get(r.scene) ?? { frames: 0, bad: 0, off: 0, n: 0 };
  e.frames++; if (r.out || r.cut) e.bad++; e.off += r.out + r.cut; e.n += r.n;
  by.set(r.scene, e);
}
for (const [k, e] of [...by].sort((a, b) => b[1].bad / b[1].frames - a[1].bad / a[1].frames)) console.log(`${k.padEnd(12)} ${e.bad}/${e.frames} frames with words off the frame, ${e.off}/${e.n} glyphs`);
await browser.close();
