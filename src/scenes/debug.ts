// Debug views: the climax of the user's 《△ 三角》 (a million-triangle world shown through a GPU debugger, a new
// view on every beat), built from this song's cover. The cover's brightness raises a low-poly landscape — every
// triangle flat, its colour the cover's there — and on every beat a new render view wipes down over the last, like a
// redraw: shaded, wireframe, normals, depth with contours, barycentric, triangle id, X-ray, blueprint. All in the
// palette's colours. Top left a debugger panel lists the views (the current one lit) over the counts; bottom right
// the view's name. Cameras: low along a valley, round the highest peak, high above turning.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, outExpo, rng, smooth } from './types.ts';
import { textMesh } from '../render/text.ts';
import { LyricRig } from './lyricRig.ts';

const G = 160; // grid cells a side: 2·G² triangles
const SIZE = 64; // world units a side
export const VIEWS = ['着色', '线框', '法线', '深度', '重心坐标', '三角形编号', 'X 光', '蓝图'] as const;

const vertexShader = /* glsl */ `
  attribute vec3 aBary, aColor, aNormalF;
  attribute float aId;
  varying vec3 vBary, vColor, vNormal, vWorld;
  varying float vId;
  void main() {
    vBary = aBary; vColor = aColor; vNormal = aNormalF; vId = aId;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uInk, uPaper, uSignal, uAccent, uCam;
  uniform float uA, uB, uWipe, uFlash;
  uniform vec2 uRes;
  varying vec3 vBary, vColor, vNormal, vWorld;
  varying float vId;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  float wire(float w) { vec3 d = fwidth(vBary); vec3 a = smoothstep(vec3(0.0), d * w, vBary); return 1.0 - min(min(a.x, a.y), a.z); }
  vec3 view(float k) {
    vec3 n = normalize(vNormal);
    float lit = 0.25 + 0.75 * max(dot(n, normalize(vec3(-0.4, 0.8, 0.35))), 0.0);
    float depth = clamp(length(vWorld - uCam) / 40.0, 0.0, 1.0);
    if (k < 0.5) return vColor * lit + uSignal * 0.04;
    if (k < 1.5) return uInk + uPaper * wire(1.2) * (1.0 - depth * 0.7);
    if (k < 2.5) return (uSignal * abs(n.x) + uAccent * abs(n.z) + uPaper * 0.55 * abs(n.y)) * (0.35 + 0.65 * lit);
    if (k < 3.5) {
      float c = step(0.93, fract(depth * 26.0));
      return mix(uSignal * 0.8, uInk, pow(depth, 0.6)) + uPaper * c * 0.7 * (1.0 - depth);
    }
    if (k < 4.5) return (uSignal * vBary.x + uAccent * vBary.y + uPaper * 0.8 * vBary.z) * (0.5 + 0.5 * lit);
    if (k < 5.5) {
      float h = hash(vId), g = hash(vId + 17.0);
      vec3 c = h < 0.34 ? uSignal : h < 0.67 ? uAccent : uPaper * 0.8;
      return c * (0.3 + 0.7 * g);
    }
    if (k < 6.5) return uSignal * (0.07 + 0.2 * (1.0 - depth)) + uSignal * wire(1.0) * 0.9 * (1.0 - depth * 0.6);
    // Blueprint: a signal-tinted ground, paper lines, a faint grid in world space.
    vec2 gp = abs(fract(vWorld.xz * 0.5) - 0.5);
    float grid = step(0.485, max(gp.x, gp.y)) * 0.25;
    return uSignal * 0.16 + uInk * 0.5 + uPaper * (wire(1.0) * 0.85 + grid);
  }
  void main() {
    float y = gl_FragCoord.y / uRes.y;
    // The new view scans down from the top; a hairline in the signal colour on its front.
    float front = 1.0 - uWipe;
    vec3 col = y > front ? view(uB) : view(uA);
    col += uSignal * exp(-pow((y - front) * uRes.y / 1.6, 2.0)) * step(0.001, uWipe) * step(uWipe, 0.999) * 1.5;
    float fog = clamp(length(vWorld - uCam) / 46.0, 0.0, 1.0);
    col = mix(col, uInk, fog * fog);
    gl_FragColor = vec4(col * (1.0 + uFlash * 0.4), 1.0);
  }`;

