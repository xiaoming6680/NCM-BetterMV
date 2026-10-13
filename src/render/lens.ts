// The lens: what a camera does to a shot from its depth. Motion blur — the shutter open for a fraction of a second
// while the camera moves, each pixel smeared along the path its point took across the screen (from the depth and the
// camera's last pose; the plates' own motion isn't seen, only the camera's). Depth of field — focused on the line being
// sung (else on what the plate sets, else the middle of its world), the rest going soft with distance, bright lights
// opening into discs. Run per shot in ShotPass on the plate drawn without its lyrics; the lyrics are drawn back on
// afterwards against the plate's depth, so they stay sharp and unsmeared (they ride with the camera, which the
// reprojection would read as motion) and still go behind what stands in front of them.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { SceneId } from '../scenes/types.ts';

/** A plate's lens (scene.userData.lens; PLATE_LENS). */
export interface PlateLens {
  /** Depth of field, 0 = none, 1 = blur discs up to MAX_COC px at 1080p. */
  aperture: number;
  /** Motion blur, 0..1 of the style's shutter. */
  motion: number;
  /**
   * Where it focuses: 'subject' — the plate's subject at the world's origin (a crystal, a record, the cover's points:
   * they stay sharp, the lyrics are sharp anyway); a distance — on the lyrics in view (a sign in the air, the world
   * behind going soft, its lights opening into discs), at that distance when none is.
   */
  focus: 'subject' | number;
  /**
   * Where a pixel that no geometry wrote depth into is: 0 (default) the sky, infinitely far; else this many units off
   * (a plate drawn in lines that don't write depth, flying: its lines are streaked as if they stood there).
   */
  depthless?: number;
}

/**
 * The plates whose depth is their geometry's (backgrounds at the far plane). The rest keep no lens: flat ones (2D
 * plates, a plate printed in one quad), ones ray-marched on a quad at some fixed depth, and ones whose subject is
 * hairlines (LineBatch) or points that write no depth — read as the sky, they blurred as if infinitely far while the
 * solid bits beside them stayed sharp (the armillary's rings round its core; the tunnels, rings, particles, shards,
 * paper layers, ridges). The aurora is all sky: only the camera's turn smears it. The push tunnel's frames stand still
 * while the tube flies at the camera (Fx.travel): streaked as if they stood a few units off, no depth of field.
 */
export const PLATE_LENS: Partial<Record<SceneId, PlateLens>> = {
  pillars: { aperture: 0.7, motion: 1, focus: 'subject' },
  city: { aperture: 0.45, motion: 1, focus: 260 },
  vinyl: { aperture: 0.85, motion: 1, focus: 'subject' },
  relief: { aperture: 0.5, motion: 1, focus: 40 },
  subdivide: { aperture: 0.4, motion: 1, focus: 'subject' },
  aurora: { aperture: 0, motion: 1, focus: 'subject' },
  drive: { aperture: 0, motion: 0.2, focus: 8, depthless: 8 },
};

/** Largest blur disc, px at 1080p (aperture 1). */
const MAX_COC = 14;
/** Longest motion smear, in screen heights. */
const MAX_SMEAR = 0.06;

export interface LensFrame {
  aperture: number;
  motion: number;
  /** Focus distance; 0 = the plate's own (PlateLens.focus). */
  focus: number;
  /** Shutter, seconds. */
  shutter: number;
  /** The world flying past a still camera, units per second along the view (Fx.travel). */
  travel: number;
  /** PlateLens.depthless (0: the sky). */
  depthless: number;
}

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const depthGlsl = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform float uNear, uFar, uDepthless;
  uniform vec2 uRes;
  varying vec2 vUv;
  float viewZ(float d) { return 2.0 * uNear * uFar / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear)); }
  // The depth at uv; where nothing wrote one, the plate's stand-in distance (PlateLens.depthless), else the far plane.
  float depthAt(vec2 uv) {
    float d = texture2D(tDepth, uv).r;
    if (d >= 1.0 && uDepthless > 0.0) d = 0.5 + 0.5 * ((uFar + uNear) / (uFar - uNear) - 2.0 * uFar * uNear / ((uFar - uNear) * uDepthless));
    return d;
  }
  // Interleaved gradient noise: a different start per pixel, so few samples read as fine grain, not rings or steps.
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

