// Words as textures. Latin set in Archivo (bundled), CJK in whatever good system font the machine has.
// Glyphs are drawn white; materials tint them, so one texture serves every colour.
import * as THREE from 'three';

export type Face = 'display' | 'bold' | 'light' | 'serif' | 'serifLight';

const SERIF_STACK = '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "Songti SC", "SimSun", serif';
const LATIN: Record<Face, string> = {
  display: '"BMV Archivo Expanded"',
  bold: '"BMV Archivo Bold"',
  light: '"BMV Archivo Light"',
  serif: SERIF_STACK,
  serifLight: SERIF_STACK,
};
const CJK_STACK = '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "DengXian", sans-serif';
const CJK_WEIGHT: Record<Face, number> = { display: 900, bold: 700, light: 300, serif: 600, serifLight: 300 };
const isSerif = (face: Face) => face === 'serif' || face === 'serifLight';

export const hasCjk = (s: string) => /[぀-ヿ㐀-鿿豈-﫿가-힯]/.test(s);

/** Loads the bundled Latin faces, from a URL base (dev) or a file reader (the plugin, which can't use URLs). */
export async function loadFonts(source: string | ((file: string) => Promise<ArrayBuffer>)): Promise<void> {
  const faces: Array<[string, string]> = [
    ['BMV Archivo Expanded', 'Archivo-w1250-900.ttf'],
    ['BMV Archivo Bold', 'Archivo-w1000-700.ttf'],
    ['BMV Archivo Light', 'Archivo-w1000-300.ttf'],
  ];
  await Promise.all(faces.map(async ([family, file]) => {
    const face = new FontFace(family, typeof source === 'string' ? `url(${source}${file})` : await source(file));
    await face.load();
    document.fonts.add(face);
  }));
  // Make sure the CJK system fonts are resolved before the first texture is drawn.
  await document.fonts.load(`700 64px ${CJK_STACK}`, '澄净');
  await document.fonts.load(`600 64px ${SERIF_STACK}`, '澄净 Clarity');
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
  const key = face + '|' + px + '|' + halo + '|' + (vertical ? 'v|' : '') + text;
  const hit = cache.get(key);
  if (hit) return hit;
  const cjk = hasCjk(text);
  const font = isSerif(face) ? `${CJK_WEIGHT[face]} ${px}px ${SERIF_STACK}`
    : cjk ? `${CJK_WEIGHT[face]} ${px}px ${CJK_STACK}` : `${px}px ${LATIN[face]}, ${CJK_STACK}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const pad = Math.ceil(px * 0.3);
  const chars = Array.from(text);
  const advance = vertical ? px : ctx.measureText(text).width;
  const w = Math.ceil(advance) + pad * 2;
  const h = (vertical ? Math.ceil(px * VERTICAL_STEP * chars.length) : Math.ceil(px * 1.24)) + pad * 2;
  canvas.width = w; canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = vertical ? 'center' : 'start';
  const baseline = pad + px * (cjk ? 0.98 : 0.96);
  // Vertical: each character centred in its cell (a glyph's middle sits about 0.36 em above its baseline).
  const draw = () => {
    if (!vertical) { ctx.fillText(text, pad, baseline); return; }
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, pad + px * (VERTICAL_STEP * (i + 0.5) + 0.36)));
  };
  // The halo is baked in: the material tint leaves black black, so it keeps words readable on busy frames.
  if (halo === 'none') {
    draw();
  } else if (halo === 'dark') {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = px * 0.22;
    draw();
    ctx.shadowBlur = 0;
    draw();
  } else {
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = px * 0.3;
    ctx.fillStyle = halo;
    draw();
    ctx.shadowBlur = 0;
    draw();
  }
  const texture = new THREE.CanvasTexture(canvas);
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

export function disposeText(): void {
  for (const t of cache.values()) t.texture.dispose();
  cache.clear();
}
