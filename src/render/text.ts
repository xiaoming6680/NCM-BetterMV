// Words as textures. Latin set in bundled faces (Archivo; Bodoni Moda and Cormorant Garamond for the lyric voices);
// CJK in the bundled Smiley Sans (the condensed voice's) and LXGW WenKai (Kai), otherwise whatever good system font
// the machine has. Glyphs are drawn white; materials tint them, so one texture serves every colour.
// (No Archivo Expanded any more. The user, 2026-10-13, of the film's name set in it: “好丑，以后都不要用这个字体”.)
import * as THREE from 'three';

export type Face = 'bold' | 'light' | 'serif' | 'serifLight'
  | 'condensed' | 'condensedBlack' | 'didone' | 'didoneBold' | 'garamond' | 'garamondItalic' | 'garamondLight';

const SERIF_STACK = '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "Songti SC", "SimSun", serif';
const CJK_STACK = '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "DengXian", sans-serif';
/** Display CJK: Smiley Sans (bundled, OFL; one weight), the system sans for what it lacks. */
const SMILEY_STACK = '"BMV Smiley", ' + CJK_STACK;
/** Kai: LXGW WenKai Lite (bundled, OFL, cut to GB2312 and kana), the system Kai for what it lacks. */
const KAI_STACK = '"BMV WenKai", "LXGW WenKai", "KaiTi", "STKaiti", "楷体", serif';
/**
 * The lyric voices' faces set Latin and CJK each in its own font, drawn run by run (one font string
 * would make the browser fake a bold for a face that has one weight): the Latin family, then the CJK stack and its
 * weight.
 */
const PAIRED: Partial<Record<Face, { latin: string; cjk: string; cjkWeight: number }>> = {
  condensed: { latin: '"BMV Archivo Condensed"', cjk: SMILEY_STACK, cjkWeight: 400 },
  condensedBlack: { latin: '"BMV Archivo Condensed Black"', cjk: SMILEY_STACK, cjkWeight: 400 },
  didone: { latin: '"BMV Bodoni"', cjk: SERIF_STACK, cjkWeight: 500 },
  didoneBold: { latin: '"BMV Bodoni Bold"', cjk: SERIF_STACK, cjkWeight: 700 },
  garamond: { latin: '"BMV Cormorant"', cjk: KAI_STACK, cjkWeight: 400 },
  garamondItalic: { latin: '"BMV Cormorant Italic"', cjk: KAI_STACK, cjkWeight: 400 },
  garamondLight: { latin: '"BMV Cormorant Light"', cjk: KAI_STACK, cjkWeight: 400 },
};
const LATIN: Record<Face, string> = {
  bold: '"BMV Archivo Bold"',
  light: '"BMV Archivo Light"',
  serif: SERIF_STACK,
  serifLight: SERIF_STACK,
  condensed: PAIRED.condensed!.latin, condensedBlack: PAIRED.condensedBlack!.latin, didone: PAIRED.didone!.latin, didoneBold: PAIRED.didoneBold!.latin,
  garamond: PAIRED.garamond!.latin, garamondItalic: PAIRED.garamondItalic!.latin, garamondLight: PAIRED.garamondLight!.latin,
};
const CJK_WEIGHT: Record<Face, number> = {
  bold: 700, light: 300, serif: 600, serifLight: 300,
  condensed: 700, condensedBlack: 900, didone: 500, didoneBold: 700, garamond: 400, garamondItalic: 400, garamondLight: 400,
};
const isSerif = (face: Face) => face === 'serif' || face === 'serifLight';
/** A character set in the CJK font of a paired face (kana, hanzi, hangul, CJK and full-width marks). */
const isCjkChar = (ch: string) => /[　-ヿ㐀-鿿가-힯豈-﫿＀-￯]/.test(ch);

export const hasCjk = (s: string) => /[぀-ヿ㐀-鿿豈-﫿가-힯]/.test(s);