/** Depth of field: a gather over a golden-angle disc, each sample counted if its own blur reaches here. */
const dofFragment = /* glsl */ `
  ${depthGlsl}
  uniform float uFocus, uCoc;
  float coc(float d) { return d >= 1.0 ? uCoc : uCoc * min(abs(1.0 - uFocus / viewZ(d)), 1.0); }
  void main() {
    vec4 c0 = texture2D(tColor, vUv);
    float r0 = coc(depthAt(vUv));
    if (r0 < 0.6) { gl_FragColor = c0; return; }
    vec3 acc = c0.rgb;
    float wsum = 1.0, spin = ign(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < 28; i++) {
      float fi = float(i) + 0.5;
      float r = r0 * sqrt(fi / 28.0), a = fi * 2.39996323 + spin;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
      vec3 s = texture2D(tColor, uv).rgb;
      // (A sharp thing nearer the focus doesn't smear out over the blur behind it.)
      float w = smoothstep(r - 1.0, r + 1.0, coc(depthAt(uv)));
      // Bright lights open into discs.
      w *= 1.0 + clamp(luma(s) - 1.0, 0.0, 3.0);
      acc += s * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, c0.a);
  }`;

/** Motion blur: each pixel smeared along where its point was a shutter's length ago. */
const motionFragment = /* glsl */ `
  ${depthGlsl}
  uniform mat4 uReproj, uReprojFar;
  uniform float uScale, uMax;
  void main() {
    vec4 c0 = texture2D(tColor, vUv);
    float d = depthAt(vUv);
    // The sky (the far plane) moves only with the camera's turn, not its travel.
    vec4 p = (d >= 1.0 ? uReprojFar : uReproj) * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    if (p.w <= 0.0) { gl_FragColor = c0; return; }
    vec2 v = (vUv - (p.xy / p.w * 0.5 + 0.5)) * uScale;
    float aspect = uRes.x / uRes.y, len = length(v * vec2(aspect, 1.0));
    if (len > uMax) v *= uMax / len;
    if (len * uRes.y < 0.75) { gl_FragColor = c0; return; }
    vec3 acc = vec3(0.0);
    float j = ign(gl_FragCoord.xy);
    for (int i = 0; i < 12; i++) acc += texture2D(tColor, vUv + v * ((float(i) + j) / 12.0 - 0.5)).rgb;
    gl_FragColor = vec4(acc / 12.0, c0.a);
  }`;

/** The lyrics, drawn alone over transparency (premultiplied), laid over the lens's picture. */
const overFragment = /* glsl */ `
  uniform sampler2D tColor;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tColor, vUv); }`;

interface CameraState {
  vp: THREE.Matrix4;
  proj: THREE.Matrix4;
  quat: THREE.Quaternion;
  t: number;
  key: number;
  focus: number;
}

