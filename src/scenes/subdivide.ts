// Subdivide: the sphere of the user's 《△ 三角》 (an icosahedron split every half beat until it is a ball, then
// breathing with the bass), grown from this song's crystal. Every half beat (every beat in ballads) each triangle
// splits in four: the new vertices appear at the old edges' middles — the shape unchanged — then spring out towards
// the sphere within a sixth of a second, the new edges flashing in the signal colour. At the last level it is a
// ball that breathes with the bass, a ripple running over it on each kick. Beside it, the level and the count.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, rng, smooth } from './types.ts';
import { crystalPoly } from '../sigil/crystal.ts';
import { textMesh } from '../render/text.ts';
import { LyricRig } from './lyricRig.ts';

type V = [number, number, number];
const MAX_TRIS = 70000;

const vertexShader = /* glsl */ `
  attribute vec3 aFrom, aBary, aNew;
  uniform float uGrow, uBreath, uRipple, uRippleAt;
  varying vec3 vBary, vNew, vN, vView, vLocal;
  void main() {
    vec3 p = mix(aFrom, position, uGrow);
    vec3 d = normalize(p);
    // Breathing, and a ripple from the top on each kick.
    float r = 1.0 + uBreath + uRipple * exp(-pow((acos(clamp(d.y, -1.0, 1.0)) - uRippleAt) * 3.0, 2.0));
    p *= r;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * d);
    vView = -mv.xyz;
    vLocal = p;
    vBary = aBary; vNew = aNew;
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uTint, uEdge, uGlowCol;
  uniform float uGlow, uLine;
  varying vec3 vBary, vNew, vN, vView, vLocal;
  void main() {
    vec3 n = normalize(vN), v = normalize(vView);
    float facing = abs(dot(n, v)), fres = pow(1.0 - facing, 2.0);
    vec3 fw = fwidth(vBary);
    vec3 e = 1.0 - smoothstep(vec3(0.0), fw * uLine, vBary);
    float wire = max(max(e.x, e.y), e.z);
    float fresh = max(max(e.x * vNew.x, e.y * vNew.y), e.z * vNew.z);
    vec3 cover = texture2D(uCover, vLocal.xy * 0.4 + 0.5).rgb;
    vec3 col = cover * (0.1 + 0.2 * facing) + uTint * fres * 0.7;
    col += uEdge * wire * (0.45 + 0.4 * facing) + uGlowCol * fresh * uGlow * 2.0;
    gl_FragColor = vec4(col, 1.0);
  }`;

interface Level { geo: THREE.BufferGeometry; tris: number }

