// Polyhedra for the song's crystal: the five Platonic seeds and a few of Conway's operators (kis, dual, ambo,
// truncate, gyro), after George Hart's notation (polyhedronisme). A polyhedron is its vertices and its faces as
// vertex rings, counter-clockwise seen from outside. Seeds and every operator's result are convex (or star-shaped
// about the origin, for kis spikes), which the orientation fix relies on.

export type Vec = [number, number, number];
export interface Poly { name: string; v: Vec[]; f: number[][] }

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec) => Math.sqrt(dot(a, a));
const unit = (a: Vec): Vec => mul(a, 1 / (len(a) || 1));
const lerpV = (a: Vec, b: Vec, k: number): Vec => add(a, mul(sub(b, a), k));

export function centroid(p: Poly, face: number[]): Vec {
  let c: Vec = [0, 0, 0];
  for (const i of face) c = add(c, p.v[i]);
  return mul(c, 1 / face.length);
}

/** Face normal by Newell's method (fine for faces that are not quite planar). */
export function normal(p: Poly, face: number[]): Vec {
  let n: Vec = [0, 0, 0];
  for (let k = 0; k < face.length; k++) {
    const a = p.v[face[k]], b = p.v[face[(k + 1) % face.length]];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return unit(n);
}

/** Turns every face to face outward (the solid is star-shaped about the origin). */
function orient(p: Poly): Poly {
  for (const f of p.f) if (dot(normal(p, f), centroid(p, f)) < 0) f.reverse();
  return p;
}

/** Faces of the convex hull of a small point set (brute force: the Platonic seeds have at most 20 vertices). */
function hull(name: string, v: Vec[]): Poly {
  const faces: number[][] = [], seen = new Set<string>();
  const n = v.length, eps = 1e-6;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const nrm = cross(sub(v[j], v[i]), sub(v[k], v[i]));
    if (len(nrm) < eps) continue;
    const d = dot(nrm, v[i]);
    let above = 0, below = 0;
    const on: number[] = [];
    for (let m = 0; m < n; m++) {
      const s = dot(nrm, v[m]) - d;
      if (s > eps) above++; else if (s < -eps) below++; else on.push(m);
    }
    if (above && below) continue;
    const key = on.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    // Order the face's points round their centre.
    const c = mul(on.reduce((s, m) => add(s, v[m]), [0, 0, 0] as Vec), 1 / on.length);
    const ax = unit(sub(v[on[0]], c)), ay = cross(unit(nrm), ax);
    on.sort((a, b) => Math.atan2(dot(sub(v[a], c), ay), dot(sub(v[a], c), ax)) - Math.atan2(dot(sub(v[b], c), ay), dot(sub(v[b], c), ax)));
    faces.push(on);
  }
  return orient({ name, v: v.map(unit), f: faces });
}

const PHI = (1 + Math.sqrt(5)) / 2;
export const SEEDS: Record<'T' | 'C' | 'O' | 'D' | 'I', () => Poly> = {
  T: () => hull('T', [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]),
  C: () => hull('C', [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z] as Vec)))),
  O: () => hull('O', [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
  I: () => hull('I', [-1, 1].flatMap(a => [-1, 1].flatMap(b => [[0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]] as Vec[]))),
  D: () => hull('D', [
    ...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z] as Vec))),
    ...[-1, 1].flatMap(a => [-1, 1].flatMap(b => [[0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [b * PHI, 0, a / PHI]] as Vec[])),
  ]),
};

/** Builds a polyhedron from vertices named by keys, so the faces that share a new vertex share its index. */
class Builder {
  private keys = new Map<string, number>();
  readonly v: Vec[] = [];
  readonly f: number[][] = [];
  vert(key: string, at: () => Vec): number {
    let i = this.keys.get(key);
    if (i === undefined) { i = this.v.length; this.v.push(at()); this.keys.set(key, i); }
    return i;
  }
  poly(name: string, sphere: boolean): Poly {
    const p = { name, v: sphere ? this.v.map(unit) : this.v, f: this.f };
    return orient(p);
  }
}

/**
 * For each vertex, the vertices joined to it in ring order (walking face to face across the edges round it),
 * from the directed edges of the outward-facing faces.
 */
