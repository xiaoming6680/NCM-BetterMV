// Poster: Swiss-style typographic plates, like the paper plates of the user's 《△ 三角》. The line being sung is set
// huge on a 12-column grid next to a block in the signal colour, the cover cropped into a shape, hairline rules
// and small labels. Three layouts (stack / slab / split); paper or ink ground per shot. Words slide up out of
// their baseline as they are sung and the word being sung sits on a colour bar; every downbeat the block holds,
// then snaps to its next place on the grid; a marker ticks along the rule on each beat.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, lerp, outExpo, rng } from './types.ts';
import { textMesh, hasCjk } from '../render/text.ts';
import type { LineState } from '../director/lyrics.ts';
import type { SectionLabel } from '../types.ts';

const H = 9; // page height in world units
const FOV = 22;
const DIST = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const LABELS: Record<SectionLabel, string> = { intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏' };

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
interface Word { mesh: Mesh; bar: Mesh; x: number; y: number; w: number; h: number }
interface Line { index: number; root: THREE.Group; words: Word[]; trans: Mesh | null }

const flat = (color: THREE.Color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: false });

export class Poster implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  private page = new THREE.Group();
  private shot: Shot | null = null;
  private lines = new Map<number, Line>();
  private block: Mesh | null = null;
  private blockSpots: THREE.Vector2[] = [];
  private tick: Mesh | null = null;
  private counter: Mesh | null = null;
  private counterBar = -1;
  private fg = new THREE.Color();
  private bg = new THREE.Color();
  private sig = new THREE.Color();
  private W = 16;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    this.scene.add(this.page);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (Math.abs(this.W - H * aspect) > 0.01) { this.W = H * aspect; this.shot = null; }
  }

  private clear(): void {
    for (const l of this.lines.values()) this.dropLine(l);
    this.lines.clear();
    this.page.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
    this.page.clear();
    this.block = this.tick = this.counter = null;
    this.counterBar = -1;
  }

  private rect(w: number, h: number, mat: THREE.MeshBasicMaterial, x: number, y: number, z = 0): Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    this.page.add(m);
    return m;
  }

  /** The cover inside a shape: 'rect' (w × h crop from the middle), 'circle' or 'tri' (apex up). */
  private coverShape(kind: 'rect' | 'circle' | 'tri', w: number, h: number, x: number, y: number, z: number): Mesh {
    const geo = kind === 'circle' ? new THREE.CircleGeometry(w / 2, 96) : kind === 'tri' ? new THREE.CircleGeometry(w / 2, 3, Math.PI / 2) : new THREE.PlaneGeometry(w, h);
    // UVs: map the shape's bounding box onto a centred crop of the square cover.
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, 0.5 + (pos.getX(i) - (bb.min.x + bb.max.x) / 2) / span, 0.5 + (pos.getY(i) - (bb.min.y + bb.max.y) / 2) / span);
    }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.init.cover, toneMapped: false }));
    m.position.set(x, y, z);
    this.page.add(m);
    return m as Mesh;
  }

  private label(text: string, h: number, x: number, y: number, align: 'left' | 'right', opacity = 0.75): Mesh {
    const m = textMesh(text, 'bold', h, { px: 72, halo: 'none' }) as unknown as Mesh;
    m.material.color.copy(this.fg);
    m.material.opacity = opacity;
    m.material.toneMapped = false;
    m.position.set(align === 'left' ? x : x - (m.userData.width as number), y, 0.05);
    this.page.add(m);
    return m;
  }

  /** Static elements of a layout; the words come per line. */
  private build(shot: Shot): void {
    this.clear();
    const { palette } = this.init;
    const random = rng(shot.seed);
    const W = this.W, M = H * 0.07; // page width, margin
    const inkGround = this.look === 'ballad' ? random() < 0.3 : random() < 0.5;
    this.bg.copy(inkGround ? palette.ink : palette.paper);
    this.fg.copy(inkGround ? palette.paper : palette.ink);
    this.scene.background = this.bg.clone();
    // 12-column grid, faint.
    const hair = flat(this.fg, 0.07);
    for (let c = 0; c <= 12; c++) this.rect(0.012, H, hair, -W / 2 + M + ((W - 2 * M) * c) / 12, 0, -0.5);
    for (let r = 0; r <= 6; r++) this.rect(W, 0.012, hair, 0, -H / 2 + M + ((H - 2 * M) * r) / 6, -0.5);
    // The signal colour for blocks and bars — unless it is as light as the ground (a black-and-white cover's white
    // on paper), then halfway to ink so it still shows.
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    this.sig.copy(palette.signal);
    if (Math.abs(lum(this.sig) - lum(this.bg)) < 0.2) this.sig.lerp(palette.ink, 0.5);
    const sig = flat(this.sig);
    const variant = shot.variant;
    if (variant === 'slab') {
      this.block = this.rect(W * 1.2, H * 0.26, sig, 0, 0, -0.3);
      this.blockSpots = [new THREE.Vector2(0, 0), new THREE.Vector2(0, H * 0.06), new THREE.Vector2(0, -H * 0.06)];
      this.coverShape('tri', H * 0.36, H * 0.36, -W / 2 + M + H * 0.2, H / 2 - M - H * 0.17, -0.2);
    } else if (variant === 'split') {
      this.coverShape('rect', W * 0.38, H, -W / 2 + W * 0.19, 0, -0.2);
      this.block = this.rect(H * 0.12, H * 0.12, sig, -W / 2 + W * 0.38, H / 2 - M - H * 0.06, 0.1);
      this.blockSpots = [new THREE.Vector2(-W / 2 + W * 0.38, H / 2 - M - H * 0.06), new THREE.Vector2(-W / 2 + W * 0.38, -H / 2 + M + H * 0.06)];
    } else {
      const R = H * 0.34;
      this.block = new THREE.Mesh(new THREE.CircleGeometry(R, 128), sig) as unknown as Mesh;
      this.page.add(this.block);
      this.blockSpots = [new THREE.Vector2(W / 2 - R * 0.55, -H * 0.08), new THREE.Vector2(W / 2 - R * 0.9, H * 0.12), new THREE.Vector2(W / 2 - R * 0.35, -H * 0.2)];
      this.coverShape(random() < 0.5 ? 'rect' : 'circle', H * 0.34, H * 0.34, W / 2 - M - H * 0.62, -H * 0.22, 0.05);
    }
    if (this.block) this.block.position.set(this.blockSpots[0].x, this.blockSpots[0].y, this.block.position.z || -0.3);
    // Rule along the bottom with a beat marker, and the labels.
    const rule = flat(this.fg, 0.5);
    this.rect(W - 2 * M, 0.02, rule, 0, -H / 2 + M * 0.8, 0.02);
    this.tick = this.rect(H * 0.03, H * 0.03, flat(this.sig), -W / 2 + M, -H / 2 + M * 0.8, 0.03);
    this.label(`${LABELS[shot.section.label]} · ${Math.round(this.init.music.at(shot.start + 0.01).bpm)} BPM`, H * 0.028, W / 2 - M, H / 2 - M * 0.7, 'right');
  }

  private layoutLine(state: LineState): Line {
    const shot = this.shot!;
    const W = this.W, M = H * 0.07;
    const root = new THREE.Group();
    root.userData.lyrics = true;
    const line = state.line;
    const cjk = hasCjk(line.text);
    const words: Word[] = [];
    const variant = shot.variant;
    const mk = (text: string, h: number) => {
      const m = textMesh(text, 'display', h, { px: 200, halo: 'none' }) as unknown as Mesh;
      m.material.toneMapped = false;
      return m;
    };
    let x0: number, y0: number, maxW: number, h: number, align: 'left' | 'right' = 'left';
    if (variant === 'slab') { x0 = -W / 2 + M; y0 = H * 0.01; maxW = W - 2 * M; h = H * 0.13; }
    else if (variant === 'split') { x0 = W / 2 - M; y0 = H * 0.28; maxW = W * 0.52; h = H * 0.12; align = 'right'; }
    else { x0 = -W / 2 + M; y0 = H / 2 - M - H * 0.08; maxW = W * 0.55; h = H * 0.12; }
    // Fit: shrink until the line takes at most four rows.
    const probe = line.words.map(w => mk(w.text, h));
    const gap = cjk ? h * 0.08 : h * 0.3;
    let total = probe.reduce((a, m) => a + (m.userData.width as number), 0) + gap * (probe.length - 1);
    // On the slab the line runs as one row inside the bar (knocked-out type only reads on the bar). A single word
    // wider than the column shrinks the line too, or it would run into the cover and the block.
    const rowsMax = variant === 'slab' ? 1 : 4;
    const widest = Math.max(1e-3, ...probe.map(m => m.userData.width as number));
    const scale = Math.min(total > maxW * rowsMax * 0.98 ? (maxW * rowsMax * 0.98) / total : 1, (maxW * 0.98) / widest);
    h *= scale;
    probe.forEach(m => { m.scale.setScalar(scale); m.userData.width = (m.userData.width as number) * scale; });
    total *= scale;
    // Stack keeps each Latin word on its own row when it fits: the poster look.
    const stack = variant === 'stack' && !cjk && probe.length <= 5;
    const rows: number[][] = [[]];
    let acc = 0;
    probe.forEach((m, i) => {
      const w = m.userData.width as number;
      if (acc > 0 && variant !== 'slab' && (stack || acc + w > maxW)) { rows.push([]); acc = 0; }
      rows[rows.length - 1].push(i);
      acc += w + gap * scale;
    });
    const lineH = h * (cjk ? 1.2 : 1.02);
    if (variant === 'slab') y0 = ((rows.length - 1) * lineH) / 2;
    const barMat = () => flat(this.sig);
    rows.forEach((row, r) => {
      const rowW = row.reduce((a, i) => a + (probe[i].userData.width as number), 0) + gap * scale * (row.length - 1);
      let x = align === 'left' ? x0 : x0 - rowW;
      for (const i of row) {
        const m = probe[i], w = m.userData.width as number;
        const y = y0 - r * lineH;
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, h * 0.92), barMat()) as unknown as Mesh;
        bar.geometry.translate(0.5, 0, 0);
        bar.position.set(x - h * 0.06, y, 0.1);
        bar.scale.x = 0.0001;
        root.add(bar, m);
        words.push({ mesh: m, bar, x, y, w, h });
        x += w + gap * scale;
      }
    });
    let trans: Mesh | null = null;
    if (line.translation) {
      trans = textMesh(line.translation, 'bold', H * 0.034, { px: 96, halo: 'none' }) as unknown as Mesh;
      trans.material.toneMapped = false;
      const bottom = y0 - (rows.length - 1) * lineH - h * 0.9;
      const tw = trans.userData.width as number;
      trans.position.set(align === 'left' ? x0 : x0 - tw, variant === 'slab' ? -H * 0.2 : bottom, 0.12);
      root.add(trans);
    }
    this.page.add(root);
    return { index: state.index, root, words, trans };
  }

  private dropLine(l: Line): void {
    this.page.remove(l.root);
    l.root.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    if (this.shot !== shot) { this.shot = shot; this.build(shot); }
    const info = music.at(t);
    const since = t - shot.start;
    const W = this.W, M = H * 0.07;
    const onSlab = shot.variant === 'slab';

    // Entrance: the page settles in over half a second.
    const enter = outExpo(clamp01(since / 0.5));
    this.page.position.set(0, (1 - enter) * -0.6, 0);

    // The block holds, then snaps to its next spot on each downbeat.
    if (this.block && this.blockSpots.length) {
      const spots = this.blockSpots, n = spots.length;
      const a = spots[info.bar % n], b = spots[(info.bar + n - 1) % n];
      const e = outExpo(clamp01(info.barPhase / 0.12));
      const kick = this.look === 'ballad' ? 0 : music.pulse('kick', t, 0.1);
      this.block.position.x = lerp(b.x, a.x, e);
      this.block.position.y = lerp(b.y, a.y, e);
      this.block.scale.setScalar((onSlab ? 1 : 1 + kick * 0.04) * (0.2 + 0.8 * enter));
    }
    // A marker ticks along the rule, one step per beat across the bar.
    if (this.tick) {
      const steps = this.init.music.meter;
      const step = Math.floor(info.inBar) % steps;
      this.tick.position.x = -W / 2 + M + ((W - 2 * M) * (step + outExpo(clamp01((info.inBar % 1) / 0.2)) * 0)) / steps;
    }
    // Bar counter, bottom left, like the counter of 《三角》.
    if (info.bar !== this.counterBar) {
      if (this.counter) { this.page.remove(this.counter); this.counter.geometry.dispose(); this.counter.material.dispose(); }
      this.counterBar = info.bar;
      this.counter = this.label(`${this.look === 'ballad' ? '○' : '△'} ${String(info.bar + 1).padStart(3, '0')}`, H * 0.03, -W / 2 + M, -H / 2 + M * 0.35, 'left', 0.85);
    }

    // Lines: the leaving one fades, the entering one builds word by word.
    const states = ctx.lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const [i, l] of Array.from(this.lines)) if (!keep.has(i)) { this.dropLine(l); this.lines.delete(i); }
    for (const st of states) {
      const l = this.lines.get(st.index) ?? this.lines.set(st.index, this.layoutLine(st)).get(st.index)!;
      // A leaving line scrolls off the top of the page, translation and all, like turning a page.
      const fade = (1 - st.exit) * (1 - st.exit);
      l.root.position.y = outExpo(st.exit) * H * 0.6;
      st.words.forEach((ws, i) => {
        const w = l.words[i];
        if (!w) return;
        const k = outExpo(clamp01((ws.age + 0.05) / 0.22));
        w.mesh.visible = ws.age > -0.05 && fade > 0;
        w.mesh.position.set(w.x, w.y - (1 - k) * w.h * 0.5, 0.2);
        const singing = ws.progress > 0 && ws.progress < 1 || (ws.age >= 0 && ws.age < 0.12);
        // Colour bar under the sung word; on the slab the words knock out to the ground colour.
        w.bar.scale.x = singing ? Math.max(0.0001, (w.w + w.h * 0.12) * outExpo(clamp01(ws.age / 0.12))) : 0.0001;
        w.bar.visible = singing && !onSlab;
        const base = onSlab ? this.bg : this.fg;
        w.mesh.material.color.copy(singing && !onSlab ? this.bg : base);
        if (singing && onSlab) w.mesh.material.color.copy(palette.paper);
        w.mesh.material.opacity = k * fade;
      });
      if (l.trans) {
        l.trans.material.color.copy(onSlab ? this.fg : this.fg);
        l.trans.material.opacity = clamp01(st.translationProgress * 3) * 0.75 * fade;
      }
    }

    // A slow parallax drift.
    const random = rng(shot.seed);
    const sx = random() < 0.5 ? -1 : 1;
    const k = clamp01(since / Math.max(0.5, shot.end - shot.start));
    this.camera.position.set(sx * lerp(0.25, -0.25, k), lerp(0.12, -0.12, k), DIST);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    ctx.fx.bloom = 0.05;
    ctx.fx.vignette = 0.12;
    ctx.fx.grain = 0.03;
  }
}
