// Palette from the album cover: a near-black ink, a warm paper white, the cover's most vivid prominent colour as
// the signal, and a second hue far from it. Clustering runs in OKLab so "vivid" and "similar" match perception.
import * as THREE from 'three';

export interface Palette {
  ink: THREE.Color;
  paper: THREE.Color;
  signal: THREE.Color;
  accent: THREE.Color;
  /** The cover is mostly light: scenes that show it whole should sit it on a light backdrop and set dark type. */
  light: boolean;
  /** Backdrop around the whole cover: its dominant light colour, dimmed (light covers), or the ink (dark ones). */
  backdrop: THREE.Color;
  /** Flat graphic artwork (few large colour regions) rather than a photo or painting. */
  graphic: boolean;
  /** Share of pixels on a colour-region boundary (0 = one flat colour); `graphic` is this below a threshold. */
  complexity: number;
  /** The cover has no real colour (a black-and-white photo): signal is white, accent grey. */
  mono: boolean;
  /** CSS hex strings of the same colours. */
  css: { ink: string; paper: string; signal: string; accent: string };
}

export type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** sRGB components 0..1 → OKLab. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  r = toLinear(r); g = toLinear(g); b = toLinear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function labToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.max(0, Math.min(1, toSrgb(x)));
  return [clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

const chroma = (c: Lab) => Math.hypot(c[1], c[2]);
const hue = (c: Lab) => Math.atan2(c[2], c[1]);
const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

function withLC(c: Lab, L: number, C: number): Lab {
  const h = hue(c);
  return [L, Math.cos(h) * C, Math.sin(h) * C];
}

function color(lab: Lab): THREE.Color {
  const [r, g, b] = labToRgb(lab);
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

export function paletteFromImage(img: CanvasImageSource): Palette {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const px: Lab[] = [];
  for (let i = 0; i < data.length; i += 4) px.push(rgbToLab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255));

  // k-means, deterministic init: spread seeds across lightness order.
  const k = 7;
  const sorted = px.slice().sort((p, q) => p[0] - q[0]);
  let centers: Lab[] = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice() as Lab);
  const assign = new Int32Array(px.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist2(px[i], centers[c]); if (d < bd) { bd = d; best = c; } }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) { const s = sums[assign[i]]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++; }
    centers = centers.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c));
  }
  const weight = centers.map((_, c) => { let n = 0; for (let i = 0; i < assign.length; i++) if (assign[i] === c) n++; return n / px.length; });
  const darkest = centers.reduce((a, c) => (c[0] < a[0] ? c : a), centers[0]);

  // Signal and accent come from the cover's own coloured pixels, not the cluster centres (which average a small or
  // muted coloured area into grey): a hue histogram weighted by chroma finds the main colour, and a second one well
  // away from it. Nothing is invented: a black-and-white cover gets a white signal and a grey accent, a muted cover
  // keeps its muted hues (only lifted a little so they still read as colour).
  const coloured = px.filter(p => chroma(p) > 0.03);
  const mono = coloured.length < px.length * 0.03 || quantile(coloured.map(chroma), 0.9) < 0.04;
  let signalLab: Lab, accentLab: Lab;
  if (mono) {
    signalLab = [0.93, 0, 0];
    accentLab = [0.62, 0, 0];
  } else {
    const BINS = 24, bin = (p: Lab) => Math.floor((((hue(p) / (Math.PI * 2)) % 1) + 1) % 1 * BINS) % BINS;
    const mass = new Float64Array(BINS);
    for (const p of coloured) mass[bin(p)] += chroma(p) ** 2 * (p[0] > 0.3 ? 1 : 0.5);
    const smooth = Array.from(mass, (m, b) => m + 0.5 * (mass[(b + 1) % BINS] + mass[(b + BINS - 1) % BINS]));
    const gap = (a: number, b: number) => { const d = Math.abs(a - b) % BINS; return Math.min(d, BINS - d); };
    const peak = smooth.indexOf(Math.max(...smooth));
    // The pixels around a peak: their hue (weighted mean), lightness (median) and chroma (upper quartile).
    const colourAt = (b: number, cq: number, lo: number, hi: number, cMax: number): Lab => {
      const near = coloured.filter(p => gap(bin(p), b) <= 1);
      let x = 0, y = 0;
      for (const p of near) { const w = chroma(p); x += p[1] * w; y += p[2] * w; }
      const c = Math.min(cMax, Math.max(0.05, quantile(near.map(chroma), cq) * 1.15));
      const L = Math.max(lo, Math.min(hi, quantile(near.map(p => p[0]), 0.5)));
      return withLC([L, x, y], L, c);
    };
    signalLab = colourAt(peak, 0.75, 0.7, 0.84, 0.2);
    // Accent: the strongest other hue at least 45° away, if the cover really has one; else a quieter signal.
    let second = -1;
    for (let b = 0; b < BINS; b++) if (gap(b, peak) >= 3 && (second < 0 || smooth[b] > smooth[second])) second = b;
    accentLab = second >= 0 && smooth[second] > smooth[peak] * 0.15
      ? colourAt(second, 0.7, 0.6, 0.8, 0.16)
      : withLC(signalLab, 0.66, chroma(signalLab) * 0.55);
  }
  const inkLab: Lab = withLC(darkest, 0.13, mono ? 0 : Math.min(0.025, chroma(darkest)));
  const paperLab: Lab = withLC(signalLab, 0.95, mono ? 0 : 0.012);

  const ink = color(inkLab), paper = color(paperLab), signal = color(signalLab), accent = color(accentLab);
  const meanL = px.reduce((a, p) => a + p[0], 0) / px.length;
  // How broken-up the colour regions are: share of pixels whose right or lower neighbour is another cluster.
  let breaks = 0;
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const i = y * size + x;
    if (assign[i] !== assign[i + 1] || assign[i] !== assign[i + size]) breaks++;
  }
  const complexity = breaks / ((size - 1) * (size - 1));
  const graphic = complexity < 0.3; // measured: 一程山路 0.28, a portrait on a flat backdrop 0.28; paintings and illustrations 0.33–0.86
  const light = meanL > 0.66;
  const biggest = centers.reduce((best, c, i) => (weight[i] > weight[best] ? i : best), 0);
  const backdrop = light ? color(withLC(centers[biggest], Math.min(0.9, centers[biggest][0] * 0.93), Math.min(0.03, chroma(centers[biggest])))) : ink.clone();
  const hex = (c: THREE.Color) => '#' + c.getHexString(THREE.SRGBColorSpace);
  return { ink, paper, signal, accent, light, backdrop, graphic, complexity, mono, css: { ink: hex(ink), paper: hex(paper), signal: hex(signal), accent: hex(accent) } };
}

/** The q-quantile (0..1) of a list of numbers (0 for an empty list). */
function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
