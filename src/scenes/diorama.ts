// Diorama: the cover cut into paper layers, like a paper-cut lightbox. Colours are clustered; clusters that hug
// the border sit at the back, those near the centre come forward. Each sheet carries only its own cluster; the
// back plate is the whole picture with the foreground painted out, so moving the camera opens up depth without
// holes or doubles. Light comes from behind: sheet edges glow, each sheet drops a soft shadow on the one behind.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig, type Align } from './lyricRig.ts';

const LAYERS = 6;
const GAP = 0.85;
const SIZE = 10;
const CAMERA_Z = 18.5;
const MASK = 256;

type Lab = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function lab(r: number, g: number, b: number): Lab {
  r = toLinear(r); g = toLinear(g); b = toLinear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Soft masks, back to front: mask[i] covers the pixels whose cluster sits at depth i or nearer. */
function cutLayers(pixels: Uint8ClampedArray, size: number): { masks: Float32Array[]; back: Uint8Array } {
  const n = MASK * MASK, step = size / MASK;
  const px: Lab[] = new Array(n);
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) {
    const o = (Math.floor(y * step) * size + Math.floor(x * step)) * 4;
    px[y * MASK + x] = lab(pixels[o] / 255, pixels[o + 1] / 255, pixels[o + 2] / 255);
  }
  // k-means on a subsample, seeds spread over lightness.
  const sample = px.filter((_, i) => i % 7 === 0);
  const sorted = sample.slice().sort((a, b) => a[0] - b[0]);
  let centers: Lab[] = Array.from({ length: LAYERS }, (_, i) => sorted[Math.floor(((i + 0.5) / LAYERS) * sorted.length)].slice() as Lab);
  const d2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of sample) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < LAYERS; c++) { const d = d2(p, centers[c]); if (d < bd) { bd = d; best = c; } }
      const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    centers = centers.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] as Lab : c));
  }
  // Depth: share on the border and mean distance from the centre push a cluster back; chroma pulls it forward.
  const assign = new Uint8Array(n);
  const stats = centers.map(() => ({ n: 0, border: 0, dist: 0 }));
  for (let i = 0; i < n; i++) {
    let best = 0, bd = Infinity;
    for (let c = 0; c < LAYERS; c++) { const d = d2(px[i], centers[c]); if (d < bd) { bd = d; best = c; } }
    assign[i] = best;
    const x = (i % MASK) / MASK - 0.5, y = Math.floor(i / MASK) / MASK - 0.5;
    const s = stats[best];
    s.n++; s.dist += Math.hypot(x, y);
    if (Math.max(Math.abs(x), Math.abs(y)) > 0.38) s.border++;
  }
  const depth = centers.map((c, i) => {
    const s = stats[i];
    if (!s.n) return 99;
    return 0.6 * (s.border / s.n) + 0.8 * (s.dist / s.n) - 0.6 * Math.hypot(c[1], c[2]);
  });
  const order = centers.map((_, i) => i).sort((a, b) => depth[b] - depth[a]); // back → front
  const rank = new Uint8Array(LAYERS);
  order.forEach((c, r) => (rank[c] = r));

  // Each sheet carries only its own cluster (soft-edged), so nothing appears twice when the camera moves.
  const masks: Float32Array[] = [];
  for (let r = 0; r < LAYERS; r++) {
    let m: Float32Array = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = rank[assign[i]] === r ? 1 : 0;
    for (let pass = 0; pass < 3; pass++) m = boxBlur(m, 2);
    for (let i = 0; i < n; i++) m[i] = smooth((m[i] - 0.3) / 0.3);
    masks.push(m);
  }
  // The back plate is the whole picture with everything in front painted out: the backmost cluster's colours
  // spread into the holes (normalised convolution, growing radius until every hole is filled).
  const rgb = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) {
    const o = (Math.floor(y * step) * size + Math.floor(x * step)) * 4, i = y * MASK + x;
    rgb[0][i] = pixels[o]; rgb[1][i] = pixels[o + 1]; rgb[2][i] = pixels[o + 2];
  }
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) keep[i] = rank[assign[i]] === 0 ? 1 : 0;
  const fill = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const filled = new Float32Array(n);
  for (const radius of [4, 12, 32, 96]) {
    let den: Float32Array = keep;
    const num = rgb.map(ch => { const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = ch[i] * keep[i]; return out; });
    let nb: Float32Array[] = num;
    for (let pass = 0; pass < 2; pass++) { den = boxBlur(den, radius); nb = nb.map(ch => boxBlur(ch, radius)); }
    for (let i = 0; i < n; i++) {
      if (filled[i] || den[i] < 1e-3) continue;
      for (let c = 0; c < 3; c++) fill[c][i] = nb[c][i] / den[i];
      filled[i] = 1;
    }
  }
  const back = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = keep[i];
    for (let c = 0; c < 3; c++) back[i * 4 + c] = Math.round(rgb[c][i] * k + (filled[i] ? fill[c][i] : rgb[c][i]) * (1 - k));
    back[i * 4 + 3] = 255;
  }
  return { masks, back };
}

