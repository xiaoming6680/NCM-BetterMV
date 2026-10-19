// Aurora: a frozen lake in a snowfield under the night sky, ringed by dark mountains, with curtains of aurora in the
// cover's colours (its signal colour along the curtains' sharp lower edge, its second colour fading up into the
// sky); the ice mirrors them, the snow glints. The curtains are sheets folded along slow curves, combed into vertical
// rays, marched through layer by layer per pixel; seen from right under them their rays converge into the corona.
// The music is the aurora's activity: its brightness follows the song's loudness, every kick sends a surge of light
// running along the curtains, every snare shoves their folds, and a chorus brings them overhead (the corona) when
// the camera looks up.
// Cameras: over the ice towards the curtains (lake), wide from higher on the shore (wide), looking up from the ice
// into the corona (up).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { rng, smooth, surge } from './types.ts';
import { Accents } from './hits.ts';
import { LyricBlocks, Stands, voiceFor } from './lyricBlock.ts';
import { lastIndex } from '../director/music.ts';

const SURGES = 4;
/** Seconds a surge is on its way in before its hit. */
const PREROLL = 0.45;
/**
 * A colour as a uniform: the palette reaches the shader as uniforms, so its source is the same for every song and the
 * compiled program is reused by the next song with the aurora (as in the city). Rounded as when written into the source.
 */
const u3 = (c: THREE.Color) => new THREE.Vector3(+c.r.toFixed(5), +c.g.toFixed(5), +c.b.toFixed(5));
/** A light's colour: the hue of c at full strength. */
const hue = (c: THREE.Color) => { const m = Math.max(c.r, c.g, c.b, 1e-4); return c.clone().multiplyScalar(1 / m); };

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

/** FRAG's colours for a palette. */
function colours(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): Record<string, THREE.IUniform> {
  const low = hue(p.signal), high = hue(p.accent.clone().lerp(p.signal, 0.15));
  const zenith = p.ink.clone().lerp(p.accent, 0.12).multiplyScalar(0.18).add(new THREE.Color(0.0015, 0.002, 0.004));
  const horizon = p.ink.clone().lerp(p.accent, 0.3).multiplyScalar(0.3).add(new THREE.Color(0.003, 0.004, 0.008));
  return { uLow: { value: u3(low) }, uHigh: { value: u3(high) }, uPaper: { value: u3(hue(p.paper)) }, uZenith: { value: u3(zenith) }, uHorizon: { value: u3(horizon) } };
}

