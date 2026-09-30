// Type wall (the 字 style, for rap): the words ARE the picture. The line being rapped is stacked in rows as it is
// sung, every row set as wide as the frame allows (Latin a word a row, Chinese two to four characters a row); a new
// row slams in at the bottom and shoves the stack up; the word being rapped is in the signal colour; a snare knocks
// the newest row out of a solid signal block; kicks jolt the whole wall. Behind: the cover as a hard ink / signal
// duotone — a strip down one side (split), full-bleed and dark (stack), or nothing but ink (solo, one row at a time).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, outExpo, rng } from './types.ts';
import { textMesh, hasCjk } from '../render/text.ts';
import type { LineState } from '../director/lyrics.ts';
import { lastIndex } from '../director/music.ts';

const DIST = 10;
type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Row { text: string; start: number; mesh: Mesh; block: Mesh; aspect: number }
interface Built { index: number; rows: Row[]; root: THREE.Group }

const coverVertex = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coverFragment = /* glsl */ `
  uniform sampler2D uCover; uniform vec3 uInk, uSig; uniform float uDim, uKick; varying vec2 vUv;
  void main() {
    float l = dot(texture2D(uCover, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    float v = smoothstep(0.32, 0.5, l + uKick * 0.08);
    gl_FragColor = vec4(mix(uInk, uSig, v) * uDim, 1.0);
  }`;

export class TypeWall implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  private built = new Map<number, Built>();
  private cover: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private snares: Float64Array;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    this.cover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: coverVertex, fragmentShader: coverFragment, depthWrite: false,
      uniforms: { uCover: { value: init.cover }, uInk: { value: palette.ink.clone() }, uSig: { value: palette.signal.clone() }, uDim: { value: 1 }, uKick: { value: 0 } },
    }));
    this.cover.renderOrder = -5;
    this.scene.add(this.cover);
    this.snares = Float64Array.from(init.music.a.hits.snare.filter(h => h[1] > 0.4), h => h[0]);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    for (const b of Array.from(this.built.values())) this.drop(b);
  }

  /** Rows of a line: a Latin word each; Chinese in runs of up to four characters, broken at punctuation. */
  private rowsOf(state: LineState): Array<{ text: string; start: number }> {
    const words = state.line.words;
    if (!hasCjk(state.line.text)) return words.map(w => ({ text: w.text.toUpperCase(), start: w.start }));
    const rows: Array<{ text: string; start: number }> = [];
    let cur: { text: string; start: number } | null = null;
    for (const w of words) {
      const glyphs = Array.from(w.text.replace(/[，。、！？；：,.!?;:]/g, ''));
      if (!cur || Array.from(cur.text).length + glyphs.length > 4) { cur = { text: '', start: w.start }; rows.push(cur); }
      cur.text += glyphs.join('');
      if (/[，。、！？；：,.!?;:]$/.test(w.text)) cur = null;
    }
    return rows.filter(r => r.text);
  }

  private build(state: LineState): Built {
    const root = new THREE.Group();
    root.userData.lyrics = true;
    const rows = this.rowsOf(state).map(r => {
      const mesh = textMesh(r.text, 'display', 1, { center: true, px: 200, halo: 'none' });
      mesh.material.toneMapped = false;
      mesh.material.depthTest = false;
      mesh.renderOrder = 20;
      const block = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: this.init.palette.signal, toneMapped: false, depthTest: false, transparent: true }));
      block.renderOrder = 19;
      root.add(block, mesh);
      return { text: r.text, start: r.start, mesh, block, aspect: mesh.userData.width as number };
    });
    this.scene.add(root);
    return { index: state.index, rows, root };
  }

  private drop(b: Built): void {
    this.scene.remove(b.root);
    b.root.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
    this.built.delete(b.index);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const random = rng(shot.seed);
    const cam = this.camera;
    const vh = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), vw = vh * ctx.aspect;
    const kick = music.pulse('kick', t, 0.1);
    const si = lastIndex(this.snares, t), snareAge = si >= 0 ? t - this.snares[si] : 99;
    const side = random() < 0.5 ? -1 : 1;
    const variant = shot.variant;

    // The cover behind: a strip, a dim full bleed, or nothing.
    const cu = this.cover.material.uniforms;
    cu.uKick.value = kick;
    this.cover.visible = variant !== 'solo';
    if (variant === 'split') {
      this.cover.scale.set(vw * 0.34, vh, 1);
      this.cover.position.set(side * vw * 0.33, 0, 0);
      cu.uDim.value = 1;
    } else {
      this.cover.scale.set(vw * 1.05, vw * 1.05, 1);
      this.cover.position.set(0, -kick * 0.05, 0);
      cu.uDim.value = 0.22;
    }
    // Where the words go: the free side of a split, else the whole frame.
    const areaW = variant === 'split' ? vw * 0.58 : vw * 0.88;
    const areaX = variant === 'split' ? -side * vw * 0.19 : 0;

    const states = ctx.lyrics.visible(t);
    const keep = new Set(states.map(s => s.index));
    for (const b of Array.from(this.built.values())) if (!keep.has(b.index)) this.drop(b);
    const jolt = kick * vh * 0.012;
    for (const st of states) {
      const b = this.built.get(st.index) ?? this.built.set(st.index, this.build(st)).get(st.index)!;
      const shown = b.rows.filter(r => t >= r.start - 0.03);
      const rows = variant === 'solo' ? shown.slice(-1) : shown.slice(-4);
      // Heights: each row as wide as the area, capped; the stack sits on a baseline below the middle.
      // (Four rows of at most a fifth of the frame fit between the baseline and the top margin.)
      const hs = rows.map(r => Math.min(vh * (variant === 'solo' ? 0.5 : 0.2), areaW / Math.max(0.2, r.aspect)));
      let y = -vh * (variant === 'solo' ? 0.25 : 0.4) + outExpo(st.exit) * vh * 1.1;
      for (const r of b.rows) { r.mesh.visible = false; r.block.visible = false; }
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i], h = hs[i];
        const age = t - r.start, slam = outExpo(clamp01(age / 0.12));
        // Rows above the newest slide up to their places as it pushes in.
        const lift = i === rows.length - 1 ? 0 : (1 - outExpo(clamp01((t - rows[rows.length - 1].start) / 0.15))) * -hs[rows.length - 1];
        const scale = h * (1 + (1 - slam) * 0.5);
        const yy = y + h * 0.5 + lift - jolt;
        r.mesh.visible = true;
        r.mesh.scale.set(scale, scale, 1);
        r.mesh.position.set(areaX, yy, -DIST);
        const newest = i === rows.length - 1;
        const snap = newest && snareAge < 0.14 && age > 0.05;
        const singing = newest && age < 0.5;
        r.mesh.material.color.copy(snap ? palette.ink : singing ? palette.signal : palette.paper);
        r.mesh.material.opacity = slam * (1 - st.exit) * (newest ? 1 : 0.55 + 0.45 * (i / rows.length));
        r.block.visible = snap;
        if (snap) {
          r.block.scale.set(r.aspect * h * 1.06, h * 1.1, 1);
          r.block.position.set(areaX, yy, -DIST - 0.01);
          r.block.material.opacity = 1 - st.exit;
        }
        y += h * 1.02;
      }
    }

    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    cam.rotateZ((random() - 0.5) * 0.06 + kick * 0.01 * side);
    cam.updateMatrixWorld();
    this.cover.position.z = -DIST - 0.5;
    this.cover.lookAt(cam.position);
    ctx.fx.bloom = 0.2 + kick * 0.2;
    ctx.fx.vignette = 0.35;
    ctx.fx.ca = kick * 0.25;
  }

}
