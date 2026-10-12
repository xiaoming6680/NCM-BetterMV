// The city's buildings (after the base engine's Still_Shining world, ss/towers.ts): instanced boxes standing in the
// blocks of the light carpet's street grid (city.ts: the same warp, Voronoi districts and street spacings, the same
// integer hashes, so no building stands on a road), towers around the downtowns the flights pass through, stepping
// back in tiers. Facades are window grids (lit windows glow in the cover's colours, dark ones are glass mirroring the
// sky), filtered to their mean once a window is under a pixel; roofs are dark. Tall towers carry aviation lights in
// the cover's signal colour that blink on the beat in loud sections. A corridor along the canyon flight is kept clear
// of anything it would fly into.
import * as THREE from 'three';
import { rng } from './types.ts';

/** District size and street half widths (m), as in city.ts. */
export const LAYOUT = { S: 650, mainHW: 12, minorHW: 4.5 };
/** Downtowns along the flights (x, z, sigma m, strength): the camera travels towards −z near x = 0. */
export const CENTERS: Array<[number, number, number, number]> = [[0, -2500, 2200, 0.75], [900, -12500, 2600, 0.65], [-1100, -23000, 2600, 0.6], [600, -34000, 2800, 0.55]];
/** The canyon flight's line (x) and height (m): nothing taller than CANYON_Y − 25 within 70 m of it. */
export const CANYON_X = 0, CANYON_Y = 150;

function warpJS(x: number, z: number): [number, number] {
  return [
    x + 170 * (Math.sin(z * 0.00093 + 1.3) + 0.6 * Math.sin((x + z) * 0.00051 + 4.1)),
    z + 170 * (Math.sin(x * 0.00087 + 2.2) + 0.6 * Math.sin((x - z) * 0.00047 + 0.7)),
  ];
}
const ih = (x: number) => {
  x >>>= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16;
  return x >>> 0;
};
const ih2 = (cx: number, cy: number, s: number) => ih((Math.imul(cx | 0, 0x9e3779b1) ^ ih(((cy | 0) + Math.imul(s, 0x85ebca77)) >>> 0)) >>> 0);
/** Uniform [0,1) from an integer cell and a salt (bit-identical to hf() in the city shader). */
const hfJS = (cx: number, cy: number, s: number) => (ih2(cx, cy, s) >>> 8) / 16777216;
function vpointJS(cx: number, cy: number): [number, number] {
  const S = LAYOUT.S;
  return [(cx + 0.12 + 0.76 * hfJS(cx, cy, 11)) * S, (cy + 0.12 + 0.76 * hfJS(cx, cy, 12)) * S];
}
function voronoiJS(qx: number, qz: number) {
  const S = LAYOUT.S, bx = Math.floor(qx / S), by = Math.floor(qz / S);
  let d1 = Infinity, m1: [number, number] = [0, 0], c1: [number, number] = [0, 0];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const m = vpointJS(bx + i, by + j), d = (qx - m[0]) ** 2 + (qz - m[1]) ** 2;
    if (d < d1) { d1 = d; m1 = m; c1 = [bx + i, by + j]; }
  }
  let e = Infinity;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    if (!i && !j) continue;
    const m = vpointJS(c1[0] + i, c1[1] + j), nx = m[0] - m1[0], nz = m[1] - m1[1], l = Math.hypot(nx, nz);
    const dd = ((0.5 * (m1[0] + m[0]) - qx) * nx + (0.5 * (m1[1] + m[1]) - qz) * nz) / l;
    if (dd < e) e = dd;
  }
  return { c1, e };
}
const gridJS = (cx: number, cy: number) => ({ theta: hfJS(cx, cy, 21) * Math.PI * 0.5, s: 74 + 50 * hfJS(cx, cy, 22), ox: hfJS(cx, cy, 23), oy: hfJS(cx, cy, 24) });
function typeJS(cx: number, cy: number, D: number): number {
  const t = hfJS(cx, cy, 31);
  return t > 0.965 ? 3 : t > 0.89 ? 2 : t < 0.25 + 0.5 * D ? 0 : 1;
}
function unwarp(qx: number, qz: number): [number, number] {
  let x = qx, z = qz;
  for (let i = 0; i < 10; i++) { const [wx, wz] = warpJS(x, z); x = qx - (wx - x); z = qz - (wz - z); }
  return [x, z];
}
/** The street grid's angle in world space (the warp turns the streets a little). */
function pAngle(x: number, z: number, th: number): number {
  const [ax, az] = warpJS(x, z), [bx, bz] = warpJS(x + 1, z), [cx, cz] = warpJS(x, z + 1);
  const j11 = bx - ax, j12 = cx - ax, j21 = bz - az, j22 = cz - az, det = j11 * j22 - j12 * j21;
  const dx = Math.cos(th), dz = Math.sin(th);
  return Math.atan2((-j21 * dx + j11 * dz) / det, (j22 * dx - j12 * dz) / det);
}
function densAt(x: number, z: number): number {
  let n = 0.42;
  for (const [cx, cz, s, k] of CENTERS) n += k * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
  return Math.min(1, n);
}

