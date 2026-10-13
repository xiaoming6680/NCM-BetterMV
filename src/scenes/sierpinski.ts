// Triangle (sierpinski): drilling into the Sierpinski tetrahedron without end. The tetrahedron is four of itself at
// half the size, one at each corner, round an octahedral hollow; between the hollow and the small tetrahedron at a
// corner is a face whose middle is a triangular hole. So the route goes from hollow to hollow through those windows,
// each into one of the four smaller tetrahedra, inside which the same holds a level down, for ever (drill.ts): the
// windows and the hollows round the camera always the same size relative to it. Which corner the route makes for
// next is picked at random each level: the same one again a little under half the time (straight on through the next
// window in line), else one of the other three (a turn: the corners' directions are 109° apart). Through all of them
// the route stays deep inside (making for one corner for ever would end at its tip, half the view the empty outside).
// The turns are spread out: the route already leans half way into the directions before and after as it passes a
// window, the camera looks three quarters of a window ahead, and slows into a turn rather than swing (DrillPlate).
// The look (after Leaf's "Aleph-0" BGA, as menger.ts): a fisheye lens, the tetrahedra's edges glowing in the cover's
// colours, the light ahead down the route, warm haze, dust.
import * as THREE from 'three';
import type { SceneInit } from './types.ts';
import { Chain, DrillPlate, drillLook, type Stretch } from './drill.ts';
import { rng } from './types.ts';

/** The corners. */
const V = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, -1, -1), new THREE.Vector3(-1, 1, -1), new THREE.Vector3(-1, -1, 1)];
/** Levels of ancestors drawn round the current one. */
const OUTER = 6;

/** The corners the route makes for, level after level (from level −8, for the ancestors drawn round the start). */
function letters(seed: number): (k: number) => number {
  const random = rng(seed), seq: number[] = [];
  return (k: number) => {
    while (seq.length <= k + 8) {
      const last = seq.length ? seq[seq.length - 1] : Math.floor(random() * 4);
      seq.push(random() < 0.45 ? last : (last + 1 + Math.floor(random() * 3)) % 4);
    }
    return seq[k + 8];
  };
}

/**
 * Level k, in its own frame (the tetrahedron it is in, scaled up to the whole): from the window into the corner it
 * makes for to the window inside that one into the next; the next level's frame is that corner's (x ↦ (x + V)/2).
 */
function stretch(L: (k: number) => number, k: number): Stretch {
  const lean = (a: number, b: number, c: number) => {
    const d = V[b].clone().normalize();
    if (a !== b) d.addScaledVector(V[a].clone().normalize(), 0.5);
    if (c !== b) d.addScaledVector(V[c].clone().normalize(), 0.5);
    return d.normalize();
  };
  const x0 = L(k - 1), x1 = L(k), x2 = L(k + 1), x3 = L(k + 2);
  return {
    points: [V[x1].clone().multiplyScalar(1 / 3), V[x2].clone().multiplyScalar(1 / 3).add(V[x1]).multiplyScalar(0.5)],
    dirs: [lean(x0, x1, x2), lean(x1, x2, x3)],
    s: 0.5,
    t: V[x1].clone().multiplyScalar(0.5),
  };
}

function glsl(p: { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color }): string {
  return drillLook(p) + /* glsl */ `
/** The camera's level in the ancestor's frame (${OUTER} levels up, and as far down its own). */
float camLevel() { return ${OUTER.toFixed(1)} + uPhase; }

/** A tetrahedron with corners (1,1,1), (1,-1,-1), (-1,1,-1), (-1,-1,1): distance (unit scale) and edge nearness. */
vec2 tetra(vec3 z) {
  vec4 fp = vec4(-z.x - z.y - z.z, z.x + z.y - z.z, -z.x + z.y + z.z, z.x - z.y + z.z);
  float m1 = max(max(fp.x, fp.y), max(fp.z, fp.w));
  vec4 rest = fp - step(m1, fp) * 100.0;
  float m2 = max(max(rest.x, rest.y), max(rest.z, rest.w));
  return vec2((m1 - 1.0) / sqrt(3.0), (m1 - m2) / sqrt(3.0));
}

/**
 * The tetrahedron as the ancestor ${OUTER} levels up has it (uOuter), folded only down to a little below the camera's
 * level (the faces stay whole triangles pierced by windows of a few sizes; holes all the way down read as noise),
 * the next level's windows opening as the camera nears it (a blend of the two depths).
 */
float DE(vec3 p) {
  vec3 z = uOuter.w * p + uOuter.xyz;
  float top = camLevel() + 4.5, sc = 1.0, dK = 0.0;
  int K = int(floor(top));
  for (int i = 0; i < ${OUTER + 8}; i++) {
    if (i == K) dK = tetra(z).x / sc;
    if (i > K) break;
    if (z.x + z.y < 0.0) z.xy = -z.yx;
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.zy = -z.yz;
    z = z * 2.0 - vec3(1.0);
    sc *= 2.0;
  }
  vec2 e = tetra(z);
  gTrap = vec4(e.y, 0.0, 0.0, 0.0);
  return mix(dK, e.x / sc, top - float(K)) / uOuter.w;
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float t, float ao) {
  float rim = smoothstep(0.1, 0.0, gTrap.x);
  // The edges glow faintly in the cover's colours.
  return lit(p, n, rd, t, WALL) + mix(GLOW, SIG, 0.5) * rim * 0.06;
}`;
}

export class Sierpinski extends DrillPlate {
  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const L = letters(((init.seed ?? 0) ^ 0x51e7) >>> 0);
    const chain = new Chain(k => stretch(L, k), { ahead: 0.75, up: new THREE.Vector3(0, 1, 0) });
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
    }, { chain, rate: 0.3, turnMax: 28, outer: OUTER, light: 2.5 });
  }
}
