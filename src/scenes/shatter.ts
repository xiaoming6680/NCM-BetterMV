// Shatter: the album cover as a wall of triangles. In a chorus every downbeat sends a flip wave across it
// (each triangle turns over, showing its signal-coloured back); on a drop the wall bursts and the camera
// flies through the swarm, which throbs on the kicks and sparkles on the hats.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';

const M = 48;
const SIZE = 16;

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aRand;
  attribute vec2 aCell;
  attribute vec3 aBary;
  uniform float uExplode, uTime, uFlip, uKick, uSpin, uShake, uPattern;
  varying vec2 vUv;
  varying vec3 vBary;
  varying float vRand;
  mat3 rot(vec3 axis, float a) {
    axis = normalize(axis);
    float s = sin(a), c = cos(a), oc = 1.0 - c;
    return mat3(oc*axis.x*axis.x + c, oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
                oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c, oc*axis.y*axis.z + axis.x*s,
                oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
  }
  void main() {
    vec3 local = position;
    // Flip wave: one full turn as the front passes. The front's shape changes bar to bar.
    float key;
    vec3 axis = vec3(1.0, 0.25 * (aRand.x - 0.5), 0.0);
    if (uPattern < 0.5) key = (aCell.x + 1.0 - aCell.y) * 0.5;                      // diagonal
    else if (uPattern < 1.5) key = length(aCell - 0.5) * 1.35;                        // from the centre
    else if (uPattern < 2.5) { key = aCell.x; axis = vec3(0.0, 1.0, 0.0); }           // left to right
    else if (uPattern < 3.5) key = 1.0 - aCell.y;                                     // top to bottom
    else if (uPattern < 4.5) key = mod(floor(aCell.x * 8.0) + floor(aCell.y * 8.0), 2.0) * 0.45 + aRand.w * 0.1; // checker
    else key = aRand.w * 0.85;                                                        // scattered
    float f = clamp((uFlip - key) / 0.2, 0.0, 1.0);
    local = rot(axis, (1.0 - cos(f * 3.14159265)) * 3.14159265) * local;
    float e = uExplode;
    vec3 dir = normalize(vec3(aRand.x - 0.5, aRand.y - 0.5, aRand.z * 0.9 + 0.15));
    vec3 pc = aCenter + dir * e * (5.0 + aRand.w * 24.0);
    float swirl = e * (uTime * 0.16 * (0.4 + aRand.w) + aRand.z * 0.6) * uSpin;
    float cs = cos(swirl), sn = sin(swirl);
    pc = vec3(pc.x * cs - pc.z * sn, pc.y, pc.x * sn + pc.z * cs);
    pc += (aRand.xyz - 0.5) * uShake * 0.25;
    local = rot(aRand.zxy - 0.5, e * (uTime * (0.5 + aRand.y) + aRand.x * 9.0)) * local;
    local *= 1.0 + e * uKick * 0.5;
    vUv = uv; vBary = aBary; vRand = aRand.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pc + local, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uSignal, uAccent, uPaper, uInk;
  uniform float uExplode, uKick, uHat, uEdge, uTime;
  varying vec2 vUv;
  varying vec3 vBary;
  varying float vRand;
  void main() {
    // Backs: dark glass tinted by the signal (a few by the accent); the rim does the shining.
    vec3 back = mix(uInk * 1.6, mix(uSignal, uAccent, step(0.8, vRand)), 0.18 + 0.5 * (1.0 - uExplode) + 0.1 * vRand);
    vec3 col = gl_FrontFacing ? texture2D(uCover, vUv).rgb : back;
    float edge = min(min(vBary.x, vBary.y), vBary.z);
    vec3 rim = gl_FrontFacing ? uPaper * 1.4 : mix(uSignal, uPaper, 0.3) * 1.6;
    col = mix(col, rim, (1.0 - smoothstep(0.0, 0.03 + 0.05 * uExplode, edge)) * uEdge);
    col *= 1.0 + uKick * uExplode * 0.9;
    col += uPaper * step(0.94, fract(vRand * 91.7 + floor(uTime * 9.0) * 0.37)) * uHat * uExplode * 2.5;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Shatter implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 500);
  private material: THREE.ShaderMaterial;
  private dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private rig: LyricRig;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    const tris = M * M * 2;
    const pos = new Float32Array(tris * 9), uv = new Float32Array(tris * 6), center = new Float32Array(tris * 9);
    const rand = new Float32Array(tris * 12), cell = new Float32Array(tris * 6), bary = new Float32Array(tris * 9);
    const random = rng(7);
    const c = SIZE / M;
    let v = 0;
    const put = (verts: number[][], cx: number, cy: number) => {
      const mx = (verts[0][0] + verts[1][0] + verts[2][0]) / 3, my = (verts[0][1] + verts[1][1] + verts[2][1]) / 3;
      const r = [random(), random(), random(), random()];
      verts.forEach((p, i) => {
        pos.set([p[0] - mx, p[1] - my, 0], v * 3);
        center.set([mx, my, 0], v * 3);
        uv.set([p[0] / SIZE + 0.5, p[1] / SIZE + 0.5], v * 2);
        rand.set(r, v * 4);
        cell.set([cx, cy], v * 2);
        bary.set([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], v * 3);
        v++;
      });
    };
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x0 = -SIZE / 2 + i * c, y0 = -SIZE / 2 + j * c, x1 = x0 + c, y1 = y0 + c;
      const cx = (i + 0.5) / M, cy = (j + 0.5) / M;
      // Counter-clockwise seen from +z, alternating diagonals.
      if ((i + j) % 2) { put([[x0, y0], [x1, y0], [x1, y1]], cx, cy); put([[x0, y0], [x1, y1], [x0, y1]], cx, cy); }
      else { put([[x0, y0], [x1, y0], [x0, y1]], cx, cy); put([[x1, y0], [x1, y1], [x0, y1]], cx, cy); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
    geometry.setAttribute('aCell', new THREE.BufferAttribute(cell, 2));
    geometry.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, side: THREE.DoubleSide,
      uniforms: {
        uCover: { value: init.cover }, uSignal: { value: palette.signal.clone() }, uAccent: { value: palette.accent.clone() },
        uPaper: { value: palette.paper.clone() }, uInk: { value: palette.ink.clone() }, uExplode: { value: 0 }, uTime: { value: 0 }, uFlip: { value: -1 },
        uKick: { value: 0 }, uHat: { value: 0 }, uEdge: { value: 0.35 }, uSpin: { value: 1 }, uShake: { value: 0 }, uPattern: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    const dustN = 2400, dp = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      const r = 20 + random() * 70, a = random() * Math.PI * 2, y = (random() - 0.5) * 80;
      dp.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: palette.paper.clone(), size: 0.12, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.dust);

    this.rig = new LyricRig(palette, 'hook');
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
    const info = music.at(t);
    const section = shot.section;
    const energy = section.energy;
    const kick = music.pulse('kick', t, 0.12);
    const hat = music.pulse('hat', t, 0.06);
    const drop = section.label === 'drop';
    const beatLen = 60 / Math.max(40, info.bpm);

    // Burst on the drop's first downbeat; every fourth bar it snaps back into the cover for a beat and bursts
    // again; over its last two beats it gathers back.
    let e = 0;
    if (drop) {
      const barInDrop = info.bar - music.at(section.start + 0.01).bar;
      const reform = barInDrop > 0 && barInDrop % 4 === 0 ? 1 - smooth(info.inBar / 1.2) : 0;
      e = outExpo((t - section.start) / 0.9) * (1 - 0.65 * smooth((t - (section.end - beatLen * 2)) / (beatLen * 2))) * (1 - 0.9 * reform);
    }
    // The beat before a drop, the wall trembles.
    const next = music.a.sections[shot.sectionIndex + 1];
    const toDrop = next && next.label === 'drop' ? next.start - t : Infinity;
    const shake = toDrop < beatLen * 2 ? (1 - toDrop / (beatLen * 2)) * (0.5 + 0.5 * Math.sin(t * 90)) : 0;

    u.uExplode.value = e;
    u.uTime.value = t;
    u.uKick.value = kick;
    u.uHat.value = hat;
    u.uShake.value = shake;
    u.uPattern.value = Math.floor(rng((info.bar * 2654435761) ^ shot.seed)() * 6);
    u.uFlip.value = drop ? -1 : -0.25 + inOutCubic(Math.min(1, info.barPhase * 1.35)) * 1.6;
    u.uEdge.value = drop ? 0.55 : 0.28 + kick * 0.3;

    const cam = this.camera;
    const k = clamp01(ctx.shotT / Math.max(0.3, shot.end - shot.start));
    const random = rng(shot.seed);
    const sign = random() < 0.5 ? -1 : 1;
    let fov = 42, roll = 0;
    const target = new THREE.Vector3(0, 0, 0);
    switch (shot.variant) {
      case 'wall': {
        cam.position.set(Math.sin(k * 2.2) * 1.2 * sign, 0.4 + Math.sin(k * 1.7) * 0.5, lerp(25, 18, inOutCubic(k)));
        break;
      }
      case 'wall-close': {
        // Close on one part of the artwork, drifting across it.
        const cx = (random() - 0.5) * 9, cy = (random() - 0.5) * 9;
        target.set(cx + lerp(-1, 1, k) * sign, cy, 0);
        cam.position.set(target.x, target.y + 0.4, lerp(8.5, 6.5, inOutCubic(k)));
        fov = 38;
        break;
      }
      case 'wall-dutch': {
        cam.position.set(lerp(-7, 5, inOutCubic(k)) * sign, 2.5, 17);
        roll = 0.24 * sign;
        break;
      }
      case 'wall-edge': {
        // Grazing the wall: it recedes in steep perspective and the flip waves read as a surface.
        cam.position.set(15 * sign, lerp(2, 5, k), 5);
        target.set(-3 * sign, 0, 0);
        fov = 48;
        break;
      }
      case 'wall-orbit': {
        const a = THREE.MathUtils.degToRad(lerp(-34, 18, inOutCubic(k)) * sign);
        cam.position.set(Math.sin(a) * 22, 2.5, Math.cos(a) * 22);
        break;
      }
      case 'swarm-a': {
        const a = info.pos * 0.11 * sign + random() * 6;
        cam.position.set(Math.sin(a) * 15, 3 + Math.sin(info.pos * 0.2) * 2, Math.cos(a) * 15);
        fov = 55;
        break;
      }
      case 'swarm-b': {
        cam.position.set(Math.sin(k * 3) * 2 * sign, 1.5, lerp(34, 2, inOutCubic(k)));
        target.set(0, 0, -20);
        fov = 60;
        roll = Math.sin(k * 2.4) * 0.12 * sign;
        break;
      }
      case 'swarm-d': {
        // Inside the cloud, shards rushing past the lens.
        const a = random() * 6 + k * 1.2 * sign;
        cam.position.set(Math.sin(a) * 4, 0.5, Math.cos(a) * 4 + 6);
        target.set(Math.sin(a + 1.2) * 10, 0, -6);
        fov = 72;
        break;
      }
      default: {
        const a = info.pos * 0.08 * sign;
        cam.position.set(Math.sin(a) * 8, 26, Math.cos(a) * 8);
        fov = 50;
      }
    }
    // Downbeat punch.
    fov -= info.inBar < 1 ? Math.exp(-info.inBar * 5) * 3 * (0.5 + energy) : 0;
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    if (roll) cam.rotateZ(roll);

    this.dust.material.opacity = 0.2 + hat * 0.5 + e * 0.2;
    this.dust.rotation.y = t * 0.02;
    ctx.fx.bloom = 0.5 + energy * 0.35 + kick * 0.35 * e;
    ctx.fx.ca = kick * 0.7 * e;
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, energy);
  }
}