export class Lens {
  private dof: THREE.ShaderMaterial;
  private motion: THREE.ShaderMaterial;
  private over: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private mid: THREE.WebGLRenderTarget;
  private states = new WeakMap<THREE.Camera, CameraState>();
  private res = new THREE.Vector2(1, 1);
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private box = new THREE.Box3();
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor() {
    const uniforms = () => ({
      tColor: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null },
      uNear: { value: 0.1 }, uFar: { value: 100 }, uDepthless: { value: 0 }, uRes: { value: this.res },
    });
    this.dof = new THREE.ShaderMaterial({ vertexShader, fragmentShader: dofFragment, depthTest: false, depthWrite: false,
      uniforms: { ...uniforms(), uFocus: { value: 10 }, uCoc: { value: 0 } } });
    this.motion = new THREE.ShaderMaterial({ vertexShader, fragmentShader: motionFragment, depthTest: false, depthWrite: false,
      uniforms: { ...uniforms(), uReproj: { value: new THREE.Matrix4() }, uReprojFar: { value: new THREE.Matrix4() }, uScale: { value: 0 }, uMax: { value: MAX_SMEAR } } });
    this.over = new THREE.ShaderMaterial({ vertexShader, fragmentShader: overFragment, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tColor: { value: null as THREE.Texture | null } } });
    this.quad = new FullScreenQuad(this.dof);
    this.mid = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  }

  /** The pass materials, for compiling with the post chain. */
  get materials(): THREE.Material[] { return [this.dof, this.motion, this.over]; }

  setSize(width: number, height: number): void {
    this.res.set(width, height);
    this.mid.setSize(width, height);
  }

  /**
   * The lens on one shot: `color` and `depth` (the plate drawn without its lyrics) into `out`. `key` changes on a
   * cut (the camera's last pose belongs to another shot: no smear on its first frame; null: carry on); `still`: no
   * motion blur (the camera also films the other side of a transition this frame).
   */
  apply(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, color: THREE.Texture, depth: THREE.Texture,
    lens: LensFrame, t: number, key: number | null, still: boolean, out: THREE.WebGLRenderTarget | null): void {
    const st = this.state(camera, t, key);
    const dt = t - st.t;
    const moving = !still && st.t > -Infinity && dt > 1e-4 && dt < 0.1 && lens.motion > 0.001;
    // Focus: on the lyrics in view, eased (a focus pull), snapped on a cut.
    const plate = (scene.userData.lens as PlateLens | undefined)?.focus ?? 'subject';
    const target = lens.focus > 0 ? lens.focus : plate === 'subject' ? camera.getWorldPosition(this.v).length() : this.lyricFocus(scene, camera) ?? plate;
    st.focus = st.t === -Infinity || !(dt > 0 && dt < 0.1) ? target : st.focus + (target - st.focus) * (1 - Math.exp(-dt / 0.25));
    const coc = MAX_COC * lens.aperture * (this.res.y / 1080);
    const dof = coc > 0.6;

    let src = color;
    if (dof) {
      const u = this.dof.uniforms;
      u.tColor.value = color; u.tDepth.value = depth; u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uFocus.value = Math.max(camera.near * 2, st.focus); u.uCoc.value = coc; u.uDepthless.value = lens.depthless;
      this.draw(renderer, this.dof, moving ? this.mid : out);
      src = this.mid.texture;
    }
    if (moving) {
      const u = this.motion.uniforms;
      u.tColor.value = src; u.tDepth.value = depth; u.uNear.value = camera.near; u.uFar.value = camera.far; u.uDepthless.value = lens.depthless;
      // prev view-projection × inverse(this view-projection); for the sky the last pose's turn alone (seen from here)
      const inv = this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      const reproj = (u.uReproj.value as THREE.Matrix4).copy(st.vp);
      // A world flying past a still camera: seen as if the camera had stood that much further back.
      if (lens.travel) reproj.multiply(this.m2.makeTranslation(camera.getWorldDirection(this.fwd).multiplyScalar(lens.travel * dt)));
      reproj.multiply(inv);
      const turn = this.m2.compose(camera.getWorldPosition(this.v), st.quat, this.one).invert();
      (u.uReprojFar.value as THREE.Matrix4).multiplyMatrices(st.proj, turn).multiply(inv);
      u.uScale.value = lens.motion * lens.shutter / dt;
      this.draw(renderer, this.motion, out);
    } else if (!dof) {
      this.over.uniforms.tColor.value = color;
      this.over.blending = THREE.NoBlending;
      this.draw(renderer, this.over, out);
      this.over.blending = THREE.CustomBlending;
    }
    st.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    st.proj.copy(camera.projectionMatrix);
    camera.getWorldQuaternion(st.quat);
    st.t = t;
  }

  /** Lays a premultiplied layer (the lyrics alone) over `out`. */
  overlay(renderer: THREE.WebGLRenderer, layer: THREE.Texture, out: THREE.WebGLRenderTarget | null): void {
    this.over.uniforms.tColor.value = layer;
    // (Over what is there: no clear before the draw.)
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this.draw(renderer, this.over, out);
    renderer.autoClear = auto;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, out: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(out);
    this.quad.material = material;
    this.quad.render(renderer);
  }

  private state(camera: THREE.Camera, t: number, key: number | null): CameraState {
    let st = this.states.get(camera);
    if (!st) this.states.set(camera, st = { vp: new THREE.Matrix4(), proj: new THREE.Matrix4(), quat: new THREE.Quaternion(), t: -Infinity, key: key ?? 0, focus: 10 });
    // A cut, or a jump in time (a seek, a loop): the last pose is no guide.
    if ((key !== null && st.key !== key) || t <= st.t || t - st.t > 0.1) { st.t = -Infinity; if (key !== null) st.key = key; }
    return st;
  }

  /** The distance along the view to the nearest lyric in front of the camera (none in view: null). */
  private lyricFocus(scene: THREE.Scene, camera: THREE.PerspectiveCamera): number | null {
    camera.getWorldDirection(this.fwd);
    const eye = camera.getWorldPosition(this.v.clone());
    let best: number | null = null;
    scene.traverseVisible(o => {
      if (!o.userData.lyrics) return;
      this.box.setFromObject(o);
      if (this.box.isEmpty()) return;
      const z = this.box.getCenter(this.v).sub(eye).dot(this.fwd);
      if (z > camera.near && (best === null || z < best)) best = z;
    });
    return best;
  }

  dispose(): void {
    this.dof.dispose();
    this.motion.dispose();
    this.over.dispose();
    this.quad.dispose();
    this.mid.dispose();
  }
}