const FRAG = /* glsl */ `
precision highp float;
in vec2 vNdc;
out vec4 fragColor;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uT, uI, uFlow, uOver, uExposure;
uniform vec4 uSurge[${SURGES}];
uniform vec3 uLow, uHigh, uPaper, uZenith, uHorizon;
#define LOW uLow
#define HIGH uHigh
#define PAPER uPaper
#define ZENITH uZenith
#define HORIZON uHorizon
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
float n2(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

/** Where curtain j hangs: its world z at x (and height h: the sheet leans back as it rises). */
float curve(float x, float h, int j) {
  float fj = float(j);
  // (Relative to the camera with a little parallax: the aurora is far off and stays ahead; a chorus brings it overhead.)
  return uCam.z * 0.92 + mix(-230.0 - fj * 85.0, -6.0 - fj * 22.0, uOver)
    + 70.0 * sin(x * 0.0042 + fj * 1.7 + uFlow * 0.21) + 26.0 * sin(x * 0.013 - uFlow * 0.43 + fj * 2.3)
    + 9.0 * sin(x * 0.041 + uFlow * 0.9 + fj) - (h - 40.0) * 0.18;
}

/**
 * The aurora along a ray from ro. Each curtain is a vertical sheet over a folding curve: the ray's crossing with it
 * is found directly (a few fixed-point steps), a handful of parallel sheets around it give it depth, and at the
 * crossing the sheet's rays, brighter stretches, height profile and colour are read.
 */
vec3 aurora(vec3 ro, vec3 rd) {
  if (rd.y < 0.005) return vec3(0.0);
  vec3 col = vec3(0.0);
  float rz = rd.z;
  if (abs(rz) < 1e-3) rz = rz < 0.0 ? -1e-3 : 1e-3;
  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    for (int s = -2; s <= 2; s++) {
      float off = float(s) * 3.0;
      float t = (curve(ro.x, 90.0, j) + off - ro.z) / rz;
      for (int it = 0; it < 4; it++) {
        vec3 q = ro + rd * max(t, 0.0);
        t = (curve(q.x, q.y, j) + off - ro.z) / rz;
      }
      if (t <= 0.0 || t > 3000.0) continue;
      vec3 q = ro + rd * t;
      float k = (q.y - 40.0) / 120.0;
      if (k < -0.05 || k > 1.0) continue;
      // A sharp, bright hem along the lower edge, the sheet fading upwards above it.
      float kk = max(k, 0.0);
      float edge = smoothstep(-0.03, 0.0, k) * (exp(-kk * 2.6) * 0.75 + exp(-kk * 30.0) * 1.1);
      // Where the sheet folds and is seen edge-on it is brightest (the light of its whole width adds up).
      float e = 0.5;
      vec2 n = normalize(vec2(-(curve(q.x + e, q.y, j) - curve(q.x - e, q.y, j)) / (2.0 * e), 1.0));
      float edgeOn = clamp(1.0 / max(0.2, abs(dot(normalize(rd.xz), n))), 1.0, 5.0);
      float x = q.x * 0.11 + fj * 31.0 + uFlow * 0.35;
      float rays = 0.2 + 0.8 * pow(n1(x) * 0.65 + n1(x * 2.7 + 7.0) * 0.35, 2.0);
      float stretch = 0.3 + 0.7 * n1(q.x * 0.006 + fj * 5.0 + uFlow * 0.05);
      float surge = 0.0;
      for (int i = 0; i < ${SURGES}; i++) {
        vec4 u = uSurge[i];
        if (u.z <= 0.0) continue;
        float e = (q.x - u.x) / 55.0;
        surge += u.z * exp(-e * e);
      }
      vec3 c = mix(LOW, HIGH, smoothstep(0.08, 0.7, k));
      c = mix(c, PAPER, min(0.75, surge * 0.45 + exp(-kk * 30.0) * 0.25));
      float wgt = exp(-float(s * s) * 0.6) * (j == 0 ? 1.0 : 0.6);
      col += c * rays * stretch * edge * edgeOn * wgt * (1.0 + 2.5 * surge) * exp(-t / 1600.0);
    }
  }
  return col * 0.4 * uI;
}

/** The mountains' ridge height (as an elevation, radians) round the horizon. */
float ridge(vec3 rd) {
  float a = atan(rd.x, -rd.z);
  float h = 0.0, amp = 1.0, fr = 2.0;
  for (int i = 0; i < 5; i++) { h += amp * n1(a * fr + float(i) * 11.3); amp *= 0.5; fr *= 2.2; }
  return 0.012 + 0.07 * pow(h / 1.9, 2.0);
}

vec3 stars(vec3 rd) {
  vec3 q = rd * 300.0;
  vec3 c = floor(q);
  float h = hash12(c.xy + c.z * 7.31);
  float s = step(0.9975, h) * (0.5 + 0.5 * sin(uT * (1.0 + 3.0 * fract(h * 91.0)) + h * 50.0));
  return vec3(s * smoothstep(0.0, 0.2, rd.y) * 0.5);
}

vec3 sky(vec3 ro, vec3 rd, bool withAurora) {
  vec3 c = mix(HORIZON, ZENITH, smoothstep(0.0, 0.5, rd.y)) + stars(rd);
  vec3 a = withAurora ? aurora(ro, rd) : vec3(0.0);
  // The air glows faintly with the aurora's light near the horizon.
  c += (LOW * 0.6 + HIGH * 0.4) * uI * 0.012 * exp(-max(rd.y, 0.0) * 6.0);
  // Mountains: dark, rimmed by the aurora's light behind them.
  float r = ridge(rd);
  if (rd.y < r) {
    float rim = exp(-(r - rd.y) * 220.0);
    return HORIZON * 0.25 + (LOW * 0.6 + HIGH * 0.4) * uI * 0.02 * rim;
  }
  return c + a;
}

void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(w.xyz / w.w - uCam);
  vec3 ro = uCam;
  vec3 col = vec3(0.0);
  if (rd.y >= 0.0) col = sky(ro, rd, true);
  else {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    // Under the mountains' line the ground is beyond them: only the near shore is lake and snow.
    float far = smoothstep(900.0, 1600.0, t);
    // Ice where the noise is low (the lake), snow drifts elsewhere.
    float lake = smoothstep(0.62, 0.5, n2(p.xz * 0.012) * 0.7 + n2(p.xz * 0.05) * 0.3);
    vec3 auroraLight = (LOW * 0.65 + HIGH * 0.35) * uI;
    // Ice: a slightly rippled mirror, blacker straight down, cracked here and there.
    vec2 g = vec2(n2(p.xz * 0.35) - 0.5, n2(p.xz * 0.35 + 17.0) - 0.5) * 0.012;
    vec3 rr = normalize(reflect(rd, normalize(vec3(g.x, 1.0, g.y))));
    float fres = 0.04 + 0.96 * pow(1.0 - max(0.0, -rd.y), 5.0);
    vec3 ice = sky(p + vec3(0.0, 0.01, 0.0), rr, true) * (0.25 + 0.75 * fres);
    float crack = smoothstep(0.035, 0.0, abs(n2(p.xz * 0.08) - 0.5)) * 0.4;
    ice += auroraLight * crack * 0.01;
    // Snow: lit by the aurora and the sky, with glints.
    vec2 cell = floor(p.xz * 6.0);
    float glint = step(0.993, hash12(cell)) * (0.5 + 0.5 * sin(uT * 2.0 + hash12(cell + 3.0) * 40.0)) * exp(-t / 60.0);
    vec3 snow = auroraLight * 0.03 + HORIZON * 0.5 + auroraLight * glint * 0.6;
    col = mix(snow, ice, lake);
    // Haze towards the horizon.
    col = mix(col, sky(ro, vec3(rd.x, 0.002, rd.z), false), smoothstep(150.0, 1500.0, t) * 0.85 + far * 0.15);
  }
  col *= uExposure;
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  fragColor = vec4(col, 1.0);
}`;

