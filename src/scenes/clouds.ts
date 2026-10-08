// Clouds: flying over a sea of cumulus at sundown, the cover sinking at the horizon as the sun — hazy, half lost in
// the glow — and lighting the clouds in its colours. Cameras: gliding over the tops, skimming them (the taller ones
// pass through the lens), and climbing out of a cloud into the light (a chorus breaking through). The words are signs
// in the sky ahead: each holds in front of the camera while it is sung, then is left behind and flown through.
// Clouds after the base engine's kit/clouds.ts (from Still_Shining v10): broken cumulus from tileable Perlin-Worley
// noise (Schneider, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn", SIGGRAPH 2015), self-shadowing, a
// two-lobe phase (silver linings into the sun), approximate multiple scattering, haze. For real time it marches at
// half resolution (a quarter at low quality) with a fixed dither instead of the engine's motion-blur averaging.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricGates } from './lyricSpace.ts';

const SHAPE = 96, DETAIL = 32;
/** The cloud slab (m). */
const BASE = 2250, TOP = 2950;

const COMMON = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

// ── The noise volumes, baked once on the GPU into a 2D atlas of slices and read back into 3D textures ──────────────
const NOISE = /* glsl */ `
  uniform float uRes, uTiles;
  uniform int uMode;
  ${COMMON}
  vec3 h33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  float worley(vec3 p, float per) {
    vec3 id = floor(p), f = fract(p);
    float d = 1.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(x, y, z);
      vec3 r = o + h33(mod(id + o, per)) - f;
      d = min(d, dot(r, r));
    }
    return sqrt(d);
  }
  vec3 g33(vec3 c) { return normalize(h33(c) * 2.0 - 1.0 + 1e-4); }
  float perlin(vec3 p, float per) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(g33(mod(i, per)), f);
    float n100 = dot(g33(mod(i + vec3(1, 0, 0), per)), f - vec3(1, 0, 0));
    float n010 = dot(g33(mod(i + vec3(0, 1, 0), per)), f - vec3(0, 1, 0));
    float n110 = dot(g33(mod(i + vec3(1, 1, 0), per)), f - vec3(1, 1, 0));
    float n001 = dot(g33(mod(i + vec3(0, 0, 1), per)), f - vec3(0, 0, 1));
    float n101 = dot(g33(mod(i + vec3(1, 0, 1), per)), f - vec3(1, 0, 1));
    float n011 = dot(g33(mod(i + vec3(0, 1, 1), per)), f - vec3(0, 1, 1));
    float n111 = dot(g33(mod(i + vec3(1, 1, 1), per)), f - vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  }
  float wfbm(vec3 v, float per) { return worley(v * per, per) * 0.625 + worley(v * per * 2.0, per * 2.0) * 0.25 + worley(v * per * 4.0, per * 4.0) * 0.125; }
  void main() {
    vec2 px = floor(gl_FragCoord.xy);
    float tile = floor(px.x / uRes) + floor(px.y / uRes) * uTiles;
    vec3 v = (vec3(mod(px.x, uRes), mod(px.y, uRes), tile) + 0.5) / uRes;
    if (uMode == 0) {
      float pf = 0.0, a = 1.0, fr = 4.0, nrm = 0.0;
      for (int i = 0; i < 4; i++) { pf += a * perlin(v * fr, fr); nrm += a; a *= 0.5; fr *= 2.0; }
      pf = clamp(pf / nrm * 0.75 + 0.5, 0.0, 1.0);
      float w1 = 1.0 - wfbm(v, 4.0), w2 = 1.0 - wfbm(v, 8.0), w3 = 1.0 - wfbm(v, 16.0);
      gl_FragColor = vec4(clamp(remap(pf, w1 - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0), w1, w2, w3);
    } else {
      gl_FragColor = vec4(1.0 - wfbm(v, 2.0), 1.0 - wfbm(v, 4.0), 1.0 - wfbm(v, 8.0), 1.0);
    }
  }`;

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function bakeVolume(renderer: THREE.WebGLRenderer, res: number, mode: number): THREE.Data3DTexture {
  const tiles = Math.ceil(Math.sqrt(res)), rows = Math.ceil(res / tiles);
  const rt = new THREE.WebGLRenderTarget(res * tiles, res * rows, { type: THREE.UnsignedByteType, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: NOISE, uniforms: { uRes: { value: res }, uTiles: { value: tiles }, uMode: { value: mode } } });
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  quad.render(renderer);
  const atlas = new Uint8Array(rt.width * rt.height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, atlas);
  renderer.setRenderTarget(prev);
  rt.dispose(); mat.dispose(); quad.dispose();
  const vol = new Uint8Array(res * res * res * 4);
  for (let z = 0; z < res; z++) {
    const tx = (z % tiles) * res, ty = Math.floor(z / tiles) * res;
    for (let y = 0; y < res; y++) {
      const src = ((ty + y) * rt.width + tx) * 4, dst = (z * res * res + y * res) * 4;
      vol.set(atlas.subarray(src, src + res * 4), dst);
    }
  }
  const tex = new THREE.Data3DTexture(vol, res, res, res);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ── The march (premultiplied colour, alpha = cover) ─────────────────────────────────────────────────────────────────
const MARCH = /* glsl */ `
  precision highp sampler3D;
  uniform mat4 uInvVP;
  uniform sampler3D uShape, uDetail;
  uniform float uCov, uT, uSteps;
  uniform vec4 uBump;
  uniform vec3 uSunCol, uAmbTop, uAmbBot, uSunDir, uCam, uFogCol;
  uniform vec2 uWind;
  varying vec2 vUv;
  ${COMMON}
  const float CB = ${BASE.toFixed(1)}, CT = ${TOP.toFixed(1)}, DENS = 0.12, FOG = 2.4e-5;
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
  float weather(vec2 xz) {
    vec2 q = (xz + uWind * uT) / 21000.0;
    float a = texture(uShape, vec3(q, 0.21)).r, b = texture(uShape, vec3(q * 2.7 + 0.31, 0.63)).g;
    float n = a * 0.7 + b * 0.45;
    float c = smoothstep(1.02 - uCov, 1.28 - uCov * 0.8, n);
    vec2 d = xz - uBump.xy;
    return max(c, uBump.w * exp(-dot(d, d) / (uBump.z * uBump.z)));
  }
  float density(vec3 p, float lod) {
    float h = (p.y - CB) / (CT - CB);
    if (h <= 0.0 || h >= 1.0) return 0.0;
    float cov = weather(p.xz);
    if (cov < 0.02) return 0.0;
    float top = mix(0.42, 1.0, cov);
    float prof = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(top * 0.72, top, h));
    vec3 sp = (p + vec3(uWind.x, 0.0, uWind.y) * uT) / 2400.0;
    vec4 n = texture(uShape, sp);
    float low = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    float base = remap(n.r, low - 1.0, 1.0, 0.0, 1.0) * prof;
    base = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
    if (base <= 0.0 || lod > 0.5) return base;
    vec3 dn = texture(uDetail, p / 300.0 + vec3(0.013, -0.021, 0.008) * uT).rgb;
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    hf = mix(hf, 1.0 - hf, clamp(h * 3.0, 0.0, 1.0));
    return clamp(remap(base, hf * 0.55, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  float toSun(vec3 p) {
    float od = 0.0, st = 36.0;
    vec3 q = p;
    for (int i = 0; i < 4; i++) { q += uSunDir * st; od += density(q, 1.0) * st; st *= 2.0; }
    return od;
  }
  void main() {
    vec4 a = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rd = normalize(a.xyz / a.w - uCam);
    vec3 cam = uCam;
    float tA = 0.0, tB = 0.0;
    if (abs(rd.y) > 1e-5) {
      float t0 = (CB - cam.y) / rd.y, t1 = (CT - cam.y) / rd.y;
      tA = max(min(t0, t1), 0.0); tB = max(t0, t1);
    } else if (cam.y > CB && cam.y < CT) { tA = 0.0; tB = 1e9; }
    tB = min(tB, 36000.0);
    if (tB <= tA) { gl_FragColor = vec4(0.0); return; }
    float n = floor(uSteps);
    float dt = max((tB - tA) / n, 14.0);
    // A fixed dither (interleaved gradient noise): no banding, and no crawl from frame to frame.
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float t = tA + dt * j;
    float cs = dot(rd, uSunDir);
    vec3 col = vec3(0.0);
    float T = 1.0, dsum = 0.0, wsum = 0.0;
    for (int i = 0; i < 80; i++) {
      if (t > tB || T < 0.01 || float(i) >= n) break;
      vec3 p = cam + rd * t;
      float d = density(p, dt > 240.0 ? 1.0 : 0.0);
      if (d > 0.003) {
        float sig = d * DENS;
        float od = toSun(p) * DENS;
        float h = (p.y - CB) / (CT - CB);
        vec3 S = vec3(0.0);
        float ka = 1.0, kb = 1.0, kc = 1.0;
        for (int o = 0; o < 3; o++) {
          float ph = mix(hg(cs, 0.75 * kc), hg(cs, -0.25 * kc), 0.3) * 12.566;
          S += kb * ph * exp(-od * ka);
          ka *= 0.25; kb *= 0.42; kc *= 0.5;
        }
        float powder = 1.0 - 0.7 * exp(-sig * 200.0);
        vec3 L = uSunCol * S * powder + mix(uAmbBot, uAmbTop, smoothstep(0.05, 0.95, h));
        L += mix(uSunCol, vec3(luma(uSunCol)), 0.55) * 0.07 * exp(-od * 0.004);
        float Ts = exp(-sig * dt);
        col += T * L * (1.0 - Ts);
        wsum += T * (1.0 - Ts); dsum += T * (1.0 - Ts) * t;
        T *= Ts;
      }
      t += dt;
    }
    if (T > 0.999) { gl_FragColor = vec4(0.0); return; }
    float tm = dsum / max(wsum, 1e-5);
    float tr = exp(-tm * FOG);
    col = col * tr + uFogCol * (1.0 - T) * (1.0 - tr);
    gl_FragColor = vec4(col, 1.0 - T);
  }`;

// ── The sky (with the cover setting in it) and the clouds over it ───────────────────────────────────────────────────
const SKY_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY = /* glsl */ `
  uniform sampler2D tClouds, uCover;
  uniform mat4 uInvVP;
  uniform vec3 uCam, uSunDir, uZenith, uHorizon, uGlow, uBelow;
  uniform float uSunR, uKick;
  varying vec2 vUv;
  void main() {
    vec4 a = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 d = normalize(a.xyz / a.w - uCam);
    float e = d.y;
    vec3 c = mix(uHorizon, uZenith, smoothstep(-0.01, 0.42, e));
    c = mix(c, uBelow, smoothstep(0.0, -0.12, e));
    float s = max(dot(d, uSunDir), 0.0);
    c += uGlow * (0.35 * pow(s, 10.0) + 0.6 * pow(s, 90.0)) * (1.0 + 0.15 * uKick);
    // The cover as the sun: a disc round the sun's direction, its lower part lost in the horizon haze.
    vec3 right = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, uSunDir);
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    if (ang < uSunR * 1.05) {
      vec2 q = vec2(dot(d, right), dot(d, up)) / sin(uSunR);
      float disc = 1.0 - smoothstep(0.96, 1.0, length(q));
      vec3 cover = texture2D(uCover, q * 0.5 + 0.5).rgb;
      float haze = smoothstep(-0.05, 0.6, q.y * 0.5 + 0.5 + (e - uSunDir.y) * 2.0);
      // Lit from within: the cover's colours brightened and run into the glow at its rim.
      float rim = smoothstep(0.55, 1.0, length(q));
      c = mix(c, cover * 1.1 + uGlow * (0.25 + 0.5 * rim), disc * mix(0.2, 0.78, haze) * (1.0 - 0.45 * rim));
    }
    vec4 cl = texture2D(tClouds, vUv);
    gl_FragColor = vec4(c * (1.0 - cl.a) + cl.rgb, 1.0);
  }`;

/** The camera at time t on a shot: where it is and where it looks. */
interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion }

