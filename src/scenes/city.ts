// City: a night city seen from the air, a carpet of lights to the horizon under a dusk sky in the cover's colours.
// The city is evaluated per pixel on the ground plane and filtered by the pixel's footprint, so it neither shimmers
// in the distance nor blurs up close (after the light-carpet city of the base engine's Still_Shining world, ss/city.ts:
// Voronoi districts with main roads and traffic, minor street grids, window lattices, avenues, expressways and a ring
// road, a river mirroring the sky). Every light takes a colour of the cover: lamps its paper white and signal colour,
// windows a mix of all four, tail lights the signal.
// The music is the city's power: each kick sends a surge of light rolling out across the districts from a point in
// view, snares wider ones; a chorus or drop comes in as the city powering up in a wave from the middle of the view;
// the traffic flows with the tempo; calm sections run at a dimmer glow.
// Downtowns stand up out of the carpet as 3D towers (cityTowers.ts), their aviation lights flashing on the kicks.
// Cameras: high above looking down as it sinks slowly (the carpet's patterns), low over the roofs towards the glowing
// horizon, a glide forward at a steeper angle, and through the towers down a corridor kept clear for it (canyon).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { rng, smooth } from './types.ts';
import { Accents } from './hits.ts';
import { LyricBlocks, Stands, voiceFor } from './lyricBlock.ts';
import { lastIndex } from '../director/music.ts';
import { CANYON_X, CANYON_Y, CENTERS, TOWER_VERT, towerFrag, Towers } from './cityTowers.ts';

const SURGES = 8;

/**
 * A colour as a uniform. The palette's colours reach the shaders as uniforms, not written into their source: the
 * source is then the same for every song, so a program compiled once (seconds for the city under D3D) is taken from
 * the browser's shader cache for the next song with the city, and the next time NetEase starts. (Rounded as they were
 * when written into the source.)
 */
const u3 = (c: THREE.Color, k = 1) => new THREE.Vector3(+(c.r * k).toFixed(5), +(c.g * k).toFixed(5), +(c.b * k).toFixed(5));
/** A light's colour: the hue of c at full strength (its brightest channel 1). */
const lamp = (c: THREE.Color) => { const m = Math.max(c.r, c.g, c.b, 1e-4); return c.clone().multiplyScalar(1 / m); };