function boxBlur(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = 2 * radius + 1;
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += src[y * MASK + Math.min(MASK - 1, Math.max(0, x + k))];
    tmp[y * MASK + x] = s / w;
  }
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += tmp[Math.min(MASK - 1, Math.max(0, y + k)) * MASK + x];
    out[y * MASK + x] = s / w;
  }
  return out;
}

const sheetVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const sheetFragment = /* glsl */ `
  uniform sampler2D uCover, uMask;
  uniform vec3 uRim, uInk, uFog;
  uniform float uRimGain, uShade, uShadow, uTexel, uShadowGain;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uMask, vUv).r;
    if (uShadow > 0.5) {
      // Shadow pass: the same cut-out, blurred through the mip chain, dark.
      float s = texture2D(uMask, vUv, 3.0).r;
      gl_FragColor = vec4(uInk * 0.4, s * uShadowGain);
      return;
    }
    if (a < 0.01) discard;
    vec3 col = texture2D(uCover, vUv).rgb;
    // Edge light: the paper's cut edge catches the backlight.
    float gx = texture2D(uMask, vUv + vec2(uTexel, 0.0)).r - texture2D(uMask, vUv - vec2(uTexel, 0.0)).r;
    float gy = texture2D(uMask, vUv + vec2(0.0, uTexel)).r - texture2D(uMask, vUv - vec2(0.0, uTexel)).r;
    float edge = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
    col = mix(col, uFog, uShade);
    col += uRim * edge * uRimGain;
    gl_FragColor = vec4(col, a);
  }`;

const dustVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime, uGlow;
  varying float vA;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * (0.07 + aSeed.x * 0.08) + aSeed.y * 6.28) * 0.9;
    p.y += mod(uTime * (0.05 + aSeed.z * 0.1) + aSeed.w * 10.0, 10.0) - 5.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float focus = abs(-mv.z - ${CAMERA_Z.toFixed(1)});
    gl_PointSize = (0.25 + focus * 0.9) * (220.0 / -mv.z);
    vA = (0.25 + 0.75 * fract(aSeed.x * 17.0 + uTime * 0.1)) * uGlow / (1.0 + focus * focus * 0.6);
    gl_Position = projectionMatrix * mv;
  }`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(uColor, smoothstep(1.0, 0.2, r) * vA);
  }`;