type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

export class DebugScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  private material: THREE.ShaderMaterial;
  private heights: Float32Array;
  private panel = new THREE.Group();
  private items: Mesh[] = [];
  private names: Mesh[] = [];
  private stats: Mesh;
  private rig: LyricRig;
  private aspect = 16 / 9;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    // Heights from the cover's brightness, blurred a little, lifted towards the middle so there is a peak to orbit.
    const px = init.coverPixels, cs = init.coverSize, N = G + 1;
    const h = new Float32Array(N * N), col = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (Math.min(cs - 1, Math.floor((j / G) * (cs - 1))) * cs + Math.min(cs - 1, Math.floor((i / G) * (cs - 1)))) * 4;
      const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const dx = i / G - 0.5, dz = j / G - 0.5, mid = Math.exp(-(dx * dx + dz * dz) * 6);
      h[j * N + i] = lum * 4.2 + mid * 3.2;
      col.set([Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)], (j * N + i) * 3);
    }
    const blur = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        s += h[jj * N + ii]; n++;
      }
      blur[j * N + i] = s / n;
    }
    this.heights = blur;
    // A river valley down the middle for the low shots.
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i / G - 0.5 - 0.08 * Math.sin((j / G) * 9);
      blur[j * N + i] *= smooth(Math.abs(x) / 0.12) * 0.9 + 0.1;
    }
    // Every triangle its own three vertices (flat shading, barycentric wires, an id each).
    const T = G * G * 2;
    const pos = new Float32Array(T * 9), bary = new Float32Array(T * 9), cols = new Float32Array(T * 9), nrm = new Float32Array(T * 9), ids = new Float32Array(T * 3);
    const P = (i: number, j: number): [number, number, number] => [(i / G - 0.5) * SIZE, blur[j * N + i], (j / G - 0.5) * SIZE];
    const random = rng(0xa11ce);
    let t = 0;
    const put = (a: number[], b: number[], c: number[], ci: number) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      [a, b, c].forEach((p, k) => {
        pos.set(p, t * 9 + k * 3);
        bary.set(k === 0 ? [1, 0, 0] : k === 1 ? [0, 1, 0] : [0, 0, 1], t * 9 + k * 3);
        cols.set([col[ci * 3], col[ci * 3 + 1], col[ci * 3 + 2]], t * 9 + k * 3);
        nrm.set([nx, ny, nz], t * 9 + k * 3);
        ids[t * 3 + k] = t;
      });
      t++;
    };
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      // Jittered diagonals, so the landscape reads as triangles, not a grid.
      const flip = random() < 0.5;
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (flip) { put(a, d, b, j * N + i); put(b, d, c, (j + 1) * N + i + 1); }
      else { put(a, d, c, j * N + i); put(a, c, b, j * N + i + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('aNormalF', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uInk: { value: palette.ink.clone() }, uPaper: { value: palette.paper.clone() }, uSignal: { value: palette.signal.clone() }, uAccent: { value: palette.accent.clone() },
        uCam: { value: new THREE.Vector3() }, uA: { value: 0 }, uB: { value: 1 }, uWipe: { value: 0 }, uFlash: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) },
      },
    });
    const land = new THREE.Mesh(geo, this.material);
    land.frustumCulled = false;
    this.scene.add(land);

    // The debugger panel: the views, then the counts; and the view's name, big, bottom right.
    const mk = (s: string, face: 'bold' | 'light' | 'display', size: number) => {
      const m = textMesh(s, face, size, { px: face === 'display' ? 160 : 72, halo: 'dark' });
      m.material.toneMapped = false;
      this.panel.add(m);
      return m;
    };
    this.items = VIEWS.map(v => mk(v, 'bold', 0.05));
    this.names = VIEWS.map(v => mk(v, 'display', 0.2));
    this.stats = mk(`三角形 ${(T).toLocaleString('en').replace(/,/g, ' ')} · 顶点 ${(T * 3).toLocaleString('en').replace(/,/g, ' ')} · 绘制调用 1`, 'light', 0.036);
    this.scene.add(this.panel);
    this.rig = new LyricRig(palette, 'hook');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number): void {
    this.material.uniforms.uRes.value.set(width, height);
  }

  /** The landscape's height at a world point (bilinear on the grid). */
  private heightAt(x: number, z: number): number {
    const N = G + 1, fx = clamp01(x / SIZE + 0.5) * G, fz = clamp01(z / SIZE + 0.5) * G;
    const i = Math.min(G - 1, Math.floor(fx)), j = Math.min(G - 1, Math.floor(fz)), u = fx - i, v = fz - j, h = this.heights;
    return lerp(lerp(h[j * N + i], h[j * N + i + 1], u), lerp(h[(j + 1) * N + i], h[(j + 1) * N + i + 1], u), v);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const len = Math.max(0.2, shot.end - shot.start), k = clamp01(ctx.shotT / len);
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, first = Math.floor(random() * VIEWS.length);
    const info = music.at(t), beat = 60 / Math.max(40, info.bpm);
    // A new view each beat of the shot, wiping down over the first quarter beat.
    const b0 = Math.floor(music.beatPos(shot.start) + 0.5), bi = Math.max(0, Math.floor(info.pos) - b0);
    const viewOf = (n: number) => (first + n * 3) % VIEWS.length;
    const cur = viewOf(bi), prev = viewOf(bi - 1);
    const wipe = bi === 0 ? 1 : outExpo(clamp01((info.phase * beat) / (beat * 0.3)));
    const u = this.material.uniforms;
    u.uA.value = prev; u.uB.value = cur; u.uWipe.value = wipe;
    u.uFlash.value = music.pulse('kick', t, 0.1) * 0.6;

    const cam = this.camera;
    switch (shot.variant) {
      case 'orbit': {
        const a = t * 0.18 * side + random() * 6;
        cam.position.set(Math.cos(a) * 15, 9 + 2 * Math.sin(t * 0.3), Math.sin(a) * 15);
        cam.lookAt(0, 3.5, 0);
        cam.fov = 48;
        break;
      }
      case 'top': {
        const a = t * 0.12 * side;
        cam.position.set(Math.sin(a) * 2, 30 - 6 * k, Math.cos(a) * 2);
        cam.up.set(Math.sin(a), 0, Math.cos(a));
        cam.lookAt(0, 0, 0);
        cam.up.set(0, 1, 0);
        cam.fov = 52;
        break;
      }
      default: {
        // Low along the valley, a little faster through the shot.
        const z = lerp(16, -12, k * (0.9 + 0.1 * k));
        const x = 0.08 * Math.sin((z / SIZE + 0.5) * 9) * SIZE;
        const y = Math.max(this.heightAt(x, z) + 1.4, 1.6);
        cam.position.set(x, y, z);
        cam.lookAt(0.08 * Math.sin(((z - 6) / SIZE + 0.5) * 9) * SIZE, y - 0.6, z - 6);
        cam.fov = 58;
      }
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    u.uCam.value.copy(cam.position);

    // Panel in front of the camera, sized to the frame (distance 1: the visible height is 2·tan(fov/2)).
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), vw = vh * this.aspect, s = vh / 2;
    this.panel.position.copy(cam.position);
    this.panel.quaternion.copy(cam.quaternion);
    const { paper, signal } = this.init.palette;
    const x0 = -vw / 2 + 0.075 * s, y0 = vh / 2 - 0.34 * s;
    this.items.forEach((m, i) => {
      m.position.set(x0, y0 - i * 0.075 * s, -1);
      m.scale.setScalar(s);
      m.material.color.copy(i === cur ? signal : paper).multiplyScalar(i === cur ? 1.3 : 0.55);
      m.material.opacity = 0.95;
    });
    this.stats.position.set(x0, y0 - VIEWS.length * 0.075 * s - 0.03 * s, -1);
    this.stats.scale.setScalar(s);
    this.stats.material.color.copy(paper).multiplyScalar(0.7);
    this.names.forEach((m, i) => {
      m.visible = i === cur;
      const w = (m.userData.width as number) * s;
      m.position.set(vw / 2 - 0.09 * s - w, -vh / 2 + 0.34 * s, -1);
      m.scale.setScalar(s);
      m.material.color.copy(paper);
      m.material.opacity = smooth(wipe * 1.4);
    });

    ctx.fx.bloom = 0.35 + 0.15 * u.uFlash.value;
    ctx.fx.vignette = 0.45;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
