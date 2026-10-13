// Rain on the window (抒情): a city at night in the cover's colours, out of focus beyond a fogged pane. The lights are
// the cover's own (each a disc of the colour the cover has where it stands), drifting a little as if the view turned;
// the glass is beaded with drops that are small lenses, each holding a sharper, upside-down city. Slow songs are
// carried by the voice, not the drums, so the voice moves the picture: each line is written with a fingertip in the
// fog as it is sung (the wiped strokes show the city clear and dark behind them), and when a line ends a heavy drop
// lets go and runs down the pane, clearing a streak that fogs over again. The rain on the glass thickens with the
// section's level; a chorus thins the fog and brings the lights up. Variants: pane (the glass, the city a blur),
// close (nearer the glass: bigger drops, bigger words), clear (the focus slowly pulls through the glass to the city).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, rng, smooth } from './types.ts';
import { LyricLayer } from './lyricSpace.ts';

/** Running drops drawn at once. */
const SLIDERS = 8;

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover, uLyric;
  uniform float uAspect, uTime, uFog, uFocus, uLights, uRain, uZoom, uLyricOn, uDrift;
  uniform vec4 uSlide[${SLIDERS}];
  uniform vec4 uSlideY[${SLIDERS}];
  varying vec2 vUv;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n)); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  /** The city beyond the glass at q (frame units: height 1, centred), its focus 0 (all bokeh) .. 1 (sharp lights). */
  vec3 city(vec2 q, float focus) {
    vec3 col = texture2D(uCover, q * 0.55 + 0.5 + vec2(uDrift * 0.5, 0.0), 6.0).rgb * 0.2;
    for (int L = 0; L < 2; L++) {
      float cell = L == 0 ? 0.12 : 0.065;
      vec2 g = (q + vec2(uDrift * (L == 0 ? 1.0 : 0.7), 0.0)) / cell;
      vec2 id = floor(g);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = id + vec2(float(i), float(j)) + float(L) * 37.0;
        vec2 r = h22(c);
        if (r.x > 0.6) continue;
        vec2 centre = id + vec2(float(i), float(j)) + 0.2 + 0.6 * h22(c + 3.1);
        vec3 lc = texture2D(uCover, (centre * cell - vec2(uDrift * (L == 0 ? 1.0 : 0.7), 0.0)) * 0.55 + 0.5, 1.5).rgb;
        float lum = luma(lc);
        lc = max(mix(vec3(lum), lc, 1.6), 0.0);
        float rad = cell * mix(0.5, 0.1, focus) * (0.55 + 0.6 * r.y);
        float d = length(g - centre) * cell;
        float disc = 1.0 - smoothstep(rad * 0.82, rad, d);
        float rim = smoothstep(rad * 0.5, rad * 0.95, d) * disc;
        float bright = (0.2 + 1.5 * pow(lum, 0.9)) * mix(0.45, 1.5, focus) * (0.88 + 0.12 * sin(uTime * (0.2 + 0.4 * r.y) + r.x * 40.0));
        col += lc * bright * uLights * (disc * 0.75 + rim * 0.3);
      }
    }
    return col;
  }

  /** Beaded drops in cells of this size: their lens offset (xy) and how much of the point they cover (z). */
  vec3 beads(vec2 p, float cell, float seed, float density) {
    vec2 g = p / cell, id = floor(g), f = fract(g) - 0.5;
    vec2 r = h22(id + seed);
    if (r.x > density) return vec3(0.0);
    // Each drop gathers and dries on its own slow cycle.
    float life = fract(uTime / (16.0 + 12.0 * r.y) + r.x * 7.0);
    float size = (0.16 + 0.2 * h21(id + seed + 5.0)) * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.8, 1.0, life));
    vec2 d = f - (h22(id + seed + 9.0) - 0.5) * 0.45;
    float m = 1.0 - smoothstep(size * 0.8, size, length(d * vec2(1.0, 0.92)));
    return vec3(d / max(size, 1e-3) * m, m);
  }

  void main() {
    vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec2 p = q / uZoom;
    // The words wiped through the fog (laid out on the frame, so a closer view doesn't push them off it).
    // The type's thin strokes are widened to a fingertip's (the mask taken as the brightest of a ring of samples).
    float writ = 0.0;
    if (uLyricOn > 0.5) {
      vec2 px = vec2(0.0028 / uAspect, 0.0028);
      float m = luma(texture2D(uLyric, vUv).rgb);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        m = max(m, luma(texture2D(uLyric, vUv + vec2(cos(a), sin(a)) * px).rgb));
      }
      writ = smoothstep(0.25, 0.55, m) * (0.85 + 0.15 * n2(q * 90.0));
    }
    // Drops: two sizes of beads, and the ones running down (with the clear streak each leaves).
    vec3 b1 = beads(p, 0.04, 1.0, 0.36 * uRain), b2 = beads(p, 0.012, 7.0, 0.32 * uRain);
    vec2 refr = b1.xy + b2.xy;
    float cover = max(b1.z, b2.z), trail = 0.0;
    for (int k = 0; k < ${SLIDERS}; k++) {
      vec4 s = uSlide[k], sy = uSlideY[k];
      if (s.w <= 0.0) continue;
      // s: x, release time, speed, size; sy: start y, current y.
      float yy = p.y, top = sy.x, head = sy.y;
      float x = s.x + 0.005 * sin(yy * 17.0 + s.y) + 0.002 * sin(yy * 53.0 + s.y * 3.0);
      vec2 d = vec2(p.x - x, (yy - head) * 0.75);
      float m = 1.0 - smoothstep(s.w * 0.8, s.w, length(d));
      refr += d / s.w * m;
      cover = max(cover, m);
      if (yy < top && yy > head) {
        float passed = s.y + (top - yy) / s.z;
        float w = s.w * 0.3 * (0.75 + 0.5 * n2(vec2(yy * 25.0, s.y)));
        float lane = 1.0 - smoothstep(w * 0.6, w, abs(p.x - x));
        trail = max(trail, lane * exp(-max(0.0, uTime - passed) / 9.0));
        // It leaves a few small drops behind.
        float cellY = floor(yy / 0.03);
        float hd = h21(vec2(cellY, s.y));
        vec2 dd = vec2(p.x - x - (hd - 0.5) * w, (yy - (cellY + 0.5) * 0.03) * 0.9);
        float rr = s.w * 0.3 * step(0.55, hd);
        float dm = 1.0 - smoothstep(rr * 0.8, rr, length(dd));
        refr += dd / max(rr, 1e-3) * dm;
        cover = max(cover, dm);
      }
    }
    // A wiped stroke takes the drops with it (and keeps the words clean).
    cover *= 1.0 - writ;
    refr *= 1.0 - writ;
    float clear = max(max(cover, trail), writ);
    // Beyond the glass; through a drop, a sharper, brighter city, turned over (a drop gathers light).
    vec3 behind = city(q * pow(uZoom, -0.25), uFocus);
    vec3 fogC = texture2D(uCover, q * 0.55 + 0.5, 7.0).rgb * 0.45 + vec3(0.13, 0.13, 0.14) + behind * 0.22;
    // (Each only where it shows: the city is the costly part.)
    vec3 inDrop = cover > 0.004 ? city(q * pow(uZoom, -0.25) - refr * 0.06, min(1.0, uFocus + 0.55)) * 1.8 + fogC * 0.3 : behind;
    // Through the wiped words the night shows dark, its lights sharp and small: they read against the milky fog.
    vec3 wiped = writ > 0.004 ? city(q * pow(uZoom, -0.25), 0.9) * 0.55 : behind;
    vec3 col = mix(mix(behind, wiped, writ), inDrop, cover);
    // The fog: milky, lit by the city behind it.
    float fog = uFog * (1.0 - clear) * (0.86 + 0.14 * n2(p * 5.0 + uTime * 0.01));
    col = mix(col, fogC, fog);
    // A drop: a glint up on one side, its lower rim dark; the wiped strokes keep a faint wet edge.
    col += cover * (1.0 - smoothstep(0.0, 0.35, length(refr - vec2(-0.3, 0.38)))) * 0.35;
    col *= 1.0 - cover * smoothstep(0.6, 1.0, length(refr)) * step(refr.y, 0.0) * 0.35;
    col += fogC * 0.18 * smoothstep(0.05, 0.3, writ) * (1.0 - smoothstep(0.3, 0.7, writ)) * uFog;
    gl_FragColor = vec4(col, 1.0);
  }`;

interface Slide { x: number; t0: number; speed: number; size: number; y0: number }

export class RainScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private material: THREE.ShaderMaterial;
  private layer: LyricLayer;
  private slides: Slide[] = [];

  constructor(private init: SceneInit) {
    const { palette, music, lyrics } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.2);
    const slide = () => Array.from({ length: SLIDERS }, () => new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uLyric: { value: null }, uAspect: { value: 16 / 9 }, uTime: { value: 0 }, uFog: { value: 0.8 },
        uFocus: { value: 0 }, uLights: { value: 1 }, uRain: { value: 0.7 }, uZoom: { value: 1 }, uLyricOn: { value: 0 }, uDrift: { value: 0 },
        uSlide: { value: slide() }, uSlideY: { value: slide() },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);
    // A drop lets go as each line ends; between lines (and through a song without words) now and then on its own.
    const random = rng(Math.round(music.duration * 613) ^ 0x7a1);
    const ends = lyrics.lines.map(l => l.end + 0.15);
    for (let t = 4 + random() * 6; t < music.duration; t += 7 + random() * 9) if (!ends.some(e => Math.abs(e - t) < 3)) ends.push(t);
    this.slides = ends.sort((a, b) => a - b).map(t0 => ({
      x: (random() - 0.5) * 1.5, t0, speed: 0.05 + 0.06 * random(), size: 0.011 + 0.009 * random(), y0: 0.05 + 0.4 * random(),
    }));
    // The words: written in the fog (light type, read as the wiped strokes). The writing is the glass itself, not a
    // caption, so its token stays out of the scene: when the frame's words are drawn apart (light trails, a look) the
    // plate's own pass hides lyric objects, and the strokes vanished with them.
    this.layer = new LyricLayer(palette, 'poem');
    this.material.uniforms.uLyric.value = this.layer.target.texture;
    this.material.uniforms.uLyricOn.value = 1;
    this.scene.onBeforeRender = renderer => this.layer.render(renderer);
    this.camera.position.set(0, 0, 10);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uAspect.value = aspect;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const random = rng(shot.seed);
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const loud = shot.section.label === 'chorus' || shot.section.label === 'drop';
    u.uTime.value = t;
    u.uDrift.value = (random() < 0.5 ? -1 : 1) * t * 0.004;
    u.uZoom.value = shot.variant === 'close' ? 1.65 : 1;
    u.uFocus.value = shot.variant === 'clear' ? lerp(0.05, 0.75, smooth((k - 0.15) / 0.7)) : 0.04;
    u.uFog.value = (loud ? 0.6 : 0.72) * (shot.variant === 'clear' ? lerp(1, 0.75, smooth(k)) : 1);
    u.uRain.value = 0.55 + 0.45 * shot.section.energy;
    u.uLights.value = (loud ? 1.15 : 0.95) + 0.15 * music.env('mid', t);
    // The running drops: the latest few that are still on the pane.
    const live = this.slides.filter(s => s.t0 <= t && s.y0 - s.speed * Math.max(0, t - s.t0 - 0.4) > -0.75).slice(-SLIDERS);
    const sl = u.uSlide.value as THREE.Vector4[], sy = u.uSlideY.value as THREE.Vector4[];
    for (let i = 0; i < SLIDERS; i++) {
      const s = live[i];
      if (!s) { sl[i].set(0, 0, 1, 0); continue; }
      const age = t - s.t0;
      // It gathers for a moment, then runs, a little faster as it goes.
      const run = Math.max(0, age - 0.4);
      const head = s.y0 - s.speed * (run + 0.08 * run * run / (1 + run * 0.1)) - s.size * smooth(age / 0.4) * 0.5;
      sl[i].set(s.x, s.t0 + 0.4, s.speed, s.size * smooth(age / 0.4));
      sy[i].set(s.y0, head, 0, 0);
    }
    ctx.fx.bloom = 0.35;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.05;
    // (Laid out as if the pane were taller: the strokes come out bigger than the poem type, as a finger writes; the
    // columns keep to the pane's width.)
    this.layer.update(ctx.lyrics, t, shot.section.energy, ctx.aspect, 1.35, ctx.aspect, 1);
  }
}
