// Bokeh: the cover as a field of glowing discs rendered with depth of field. Out of focus it is a haze of
// coloured light; when the focus pulls onto the image plane (and the discs gather into it) the picture
// resolves. Made for choruses of slow songs: the moment the image comes into focus is the chorus landing.
// The words hang among the lights, just in front of the picture and to one side, and are in and out of focus with
// it: soft in the haze, coming sharp as the focus pulls onto the picture.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { rgbToLab } from '../render/palette.ts';

const G = 120;
const SIZE = 10;
const DOT = (SIZE / G) * 1.2;
const TEXT_Z = 1.5; // the words' depth (the picture's plane is z = 0, its lights spread a few units either side)

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aSeed;
  attribute float aWeight;
  uniform float uTime, uFocus, uAperture, uScatter, uRise, uPxPerUnit, uGain;
  varying vec3 vColor;
  varying float vA, vDefocus;
  void main() {
    vec3 p = position;
    p.z *= uScatter;
    p.x += sin(uTime * 0.3 + aSeed.x * 6.28) * 0.18 * uScatter;
    p.y += cos(uTime * 0.25 + aSeed.y * 6.28) * 0.18 * uScatter;
    // A share of the lights drift upwards like lanterns.
    float lantern = step(0.82, aSeed.z) * uRise;
    p.y += lantern * (mod(uTime * (0.2 + aSeed.w * 0.3) + aSeed.w * 30.0, 16.0) - 4.0);
    p.z += lantern * (aSeed.x - 0.5) * 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = max(0.1, -mv.z);
    float coc = abs(d - uFocus) * uAperture;
    float size = (${DOT.toFixed(4)} + coc) * uPxPerUnit / d;
    gl_PointSize = min(size, 360.0);
    float k = ${DOT.toFixed(4)} / (${DOT.toFixed(4)} + coc);
    vA = clamp(k * k * 1.6, 0.012, 0.9) * uGain * aWeight;
    vDefocus = clamp(coc / 0.6, 0.0, 1.0);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vA, vDefocus;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float disc = smoothstep(1.0, mix(0.55, 0.9, vDefocus), r);
    float rim = mix(1.0, 0.7 + 0.45 * smoothstep(0.45, 0.95, r), vDefocus);
    gl_FragColor = vec4(vColor * rim, vA * disc);
  }`;

export class Bokeh implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  private material: THREE.ShaderMaterial;
  private rig: LyricRig;
  private height = 720;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = (palette.light ? palette.backdrop : palette.ink).clone();
    const n = G * G + 90;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n * 4), weight = new Float32Array(n);
    // Lights the colour of the backdrop add nothing but a wash: fade them out and keep the picture's figures.
    const light = palette.light;
    const bg = light ? palette.backdrop : palette.ink;
    const bgRgb = bg.clone().convertLinearToSRGB();
    const bgLab = rgbToLab(bgRgb.r, bgRgb.g, bgRgb.b);
    const random = rng(5), c = new THREE.Color();
    const S = init.coverSize, px = init.coverPixels;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      const sx = Math.floor(((i + 0.5) / G) * S), sy = Math.floor(((j + 0.5) / G) * S), o = (sy * S + sx) * 4;
      c.setRGB(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, THREE.SRGBColorSpace);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      // Brighter lights sit a little forward, so a slow orbit shows depth.
      pos.set([((i + 0.5) / G - 0.5) * SIZE, (0.5 - (j + 0.5) / G) * SIZE, (random() - 0.5) * 7 + lum * 1.5], k * 3);
      col.set([c.r, c.g, c.b], k * 3);
      seed.set([random(), random(), random(), random()], k * 4);
      const lab = rgbToLab(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255);
      const d = Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]);
      weight[k] = light ? clamp01((d - 0.05) / 0.14) : 0.25 + 0.75 * clamp01((d - 0.03) / 0.12);
    }
    // A few big lights close to the lens, always soft.
    const accents = [palette.signal, palette.accent, palette.paper];
    for (let k = G * G; k < n; k++) {
      const a = accents[k % 3];
      pos.set([(random() - 0.5) * 18, (random() - 0.5) * 10, lerp(6, 11, random())], k * 3);
      col.set([a.r * 0.6, a.g * 0.6, a.b * 0.6], k * 3);
      seed.set([random(), random(), 0, random()], k * 4);
      weight[k] = light ? 0.35 : 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geometry.setAttribute('aWeight', new THREE.BufferAttribute(weight, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uFocus: { value: 16 }, uAperture: { value: 0.22 }, uScatter: { value: 1 },
        uRise: { value: 0 }, uPxPerUnit: { value: 1000 }, uGain: { value: 1 },
      },
    });
    const points = new THREE.Points(geometry, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.rig = new LyricRig(palette, 'poem');
    this.rig.frame = { vh: 7, vw: 11 };
    this.rig.focusable = true;
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Viewport height in device pixels, so disc sizes match the lens. */
  setViewportHeight(h: number): void { this.height = h; }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const k = clamp01(ctx.shotT / Math.max(0.5, shot.end - shot.start));
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    const rms = music.env('rms', t);
    const info = music.at(t);
    const beat = 60 / Math.max(40, info.bpm);
    const cam = this.camera;
    const target = new THREE.Vector3(0, 0, 0);
    let dist = 16, focusOffset = 0, scatter = 1, rise = 0, aperture = 0.22;
    let az = 0, el = 0.05;
    switch (shot.variant) {
      case 'haze': {
        dist = lerp(19, 15, inOutCubic(k));
        focusOffset = -9;
        az = side * lerp(0.15, -0.1, k);
        break;
      }
      case 'focus': {
        // Pull focus onto the picture over the first bar and a half while the lights gather into it.
        const pull = smooth(ctx.shotT / (beat * 6));
        dist = lerp(17.5, 15.5, inOutCubic(k));
        focusOffset = lerp(-8, 0, pull);
        scatter = lerp(1, 0.12, pull);
        az = side * lerp(0.08, -0.05, k);
        break;
      }
      case 'orbit': {
        dist = 16.5;
        scatter = 0.45;
        az = side * lerp(-0.45, 0.45, inOutCubic(k));
        el = lerp(0.12, -0.05, k);
        break;
      }
      default: { // rise
        dist = 17;
        scatter = 0.8;
        rise = 1;
        el = lerp(-0.25, 0.1, inOutCubic(k));
        focusOffset = lerp(-2, -5, k);
        aperture = 0.26;
      }
    }
    cam.position.set(Math.sin(az) * dist, Math.sin(el) * dist, Math.cos(az) * dist);
    cam.position.x += Math.sin(t * 0.33) * 0.1;
    cam.position.y += Math.sin(t * 0.27 + 2) * 0.08;
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    u.uTime.value = t;
    u.uFocus.value = cam.position.length() + focusOffset;
    u.uScatter.value = scatter;
    u.uRise.value = rise;
    u.uAperture.value = aperture;
    u.uPxPerUnit.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    // Swell a little on each downbeat of a chorus and with the voice.
    const swell = shot.section.label === 'chorus' ? Math.exp(-info.inBar * 1.2) * 0.25 : 0;
    u.uGain.value = 0.8 + rms * 0.35 + swell;

    ctx.fx.bloom = this.init.palette.light ? 0.12 : 0.5 + rms * 0.3;
    // Each line a card just in front of the picture, to one side (alternating), turned a little towards the middle;
    // as far out of focus as a light at its depth would be.
    const aspect = ctx.aspect;
    this.rig.place = (root, st) => {
      const s = st.index % 2 ? 1 : -1;
      root.position.set(s * Math.min(3.4, 2.5 * aspect), 0.3, TEXT_Z);
      root.rotation.set(0, -s * 0.18, 0);
    };
    const d = cam.position.distanceTo(new THREE.Vector3(Math.min(3.4, 2.5 * aspect) * side, 0.3, TEXT_Z));
    this.rig.blur.value = Math.min(1.7, Math.log2(1 + Math.abs(d - u.uFocus.value) * 0.6));
    this.rig.onLight = this.init.palette.light;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, rms);
  }
}