/** Loads the bundled Latin faces, from a URL base (dev) or a file reader (the plugin, which can't use URLs). */
export async function loadFonts(source: string | ((file: string) => Promise<ArrayBuffer>)): Promise<void> {
  const faces: Array<[string, string]> = [
    ['BMV Archivo Bold', 'Archivo-w1000-700.ttf'],
    ['BMV Archivo Light', 'Archivo-w1000-300.ttf'],
    ['BMV Archivo Condensed', 'Archivo-w620-700.ttf'],
    ['BMV Archivo Condensed Black', 'Archivo-w620-900.ttf'],
    ['BMV Bodoni', 'BodoniModa-o40-500.ttf'],
    ['BMV Bodoni Bold', 'BodoniModa-o40-800.ttf'],
    ['BMV Cormorant', 'CormorantGaramond-600.ttf'],
    ['BMV Cormorant Italic', 'CormorantGaramond-Italic-600.ttf'],
    ['BMV Cormorant Light', 'CormorantGaramond-400.ttf'],
    ['BMV Smiley', 'SmileySans-Oblique.woff2'],
    ['BMV WenKai', 'LXGWWenKaiLite-GB.woff2'],
  ];
  await Promise.all(faces.map(async ([family, file]) => {
    const face = new FontFace(family, typeof source === 'string' ? `url(${source}${file})` : await source(file));
    await face.load();
    document.fonts.add(face);
  }));
  // Make sure the CJK system fonts are resolved before the first texture is drawn.
  await document.fonts.load(`700 64px ${CJK_STACK}`, '澄净');
  await document.fonts.load(`600 64px ${SERIF_STACK}`, '澄净 Clarity');
  await document.fonts.load(`400 64px ${KAI_STACK}`, '澄净');
  await document.fonts.load(`400 64px ${SMILEY_STACK}`, '澄净');
}

export interface TextTexture {
  texture: THREE.CanvasTexture;
  /** Canvas size, the font size, the text's advance width and the halo padding, all in pixels. */
  boxW: number;
  boxH: number;
  px: number;
  advance: number;
  pad: number;
}

const cache = new Map<string, TextTexture>();
let anisotropy = 4;
export function setAnisotropy(n: number) { anisotropy = n; }

/** 'dark': light type on a dark glow (tint with material.color). 'none': plain white glyphs to tint, for flat
 * graphic layouts. Otherwise a CSS colour: type drawn in that colour on a white glow, for dark type on light
 * frames — keep material.color white for these. */
export type Halo = 'dark' | 'none' | string;

/** Cell height of vertical text, in ems (one character per cell, top to bottom). */
export const VERTICAL_STEP = 1.16;

/**
 * A texture of `text` at `px` pixels per em with a soft halo baked in (see Halo). `vertical` stacks the characters
 * top to bottom, one per VERTICAL_STEP cell (for CJK set in columns).
 */