/** One box: footprint w × d at (x, z), from y0 to y0 + h; H is the whole building's height. */
interface Building { x: number; z: number; w: number; d: number; h: number; y0: number; H: number; rot: number; seed: number; crown: number }

/** The buildings round the downtowns: towers in the busy districts, mid-rises in a ring round each centre. */
function generate(): Building[] {
  const out: Building[] = [];
  const rnd = rng(1234);
  const { S, mainHW, minorHW } = LAYOUT;
  const seen = new Set<string>();
  for (const [cx, cz, R0] of CENTERS) {
    const R = R0 * 1.7;
    const [qx0, qz0] = warpJS(cx, cz);
    const n = Math.ceil(R / S) + 1, bx = Math.floor(qx0 / S), bz = Math.floor(qz0 / S);
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
      const ci = bx + di, cj = bz + dj, key = `${ci},${cj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = vpointJS(ci, cj), g = gridJS(ci, cj);
      const c = Math.cos(g.theta), s = Math.sin(g.theta), nb = Math.ceil(S / g.s) + 1;
      const offx = g.ox * g.s, offz = g.oy * g.s, i0 = Math.floor(offx / g.s), j0 = Math.floor(offz / g.s);
      for (let bj = j0 - nb; bj <= j0 + nb; bj++) for (let bi = i0 - nb; bi <= i0 + nb; bi++) {
        // (The shader's grid frame is r = R(q − m) + off with R a turn by −θ; back to q with R's transpose.)
        const rx = (bi + 0.5) * g.s - offx, rz = (bj + 0.5) * g.s - offz;
        const qx = m[0] + c * rx - s * rz, qz = m[1] + s * rx + c * rz;
        const half = g.s / 2 - minorHW - 3;
        const v = voronoiJS(qx, qz);
        if (v.c1[0] !== ci || v.c1[1] !== cj || v.e < half * 1.42 + mainHW + 4) continue;
        const [x, z] = unwarp(qx, qz);
        const dc = Math.hypot(x - cx, z - cz) / R0;
        if (dc > 1.7) continue;
        const D = densAt(x, z), type = typeJS(ci, cj, D);
        if (type === 3) continue;
        const zr = -3600 + 1100 * Math.sin(x / 2600) + 420 * Math.sin(x / 1030 + 1.7);
        if (Math.abs(z - zr) < 160) continue;
        const pLow = 0.85 * Math.exp(-dc * dc * 0.9);
        const pTall = (type === 0 ? 0.55 : type === 1 ? 0.14 : 0.05) * Math.exp(-dc * dc * 0.6) * D;
        const rot = pAngle(x, z, g.theta);
        const inner = 2 * half, split = rnd() < 0.55 ? 2 : 1, lot = inner / split;
        for (let v2 = 0; v2 < split; v2++) for (let u2 = 0; u2 < split; u2++) {
          const tall = rnd() < pTall;
          if (!tall && rnd() > pLow) continue;
          let h = tall ? 50 + 260 * Math.pow(rnd(), 2.2) * (0.45 + 0.55 * D) : 9 + 32 * Math.pow(rnd(), 1.8) * (0.4 + 0.6 * D) * (type === 2 ? 0.5 : 1);
          const w = lot * (0.6 + 0.35 * rnd()), d = lot * (0.6 + 0.35 * rnd());
          const ox = (u2 + 0.5) * lot - inner / 2 + (rnd() - 0.5) * (lot - w) * 0.8;
          const oz = (v2 + 0.5) * lot - inner / 2 + (rnd() - 0.5) * (lot - d) * 0.8;
          const cr = Math.cos(rot), sr = Math.sin(rot);
          const x2 = x + cr * ox - sr * oz, z2 = z + sr * ox + cr * oz, seed = rnd() * 1000;
          // The canyon flight's corridor: nothing there it would fly into.
          if (Math.abs(x2 - CANYON_X) < 70 + Math.max(w, d) * 0.75) h = Math.min(h, CANYON_Y - 25);
          const tiers = tall && h > 110 ? (rnd() < 0.6 ? 3 : 2) : tall && rnd() < 0.4 ? 2 : 1;
          const crown = tall && h > 150 && rnd() < 0.25 ? 1 : 0;
          let y0 = 0, tw = w, td = d;
          for (let k = 0; k < tiers; k++) {
            const frac = tiers === 1 ? 1 : k === 0 ? (tiers === 3 ? 0.18 : 0.62) : k === 1 && tiers === 3 ? 0.64 : 1 - y0 / h;
            const th = k === tiers - 1 ? h - y0 : h * frac;
            out.push({ x: x2, z: z2, w: tw, d: td, h: th, y0, H: h, rot, seed, crown: k === tiers - 1 ? crown : 0 });
            y0 += th;
            tw *= 0.72 + 0.12 * rnd(); td *= 0.72 + 0.12 * rnd();
          }
        }
      }
    }
  }
  return out;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 iA; // x, z, rot, y0
in vec4 iB; // w, d, h, seed
in vec4 iC; // H, -, crown, -
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam;
out vec3 vW;
out vec3 vL;
flat out vec3 vNL;
flat out vec4 vB;
flat out vec4 vC;
void main() {
  vec3 lp = vec3(position.x * iB.x, position.y * iB.z + iA.w, position.z * iB.y);
  float c = cos(iA.z), s = sin(iA.z);
  vec3 wp = vec3(c * lp.x - s * lp.z, lp.y, s * lp.x + c * lp.z);
  wp.xz += iA.xy;
  vec2 dc = wp.xz - uCam.xz;
  wp.y -= dot(dc, dc) / (2.0 * 6.371e6);
  vW = wp; vL = lp; vNL = normal; vB = iB; vC = iC;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

/** The facades; `glsl` brings the city's shared code (the atmosphere, the light colours, the surges). */
const frag = (glsl: string) => /* glsl */ `
precision highp float;
precision highp int;
in vec3 vW;
in vec3 vL;
flat in vec3 vNL;
flat in vec4 vB;
flat in vec4 vC;
out vec4 fragColor;
${glsl}
float boxAA(float x, float a, float b, float fw) {
  float lo = max(x - 0.5 * fw, a), hi = min(x + 0.5 * fw, b);
  return clamp((hi - lo) / max(fw, 1e-5), 0.0, 1.0);
}
void main() {
  float seed = vB.w, Htot = vC.x;
  vec3 V = normalize(vW - uCam);
  vec3 nl = vNL;
  vec3 amb = ambient();
  float surge = surgeAt(vW.xz);
  vec3 col;
  if (abs(nl.y) > 0.5) {
    // Roofs: dark, a few equipment lights.
    col = amb * (0.06 + 0.05 * hash12(vec2(seed, 3.1)));
    vec2 g = fract(vL.xz / 9.0) - 0.5;
    col += C_WARM * 0.35 * step(0.88, hash12(floor(vL.xz / 9.0) + seed)) * exp(-dot(g, g) * 40.0) * uLights;
  } else {
    float u = abs(nl.x) > 0.5 ? vL.z * sign(nl.x) : -vL.x * sign(nl.z);
    float v = vL.y;
    float office = min(step(0.4, hash12(vec2(seed, 1.7))) + step(70.0, Htot), 1.0);
    float floorH = mix(3.0, 4.0, office) + 0.25 * hash12(vec2(seed, 2.9));
    float bay = mix(2.4, 3.2, hash12(vec2(seed, 4.3)));
    vec2 fc = vec2(u / bay, v / floorH);
    vec2 cell = floor(fc), f = fc - cell;
    vec2 fw = max(fwidth(fc), vec2(1e-4));
    float wx = office > 0.5 ? boxAA(f.x, 0.05, 0.95, fw.x) : boxAA(f.x, 0.18, 0.82, fw.x);
    float wy = office > 0.5 ? boxAA(f.y, 0.24, 0.9, fw.y) : boxAA(f.y, 0.32, 0.84, fw.y);
    float winA = office > 0.5 ? 0.9 * 0.66 : 0.64 * 0.52;
    float sub = smoothstep(0.3, 0.9, max(fw.x, fw.y));
    float win = mix(wx * wy, winA, sub);
    float faceSeed = seed + dot(nl, vec3(1.3, 0.0, 2.7));
    float floorOn = hash12(vec2(cell.y, faceSeed));
    float litFrac = mix(0.12, 0.42, hash12(vec2(seed, 5.5)));
    float run = hash12(vec2(floor(cell.x / 5.0), cell.y + faceSeed));
    float on = office > 0.5 ? step(1.0 - litFrac, floorOn) * step(0.25, run) * step(0.1, hash12(cell + faceSeed))
                            : step(1.0 - litFrac * 0.75, hash12(cell + faceSeed));
    // A surge lights windows that were dark as it passes.
    on = max(on, step(1.0 - min(0.8, surge * 0.6), hash12(cell + faceSeed + 3.3)));
    float onT = smoothstep(0.0, 0.08, uLights + 0.5 * surge - 0.9 * hash12(cell + faceSeed + 0.7));
    float tone = hash12(vec2(seed, 8.8)), wtone = hash12(cell + faceSeed + 4.4);
    vec3 lc = office > 0.5 ? mix(C_COOL, C_WHITE, tone * 0.8 + wtone * 0.2) : mix(C_WARM, C_WHITE, wtone * 0.6);
    float lum = mix(on * onT * (0.35 + 0.8 * hash12(cell + faceSeed + 2.2)), litFrac * 0.75 * 0.9 * 0.75 * 0.45 * clamp(uLights + 0.5 * surge, 0.0, 1.5), sub);
    vec3 Nw = normalize(cross(dFdx(vW), dFdy(vW)));
    if (dot(Nw, V) > 0.0) Nw = -Nw;
    vec3 R = reflect(V, Nw);
    float F = pow(1.0 - abs(dot(V, Nw)), 5.0);
    vec3 glass = skyCol(R) * (0.035 + 0.45 * F) + vec3(0.002, 0.003, 0.006);
    vec3 emit = lc * lum * mix(0.75, 1.0, office) * (1.0 + 1.5 * surge);
    // Close up a lit window is a room (ceiling light, blinds, curtains, mullions); fades in past ~12 px.
    float near = 1.0 - smoothstep(0.025, 0.08, max(fw.x, fw.y));
    if (near > 0.001) {
      vec2 w0 = office > 0.5 ? vec2(0.05, 0.24) : vec2(0.18, 0.32), w1 = office > 0.5 ? vec2(0.95, 0.9) : vec2(0.82, 0.84);
      vec2 l = clamp((f - w0) / (w1 - w0), 0.0, 1.0);
      float h1 = hash12(cell + faceSeed + 7.7), h2 = hash12(cell + faceSeed + 9.1);
      float room = mix(0.55, 1.15, smoothstep(0.05, 0.95, l.y));
      room *= mix(1.0, 1.0 - 0.5 * step(0.5, fract(l.y * 11.0)), step(0.74, h1));
      room *= mix(1.0, 0.25 + 0.75 * smoothstep(0.5 + 0.35 * h2, 0.56 + 0.35 * h2, 1.0 - l.x), step(0.82, h2));
      float aa = fw.x / (w1.x - w0.x);
      float md = office > 0.5 ? min(abs(l.x - 0.3333), abs(l.x - 0.6667)) : abs(l.x - 0.5);
      float mull = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, md);
      emit *= mix(1.0, room * (1.0 - 0.9 * mull), near);
      glass *= mix(1.0, 1.0 - 0.6 * mull, near);
    }
    vec3 frameC = amb * (0.12 + 0.08 * hash12(vec2(seed, 6.1)));
    col = mix(frameC, glass + emit, win);
    if (vC.z > 0.5) {
      float top = Htot - v;
      float band = smoothstep(2.0 * floorH + 0.3, 2.0 * floorH - 0.3, top) * smoothstep(0.2, 0.8, top);
      col += (hash12(vec2(seed, 9.9)) < 0.5 ? C_WHITE : C_SIG) * band * 1.1 * uLights;
    }
  }
  float T = transmit(vW);
  vec3 o = (col * T + fogCol(V) * (1.0 - T)) * uExposure;
  if (any(isnan(o)) || any(isinf(o))) o = vec3(0.0);
  fragColor = vec4(o, 1.0);
}`;

const LVERT = /* glsl */ `
precision highp float;
in vec3 position;
in float phase;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam;
uniform float uFocal, uTime, uBeat, uLights, uHaze;
out float vI;
void main() {
  vec3 wp = position;
  vec2 dc = wp.xz - uCam.xz;
  wp.y -= dot(dc, dc) / (2.0 * 6.371e6);
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * vp;
  float dist = max(-vp.z, 1.0);
  float size = 2.4 * uFocal / dist, ps = max(size, 3.0);
  gl_PointSize = ps;
  // A slow blink, each tower on its own phase; in loud sections they all flash on the kick.
  float blink = smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(uTime * 4.2 + phase * 6.283));
  blink = mix(blink, uBeat, step(0.001, uBeat) * 0.85);
  vI = 45.0 * blink * (size * size) / (ps * ps) * uLights * exp(-distance(uCam, wp) * 6e-5 * uHaze);
}`;

const lfrag = (signal: THREE.Color) => /* glsl */ `
precision highp float;
in float vI;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  fragColor = vec4(vec3(${signal.r.toFixed(4)}, ${signal.g.toFixed(4)}, ${signal.b.toFixed(4)}) * vI * exp(-dot(d, d) * 14.0), 1.0);
}`;

export class Towers {
  readonly group = new THREE.Group();
  constructor(glsl: string, uniforms: Record<string, THREE.IUniform>, signal: THREE.Color) {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const bs = generate();
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('normal', box.getAttribute('normal'));
    const A = new Float32Array(bs.length * 4), B = new Float32Array(bs.length * 4), C = new Float32Array(bs.length * 4);
    bs.forEach((b, i) => { A.set([b.x, b.z, b.rot, b.y0], i * 4); B.set([b.w, b.d, b.h, b.seed], i * 4); C.set([b.H, 0, b.crown, 0], i * 4); });
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4));
    g.instanceCount = bs.length;
    // Drawn before the street carpet, writing depth, so the carpet's costly shading is skipped behind them.
    const mesh = new THREE.Mesh(g, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag(glsl), uniforms, side: THREE.FrontSide }));
    mesh.frustumCulled = false;
    mesh.renderOrder = -9;
    this.group.add(mesh);
    // Aviation lights on the corners of the tall ones.
    const lp: number[] = [], ph: number[] = [];
    for (const b of bs) {
      if (b.H < 95 || b.y0 + b.h < b.H - 0.5) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot), p0 = (b.seed * 0.137) % 1;
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
        const ox = u * b.w * 0.92, oz = v * b.d * 0.92;
        lp.push(b.x + c * ox - s * oz, b.H + 1.5, b.z + s * ox + c * oz);
        ph.push(p0);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
    const lights = new THREE.Points(lg, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: LVERT, fragmentShader: lfrag(signal), uniforms,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    lights.frustumCulled = false;
    lights.renderOrder = 10;
    this.group.add(lights);
  }
}