export class Diorama implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  private sheets: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private shadows: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private rig: LyricRig;
  /** Where the camera looks: the middle of the nearest sheet's cut-out. */
  private focus = new THREE.Vector2();

  constructor(private init: SceneInit) {
    const { palette } = init;
    const light = palette.light;
    this.scene.background = palette.backdrop.clone();
    const { masks, back } = cutLayers(init.coverPixels, init.coverSize);
    const plate = new THREE.DataTexture(back, MASK, MASK, THREE.RGBAFormat);
    plate.colorSpace = THREE.SRGBColorSpace;
    plate.flipY = true;
    plate.generateMipmaps = true;
    plate.minFilter = THREE.LinearMipmapLinearFilter;
    plate.magFilter = THREE.LinearFilter;
    plate.needsUpdate = true;
    // Centre of the front sheet, for push-ins.
    const front = masks[LAYERS - 1];
    let fx = 0, fy = 0, fw = 0;
    for (let i = 0; i < front.length; i++) { const w = front[i]; fx += (i % MASK) * w; fy += Math.floor(i / MASK) * w; fw += w; }
    if (fw > 0) this.focus.set((fx / fw / MASK - 0.5) * SIZE, -(fy / fw / MASK - 0.5) * SIZE);

    for (let r = 0; r < LAYERS; r++) {
      const data = new Uint8Array(MASK * MASK * 4);
      for (let i = 0; i < MASK * MASK; i++) { const v = r === 0 ? 255 : Math.round(masks[r][i] * 255); data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
      const mask = new THREE.DataTexture(data, MASK, MASK, THREE.RGBAFormat);
      mask.flipY = true;
      mask.generateMipmaps = true;
      mask.minFilter = THREE.LinearMipmapLinearFilter;
      mask.magFilter = THREE.LinearFilter;
      mask.needsUpdate = true;
      const z = -(LAYERS - 1 - r) * GAP;
      // Scale each sheet so the stack lines up with the flat cover from the resting camera.
      const s = SIZE * (CAMERA_Z - z) / CAMERA_Z;
      const make = (shadow: boolean) => new THREE.ShaderMaterial({
        vertexShader: sheetVertex, fragmentShader: sheetFragment, transparent: true, depthWrite: !shadow,
        uniforms: {
          uCover: { value: r === 0 ? plate : init.cover }, uMask: { value: mask },
          uRim: { value: light ? palette.paper.clone().multiplyScalar(0.5) : palette.paper.clone().lerp(palette.signal, 0.35) },
          uInk: { value: palette.ink.clone() }, uFog: { value: palette.backdrop.clone() }, uRimGain: { value: 1 },
          uShade: { value: (LAYERS - 1 - r) * (light ? 0.035 : 0.07) },
          uShadow: { value: shadow ? 1 : 0 }, uShadowGain: { value: light ? 0.62 : 0.5 }, uTexel: { value: 1.2 / MASK },
        },
      });
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(s, s), make(false));
      sheet.position.z = z;
      this.scene.add(sheet);
      this.sheets.push(sheet);
      if (r > 0) {
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(s, s), make(true));
        shadow.position.set(light ? 0.2 : 0.12, light ? -0.26 : -0.16, z - GAP * 0.5);
        shadow.renderOrder = -1;
        this.scene.add(shadow);
        this.shadows.push(shadow);
      }
    }

    // Backlight: a soft radial glow behind the stack.
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 3.2, SIZE * 3.2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: palette.signal.clone().lerp(palette.paper, 0.4) }, uGain: { value: light ? 0.08 : 0.6 } },
      vertexShader: sheetVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uGain; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uColor * uGain * exp(-r * r * 3.2), 1.0); }`,
    }));
    this.glow.position.z = -(LAYERS - 1) * GAP - 1.5;
    this.scene.add(this.glow);

    const n = 700, pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), random = rng(11);
    for (let i = 0; i < n; i++) {
      pos.set([(random() - 0.5) * 16, (random() - 0.5) * 10, lerp(-5.5, 4, random())], i * 3);
      seed.set([random(), random(), random(), random()], i * 4);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    // Dust: specks of light on dark covers, fine dark specks on light ones.
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      vertexShader: dustVertex, fragmentShader: dustFragment, transparent: true, depthWrite: false,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0.6 }, uColor: { value: light ? palette.ink.clone() : palette.paper.clone().lerp(palette.signal, 0.25) } },
    }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.rig = new LyricRig(palette, 'poem');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const k = clamp01(ctx.shotT / Math.max(0.5, shot.end - shot.start));
    const e = inOutCubic(k);
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const rms = music.env('rms', t);
    const vocalWarmth = shot.section.vocal ? 0.15 : 0;
    const cam = this.camera;
    const target = new THREE.Vector3(0, 0, -1.8);
    let fov = 40;
    switch (shot.variant) {
      case 'push': {
        // Slow push towards the heart of the picture.
        target.set(this.focus.x * 0.6, this.focus.y * 0.6, -1.5);
        cam.position.set(lerp(side * 1.2, this.focus.x * 0.4, e), lerp(0.6, this.focus.y * 0.4, e), lerp(20.5, 13, e));
        break;
      }
      case 'truck': {
        // Across the stack at an angle: the most parallax.
        cam.position.set(lerp(-7, 7, e) * side, lerp(1.5, -0.5, e), 16);
        target.set(lerp(-1, 1, e) * side, 0, -2);
        fov = 42;
        break;
      }
      case 'tilt': {
        cam.position.set(side * 1.5, lerp(-5.5, 1.2, e), 17.5);
        target.set(0, lerp(-1.5, 0.3, e), -2);
        break;
      }
      case 'pullback': {
        cam.position.set(0, 0.3, lerp(15, 28, e));
        break;
      }
      default: { // drift
        cam.position.set(lerp(-1.6, 1.6, e) * side, lerp(0.8, -0.4, e), CAMERA_Z + 0.5 - e);
      }
    }
    // A slow handheld breath.
    cam.position.x += Math.sin(t * 0.37) * 0.08;
    cam.position.y += Math.sin(t * 0.29 + 1) * 0.06;
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(target);

    // The sheets breathe apart a little with the loudness; the backlight follows the voice.
    const spread = 1 + rms * 0.12;
    this.sheets.forEach((sheet, r) => {
      sheet.position.z = -(LAYERS - 1 - r) * GAP * spread;
      sheet.material.uniforms.uRimGain.value = this.init.palette.light ? 0.25 + rms * 0.2 : 0.7 + rms * 0.9 + vocalWarmth;
    });
    this.shadows.forEach((s, i) => { s.position.z = -(LAYERS - 1 - (i + 1)) * GAP * spread - GAP * 0.5 * spread; });
    (this.glow.material.uniforms.uGain as { value: number }).value = this.init.palette.light ? 0.06 : 0.35 + rms * 0.5 + shot.section.energy * 0.2;
    this.dust.material.uniforms.uTime.value = t;
    this.dust.material.uniforms.uGlow.value = this.init.palette.light ? 0.25 : 0.35 + rms * 0.6;

    ctx.fx.bloom = this.init.palette.light ? 0.1 : 0.45 + rms * 0.25;
    ctx.fx.fade = Math.max(ctx.fx.fade, shot.variant === 'pullback' ? 0.8 * smooth(ctx.music.endingProgress(t) * 1.6 - 0.6) : 0);
    // Lyrics sit on the side the camera is not moving towards.
    this.rig.align = (side > 0 ? 'left' : 'right') as Align;
    this.rig.onLight = this.init.palette.light;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, rms);
  }
}