export class Clouds implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 1, 60000);
  private shape: THREE.Data3DTexture | null = null;
  private detail: THREE.Data3DTexture | null = null;
  private rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  private march: THREE.ShaderMaterial;
  private marchQuad: FullScreenQuad;
  private sky: THREE.ShaderMaterial;
  private invVP = new THREE.Matrix4();
  private sunDir: THREE.Vector3;
  private speed: number;
  private gates: LyricGates;
  private scale = 0.5;
  private size = new THREE.Vector2(1920, 1080);
  private shot: Shot | null = null;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.speed = look === 'ballad' ? 85 : 160;
    // The sun low ahead, a little to one side (the camera flies towards −z).
    const side = (rng(Math.round(init.music.duration * 1000))() < 0.5 ? -1 : 1) * 0.22;
    this.sunDir = new THREE.Vector3(side, Math.sin(THREE.MathUtils.degToRad(1.6)), -1).normalize();
    // The light from the palette: the sun warmed towards the signal, the sky from ink to the cover's own colours.
    const lin = (c: THREE.Color) => new THREE.Vector3(c.r, c.g, c.b);
    const warm = new THREE.Color(1.0, 0.62, 0.38).lerp(palette.signal, 0.35);
    // Late dusk: a low, deep sun, the sky darkening overhead (the words, light, read against it).
    const sun = warm.clone().multiplyScalar(1.15);
    const zenith = palette.ink.clone().lerp(palette.accent, 0.12).multiplyScalar(0.6).add(new THREE.Color(0.006, 0.01, 0.03));
    const horizon = warm.clone().lerp(palette.paper, 0.15).multiplyScalar(0.3);
    const glow = warm.clone().multiplyScalar(0.9);
    const ambTop = zenith.clone().multiplyScalar(1.6).add(new THREE.Color(0.012, 0.018, 0.045));
    const ambBot = palette.accent.clone().multiplyScalar(0.04).add(new THREE.Color(0.02, 0.016, 0.028));
    this.march = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: MARCH, depthTest: false, depthWrite: false,
      uniforms: {
        uInvVP: { value: this.invVP }, uShape: { value: null }, uDetail: { value: null }, uCov: { value: 0.52 }, uT: { value: 0 }, uSteps: { value: 48 },
        uBump: { value: new THREE.Vector4() }, uSunCol: { value: lin(sun) }, uAmbTop: { value: lin(ambTop) }, uAmbBot: { value: lin(ambBot) },
        uSunDir: { value: this.sunDir }, uCam: { value: new THREE.Vector3() }, uFogCol: { value: lin(horizon) }, uWind: { value: new THREE.Vector2(9, -4) },
      },
    });
    this.marchQuad = new FullScreenQuad(this.march);
    this.sky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY, depthTest: false, depthWrite: false,
      uniforms: {
        tClouds: { value: this.rt.texture }, uCover: { value: init.cover }, uInvVP: { value: this.invVP }, uCam: { value: new THREE.Vector3() },
        uSunDir: { value: this.sunDir }, uZenith: { value: lin(zenith) }, uHorizon: { value: lin(horizon) }, uGlow: { value: lin(glow) },
        uBelow: { value: lin(palette.ink.clone().multiplyScalar(0.6)) }, uSunR: { value: THREE.MathUtils.degToRad(6.5) }, uKick: { value: 0 },
      },
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sky);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -10;
    this.scene.add(backdrop);
    // The clouds march before each draw of the scene, for the camera it is drawn with.
    this.scene.onBeforeRender = (renderer, _scene, camera) => this.render(renderer, camera as THREE.PerspectiveCamera);

    this.gates = new LyricGates(palette, { style: look === 'ballad' ? 'poem' : 'hook', em: 13, maxW: 190, trans: { em: 6, vertical: false }, linger: 3 });
    this.scene.add(this.gates.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The march's resolution: a share of the canvas (half at high quality). */
  setViewport(width: number, height: number, pixelRatio: number): void {
    this.size.set(width, height);
    this.scale = pixelRatio >= 1 ? 0.5 : 0.6;
    this.rt.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }

  private render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    if (!this.shape) {
      this.shape = bakeVolume(renderer, SHAPE, 0);
      this.detail = bakeVolume(renderer, DETAIL, 1);
      this.march.uniforms.uShape.value = this.shape;
      this.march.uniforms.uDetail.value = this.detail;
    }
    camera.updateMatrixWorld(true);
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    const pos = camera.getWorldPosition(new THREE.Vector3());
    (this.march.uniforms.uCam.value as THREE.Vector3).copy(pos);
    (this.sky.uniforms.uCam.value as THREE.Vector3).copy(pos);
    const prev = renderer.getRenderTarget(), color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.marchQuad.render(renderer);
    renderer.setClearColor(color, alpha);
    renderer.setRenderTarget(prev);
  }

  /**
   * The camera at time t for a shot. Flying towards −z at a steady speed (so cuts within the plate keep the travel);
   * over: well above the tops, looking a little down; skim: grazing them, the taller ones passing through the lens;
   * rise: from inside a cloud (one is put on the path) climbing out into the light over the shot's first bars.
   */
  private pose(t: number, shot: Shot, out: Pose): Pose {
    const random = rng(shot.seed);
    const sk = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const side = random() < 0.5 ? -1 : 1;
    const z = -t * this.speed;
    const sway = Math.sin(t * 0.21) * 60;
    // The speeding-up cuts of a run change only the heading: one height for the whole run (a climb out of a cloud
    // on every beat would white the frame out on every beat).
    const variant = shot.run ? 'skim' : shot.variant;
    let y = 3250, pitch = -0.1, bank = Math.sin(t * 0.17) * 0.03 * side, yaw = side * 0.08;
    if (variant === 'skim') {
      y = 3010 + Math.sin(t * 0.33) * 40;
      pitch = -0.02;
      bank = Math.sin(t * 0.25) * 0.05;
      yaw = side * 0.05;
    } else if (variant === 'rise') {
      const k = smooth(clamp01((t - shot.start) / Math.max(2, Math.min(6, (shot.end - shot.start) * 0.6))));
      y = lerp(2650, 3230, k);
      pitch = lerp(0.12, -0.06, inOutCubic(sk));
      yaw = side * lerp(0.02, 0.1, sk);
    }
    out.pos.set(sway, y, z);
    out.quat.setFromEuler(new THREE.Euler(pitch, yaw, bank, 'YXZ'));
    return out;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const soft = this.look === 'ballad';
    const kick = soft ? 0 : music.pulse('kick', t, 0.2);
    this.shot = shot;
    const pose = this.pose(t, shot, { pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
    this.camera.position.copy(pose.pos);
    this.camera.quaternion.copy(pose.quat);
    this.camera.updateMatrixWorld();
    const mu = this.march.uniforms;
    mu.uT.value = t;
    // A cloud on the path where a rise begins, so it starts inside one.
    if (shot.variant === 'rise' && !shot.run) {
      const p0 = this.pose(shot.start, shot, { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }).pos;
      (mu.uBump.value as THREE.Vector4).set(p0.x, p0.z - this.speed * 1.5, 1600, 1);
    } else (mu.uBump.value as THREE.Vector4).set(0, 0, 1000, 0);
    mu.uSteps.value = this.scale >= 0.55 ? 40 : 48;
    this.sky.uniforms.uKick.value = kick;

    // The words: a sign 170 m ahead while it is sung (riding with the camera), left where it was when the chunk ends.
    const ahead = 170;
    // Consecutive signs step across the sky (left, right, middle), so one being left behind never sits on the next.
    const LANES: Array<[number, number]> = [[-30, 28], [30, 4], [0, -18]];
    const at = (time: number, dist: number, drop: number, lane: number, root: THREE.Object3D) => {
      const p = this.pose(time, shot, { pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat), up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat), [lx, ly] = LANES[lane % LANES.length];
      root.position.copy(p.pos).addScaledVector(fwd, dist).addScaledVector(up, ly - drop).addScaledVector(right, lx);
      root.quaternion.copy(p.quat);
      return root.position.clone().sub(this.camera.position).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
    };
    this.gates.update(ctx.lyrics, t, shot.section.energy, (c, time, root) => {
      const depth = at(Math.min(time, c.end), ahead, 0, c.ordinal, root);
      const appear = smooth((time - c.start + 0.12) / 0.25);
      return appear * smooth((depth - 45) / 80);
    }, (state, time, root) => {
      // The translation under the middle lane, staying with the line.
      const depth = at(Math.min(time, state.line.end), ahead, 26, 2, root);
      return smooth((depth - 45) / 80);
    });

    ctx.fx.bloom = soft ? 0.4 : 0.42;
    ctx.fx.vignette = 0.45;
    ctx.fx.grain = 0.035;
    ctx.fx.risoPositive = 1;
  }
}