/** A surge of light along the curtains: when, how strong, from which side. */
interface Surge { t: number; size: number; dir: number }

/** The aurora's program, to compile ahead while a song is analysed (see cityPrograms). */
export const auroraPrograms = (): THREE.Object3D[] =>
  [new THREE.Mesh(new THREE.BufferGeometry(), new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG }))];

export class Aurora implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
  private u: Record<string, THREE.IUniform>;
  private invVP = new THREE.Matrix4();
  private surges: Surge[] = [];
  private surgeT: Float64Array;
  private surgeU = Array.from({ length: SURGES }, () => new THREE.Vector4());
  private snares: Float64Array;
  private blocks: LyricBlocks;
  /** Lines stand in the dark band under the curtains' hem (on the hem a light signal colour vanishes), in turn high left, low right. */
  private stands = new Stands([[-0.12, -0.07], [0.12, -0.23]]);
  private readonly soft: boolean;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { palette, music } = init;
    this.soft = look === 'ballad';
    this.scene.background = palette.ink.clone();
    this.u = {
      uInvVP: { value: this.invVP }, uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uI: { value: 1 }, uFlow: { value: 0 },
      uOver: { value: 0 }, uExposure: { value: 1 }, uSurge: { value: this.surgeU }, ...colours(palette),
    };
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(tri, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false, depthWrite: false }));
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      this.invVP.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
    };
    this.scene.add(mesh);

    // Surges: on the kicks of loud sections, on each bar's hit elsewhere (none where the bar starts on no drum); sides
    // alternate.
    const sections = music.a.sections, random = rng(0xa0 + Math.round(music.duration * 10));
    const loud = (t: number) => { const s = sections[music.sectionIndex(t)]; return !!s && (s.label === 'chorus' || s.label === 'drop'); };
    const ev: Array<[number, number]> = [];
    for (const d of Array.from(Accents.of(music).barHits())) if (!loud(d)) ev.push([d, 0.5]);
    for (const [t, v] of music.a.hits.kick) if (loud(t) && v > 0.4) ev.push([t, this.soft ? 0.5 : 0.6 + 0.5 * v]);
    ev.sort((a, b) => a[0] - b[0]);
    let dir = random() < 0.5 ? -1 : 1;
    for (const [t, size] of ev) {
      if (this.surges.length && t - this.surges[this.surges.length - 1].t < 0.18) continue;
      if (random() < 0.75) dir = -dir;
      this.surges.push({ t, size, dir });
    }
    this.surgeT = Float64Array.from(this.surges, s => s.t);
    this.snares = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.55), h => h[0]);

    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 2.8, maxW: this.soft ? 11 : 13, trans: 0.48, dust: [0, 1.5, 0] });
    this.scene.add(this.blocks.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  /** lake: low over the ice, gliding towards the curtains; wide: higher on the shore, panning; up: tilting up into the sky. */
  private pose(t: number, shot: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const k = Math.max(0, t - shot.start), len = Math.max(1, shot.end - shot.start);
    if (shot.variant === 'up') {
      // (All the way up only in a chorus, when the curtains come overhead; elsewhere there'd be nothing but stars.)
      const loud = shot.section.label === 'chorus' || shot.section.label === 'drop';
      const e = smooth(k / Math.min(len, 6));
      pos.set(Math.sin(phase) * 30, 1.7, -t * 1.2);
      quat.setFromEuler(new THREE.Euler(0.25 + (loud ? 1.0 : 0.25) * e, side * 0.2 + k * 0.02 * side, 0, 'YXZ'));
    } else if (shot.variant === 'wide') {
      pos.set(Math.sin(phase) * 60, 16, 40 - t * 2);
      quat.setFromEuler(new THREE.Euler(0.13, side * 0.25 + Math.sin(t * 0.04 + phase) * 0.18, 0, 'YXZ'));
    } else {
      pos.set(Math.sin(t * 0.07 + phase) * 15, 2.2 + Math.sin(t * 0.3) * 0.1, -t * 3.5);
      quat.setFromEuler(new THREE.Euler(0.24 + Math.sin(t * 0.11) * 0.02, side * 0.12 + Math.sin(t * 0.06) * 0.05, Math.sin(t * 0.13) * 0.01, 'YXZ'));
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
    u.uT.value = t;
    // Brightness with the song's loudness (a quieter base in calm sections).
    u.uI.value = (loud ? 0.75 : 0.45) + (this.soft ? 0.5 : 0.75) * music.env('rms', t);
    // The folds drift with the tempo; each snare shoves them on.
    const n = lastIndex(this.snares, t);
    let shove = 0;
    for (let i = n; i >= 0; i--) {
      const age = t - this.snares[i];
      if (age > 2) { shove += 1.1 * (i + 1); break; }
      shove += 1.1 * surge(age, 0.12);
    }
    u.uFlow.value = 0.5 * music.visual.position(t) * (this.soft ? 0.45 : 0.7) + (this.soft ? 0.4 : 1) * shove;
    // Looking up in a chorus: the curtains come overhead.
    // (Elsewhere a sheet half overhead is seen edge-on as an odd blob: only a chorus brings them all the way over.)
    u.uOver.value = shot.variant === 'up' && loud ? smooth((t - shot.start) / 2.5) : 0;
    u.uExposure.value = 1;

    let m = 0;
    for (let i = lastIndex(this.surgeT, t + PREROLL); i >= 0 && m < SURGES; i--) {
      const s = this.surges[i], age = t - s.t;
      if (age > 2.4) break;
      // The surge runs along the curtains across the view (x), from one side to the other, and crosses the middle of
      // the view on its hit: it comes in from the side growing brighter, is brightest there, and fades as it runs
      // off. (It used to set out from the side on the hit and reach the middle 0.8 s later.)
      const x = cam.position.x + s.dir * age * 650;
      const k = age < 0 ? smooth((age + PREROLL) / PREROLL) * smooth((age + PREROLL) / PREROLL) : Math.exp(-age / 0.9);
      this.surgeU[m++].set(x, age, s.size * k, 0);
    }
    for (let i = m; i < SURGES; i++) this.surgeU[i].set(0, 0, 0, 0);

    // The words: each line one block standing over the ice ahead, in the dark band between the curtains' bright hem
    // and the mountains, where the camera will have it in view while it is sung (lyricBlock.ts); the camera drifts
    // up to it as the line ends.
    const view = { reach: 30, far: 48, fov: cam.fov, aspect: cam.aspect, em: this.soft ? 0.064 : 0.068 };
    const pose = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => this.pose(time, shot, pp, qq);
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root, leave, size) => {
      const s = this.stands.get(shot.start, st, leave, pose, 2.8, view, size);
      s.apply(time, root);
      return smooth((s.depth(time) - 9) / 7);
    });

    ctx.fx.bloom = 0.55;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.035;
  }
}