export class SubdivideScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 100);
  private levels: Level[] = [];
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private labels: Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>> = [];
  private rig: LyricRig;
  private readonly soft: boolean;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.soft = look === 'ballad';
    this.scene.background = palette.ink.clone();
    // Level 0: the crystal's faces as triangles (fans). Each level splits every triangle in four.
    const poly = crystalPoly(init.crystal);
    let tris: Array<[V, V, V]> = [];
    // (Faces of more than three sides are cut round their centre, not fanned from a corner: fans leave slivers that
    // subdivide into a visible crease.)
    for (const f of poly.f) {
      if (f.length === 3) { tris.push([poly.v[f[0]], poly.v[f[1]], poly.v[f[2]]]); continue; }
      const c: V = [0, 0, 0];
      for (const i of f) for (let a = 0; a < 3; a++) c[a] += poly.v[i][a] / f.length;
      for (let k = 0; k < f.length; k++) tris.push([c, poly.v[f[k]], poly.v[f[(k + 1) % f.length]]]);
    }
    // For each level: where every vertex starts (on the level before's surface) and where it springs to, and which
    // of each triangle's edges are new.
    let from = tris.map(t => t.map(v => [...v] as V) as [V, V, V]);
    let fresh: Array<[V, V, V]> = tris.map(() => [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    let depth = 0;
    const maxDepth = Math.max(1, Math.floor(Math.log(MAX_TRIS / tris.length) / Math.log(4)));
    for (;;) {
      this.levels.push({ geo: this.build(from, tris, fresh), tris: tris.length });
      if (depth >= maxDepth) break;
      depth++;
      const toward = depth / maxDepth; // how far this level goes towards the sphere
      const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const out = (p: V): V => { const l = Math.hypot(p[0], p[1], p[2]) || 1, r = lerp(l, 1, toward); return [p[0] / l * r, p[1] / l * r, p[2] / l * r]; };
      const nextFrom: Array<[V, V, V]> = [], nextTo: Array<[V, V, V]> = [], nextFresh: Array<[V, V, V]> = [];
      const N1: V = [1, 0, 0], N0: V = [0, 0, 0], ALL: V = [1, 1, 1];
      for (const [a, b, c] of tris) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        // Corner triangles: the new edge is the one opposite the corner (bary x = 0 there); the middle one is all new.
        for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as Array<[V, V, V]>) {
          nextFrom.push(t);
          nextTo.push(t.map(out) as [V, V, V]);
        }
        nextFresh.push([N1, N0, N0], [N0, N1, N0], [N0, N0, N1], [ALL, ALL, ALL]);
      }
      // (The corners' masks: marking the vertex opposite the new edge makes that edge the one where its bary is 0.)
      from = nextFrom; tris = nextTo; fresh = nextFresh;
    }
    this.mesh = new THREE.Mesh(this.levels[0].geo, new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uCover: { value: init.cover }, uTint: { value: palette.signal.clone() }, uEdge: { value: palette.paper.clone() }, uGlowCol: { value: palette.signal.clone() },
        uGlow: { value: 0 }, uLine: { value: 1.2 }, uGrow: { value: 1 }, uBreath: { value: 0 }, uRipple: { value: 0 }, uRippleAt: { value: 0 },
      },
    }));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.labels = this.levels.map((l, i) => {
      const m = textMesh(`LOD ${i} · ${l.tris.toLocaleString('en').replace(/,/g, ' ')} △`, 'bold', 0.13, { px: 96, halo: 'dark' });
      m.material.toneMapped = false;
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.rig = new LyricRig(palette, this.soft ? 'poem' : 'hook');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  /** A level's triangles: where they are (`to`), where their vertices start (`from`), their bary and new-edge masks. */
  private build(from: Array<[V, V, V]>, to: Array<[V, V, V]>, fresh: Array<[V, V, V]>): THREE.BufferGeometry {
    const n = to.length, pos = new Float32Array(n * 9), fr = new Float32Array(n * 9), bary = new Float32Array(n * 9), nw = new Float32Array(n * 9);
    const B: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      pos.set(to[t][k], o); fr.set(from[t][k], o); bary.set(B[k], o);
      // The edge opposite vertex j is new when mask j is set: every vertex of the triangle carries the same mask.
      const m = fresh[t];
      nw.set([m[0][0] || m[0][1] || m[0][2] ? 1 : 0, m[1][0] || m[1][1] || m[1][2] ? 1 : 0, m[2][0] || m[2][1] || m[2][2] ? 1 : 0], o);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFrom', new THREE.BufferAttribute(fr, 3));
    g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    g.setAttribute('aNew', new THREE.BufferAttribute(nw, 3));
    return g;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const len = Math.max(0.2, shot.end - shot.start), k = clamp01(ctx.shotT / len);
    const beat = 60 / Math.max(40, music.at(t).bpm), step = this.soft ? 1 : 0.5;
    const since = music.beatPos(t) - music.beatPos(shot.start);
    const level = Math.min(this.levels.length - 1, Math.max(0, Math.floor(since / step)));
    const age = (since - level * step) * beat; // seconds since this level split
    const L = this.levels[level], u = this.mesh.material.uniforms;
    if (this.mesh.geometry !== L.geo) this.mesh.geometry = L.geo;
    const done = level === this.levels.length - 1;
    u.uGrow.value = level === 0 ? 1 : 1 - Math.exp(-age / 0.05) * Math.cos(age * 30) * (age < 0.3 ? 1 : 0);
    u.uGlow.value = level === 0 ? 0 : Math.exp(-age / 0.18);
    u.uLine.value = lerp(1.4, 0.9, level / Math.max(1, this.levels.length - 1));
    const low = music.env('low', t);
    u.uBreath.value = done ? 0.06 * low : 0;
    const kick = music.hitsBetween('kick', t - 0.6, t + 1e-3).filter(h => h[1] > 0.35).pop();
    const ka = kick ? t - kick[0] : 9;
    u.uRipple.value = done ? 0.08 * Math.exp(-ka / 0.35) : 0;
    u.uRippleAt.value = ka * 4.5;

    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    this.mesh.rotation.set(0.35, t * 0.3 * side, 0);
    const cam = this.camera;
    const d = lerp(3.8, 3.1, smooth(k));
    cam.position.set(Math.sin(0.4 * side) * d, 0.5, Math.cos(0.4 * side) * d);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    // The level's label, low beside the ball, facing the camera.
    this.labels.forEach((m, i) => {
      m.visible = i === level;
      if (!m.visible) return;
      m.position.set(-1.35, -1.2, 0.4).applyQuaternion(cam.quaternion);
      m.quaternion.copy(cam.quaternion);
      m.material.color.copy(this.init.palette.paper).multiplyScalar(0.8 + 0.6 * u.uGlow.value);
    });
    ctx.fx.bloom = 0.45 + 0.25 * u.uGlow.value;
    ctx.fx.vignette = 0.5;
    this.rig.align = side > 0 ? 'left' : 'right';
    this.rig.update(cam, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
