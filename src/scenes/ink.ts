// Ink (the 墨 style, for 国风 / 古风 songs): the cover painted in ink on warm rice paper — its darks in three tones
// (焦墨, 浓墨, 淡墨) with feathered, bleeding edges, a wash of the cover's own colour where the ink is wet, the paper's
// fibres showing through. The ink spreads in from nothing at the start of a shot; the view travels slowly across the
// painting like an unrolled scroll; a red seal carries the song's first character; the lyrics are written into the
// painting in vertical columns (a LyricLayer read by the ink shader: they travel with the scroll, bleed like the
// rest of the ink, and the painting clears a little round them, as round an inscription). Variants: scroll (a slow pan along the painting), bloom (the ink spreads out from the
// middle), mist (a close, drifting detail with fog rising through it).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricLayer } from './lyricSpace.ts';
import { textTexture } from '../render/text.ts';

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec2 uRes, uPan, uSpread;
  uniform float uTime, uZoom, uReveal, uMist, uBreath;
  uniform vec3 uPaper, uInk;
  uniform sampler2D uLyric;
  uniform vec4 uLyricRect; // where the words are written on the painting: centre and size in cover uv
  uniform float uLyricOn;
  varying vec2 vUv;
  vec4 lyricAt(vec2 cuv) {
    vec2 q = (cuv - uLyricRect.xy) / uLyricRect.zw + 0.5;
    if (uLyricOn < 0.5 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    return texture2D(uLyric, q);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec2 px = vUv * uRes;
    float s = max(uRes.x, uRes.y);
    vec2 q = (px - 0.5 * uRes) / s;
    vec2 cuv = 0.5 + q / uZoom + uPan;
    // Ink bleeds: the cover read through a wandering offset, and its edges broken by noise.
    vec2 w = vec2(fbm(q * 9.0 + uTime * 0.03), fbm(q * 9.0 - 3.1 - uTime * 0.03)) - 0.5;
    vec3 c = (texture2D(uCover, cuv + w * 0.012).rgb + texture2D(uCover, cuv - w * 0.02).rgb) * 0.5;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float grain = fbm(q * 40.0);
    float dark = clamp((0.82 - l) / 0.7 + (fbm(q * 14.0) - 0.5) * 0.35, 0.0, 1.0);
    // Three tones with soft steps: pale wash, solid ink, scorched black.
    float tone = smoothstep(0.12, 0.3, dark) * 0.28 + smoothstep(0.42, 0.58, dark) * 0.42 + smoothstep(0.72, 0.86, dark) * 0.3;
    tone *= 0.9 + 0.2 * grain;
    // The ink arrives: it spreads out from uSpread as uReveal grows, along noisy fronts.
    float front = length(q - uSpread) * 1.3 + (fbm(q * 6.0 + 7.3) - 0.5) * 0.35;
    float wet = smoothstep(uReveal, uReveal - 0.12, front);
    tone *= wet;
    // The words: dark type with a pale glow, read through the same wandering offset so they bleed like the ink.
    vec4 lw = lyricAt(cuv + w * 0.005);
    float lwl = dot(lw.rgb, vec3(0.2126, 0.7152, 0.0722));
    float glyph = clamp(lw.a - lwl, 0.0, 1.0);
    tone *= 1.0 - clamp(lwl, 0.0, 1.0) * 0.85;
    // Rice paper: warm, with fibres and a little mottling.
    float fibre = smoothstep(0.62, 0.9, noise(vec2(q.x * 900.0, q.y * 40.0))) * 0.05;
    vec3 paper = uPaper * (0.93 + 0.07 * fbm(q * 5.0) - fibre);
    // A breath of the cover's own colour where the ink is still wet (淡彩).
    vec3 wash = mix(vec3(1.0), clamp(c * 1.5, 0.0, 1.0), 0.45);
    vec3 col = mix(paper * mix(vec3(1.0), wash, clamp(tone * 1.6, 0.0, 1.0) * 0.6), uInk, tone * (0.92 + uBreath * 0.05));
    col = mix(col, uInk, glyph * (0.86 + 0.12 * grain));
    // Mist rising through the painting.
    float fog = fbm(vec2(q.x * 2.2 + uTime * 0.03, q.y * 3.0 - uTime * 0.05)) * uMist;
    col = mix(col, uPaper, clamp(fog * (0.6 - q.y), 0.0, 0.85));
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Ink implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private seal: THREE.Group;
  private layer: LyricLayer;
  private res = new THREE.Vector2(1920, 1080);

  constructor(private init: SceneInit, title = '') {
    const { palette } = init;
    // Paper is the palette's paper warmed a touch; ink a deep, slightly cool black.
    const paper = palette.paper.clone().lerp(new THREE.Color(0.93, 0.86, 0.72), 0.45);
    const ink = new THREE.Color(0.035, 0.038, 0.045);
    this.scene.background = paper.clone();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uRes: { value: this.res }, uPan: { value: new THREE.Vector2() }, uSpread: { value: new THREE.Vector2() },
        uTime: { value: 0 }, uZoom: { value: 1 }, uReveal: { value: 2 }, uMist: { value: 0 }, uBreath: { value: 0 },
        uPaper: { value: paper }, uInk: { value: ink },
        uLyric: { value: null }, uLyricRect: { value: new THREE.Vector4(0.5, 0.5, 1, 1) }, uLyricOn: { value: 0 },
      },
    }));
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -10;
    this.scene.add(this.quad);
    this.seal = this.makeSeal(title);
    this.scene.add(this.seal);
    this.layer = new LyricLayer(palette, 'poem');
    this.layer.rig.onLight = true;
    this.quad.material.uniforms.uLyric.value = this.layer.target.texture;
    this.scene.add(this.layer.token);
    this.scene.onBeforeRender = renderer => {
      this.layer.render(renderer);
      this.quad.material.uniforms.uLyricOn.value = this.layer.on ? 1 : 0;
    };
    this.resize(init.aspect);
  }

  /** A square red seal (朱文印) with the first character of the title, ringed and slightly worn. */
  private makeSeal(title: string): THREE.Group {
    const g = new THREE.Group();
    const ch = Array.from(title.replace(/[\s\p{P}\p{S}]/gu, ''))[0] || '墨';
    const red = new THREE.Color(0.66, 0.1, 0.07);
    const block = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: red, toneMapped: false, transparent: true, opacity: 0.92 }));
    const tex = textTexture(ch, 'serif', 160, 'none');
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry((tex.boxW / tex.px) * 0.62, (tex.boxH / tex.px) * 0.62), new THREE.MeshBasicMaterial({ map: tex.texture, color: new THREE.Color(0.96, 0.9, 0.82), transparent: true, toneMapped: false }));
    glyph.position.set(0, 0, 0.01);
    g.add(block, glyph);
    return g;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number): void { this.res.set(width, height); }

  /** The view over the painting at e (0..1 through the shot): sets the pan, returns the zoom. */
  private view(variant: string, e: number, sx: number, pan: THREE.Vector2): number {
    if (variant === 'bloom') { pan.set(0, 0); return lerp(1.15, 1.35, e); }
    if (variant === 'mist') { pan.set(sx * lerp(-0.12, 0.12, e), lerp(0.1, 0.02, e)); return lerp(2.4, 2.8, e); }
    pan.set(sx * lerp(-0.2, 0.2, e), 0.02); // scroll
    return 1.7;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.quad.material.uniforms;
    const random = rng(shot.seed);
    const since = t - shot.start, len = Math.max(0.5, shot.end - shot.start);
    const k = clamp01(since / len), e = inOutCubic(k);
    const info = music.at(t);
    u.uTime.value = t;
    u.uBreath.value = Math.exp(-(info.inBar % music.meter) * 1.5);
    const sx = random() < 0.5 ? -1 : 1;
    // The ink spreads in over the first two seconds of a shot.
    u.uReveal.value = lerp(0.05, 2.2, smooth(since / 2.2));
    u.uZoom.value = this.view(shot.variant, e, sx, u.uPan.value);
    switch (shot.variant) {
      case 'bloom': u.uSpread.value.set(0, 0); u.uMist.value = 0.2; break;
      case 'mist': u.uSpread.value.set(sx * 0.3, -0.2); u.uMist.value = 1.1; break;
      default: u.uSpread.value.set(-sx * 0.35, 0.05); u.uMist.value = 0.45; // scroll
    }
    const cam = this.camera;
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    // The seal sits low in the corner away from the lyrics, pressed in when the shot opens.
    const vh = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), vw = vh * ctx.aspect;
    const size = vh * 0.075, press = 1 + (1 - smooth(since / 0.35)) * 0.25;
    this.seal.position.set(sx * (vw * 0.5 - size * 1.1), -vh * 0.5 + size * 1.3, 0);
    this.seal.scale.setScalar(size * press);
    ctx.fx.bloom = 0.04;
    ctx.fx.vignette = 0.25;
    ctx.fx.grain = 0.035;
    // Each line is written on the painting where the view was as it began, in a column to one side, and the scroll
    // carries it on from there. The words are as big as the view is halfway through the shot; the layer covers all
    // the painting the shot travels over.
    const long = Math.max(this.res.x, this.res.y), at = new THREE.Vector2(), end = new THREE.Vector2();
    const zoom = this.view(shot.variant, 0.5, sx, at), w = this.res.x / long / zoom, h = this.res.y / long / zoom;
    const z0 = this.view(shot.variant, 0, sx, at), x0 = at.x, y0 = at.y, z1 = this.view(shot.variant, 1, sx, end);
    const rw = Math.abs(end.x - x0) + this.res.x / long / Math.min(z0, z1), rh = Math.abs(end.y - y0) + this.res.y / long / Math.min(z0, z1);
    const cx = 0.5 + (x0 + end.x) / 2, cy = 0.5 + (y0 + end.y) / 2;
    (u.uLyricRect.value as THREE.Vector4).set(cx, cy, rw, rh);
    this.layer.rig.place = (root, st) => {
      const zl = this.view(shot.variant, inOutCubic(clamp01((Math.max(st.line.start, shot.start) - shot.start) / len)), sx, at);
      root.position.set(0.5 + at.x - cx + sx * 0.3 * (this.res.x / long / zl), 0.5 + at.y - cy + 0.04 * h, -10);
    };
    // (Set a little larger than the view's own type: brush-written, it should hold its own against the painting.)
    this.layer.update(ctx.lyrics, t, shot.section.energy, w * 1.35, h * 1.35, rw, rh);
  }
}