const COMMON = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 _mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute(vec3 x) { return _mod289(((x * 34.0) + 10.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = _mod289(i);
  vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}`;

/** The sky and haze for a palette (ATMOSPHERE's uniforms): a dusk gradient by elevation, the cover's colour glowing along the horizon. */
function atmosphere(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): Record<string, THREE.IUniform> {
  const { ink, signal: sig, accent: acc, paper } = p;
  const mix = (a: THREE.Color, b: THREE.Color, t: number, k: number) => a.clone().lerp(b, t).multiplyScalar(k);
  // Late dusk: dark overhead, the cover's colour only in a band along the horizon.
  const cols = [
    mix(ink, acc, 0.2, 0.2), mix(ink, acc, 0.25, 0.22), mix(acc, sig, 0.4, 0.24), mix(acc, sig, 0.5, 0.26),
    mix(sig, paper, 0.15, 0.26), mix(sig, acc, 0.3, 0.22), mix(acc, sig, 0.35, 0.15), mix(acc, ink, 0.4, 0.085),
    mix(ink, acc, 0.35, 0.05), mix(ink, acc, 0.3, 0.038), mix(ink, acc, 0.25, 0.03), mix(ink, acc, 0.2, 0.026),
  ].map(c => c.add(new THREE.Color(0.0015, 0.002, 0.004)));
  const haze = mix(ink, acc, 0.25, 0.22).add(new THREE.Color(0.002, 0.0025, 0.005));
  const amb = mix(ink, acc, 0.3, 0.22).add(new THREE.Color(0.002, 0.003, 0.006));
  return { uSky: { value: cols.map(c => u3(c)) }, uHazeCol: { value: u3(haze) }, uAmb: { value: u3(amb) } };
}
const KNOTS = [-12, -5, -1.2, 0, 0.5, 1.3, 2.6, 5, 10, 20, 45, 90];
const ATMOSPHERE = /* glsl */ `
uniform vec3 uCam;
uniform float uLights, uTime, uHaze, uTraffic, uExposure;
uniform vec3 uSky[12], uHazeCol, uAmb;
const float KN[12] = float[12](${KNOTS.map(k => k.toFixed(2)).join(', ')});
#define SKY uSky
vec3 skyCol(vec3 d) {
  float a = degrees(asin(clamp(d.y, -1.0, 1.0)));
  int i = 0;
  for (int k = 0; k < 11; k++) if (a >= KN[k]) i = k;
  float t = clamp((a - KN[i]) / (KN[min(i + 1, 11)] - KN[i]), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  return mix(SKY[i], SKY[min(i + 1, 11)], t);
}
float avgExp(float a, float b) { float d = b - a; return abs(d) < 1e-3 ? exp(-0.5 * (a + b)) : (exp(-a) - exp(-b)) / d; }
/** Transmittance from the camera to p: exponential height fog over the city. */
float transmit(vec3 p) {
  const float HS = 1200.0;
  float L = distance(uCam, p);
  float g = avgExp(max(uCam.y, 0.0) / HS, max(p.y, 0.0) / HS);
  return exp(-L * uHaze * (1.4e-5 + 1.05e-4 * g));
}
/** The haze things sink into: the dark air below the horizon, meeting the horizon's glow only far off. */
vec3 fogCol(vec3 d) { return mix(uHazeCol, skyCol(vec3(d.x, max(d.y, 0.006), d.z)), smoothstep(-0.12, 0.0, d.y)); }
vec3 ambient() { return uAmb; }`;

/** The city's light colours, taken from the cover (CITY's uniforms). */
function lampColours(p: { signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): Record<string, THREE.IUniform> {
  const white = lamp(p.paper), sig = lamp(p.signal), acc = lamp(p.accent);
  const warm = lamp(p.paper.clone().lerp(p.signal, 0.45)), cool = lamp(p.paper.clone().lerp(p.accent, 0.4));
  return { uWhite: { value: u3(white) }, uSig: { value: u3(sig) }, uAcc: { value: u3(acc) }, uWarm: { value: u3(warm) }, uCool: { value: u3(cool) } };
}

/** The city per pixel (Still_Shining's ss/city.ts). */
const CITY = /* glsl */ `
uniform vec4 uCenters[4];
uniform vec4 uSurge[${SURGES}];
const float S = 650.0, MHW = 12.0, NHW = 4.5;
const float SQ2PI = 2.5066283;
uniform vec3 uWhite, uSig, uAcc, uWarm, uCool;
#define C_WHITE uWhite
#define C_SIG uSig
#define C_ACC uAcc
#define C_WARM uWarm
#define C_COOL uCool
/** The power surges running out across the city here (0 = none). */
float gSurge = 0.0;

vec2 warpQ(vec2 p) {
  return p + 170.0 * vec2(sin(p.y * 0.00093 + 1.3) + 0.6 * sin((p.x + p.y) * 0.00051 + 4.1),
                          sin(p.x * 0.00087 + 2.2) + 0.6 * sin((p.x - p.y) * 0.00047 + 0.7));
}
uint ih(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
uint ih2(ivec2 c, uint s) { return ih((uint(c.x) * 0x9e3779b1u) ^ ih(uint(c.y) + s * 0x85ebca77u)); }
float hf(ivec2 c, uint s) { return float(ih2(c, s) >> 8) / 16777216.0; }
vec2 vpoint(ivec2 c) { return (vec2(c) + 0.12 + 0.76 * vec2(hf(c, 11u), hf(c, 12u))) * S; }
float dens(vec2 p) {
  vec2 s = p / 7000.0;
  float n = 0.42 + 0.30 * (0.66 * snoise(s) + 0.34 * snoise(s * 2.3 + 5.0));
  for (int i = 0; i < 4; i++) { vec2 d = p - uCenters[i].xy; n += uCenters[i].w * exp(-dot(d, d) / (2.0 * uCenters[i].z * uCenters[i].z)); }
  return clamp(n, 0.0, 1.0);
}
float river(vec2 p) {
  float zr = -3600.0 + 1100.0 * sin(p.x / 2600.0) + 420.0 * sin(p.x / 1030.0 + 1.7);
  return abs(p.y - zr) - (85.0 + 30.0 * sin(p.x / 1500.0));
}
float lit(float on) { return smoothstep(on, on + 0.06, uLights + 0.5 * gSurge); }

float lightRow(float u, float dv, float s, float w, float seed, float pOn, float speed) {
  float g = exp(-dv * dv / (2.0 * w * w));
  if (g < 1e-4) return 0.0;
  float cont = pOn / s * g / (SQ2PI * w);
  float b = smoothstep(0.30 * s, 0.60 * s, w);
  if (b >= 1.0) return cont;
  float uu = u - speed * uTraffic * uTime;
  float i0 = floor(uu / s), acc = 0.0;
  for (int k = -1; k <= 1; k++) {
    float i = i0 + float(k);
    float h = hash12(vec2(i, seed));
    if (h > pOn) continue;
    float uc = (i + 0.5 + 0.7 * (hash12(vec2(i, seed + 7.13)) - 0.5)) * s;
    float du = uu - uc;
    acc += (0.5 + h / pOn) * exp(-du * du / (2.0 * w * w));
  }
  acc *= g / (2.0 * PI * w * w);
  return mix(acc, cont, b);
}
vec2 nearestLine(float x, float s) { float k = floor(x / s + 0.5); return vec2(x - k * s, k); }

struct District { ivec2 c; vec2 m; ivec2 ck; vec2 mk; float e; float type; vec2 r; float s; };
District district(vec2 q, float D) {
  District o;
  ivec2 b = ivec2(floor(q / S));
  float d1 = 1e20;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j); vec2 m = vpoint(c); float d = dot(q - m, q - m);
    if (d < d1) { d1 = d; o.m = m; o.c = c; }
  }
  o.e = 1e20;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    if (i == 0 && j == 0) continue;
    ivec2 c = o.c + ivec2(i, j); vec2 m = vpoint(c); vec2 n = m - o.m;
    float dd = dot(0.5 * (o.m + m) - q, normalize(n));
    if (dd < o.e) { o.e = dd; o.mk = m; o.ck = c; }
  }
  float t = hf(o.c, 31u);
  o.type = t > 0.965 ? 3.0 : t > 0.89 ? 2.0 : (t < 0.25 + 0.5 * D ? 0.0 : 1.0);
  float th = hf(o.c, 21u) * PI * 0.5;
  o.s = 74.0 + 50.0 * hf(o.c, 22u);
  o.r = rot2(th) * (q - o.m) + vec2(hf(o.c, 23u), hf(o.c, 24u)) * o.s;
  return o;
}
vec3 mainRoad(District d, vec2 q, float w) {
  bool aFirst = d.c.x < d.ck.x || (d.c.x == d.ck.x && d.c.y < d.ck.y);
  vec2 ma = aFirst ? d.m : d.mk, mb = aFirst ? d.mk : d.m;
  ivec2 ca = aFirst ? d.c : d.ck, cb = aFirst ? d.ck : d.c;
  vec2 n = normalize(mb - ma);
  float u = dot(q, vec2(-n.y, n.x)), v = dot(q - 0.5 * (ma + mb), n);
  float sd = float(ih2(ca, uint(cb.x * 7 + cb.y * 131) + 77u) >> 12) * 0.001;
  float avenue = step(0.8, fract(sd * 3.17)), signal = step(0.78, fract(sd * 7.31));
  vec3 lampC = mix(C_WHITE, C_SIG, signal);
  float hw = mix(8.0, MHW, avenue), sp = mix(36.0, 30.0, avenue);
  float lamps = lightRow(u, v - hw - 1.0, sp, w, sd, 0.93, 0.0) + lightRow(u, v + hw + 1.0, sp, w, sd + 0.5, 0.93, 0.0);
  float pool = lightRow(u, v, sp, max(w, 9.0), sd + 0.2, 0.93, 0.0);
  vec3 c = lampC * (mix(34.0, 90.0, avenue) * lamps + mix(22.0, 50.0, avenue) * pool);
  float dn = mix(0.18, 0.55, avenue);
  float tr = lightRow(u, v - 3.5, 34.0, max(w, 0.6), sd + 2.0, dn, 14.0) + avenue * lightRow(u, v - 7.0, 41.0, max(w, 0.6), sd + 2.7, dn * 0.8, 16.5);
  float hd = lightRow(u, v + 3.5, 36.0, max(w, 0.6), sd + 3.0, dn, -15.0) + avenue * lightRow(u, v + 7.0, 43.0, max(w, 0.6), sd + 3.6, dn * 0.8, -17.5);
  return c + C_SIG * 70.0 * tr + C_WHITE * 80.0 * hd;
}
vec3 minorStreets(District d, float w) {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float u = k == 0 ? d.r.x : d.r.y, v = k == 0 ? d.r.y : d.r.x;
    vec2 L = nearestLine(v, d.s);
    float sd = L.y * 2.11 + float(k) * 50.0 + float(ih2(d.c, 41u) >> 16);
    float on = step(0.12, hash12(vec2(L.y, sd)));
    vec3 col = d.type == 2.0 ? C_SIG : C_WHITE;
    c += on * col * (30.0 * lightRow(u, L.x, 23.0, w, sd, 0.8, 0.0) + 12.0 * lightRow(u, L.x, 23.0, max(w, 6.0), sd + 0.3, 0.8, 0.0));
  }
  return c;
}
vec3 windows(District d, float c, float w, float seed, float pOn, float rho, float edgeBias) {
  vec2 r = d.r;
  vec3 acc = vec3(0.0);
  vec2 i0 = floor(r / c);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = i0 + vec2(i, j);
    float h = hash12(cell + seed + float(ih2(d.c, 51u) >> 20));
    vec2 cr = (cell + 0.15 + 0.7 * hash22(cell + seed + 3.3)) * c;
    vec2 bl = cr - d.s * floor(cr / d.s + 0.5);
    float edge = min(abs(bl.x), abs(bl.y));
    if (edge < NHW + 1.5) continue;
    float near = 1.0 - smoothstep(NHW + 2.0, NHW + 14.0, edge);
    if (h > pOn * mix(1.0 - edgeBias * 0.5, 1.0 + edgeBias, near)) continue;
    vec2 blk = floor(cr / d.s + 0.5);
    float bk = hash12(blk + vec2(d.c) * 17.0 + seed);
    float on = lit(0.55 * hash12(cell + seed + 0.7) + 0.45 * bk);
    if (on <= 0.0) continue;
    float h2 = hash12(cell + seed + 9.7);
    float pw = rho * (0.12 + 2.6 * pow(h2, 9.0) + 0.4 * h2 * h2) * on * (0.4 + 1.2 * bk);
    float h3 = hash12(cell + seed + 1.9);
    vec3 col = h3 < 0.45 ? C_WARM : h3 < 0.8 ? C_COOL : h3 < 0.94 ? C_WHITE : h3 < 0.975 ? C_SIG : C_ACC;
    if (d.type == 2.0) col = mix(col, C_SIG, 0.6);
    vec2 dd = r - cr;
    acc += col * pw * exp(-dot(dd, dd) / (2.0 * w * w));
  }
  return acc / (2.0 * PI * w * w);
}
vec3 avenues(vec2 p, float w) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float th = hash11(fi * 1.7 + 0.3) * PI;
    vec2 dir = vec2(cos(th), sin(th)), nrm = vec2(-dir.y, dir.x);
    float off = (hash11(fi * 3.1 + 0.9) - 0.5) * 52000.0;
    float along = dot(p, dir);
    float lat = dot(p, nrm) - off - 420.0 * sin(along / 3100.0 + fi) - 160.0 * sin(along / 1300.0 + 2.0 * fi);
    if (abs(lat) > 30.0 + 4.0 * w) continue;
    float sd = fi * 11.3 + 500.0;
    float lamps = lightRow(along, lat - 14.0, 30.0, w, sd, 0.95, 0.0) + lightRow(along, lat + 14.0, 30.0, w, sd + 0.4, 0.95, 0.0);
    c += C_WHITE * (95.0 * lamps + 45.0 * lightRow(along, lat, 30.0, max(w, 11.0), sd + 0.8, 0.95, 0.0));
    float tr = lightRow(along, lat - 3.5, 30.0, max(w, 0.6), sd + 2.0, 0.6, 15.0) + lightRow(along, lat - 7.0, 37.0, max(w, 0.6), sd + 2.5, 0.5, 17.0);
    float hd = lightRow(along, lat + 3.5, 31.0, max(w, 0.6), sd + 3.0, 0.6, -16.0) + lightRow(along, lat + 7.0, 39.0, max(w, 0.6), sd + 3.5, 0.5, -18.0);
    c += C_SIG * 70.0 * tr + C_WHITE * 80.0 * hd;
  }
  return c;
}
vec3 expressways(vec2 p, float w) {
  vec3 c = vec3(0.0);
  vec2 C = uCenters[0].xy, d = p - C;
  float r = length(d), ang = atan(d.y, d.x);
  const float N = 7.0;
  float base = (ang + PI) / (TAU / N);
  for (int k = 0; k < 2; k++) {
    float j = floor(base) + float(k);
    float th = j * TAU / N - PI + 0.21 * sin(j * 3.1);
    vec2 dir = vec2(cos(th), sin(th));
    float along = dot(d, dir);
    if (along < 600.0) continue;
    float lat = dot(d, vec2(-dir.y, dir.x)) - 260.0 * sin(along / 2300.0 + j);
    float sd = j * 7.7;
    float lamps = lightRow(along, lat - 16.0, 38.0, w, sd, 0.97, 0.0) + lightRow(along, lat + 16.0, 38.0, w, sd + 0.4, 0.97, 0.0);
    c += C_SIG * (120.0 * lamps + 50.0 * lightRow(along, lat, 38.0, max(w, 14.0), sd + 0.8, 0.97, 0.0));
    float tr = 0.0, hd = 0.0;
    for (int l = 0; l < 3; l++) {
      float fl = float(l);
      tr += lightRow(along, lat - 3.5 - 3.5 * fl, 22.0 + 5.0 * fl, max(w, 0.6), sd + 2.0 + fl, 0.6, 24.0 + 3.0 * fl);
      hd += lightRow(along, lat + 3.5 + 3.5 * fl, 23.0 + 5.0 * fl, max(w, 0.6), sd + 5.0 + fl, 0.6, -25.0 - 3.0 * fl);
    }
    c += C_SIG * 75.0 * tr + C_WHITE * 85.0 * hd;
  }
  float R = 4200.0 + 250.0 * sin(ang * 3.0);
  float lat = r - R, along = ang * R;
  float sd = 91.0;
  float lamps = lightRow(along, lat - 16.0, 38.0, w, sd, 0.97, 0.0) + lightRow(along, lat + 16.0, 38.0, w, sd + 0.4, 0.97, 0.0);
  c += C_SIG * (120.0 * lamps + 50.0 * lightRow(along, lat, 38.0, max(w, 14.0), sd + 0.8, 0.97, 0.0));
  float tr = lightRow(along, lat - 5.0, 24.0, max(w, 0.6), sd + 2.0, 0.6, 26.0) + lightRow(along, lat - 9.0, 27.0, max(w, 0.6), sd + 2.5, 0.5, 23.0);
  float hd = lightRow(along, lat + 5.0, 25.0, max(w, 0.6), sd + 3.0, 0.6, -24.0) + lightRow(along, lat + 9.0, 28.0, max(w, 0.6), sd + 3.5, 0.5, -27.0);
  return c + C_SIG * 75.0 * tr + C_WHITE * 85.0 * hd;
}
vec3 meanLight(float type, float D) {
  float lampOn = smoothstep(0.0, 0.3, uLights);
  vec3 mainR = (2.1 / S) * (C_WHITE * 0.93 * (2.0 * 45.0 + 28.0) / 35.0 + C_SIG * 0.27 * 150.0 / 37.0) * lampOn;
  vec3 minorR = (2.0 / 99.0) * 0.8 * 0.88 * 42.0 / 23.0 * C_WHITE * lampOn;
  float pBlk = (type == 3.0 ? 0.02 : type == 2.0 ? 0.08 : type == 0.0 ? 0.32 : 0.2) * (0.25 + 0.75 * D);
  vec3 win = mix(C_WARM, C_COOL, 0.4) * (pBlk * 22.0 * 0.52 / 121.0 + pBlk * 0.5 * 2.4 * 0.52 / 28.1) * 0.78 * clamp(uLights + 0.5 * gSurge, 0.0, 1.5);
  return (mainR + minorR * (type == 3.0 ? 0.25 : 1.0)) * mix(0.45, 1.0, D) + win;
}
float roofAlbedo(District d, float w) {
  float c = 15.0;
  vec2 cell = floor(d.r / c), cell2 = floor((d.r + 6.0) / 23.0);
  float a = 0.05 + 0.07 * hash12(cell + vec2(d.c) * 3.1) + 0.05 * hash12(cell2 + vec2(d.c) * 1.3);
  if (d.type == 3.0) a = 0.025 + 0.02 * hash12(cell);
  return mix(a, d.type == 3.0 ? 0.035 : 0.09, smoothstep(0.25 * c, 0.7 * c, w));
}
float surgeAt(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < ${SURGES}; i++) {
    vec4 u = uSurge[i];
    if (u.w <= 0.0) continue;
    // u.z: the front's radius; behind it the power stays up a while, fading.
    float d = length(p - u.xy), x = (d - u.z) / (90.0 + u.z * 0.08);
    s += u.w * (exp(-x * x) + 0.35 * step(d, u.z) * exp(-(u.z - d) / (u.z * 0.5 + 200.0)));
  }
  return s;
}
vec3 cityShade(vec2 p, float fp, vec3 V) {
  float w = max(0.7, 0.55 * fp);
  vec2 q = warpQ(p);
  float D = dens(p);
  District d = district(q, D);
  float aw = max(w, 0.5);
  gSurge = surgeAt(p);
  float onMain = 1.0 - smoothstep(MHW - aw, MHW + aw, d.e);
  vec2 lm = vec2(nearestLine(d.r.x, d.s).x, nearestLine(d.r.y, d.s).x);
  float onMin = 1.0 - smoothstep(NHW - aw, NHW + aw, min(abs(lm.x), abs(lm.y)));
  float street = mix(max(onMain, onMin * 0.9), 0.2, smoothstep(5.0, 25.0, w));
  vec3 col = ambient() * 2.6 * mix(roofAlbedo(d, w), 0.03, street);
  float farB = smoothstep(0.05 * S, 0.16 * S, w);
  vec3 L = vec3(0.0);
  if (farB < 1.0) {
    float lampOn = smoothstep(0.0, 0.3, uLights);
    L += mainRoad(d, q, w) * lampOn * mix(0.45, 1.0, D);
    if (d.type != 3.0 || hash12(vec2(d.c)) < 0.3) L += minorStreets(d, w) * lampOn * mix(0.45, 1.0, D);
    float pBlk = (d.type == 3.0 ? 0.02 : d.type == 2.0 ? 0.08 : d.type == 0.0 ? 0.32 : 0.2) * (0.25 + 0.75 * D);
    L += windows(d, 11.0, w, 17.0, pBlk, 22.0, d.type == 1.0 ? 0.6 : 1.0) * (1.0 - street * 0.8);
    L += windows(d, 5.3, w, 29.0, pBlk * 0.5, 2.4, 0.3);
    if (d.type == 0.0) L += windows(d, 170.0, max(w, 1.5), 61.0, 0.22 * D, 1100.0, 0.0);
  }
  L = mix(L, meanLight(d.type, D), farB);
  L += (expressways(p, w) + avenues(p, w)) * mix(0.6, 1.0, D) * smoothstep(0.0, 0.3, uLights);
  // A surge passing: the lights flare and run towards white.
  col += mix(L, vec3(dot(L, vec3(0.3333))) * C_WHITE, min(0.6, gSurge * 0.5)) * (1.0 + 2.4 * gSurge);
  float water = 1.0 - smoothstep(-aw, aw, river(p));
  if (water > 0.0) {
    vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
    float F = 0.02 + 0.98 * pow(1.0 - abs(V.y), 5.0);
    col = mix(col, skyCol(R) * F, water);
  }
  return col;
}`;

const CITY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam;
out vec3 vW;
void main() {
  vec2 xz = uCam.xz + position.xz;
  float drop = dot(position.xz, position.xz) / (2.0 * 6.371e6);
  vW = vec3(xz.x, -drop, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;

const SKY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

/** Polar grid under the camera: rings from 4 m to 250 km. */
function polarGrid(rings = 150, segs = 192): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0], idx: number[] = [];
  const r0 = 4, r1 = 250000, f = Math.pow(r1 / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(f, i);
    for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** A surge of light: when it starts, how strong, and where in view (ahead, across) it starts from. */
interface Surge { t: number; size: number; ahead: number; across: number; speed: number }

const SKY_FRAG = /* glsl */ `
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
out vec4 fragColor;
${COMMON}
${ATMOSPHERE}
void main() {
  vec4 a = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w - uCam);
  // A few faint stars high up.
  vec3 q = floor(d * 420.0);
  float s = step(0.997, hash12(q.xy + q.z * 17.3)) * smoothstep(0.06, 0.35, d.y);
  fragColor = vec4((skyCol(d) + vec3(s * 0.25)) * uExposure, 1.0);
}`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vW;
out vec4 fragColor;
${COMMON}
${ATMOSPHERE}
${CITY}
void main() {
  vec3 V = normalize(vW - uCam);
  vec2 dx = dFdx(vW.xz), dy = dFdy(vW.xz);
  float fp = sqrt(max(length(dx) * length(dy), 1e-6));
  vec3 c = cityShade(vW.xz, fp, V);
  float T = transmit(vW);
  vec3 o = (c * T + fogCol(V) * (1.0 - T)) * uExposure;
  if (any(isnan(o)) || any(isinf(o))) o = vec3(0.0); // (a rare bad pixel would black the frame out through the glow)
  fragColor = vec4(o, 1.0);
}`;

