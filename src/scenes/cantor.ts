// Floating city (cantor): drilling into Cantor dust without end. Of the cube [-1,1]³ only eight corner cubes are
// kept (each 0.4 of it, so the gaps between them are a fifth of its width), of each of those its eight corners, and
// so on: blocks of every size hang in the air, each a cluster of smaller blocks with narrow gaps between them like
// streets and windows. (At a third, the classic dust, the blocks are so thin they read as a haze of specks.) The
// dust contains itself 0.16 the size (a corner block's corner block, two levels down). A stretch of route runs from
// the middle of the cube's side along the gap between the blocks and rises, late and clear of them, across to the
// side of that small block, where the next stretch starts. The dust is the same turned a quarter about the route's
// axis (x), so there are four such stretches (rising towards ±y ±z) and each stretch takes one at random (drill.ts):
// the route wanders, the blocks round the camera always the same size relative to it.
// The look (after Leaf's "Aleph-0" BGA, as menger.ts): a fisheye lens, the smallest cubes rounded, warm blocks in
// coloured haze, the light ahead down the route, dust; the gaps deep in a block glow in the cover's second colour.
import * as THREE from 'three';
import type { SceneInit } from './types.ts';
import { Chain, DrillPlate, drillLook, type Stretch } from './drill.ts';
import { rng } from './types.ts';

/** Stretches of ancestors drawn round the current one. */
const OUTER = 2;
/** Each corner block's share of its parent. */
const R = 0.4;

/**
 * The S from (−1,0,0) to (0.2, 0.36, 0.36), heading +x at both ends, rising late (the power on the ease) so it keeps
 * to the gap between the blocks until it is past them; turned a quarter v times about x.
 */
function stretch(v: number): Stretch {
  const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10), slope = (x: number) => 30 * x * x * (x - 1) * (x - 1);
  const h1 = (1 - R) - R * (1 - R), x1 = h1 - R * R, span = x1 + 1, pw = 2.2;
  const turn = new THREE.Matrix4().makeRotationX((v * Math.PI) / 2);
  const points: THREE.Vector3[] = [], dirs: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const k = i / 12, kk = k ** pw, h = h1 * ease(kk), dh = (h1 * slope(kk) * pw * Math.max(k, 1e-9) ** (pw - 1)) / span;
    points.push(new THREE.Vector3(-1 + k * span, h, h).applyMatrix4(turn));
    dirs.push(new THREE.Vector3(1, dh, dh).normalize().applyMatrix4(turn));
  }
  return { points, dirs, s: R * R, t: new THREE.Vector3().setScalar((1 - R) * (1 - R)).applyMatrix4(turn) };
}

function glsl(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): string {
  return drillLook(p) + /* glsl */ `
/** The camera's level in the ancestor's frame (${OUTER} stretches of two levels up, and as far down its own). */
float camLevel() { return ${(OUTER * 2).toFixed(1)} + 2.0 * uPhase; }

/** A rounded cube of half-size 1. */
float block(vec3 q) { vec3 d = abs(q) - vec3(0.8); return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0) - 0.2; }

/**
 * The dust as the ancestor ${OUTER} stretches up has it (uOuter), split into corner blocks only down to a little below
 * the camera's level (the blocks stay solid, with gaps of a few sizes between them; split all the way down they read
 * as a haze of specks), the next level's gaps opening as the camera nears it (a blend of the two depths).
 * gTrap.x: which corner block it is, a few levels down (for the blocks' shades).
 */
float DE(vec3 p) {
  vec3 q = uOuter.w * p + uOuter.xyz;
  float top = camLevel() + 3.0, sc = 1.0, dK = 0.0, id = 0.0;
  int K = int(floor(top));
  for (int i = 0; i < ${OUTER * 2 + 6}; i++) {
    if (i == K) dK = block(q) * sc;
    if (i > K) break;
    if (i == K - 2) id = dot(step(0.0, q), vec3(1.0, 2.0, 4.0));
    q = (abs(q) - ${(1 - R).toFixed(4)}) / ${R.toFixed(4)};
    sc *= ${R.toFixed(4)};
  }
  gTrap = vec4(id, 0.0, 0.0, 0.0);
  return mix(dK, block(q) * sc, top - float(K)) / uOuter.w;
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float t, float ao) {
  // The blocks a shade apart, two by two.
  return lit(p, n, rd, t, WALL * mix(0.86, 1.0, step(4.0, mod(gTrap.x * 5.0, 8.0))));
}`;
}

export class Cantor extends DrillPlate {
  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const seed = ((init.seed ?? 0) ^ 0xca17) >>> 0;
    const chain = new Chain(k => stretch(Math.floor(rng((seed + k * 7919) >>> 0)() * 4)), { window: 0.25, up: new THREE.Vector3(0, 1, 0) });
    super(init, look, {
      glsl: glsl(init.palette),
      path: { ax: 0, ay: 0, f: 0 },
      tunnel: 0,
      cruise: 1,
      steps: 120,
      far: 25,
      fog: 6,
      eps: 0.0009,
      sign: { ahead: 0.5, em: 0.055, maxW: 0.65, lift: 0.035 },
      fov: 72,
      bands: false,
      fisheye: 105,
      ride: true,
      dust: true,
    }, { chain, rate: 0.18, turnMax: 28, outer: OUTER, light: 1 });
  }
}