export function textTexture(text: string, face: Face, px = 160, halo: Halo = 'dark', vertical = false): TextTexture {
  // The condensed voice is set in capitals wherever it is used (CJK is unchanged by it).
  if (face === 'condensed' || face === 'condensedBlack') text = text.toUpperCase();
  const key = face + '|' + px + '|' + halo + '|' + (vertical ? 'v|' : '') + text;
  const hit = cache.get(key);
  if (hit) return hit;
  const cjk = hasCjk(text);
  const pair = PAIRED[face];
  const font = isSerif(face) ? `${CJK_WEIGHT[face]} ${px}px ${SERIF_STACK}`
    : cjk && !pair ? `${CJK_WEIGHT[face]} ${px}px ${CJK_STACK}` : `${px}px ${LATIN[face]}, ${pair?.cjk ?? CJK_STACK}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  // A paired face: runs of Latin and of CJK, each in its own font.
  const cjkFont = pair ? `${pair.cjkWeight} ${px}px ${pair.cjk}` : font;
  const runs: Array<{ s: string; font: string; w: number }> = [];
  if (pair && !vertical) {
    for (const ch of Array.from(text)) {
      const f = isCjkChar(ch) ? cjkFont : font, last = runs[runs.length - 1];
      if (last && last.font === f) last.s += ch; else runs.push({ s: ch, font: f, w: 0 });
    }
    for (const r of runs) { ctx.font = r.font; r.w = ctx.measureText(r.s).width; }
  }
  ctx.font = font;
  const pad = Math.ceil(px * 0.3);
  const chars = Array.from(text);
  const advance = vertical ? px : runs.length ? runs.reduce((a, r) => a + r.w, 0) : ctx.measureText(text).width;
  const w = Math.ceil(advance) + pad * 2;
  const h = (vertical ? Math.ceil(px * VERTICAL_STEP * chars.length) : Math.ceil(px * 1.24)) + pad * 2;
  canvas.width = w; canvas.height = h;
  const baseline = pad + px * (cjk ? 0.98 : 0.96);
  // The strokes, on this canvas or (inkPoints) on a smaller one scaled by k: a shadow's blur isn't scaled with the
  // drawing, so it is given scaled.
  const paint = (ctx: CanvasRenderingContext2D, k = 1) => {
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = vertical ? 'center' : 'start';
    // Vertical: each character centred in its cell (a glyph's middle sits about 0.36 em above its baseline).
    const draw = () => {
      if (runs.length) {
        let x = pad;
        for (const r of runs) { ctx.font = r.font; ctx.fillText(r.s, x, baseline); x += r.w; }
        return;
      }
      if (!vertical) { ctx.fillText(text, pad, baseline); return; }
      chars.forEach((ch, i) => { if (pair) ctx.font = isCjkChar(ch) ? cjkFont : font; ctx.fillText(ch, w / 2, pad + px * (VERTICAL_STEP * (i + 0.5) + 0.36)); });
    };
    // The halo is baked in: the material tint leaves black black, so it keeps words readable on busy frames.
    if (halo === 'none') {
      draw();
    } else if (halo === 'dark') {
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = px * 0.22 * k;
      draw();
      ctx.shadowBlur = 0;
      draw();
    } else {
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = px * 0.3 * k;
      ctx.fillStyle = halo;
      draw();
      ctx.shadowBlur = 0;
      draw();
    }
  };
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  strokes.set(texture, { w, h, paint });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const out = { texture, boxW: w, boxH: h, px, advance, pad };
  cache.set(key, out);
  return out;
}

/**
 * A plane showing `text` with an em height of `height` world units. Pivot at the left edge of the text
 * (or its centre), vertically at the middle of the line. userData.width is the advance width for layout.
 */
export function textMesh(text: string, face: Face, height: number, opts: { center?: boolean; px?: number; halo?: Halo; vertical?: boolean } = {}): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const tex = textTexture(text, face, opts.px ?? 160, opts.halo ?? 'dark', opts.vertical);
  const unit = height / tex.px;
  const advance = tex.advance * unit;
  const geometry = new THREE.PlaneGeometry(tex.boxW * unit, tex.boxH * unit);
  geometry.translate(opts.center ? 0 : advance / 2, 0, 0);
  const material = new THREE.MeshBasicMaterial({ map: tex.texture, transparent: true, depthWrite: false, toneMapped: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.width = advance;
  return mesh;
}

/**
 * A hidden text mesh (a full stop) for where words will appear later: a plate's warm-up compiles hidden objects too, so
 * the program the words use is ready (and kept, while this holds it) before the first line is sung — made on the
 * line's first frame instead, it held that frame up 100–150 ms.
 */
export function textPrimer(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  return primer(textMesh('.', 'bold', 0.001, { px: 16, halo: 'none' }));
}

/**
 * Hides a stand-in mesh made only to have its program compiled in the warm-up (textPrimer): also out of every bounding
 * box (an empty one: the lens focuses on the lyrics' box, and a stand-in at their group's origin moved the focus).
 */
export function primer<T extends THREE.Mesh | THREE.Points>(m: T): T {
  m.visible = false;
  m.frustumCulled = false;
  m.geometry.boundingBox = new THREE.Box3();
  m.userData.primer = true;
  return m;
}

/** How each text texture was drawn (textTexture), for inkPoints. */
const strokes = new WeakMap<THREE.Texture, { w: number; h: number; paint: (ctx: CanvasRenderingContext2D, k?: number) => void }>();

/**
 * Where a text texture's light is (the glyphs, and a light halo; red above 150), on a grid of about `samples` points,
 * as x, y pairs in 0..1 of its box. The strokes are drawn again on a canvas that small rather than read back from the
 * texture's own: reading back a large canvas the GPU drew held the page up (~180 ms as a line of lyrics crumbled).
 */
export function inkPoints(texture: THREE.Texture, samples = 9000): Float32Array | null {
  const s = strokes.get(texture);
  if (!s) return null;
  const step = Math.max(1, Math.round(Math.sqrt((s.w * s.h) / samples)));
  const cw = Math.ceil(s.w / step), ch = Math.ceil(s.h / step);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.scale(1 / step, 1 / step);
  s.paint(ctx, 1 / step);
  const px = ctx.getImageData(0, 0, cw, ch).data;
  const out: number[] = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (px[(y * cw + x) * 4] > 150) out.push((x * step) / s.w, (y * step) / s.h);
  return Float32Array.from(out);
}

export function disposeText(): void {
  for (const t of cache.values()) t.texture.dispose();
  cache.clear();
}
