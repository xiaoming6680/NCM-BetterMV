// Menger: drilling into the Menger sponge without end. The sponge (the cube [-1,1]³, its middle crosses carved out
// level after level) contains itself a ninth the size: the cube two levels down at (4/9, 4/9, 0) is the whole scaled
// about (0.5, 0.5, 0), deep inside it. A stretch of route climbs from the middle of the cube's bottom face up its
// central shaft and bends, in one long gentle S (at most 32° off straight), into that small cube's own shaft, whose
// bottom is where the next stretch starts. The sponge is the same turned a quarter about the shaft, so there are four
// such S's (bending towards +x, +z, −x, −z) and each stretch takes one of them at random (drill.ts): the route
// wanders through the sponge differently every time, the walls round the camera always the same size relative to it.
// (One fixed point repeated would loop the same S; a single level's centres all lie on its outer faces.)
// The look (after the Mandelbox flights of Leaf's "Aleph-0" BGA): a fisheye lens bowing the walls round the frame,
// the holes' rims rounded so the blocks read as soft modules pierced with windows, warm walls in coloured haze, dust
// in the air, the light ahead down the route. The deep pits glow in the cover's second colour; adjacent levels'
// stone alternates in shade, so the nesting reads.
import * as THREE from 'three';
import type { SceneInit } from './types.ts';
import { Chain, DrillPlate, drillLook, type Stretch } from './drill.ts';
import { rng } from './types.ts';

/** Stretches of ancestors drawn round the current one. */
const OUTER = 2;

/** The S from (0,−1,0) to (4/9, 1/3, 0), heading +y at both ends, turned a quarter v times about the shaft (y). */
function stretch(v: number): Stretch {
  const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10), slope = (x: number) => 30 * x * x * (x - 1) * (x - 1);
  const turn = new THREE.Matrix4().makeRotationY((v * Math.PI) / 2);
  const points: THREE.Vector3[] = [], dirs: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    points.push(new THREE.Vector3((4 / 9) * ease(k), -1 + (k * 4) / 3, 0).applyMatrix4(turn));
    dirs.push(new THREE.Vector3(((4 / 9) * slope(k)) / (4 / 3), 1, 0).normalize().applyMatrix4(turn));
  }
  return { points, dirs, s: 1 / 9, t: new THREE.Vector3(4 / 9, 4 / 9, 0).applyMatrix4(turn) };
}

function glsl(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): string {
  return drillLook(p) + /* glsl */ `
float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0)); }

/** The camera's level in the ancestor's frame (${OUTER} stretches of two levels up, and as far down its own). */
float camLevel() { return ${(OUTER * 2).toFixed(1)} + 2.0 * uPhase; }

/**
 * The sponge as the ancestor ${OUTER} stretches up has it (uOuter). Only the levels down to a little below the
 * camera's are carved: the walls are slabs pierced by windows of two or three sizes, not holes all the way down (which
 * read as noise). A level opens as the camera comes near it, its windows widening from nothing, so the cut-off moves
 * with the camera and the drilling stays the same from stretch to stretch. gTrap.x: the level that carved here.
 */
float DE(vec3 p) {
  vec3 q = uOuter.w * p + uOuter.xyz;
  float d = sdBox(q, vec3(1.0)), s = 1.0, lvl = 0.0, top = camLevel() + 3.2;
  for (int m = 0; m < ${OUTER * 2 + 6}; m++) {
    float w = clamp(top - float(m), 0.0, 1.0);
    if (w <= 0.0) break;
    vec3 a = mod(q * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0 - 2.0 * (1.0 - w)) / s;
    if (c > d) lvl = float(m);
    // The windows' rims rounded, the slabs between them swelling like cushions (a smooth max, its width a share of
    // the window's own size).
    float k = 0.22 / s, h = clamp(0.5 + 0.5 * (c - d) / k, 0.0, 1.0);
    d = mix(d, c, h) + k * h * (1.0 - h);
  }
  gTrap = vec4(lvl, 0.0, 0.0, 0.0);
  return d / uOuter.w;
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float t, float ao) {
  // Adjacent levels' stone a shade apart, so the nesting reads.
  float rel = gTrap.x - camLevel();
  return lit(p, n, rd, t, WALL * (0.88 + 0.12 * cos(rel * 3.14159)));
}`;
}

export class Menger extends DrillPlate {
  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const seed = ((init.seed ?? 0) ^ 0x3e9a) >>> 0;
    const chain = new Chain(k => stretch(Math.floor(rng((seed + k * 7919) >>> 0)() * 4)), { window: 0.25, up: new THREE.Vector3(0, 0, 1) });
    super(init, look, {
      glsl: glsl(init.palette),
      path: { ax: 0, ay: 0, f: 0 },
      tunnel: 0,
      cruise: 1,
      steps: 110,
      far: 25,
      fog: 5,
      eps: 0.0009,
      sign: { ahead: 0.5, em: 0.055, maxW: 0.65, lift: 0.035 },
      fov: 72,
      bands: false,
      fisheye: 105,
      ride: true,
      dust: true,
    }, { chain, rate: 0.24, turnMax: 28, outer: OUTER, light: 1 });
  }
}