/** The code the towers share with the ground. */
const SHARED = `${COMMON}
${ATMOSPHERE}
${CITY}`;

/**
 * The city's programs that take seconds to compile (the ground) or a while (the towers, the sky), to compile ahead
 * (Engine.compile) while a song is still being read and analysed: the palette is in uniforms, so they are the very
 * programs the plate will use, whatever the song.
 */
export function cityPrograms(): THREE.Object3D[] {
  const g = new THREE.BufferGeometry();
  const m = (vertexShader: string, fragmentShader: string) => new THREE.Mesh(g, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader }));
  return [m(CITY_VERT, GROUND_FRAG), m(SKY_VERT, SKY_FRAG), m(TOWER_VERT, towerFrag(SHARED))];
}

export class City implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 16 / 9, 2, 400000);
  private u: Record<string, THREE.IUniform>;
  private invVP = new THREE.Matrix4();
  private surges: Surge[] = [];
  private surgeT: Float64Array;
  private surgeU = Array.from({ length: SURGES }, () => new THREE.Vector4());
  private blocks: LyricBlocks;
  /** Consecutive lines stand left, right and middle, a little above the middle of the view. */
  private stands = new Stands([[-0.2, 0.1], [0.2, 0.04], [0, 0.14]]);
  private readonly soft: boolean;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { palette, music } = init;
    this.soft = look === 'ballad';
    this.scene.background = palette.ink.clone();
    this.u = {
      ...atmosphere(palette), ...lampColours(palette),
      uBeacon: { value: new THREE.Vector3(...lamp(palette.signal).toArray().map(v => +v.toFixed(4))) },
      uCam: { value: new THREE.Vector3() }, uLights: { value: 1 }, uTime: { value: 0 }, uHaze: { value: 1 }, uTraffic: { value: 1 },
      uExposure: { value: 1 }, uInvVP: { value: this.invVP }, uSurge: { value: this.surgeU }, uFocal: { value: 1000 }, uBeat: { value: 0 },
      uCenters: { value: CENTERS.map(c => new THREE.Vector4(...c)) },
    };
    const raw = (vertexShader: string, fragmentShader: string, depthTest = false) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms: this.u, depthTest, depthWrite: false });

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const sky = new THREE.Mesh(tri, raw(SKY_VERT, SKY_FRAG));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      this.invVP.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
    };
    this.scene.add(sky);


    const city = new THREE.Mesh(polarGrid(), raw(CITY_VERT, GROUND_FRAG, true)); // (behind the towers, which are drawn first, it isn't shaded)
    city.frustumCulled = false;
    city.renderOrder = -8;
    this.scene.add(city);

    this.scene.add(new Towers(SHARED, this.u).group);

    this.planSurges(init);
    this.surgeT = Float64Array.from(this.surges, s => s.t);
    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 40, maxW: this.soft ? 11 : 13, trans: 0.48, scrim: 0.55, dust: [0, 2.2, 0] });
    this.scene.add(this.blocks.group);
    this.resize(init.aspect);
  }

  /**
   * The surges: a small one on each kick of a loud section (a district flaring), wide ones on its snares, and the
   * first downbeat of a chorus or drop powering the city up from the middle of the view. Calm sections send a slow
   * swell on each bar's hit (none where the bar starts on no drum: on the bare downbeat it swelled into silence);
   * ballads send small ones on the hits of their loud sections.
   */
  private planSurges(init: SceneInit): void {
    const { music } = init, sections = music.a.sections, random = rng(0xc17 + Math.round(music.duration * 10));
    const loud = (t: number) => { const s = sections[music.sectionIndex(t)]; return !!s && (s.label === 'chorus' || s.label === 'drop'); };
    const ev: Array<[number, number, number]> = []; // time, size, speed (m/s)
    const acc = Accents.of(music);
    for (const d of Array.from(acc.barHits())) if (!loud(d)) ev.push([d, 0.35, 900]);
    if (!this.soft) {
      for (const [t, v] of music.a.hits.kick) if (loud(t) && v > 0.4) ev.push([t, 0.45 + 0.35 * v, 1500]);
      for (const [t, v] of music.a.hits.snare) if (loud(t) && v > 0.6) ev.push([t, 0.8, 2600]);
    } else {
      acc.times.forEach((t, i) => { if (loud(t) && acc.strength[i] > 0.4) ev.push([t, 0.3, 900]); });
    }
    ev.sort((a, b) => a[0] - b[0]);
    for (const [t, size, speed] of ev) {
      if (this.surges.length && t - this.surges[this.surges.length - 1].t < 0.15) continue;
      this.surges.push({ t, size, speed, ahead: 0.25 + 0.6 * random(), across: random() * 2 - 1 });
    }
    for (const s of sections) {
      if (s.label !== 'chorus' && s.label !== 'drop') continue;
      const big: Surge = { t: s.start, size: 1.6, speed: 2200, ahead: 0.45, across: 0 };
      const i = this.surges.findIndex(x => x.t > s.start - 0.08);
      if (i >= 0 && Math.abs(this.surges[i].t - s.start) < 0.08) this.surges[i] = big; else this.surges.splice(i < 0 ? this.surges.length : i, 0, big);
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  private height = 1080;
  setViewport(_width: number, height: number): void { this.height = height; }

  /** The camera at time t (m): high sinks slowly looking down; horizon runs low towards the glow; glide flies forward. */
  private pose(t: number, shot: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const k = Math.max(0, t - shot.start);
    if (shot.variant === 'canyon') {
      // Low between the towers down the corridor kept clear for it (cityTowers.ts).
      pos.set(CANYON_X + Math.sin(t * 0.11 + phase) * 14, CANYON_Y - 12 + Math.sin(t * 0.23) * 6, -t * 70);
      quat.setFromEuler(new THREE.Euler(-0.07 + Math.sin(t * 0.17) * 0.02, Math.sin(t * 0.07 + phase) * 0.06, Math.sin(t * 0.13) * 0.03, 'YXZ'));
    } else if (shot.variant === 'high') {
      pos.set(Math.sin(phase) * 2000 + side * k * 25, 2600 - k * 28, -2500 - t * 45);
      quat.setFromEuler(new THREE.Euler(-1.15, phase + side * k * 0.012, 0, 'YXZ'));
    } else if (shot.variant === 'horizon') {
      pos.set(Math.sin(phase) * 3000, 480 + Math.sin(t * 0.2) * 20, -t * 85);
      quat.setFromEuler(new THREE.Euler(-0.13, side * 0.3 + Math.sin(t * 0.05) * 0.1, side * 0.01, 'YXZ'));
    } else {
      pos.set(Math.sin(phase) * 3000 + Math.sin(t * 0.07) * 300, 300 + Math.sin(t * 0.13) * 30, -t * 140);
      quat.setFromEuler(new THREE.Euler(-0.42, side * 0.15, Math.sin(t * 0.11) * 0.03, 'YXZ'));
    }
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const cam = this.camera;
    this.pose(t, shot, cam.position, cam.quaternion);
    cam.updateMatrixWorld();
    const u = this.u, sec = shot.section;
    const loud = sec.label === 'chorus' || sec.label === 'drop';
    (u.uCam.value as THREE.Vector3).copy(cam.position);
    u.uTime.value = t;
    u.uTraffic.value = music.at(t).bpm / 120;
    // Calm sections run dimmer; a chorus powers up from its first downbeat (the big surge carries the lights on).
    const into = loud ? smooth((t - sec.start) / 0.6) : 0;
    // …and in loud sections the whole city's lights lift on each kick at once, before its surge has spread (the surge
    // alone peaked a few tenths of a second after the drum, where it reached the view).
    u.uLights.value = (this.soft ? 0.7 : 0.55) + (loud ? (this.soft ? 0.3 : 0.45) * into + (this.soft ? 0.05 : 0.1) * music.pulse('kick', t, 0.15) : 0) + 0.06 * music.env('low', t);
    u.uExposure.value = 1;
    u.uFocal.value = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    // The aviation lights flash on the kicks of loud sections (ballads at half).
    u.uBeat.value = loud ? (this.soft ? 0.5 : 1) * music.pulse('kick', t, 0.12) : 0;

    // Surges about now, placed where the view was looking when each started.
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), f = new THREE.Vector3(), r = new THREE.Vector3();
    let n = 0;
    for (let i = lastIndex(this.surgeT, t); i >= 0 && n < SURGES; i--) {
      const s = this.surges[i], age = t - s.t;
      if (age > 2.6) break;
      this.pose(s.t, shot, p, q);
      // The ground point at the given share down the frame from the centre of view.
      f.set(0, 0, -1).applyQuaternion(q);
      r.set(1, 0, 0).applyQuaternion(q);
      const dir = f.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), -0.35 * s.ahead).addScaledVector(r, 0.5 * s.across).normalize();
      const dist = dir.y < -0.02 ? Math.min(30000, p.y / -dir.y) : 30000;
      const gx = p.x + dir.x * dist, gz = p.z + dir.z * dist;
      this.surgeU[n].set(gx, gz, age * s.speed * (0.7 + p.y / 2500), s.size * Math.exp(-age / 1.1) * smooth(age / 0.05));
      n++;
    }
    for (let i = n; i < SURGES; i++) this.surgeU[i].set(0, 0, 0, 0);

    // The words: each line one block standing in the air, where the flight will have it in view while it is sung;
    // the camera comes up to it as the line ends and flies past it as the next comes up (lyricBlock.ts). From high
    // up, which hardly moves, it just stands there.
    const reach = shot.variant === 'high' ? 520 : shot.variant === 'glide' ? 300 : shot.variant === 'canyon' ? 150 : 220;
    const view = { reach, far: reach * 1.9, fov: cam.fov, aspect: cam.aspect, em: this.soft ? 0.064 : 0.068 };
    const pose = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => this.pose(time, shot, pp, qq);
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root, leave, size) => {
      const s = this.stands.get(shot.start, st, leave, pose, 40, view, size);
      s.apply(time, root);
      // Gone before the camera is on top of it (it would fill the frame).
      return smooth((s.depth(time) - reach * 0.3) / (reach * 0.25));
    });

    ctx.fx.bloom = 0.5;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.035;
  }
}
