// Flip: the cover laid out on a grid of tiles, like a split-flap board. Every beat (or two) a wave runs across the
// grid and each tile snaps over; the fronts show the cover, the backs cycle through a close-up detail of it, a
// block of the signal colour and an ink tile with a hairline triangle. Kicks lift the tiles a touch.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricRig } from './lyricRig.ts';

const COLS = 20, ROWS = 12;

const vertexShader = /* glsl */ `
  attribute vec2 aTile;
  attribute float aRand;
  uniform float uLocal, uSpread, uPattern, uKick, uSnap;
  uniform vec2 uGrid;
  varying vec2 vUv, vTile;
  varying float vCount, vFace;
  varying vec3 vN;
  void main() {
    vec2 c = (aTile + 0.5) / uGrid;
    float key = uPattern < 0.5 ? (c.x + 1.0 - c.y) * 0.5 : uPattern < 1.5 ? min(1.0, length(c - 0.5) * 1.4) : aRand;
    float local = uLocal - key * uSpread;
    float count = max(0.0, floor(local));
    float f = local < 0.0 ? 0.0 : fract(local);
    float e = 1.0 - pow(2.0, -10.0 * clamp(f / uSnap, 0.0, 1.0));
    float ang = 3.14159265 * (count + (local < 0.0 ? 0.0 : e));
    float cs = cos(ang), sn = sin(ang);
    vec3 p = vec3(position.x * cs + position.z * sn, position.y, -position.x * sn + position.z * cs);
    vN = vec3(normal.x * cs + normal.z * sn, normal.y, -normal.x * sn + normal.z * cs);
    vec3 world = vec3(aTile.x - uGrid.x * 0.5 + 0.5, aTile.y - uGrid.y * 0.5 + 0.5, uKick * 0.35 * (0.3 + aRand)) + p;
    vUv = uv;
    vTile = aTile;
    vCount = count + (local >= 0.0 && e > 0.5 ? 1.0 : 0.0);
    vFace = normal.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uSignal, uInk, uPaper;
  uniform vec2 uGrid, uDetail;
  varying vec2 vUv, vTile;
  varying float vCount, vFace;
  varying vec3 vN;
  float tri(vec2 p) { // hairline equilateral triangle in the tile, 1 on the line
    p = p * 2.0 - 1.0; p.y += 0.2;
    float d = max(abs(p.x) * 0.866 + p.y * 0.5, -p.y) - 0.45;
    return 1.0 - smoothstep(0.0, 0.05, abs(d));
  }
  void main() {
    if (abs(vFace) < 0.5) { gl_FragColor = vec4(uInk * 1.4, 1.0); return; }
    vec2 cover = vec2((vTile.x + vUv.x) / uGrid.x, 0.5 + ((vTile.y + vUv.y) / uGrid.y - 0.5) * uGrid.y / uGrid.x);
    vec3 col;
    if (vFace > 0.0) col = texture2D(uCover, cover).rgb;
    else {
      float v = mod(floor(vCount * 0.5), 3.0);
      if (v < 0.5) col = texture2D(uCover, uDetail + (cover - 0.5) * 0.35).rgb;
      else if (v < 1.5) col = uSignal * (0.85 + 0.15 * vUv.y);
      else col = mix(uInk * 1.3, uPaper, tri(vUv) * 0.8);
    }
    float shade = 0.72 + 0.28 * max(dot(normalize(vN), normalize(vec3(-0.35, 0.5, 1.0))), 0.0);
    gl_FragColor = vec4(col * shade, 1.0);
  }`;

export class Flip implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  private material: THREE.ShaderMaterial;
  private rig: LyricRig;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    const box = new THREE.BoxGeometry(0.94, 0.94, 0.06);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, box.getAttribute(name));
    const tiles = new Float32Array(COLS * ROWS * 2), rand = new Float32Array(COLS * ROWS);
    const random = rng(3);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const k = j * COLS + i; tiles[k * 2] = i; tiles[k * 2 + 1] = j; rand[k] = random(); }
    g.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
    g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
    g.instanceCount = COLS * ROWS;
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uCover: { value: init.cover }, uSignal: { value: palette.signal.clone() }, uInk: { value: palette.ink.clone() },
        uPaper: { value: palette.paper.clone() }, uGrid: { value: new THREE.Vector2(COLS, ROWS) }, uDetail: { value: new THREE.Vector2(0.5, 0.5) },
        uLocal: { value: 0 }, uSpread: { value: 0.6 }, uPattern: { value: 0 }, uKick: { value: 0 }, uSnap: { value: 0.35 },
      },
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.rig = new LyricRig(palette, look === 'ballad' ? 'poem' : 'hook');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const soft = this.look === 'ballad';
    const random = rng(shot.seed);
    const waveBeats = soft ? 4 : shot.variant === 'burst' ? 1 : 2;
    const startPos = music.beatPos(shot.start);
    u.uLocal.value = (music.beatPos(t) - startPos) / waveBeats;
    u.uSpread.value = soft ? 0.8 : 0.6;
    u.uSnap.value = soft ? 0.7 : 0.3;
    u.uPattern.value = shot.variant === 'burst' ? 1 : Math.floor(random() * 3);
    u.uKick.value = soft ? 0 : music.pulse('kick', t, 0.1);
    u.uDetail.value.set(0.3 + random() * 0.4, 0.3 + random() * 0.4);

    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const sign = random() < 0.5 ? -1 : 1;
    const cam = this.camera;
    const tilt = shot.variant === 'wave' && random() < 0.5;
    if (tilt) {
      const a = sign * lerp(0.42, 0.25, inOutCubic(k));
      cam.position.set(Math.sin(a) * 22, 2.5, Math.cos(a) * 22);
    } else {
      cam.position.set(sign * lerp(1.2, -1.2, k), lerp(0.8, -0.4, k), lerp(21, 19, inOutCubic(k)));
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    ctx.fx.bloom = soft ? 0.35 : 0.4;
    this.rig.align = sign > 0 ? 'left' : 'right';
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