function rings(p: Poly): number[][] {
  const faceOf = new Map<string, number>(); // "a b" (an edge a→b of a face) → that face
  p.f.forEach((f, fi) => f.forEach((a, k) => { const b = f[(k + 1) % f.length]; faceOf.set(a + ' ' + b, fi); }));
  const out: number[][] = [];
  for (let v = 0; v < p.v.length; v++) {
    const ring: number[] = [];
    const start = p.f.findIndex(f => f.indexOf(v) >= 0);
    if (start < 0) { out.push(ring); continue; }
    let fi = start;
    for (let guard = 0; guard < 64; guard++) {
      const f = p.f[fi], k = f.indexOf(v);
      const w = f[(k + f.length - 1) % f.length]; // the edge w→v entering v in this face
      ring.push(w);
      const across = faceOf.get(v + ' ' + w);
      if (across === undefined || across === start) break;
      fi = across;
    }
    out.push(ring);
  }
  return out;
}

/** Kis: a pyramid on every face, its apex `h` × the face's size out along the face normal (spikes for h > 0.5). */
export function kis(p: Poly, h: number): Poly {
  const b = new Builder();
  p.v.forEach((v, i) => b.vert('v' + i, () => v));
  p.f.forEach((f, fi) => {
    const c = centroid(p, f), n = normal(p, f);
    const size = f.reduce((s, i) => s + len(sub(p.v[i], c)), 0) / f.length;
    const apex = b.vert('c' + fi, () => add(c, mul(n, h * size)));
    f.forEach((a, k) => b.f.push([b.vert('v' + a, () => p.v[a]), b.vert('v' + f[(k + 1) % f.length], () => p.v[f[(k + 1) % f.length]]), apex]));
  });
  return b.poly('k' + p.name, false);
}

/** Dual: a vertex for each face, a face for each vertex. */
export function dual(p: Poly): Poly {
  const b = new Builder();
  const faceOf = new Map<string, number>();
  p.f.forEach((f, fi) => f.forEach((a, k) => faceOf.set(a + ' ' + f[(k + 1) % f.length], fi)));
  const ring = rings(p);
  ring.forEach((ws, v) => {
    // The faces round v, in order: the face holding each edge v→w.
    const face = ws.map(w => faceOf.get(v + ' ' + w)).filter((x): x is number => x !== undefined);
    if (face.length >= 3) b.f.push(face.map(fi => b.vert('f' + fi, () => centroid(p, p.f[fi]))));
  });
  return b.poly('d' + p.name, true);
}

/** Ambo: a vertex at each edge's middle; the faces shrink to their edge midpoints, each vertex becomes a face. */
export function ambo(p: Poly): Poly {
  const b = new Builder();
  const mid = (a: number, c: number) => b.vert(a < c ? a + '-' + c : c + '-' + a, () => lerpV(p.v[a], p.v[c], 0.5));
  p.f.forEach(f => b.f.push(f.map((a, k) => mid(a, f[(k + 1) % f.length]))));
  rings(p).forEach((ws, v) => { if (ws.length >= 3) b.f.push(ws.map(w => mid(v, w))); });
  return b.poly('a' + p.name, true);
}

/** Truncate: each vertex cut off a third of the way along its edges. */
export function truncate(p: Poly): Poly {
  const b = new Builder();
  const cut = (a: number, c: number) => b.vert(a + '>' + c, () => lerpV(p.v[a], p.v[c], 1 / 3));
  p.f.forEach(f => {
    const ring: number[] = [];
    f.forEach((a, k) => { const c = f[(k + 1) % f.length]; ring.push(cut(a, c), cut(c, a)); });
    b.f.push(ring);
  });
  rings(p).forEach((ws, v) => { if (ws.length >= 3) b.f.push(ws.map(w => cut(v, w))); });
  return b.poly('t' + p.name, true);
}

/** Gyro: every n-gon becomes n pentagons whirling round its centre (a chiral, twisted solid). */
export function gyro(p: Poly): Poly {
  const b = new Builder();
  const third = (a: number, c: number) => b.vert(a + '~' + c, () => lerpV(p.v[a], p.v[c], 1 / 3));
  p.f.forEach((f, fi) => {
    const c = b.vert('c' + fi, () => unit(centroid(p, f)));
    for (let k = 0; k < f.length; k++) {
      const v1 = f[k], v2 = f[(k + 1) % f.length], v3 = f[(k + 2) % f.length];
      b.f.push([c, third(v1, v2), third(v2, v1), b.vert('v' + v2, () => p.v[v2]), third(v2, v3)]);
    }
  });
  return b.poly('g' + p.name, true);
}

/** Every edge once, as vertex pairs. */
export function edges(p: Poly): Array<[number, number]> {
  const out: Array<[number, number]> = [], seen = new Set<string>();
  for (const f of p.f) f.forEach((a, k) => {
    const c = f[(k + 1) % f.length], key = a < c ? a + '-' + c : c + '-' + a;
    if (!seen.has(key)) { seen.add(key); out.push([a, c]); }
  });
  return out;
}
