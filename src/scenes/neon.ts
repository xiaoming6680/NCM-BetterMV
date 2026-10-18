// Neon street (字, rap): a narrow street at night, walking down it on the beat. Signs stick out from the buildings on
// both sides, one for every chunk of the words, a little ahead of where the camera will be when it is rapped: dark
// boards with a faint tube round them, waiting; when the chunk comes, its words strike on one by one like neon tubes
// (the hook type's flicker) and the board's tube lights; the camera walks on past it to the next. The windows above are lit in the cover's colours, the shopfronts glow along the ground floor,
// the far end of the street fades into a glow of the cover's colour (caught down the middle of the street), and
// each lit sign lays a smear of its colour on the wet ground. The walk is the beat: a step forward on every
// beat (a little push, then the glide), so the street's speed is the song's tempo; a snare makes one lit sign buzz.
// Cameras: walk (eye height, a slight bob on the beat), low (just over the wet street, the reflections large), up
// (looking up at the signs, slower).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { fitFov, lerp, rng, smooth, snap } from './types.ts';
import { LyricGates, chunksOf, type Chunk } from './lyricSpace.ts';
import type { Music } from '../director/music.ts';
import { hasCjk } from '../render/text.ts';

/** Half the street's width; how far ahead of the camera a sign hangs when its chunk begins; metres per beat. */
const W = 4.2, AHEAD = 15, STEP = 1.7;
const EM = 0.5, MAXW = 3.0;

interface Sign { x: number; y: number; z: number; w: number; h: number; start: number; end: number }

const FACADE_VERT = /* glsl */ `varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`;
const FACADE_FRAG = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uWall, uWarm, uFogC, uCam;
  uniform float uGround;
  varying vec3 vW;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec3 col;
    float d = length(vW - uCam);
    if (uGround > 0.5) {
      // The wet street: nearly black, a little sheen, the wet patches darker and glossier.
      float wet = smoothstep(0.45, 0.65, n2(vW.xz * 0.9) * 0.6 + n2(vW.xz * 0.23) * 0.4);
      col = uWall * mix(0.35, 0.18, wet);
      // The glow at the far end, caught down the middle of the wet street.
      col += uFogC * (0.25 + 0.35 * wet) * exp(-abs(vW.x) * 0.8) * exp(-d * 0.012);
    } else {
      float side = sign(vW.x);
      // Buildings a few metres wide side by side, each its own concrete tone; floors every 3 m with a slab line.
      float bld = floor(vW.z / 7.0);
      float tone = 0.65 + 0.35 * h21(vec2(bld, side));
      col = uWall * tone * (0.9 + 0.1 * h21(floor(vec2(vW.z * 3.0, vW.y * 0.4))));
      col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(fract(vW.y / 3.0) - 0.02)));
      // Windows: two to a bay, each with a frame and a mullion; dark glass, about one in five lit (warm, cool
      // fluorescent or a colour of the cover), some behind blinds.
      vec2 g = vec2(vW.z / 1.15, (vW.y - 0.6) / 3.0), id = floor(g), f = fract(g);
      float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.3, f.y) * step(f.y, 0.82) * step(1.0, id.y);
      win *= 1.0 - (1.0 - smoothstep(0.0, 0.025, abs(f.x - 0.5)));
      float r = h21(id + side * 13.0 + bld * 0.37);
      float lit = step(0.8, r) * win;
      vec3 cover = texture2D(uCover, vec2(fract(r * 7.3), fract(r * 3.1)), 3.0).rgb;
      vec3 wc = r > 0.95 ? vec3(0.55, 0.7, 0.75) : r > 0.88 ? cover * 1.5 : uWarm;
      float blinds = step(0.9, fract(r * 13.0)) * (0.55 + 0.45 * step(0.5, fract(f.y * 9.0)));
      col = mix(col, uWall * 0.3 + vec3(0.01, 0.012, 0.018) * (1.0 - f.y), win * (1.0 - lit));
      col += wc * lit * (0.08 + 0.12 * fract(r * 37.0)) * (blinds > 0.0 ? blinds : 1.0);
      // The ground floor: shop windows lit behind their glass, or rolling shutters down.
      float shop = step(vW.y, 2.6) * step(0.3, vW.y);
      float bay = floor(vW.z / 3.5), on = step(0.45, h21(vec2(bay, side + 3.0)));
      float bf = fract(vW.z / 3.5);
      float frame = step(0.06, bf) * step(bf, 0.94);
      vec3 sc = mix(uWarm, texture2D(uCover, vec2(fract(bay * 0.137 + side * 0.3), 0.6), 4.0).rgb * 1.4, 0.5);
      vec3 shutter = uWall * (0.8 + 0.2 * step(0.5, fract(vW.y * 12.0)));
      // (Lit from the ceiling: bright under the fascia, falling off to the floor, a transom bar and a door.)
      float ceil = exp(-(2.6 - vW.y) * 1.6);
      float transom = 1.0 - (1.0 - smoothstep(0.0, 0.03, abs(vW.y - 2.1)));
      float door = step(0.62, bf) * step(bf, 0.8) * step(vW.y, 2.1);
      vec3 inside = sc * (0.025 + 0.11 * ceil) * transom * (1.0 - 0.5 * door);
      col = mix(col, on > 0.5 ? inside : shutter, shop * frame);
    }
    col = mix(uFogC, col, exp(-d * 0.018));
    gl_FragColor = vec4(col, 1.0);
  }`;

const SKY_VERT = /* glsl */ `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY_FRAG = /* glsl */ `
  uniform mat4 uInvVP;
  uniform vec3 uCam, uTop, uGlow;
  varying vec2 vNdc;
  void main() {
    vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
    vec3 d = normalize(w.xyz / w.w - uCam);
    // The far end of the street glows in the cover's colour; the strip of sky above is dark.
    float end = exp(-pow(length(vec2(d.x * 2.0, d.y - 0.03)) * 3.0, 1.4));
    gl_FragColor = vec4(mix(uTop, uGlow, end), 1.0);
  }`;

const BOARD_VERT = /* glsl */ `
  attribute vec4 aBoard;  // centre, width
  attribute vec3 aState;  // height, light (0..1), presence
  uniform float uMirror;
  varying vec2 vQ;
  varying vec3 vState;
  varying vec2 vSize;
  varying float vDepth;
  void main() {
    vQ = position.xy; vState = aState; vSize = vec2(aBoard.w, aState.x);
    vec3 p = aBoard.xyz + vec3(position.x * aBoard.w * 0.5, position.y * aState.x * 0.5, 0.0);
    // Reflected in the wet street: a smear lying on it, from under the board towards the viewer.
    if (uMirror > 0.5) p = vec3(aBoard.x + position.x * aBoard.w * 0.28, 0.012, aBoard.z + (position.y * 0.5 + 0.5) * aBoard.y * 1.8);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vDepth = gl_Position.w;
  }`;
const BOARD_FRAG = /* glsl */ `
  uniform vec3 uFill, uTube, uFogC;
  uniform float uMirror;
  varying vec2 vQ;
  varying vec3 vState;
  varying vec2 vSize;
  varying float vDepth;
  void main() {
    // Distance in from the board's edge (metres).
    vec2 e = (1.0 - abs(vQ)) * vSize * 0.5;
    float edge = min(e.x, e.y);
    float tube = exp(-pow((edge - 0.07) / 0.016, 2.0));
    if (uMirror > 0.5) {
      // The smear: the tube's colour, brightest near the board's foot of the image, soft at the sides, broken by the
      // wet street's ripples.
      float across = exp(-pow(vQ.x * 1.3, 2.0));
      float along = smoothstep(-1.0, -0.7, vQ.y) * (1.0 - smoothstep(-0.7, 1.0, vQ.y));
      float rip = 0.75 + 0.25 * sin(vQ.y * 40.0 + vQ.x * 3.0);
      gl_FragColor = vec4(uTube * across * along * rip * vState.y * 0.13 * exp(-vDepth * 0.02), vState.z);
      return;
    }
    // Lit, the tube glows and its light spills a little over the board.
    vec3 c = uFill + uTube * (tube * (0.1 + 1.2 * vState.y) + vState.y * 0.06 * exp(-edge * 4.0));
    // Far off, the boards sink into the street's haze like the walls.
    c = mix(uFogC, c, exp(-vDepth * 0.018));
    gl_FragColor = vec4(c, vState.z);
  }`;
/** The boards' depth alone (no colour), where they are there: drawn before everything else of the street. */
const BOARD_DEPTH_FRAG = /* glsl */ `
  varying vec3 vState;
  void main() { if (vState.z < 0.5) discard; gl_FragColor = vec4(0.0); }`;

/** The camera's distance along the street at t: a step on every beat, pushed off at its start, gliding the rest. */
function walked(music: Music, t: number): number {
  const pos = music.beatPos(t), i = Math.floor(pos), f = pos - i;
  return STEP * (i + lerp(f, snap(f / 0.4), 0.45));
}

/** A chunk's sign: its words' rough width at the sign's em (shrunk to fit the board, as the gates shrink it). */
function signOf(c: Chunk, words: string[], camZ: number, random: () => number): Sign {
  let w = 0;
  c.words.forEach((i, k) => {
    const s = words[i] ?? '';
    w += (hasCjk(s) ? Array.from(s).length * EM * 1.02 : s.length * EM * 0.56) + (k ? EM * 0.2 : 0);
  });
  w = Math.min(MAXW, w);
  const side = c.ordinal % 2 ? 1 : -1;
  return { x: side * (W - 0.35 - (w + 0.5) / 2), y: 3.4 + random() * 3.2, z: camZ - AHEAD, w: w + 0.5, h: EM * 1.9, start: c.start, end: c.end };
}

export class NeonScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 400);
  private signs: Sign[];
  private gates: LyricGates;
  private boardGeo: THREE.InstancedBufferGeometry;
  private aBoard: THREE.InstancedBufferAttribute;
  private aState: THREE.InstancedBufferAttribute;
  private skyU: Record<string, THREE.IUniform>;
  private wallU: Record<string, THREE.IUniform>[] = [];
  private buzz: Float64Array;
  private tube = new THREE.Color();

  constructor(private init: SceneInit) {
    const { palette, music, lyrics } = init;
    const wall = palette.ink.clone().multiplyScalar(0.18).add(new THREE.Color(0.006, 0.006, 0.01));
    const warm = new THREE.Color(1.0, 0.62, 0.3).lerp(palette.paper, 0.3);
    const glow = palette.accent.clone().lerp(palette.signal, 0.3).multiplyScalar(0.35);
    const fogC = glow.clone().multiplyScalar(0.5).add(wall);
    this.scene.background = wall.clone();

    // The sky strip and the glowing far end.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyU = { uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uTop: { value: wall.clone().multiplyScalar(0.6) }, uGlow: { value: glow } };
    const sky = new THREE.Mesh(tri, new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, depthTest: false, depthWrite: false }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      (this.skyU.uInvVP.value as THREE.Matrix4).multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).invert();
      (this.skyU.uCam.value as THREE.Vector3).copy(camera.position);
    };
    this.scene.add(sky);

    // The two facades and the street, as long as the song walks.
    const length = walked(music, music.duration) + AHEAD + 120;
    const surface = (ground: boolean) => {
      const u = { uCover: { value: init.cover }, uWall: { value: wall }, uWarm: { value: warm }, uFogC: { value: fogC }, uCam: { value: new THREE.Vector3() }, uGround: { value: ground ? 1 : 0 } };
      this.wallU.push(u);
      return new THREE.ShaderMaterial({ vertexShader: FACADE_VERT, fragmentShader: FACADE_FRAG, uniforms: u, side: THREE.DoubleSide });
    };
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(length, 30);
      g.rotateY(side * Math.PI / 2);
      const m = new THREE.Mesh(g, surface(false));
      m.position.set(side * W, 15, 20 - length / 2);
      m.frustumCulled = false;
      this.scene.add(m);
    }
    const gg = new THREE.PlaneGeometry(W * 2, length);
    gg.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(gg, surface(true));
    ground.position.set(0, 0, 20 - length / 2);
    ground.frustumCulled = false;
    this.scene.add(ground);

    // A sign for every chunk of the words, hung ahead of where the walk will be when it begins.
    const random = rng(Math.round(music.duration * 389) ^ 0x2e0);
    this.signs = chunksOf(lyrics).map(c => signOf(c, lyrics.lines[c.line].words.map(w => w.text), -walked(music, c.start), random));
    // Rap comes fast: neighbouring signs on one side would hang over each other. Each takes the first height (from a
    // random start) clear of the signs near it on its side; if none is, it hangs a little further on.
    const LEVELS = [2.7, 3.9, 5.1, 6.3, 7.5];
    this.signs.forEach((s, i) => {
      const side = Math.sign(s.x);
      for (let push = 0; push < 6; push++) {
        const near = this.signs.slice(Math.max(0, i - 12), i).filter(o => Math.sign(o.x) === side && Math.abs(o.z - s.z) < 3.5 + s.w * 0.3);
        const first = Math.floor(random() * LEVELS.length);
        const y = LEVELS.map((_, k) => LEVELS[(first + k) % LEVELS.length]).find(y => near.every(o => Math.abs(o.y - y) > (o.h + s.h) / 2 + 0.25));
        if (y !== undefined) { s.y = y; break; }
        s.z -= 2;
      }
    });
    this.boardGeo = new THREE.InstancedBufferGeometry();
    this.boardGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.boardGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const n = Math.max(1, this.signs.length);
    this.aBoard = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.signs.forEach((s, i) => this.aBoard.setXYZW(i, s.x, s.y, s.z - 0.02, s.w));
    this.boardGeo.setAttribute('aBoard', this.aBoard);
    this.boardGeo.setAttribute('aState', this.aState);
    this.boardGeo.instanceCount = this.signs.length;
    // Neon is saturated: the cover's signal colour at full strength (a cover without colour keeps white neon).
    const tube = this.tube = palette.signal.clone().lerp(palette.accent, 0.3);
    if (!palette.mono) {
      const hsl = { h: 0, s: 0, l: 0 };
      tube.getHSL(hsl);
      if (hsl.s > 0.12) tube.setHSL(hsl.h, Math.max(hsl.s, 0.75), THREE.MathUtils.clamp(hsl.l, 0.5, 0.65));
    }
    // The boards' depth first, an opaque pass: a nearer board hides the boards and words behind it. (The boards are one
    // draw, unsorted, and the words are drawn after all of them: a far sign's words lay over a near board — the user,
    // “这个场景的遮挡关系不对”.) The words are depth-tested too (the gates' `depth`); each sits 2 cm before its board.
    // Twice: once with the street, once with the words — under a look or light trails the words are drawn apart, on a
    // layer of their own (src/render/shots.ts), which only has the depth of what is flagged as words.
    const depth = new THREE.Mesh(this.boardGeo, new THREE.ShaderMaterial({
      vertexShader: BOARD_VERT, fragmentShader: BOARD_DEPTH_FRAG, colorWrite: false, side: THREE.DoubleSide, uniforms: { uMirror: { value: 0 } },
    }));
    depth.frustumCulled = false;
    const depthForWords = depth.clone();
    depthForWords.userData.lyrics = true;
    this.scene.add(depth, depthForWords);
    for (const mirror of [1, 0]) {
      const m = new THREE.Mesh(this.boardGeo, new THREE.ShaderMaterial({
        vertexShader: BOARD_VERT, fragmentShader: BOARD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: mirror ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uFill: { value: wall.clone().multiplyScalar(0.6) }, uTube: { value: tube }, uFogC: { value: fogC }, uMirror: { value: mirror } },
      }));
      m.frustumCulled = false;
      m.renderOrder = mirror ? 1 : 2;
      this.scene.add(m);
    }

    // The words: neon on the boards. (Mirrored in the street they read as words floating upside down: the street only
    // takes the boards' colour, as smears.)
    this.gates = new LyricGates(palette, { style: 'hook', em: EM, maxW: MAXW, trans: { em: 0.2, vertical: false }, linger: AHEAD / 2, depth: true });
    this.scene.add(this.gates.group);
    this.buzz = Float64Array.from(music.a.hits.snare.filter(h => h[1] > 0.5), h => h[0]);
    this.camera.position.set(0, 1.7, 0);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // (A portrait frame: both sides of the street as a square frame sees them, so the signs on the boards stay in.)
    this.camera.fov = fitFov(58, aspect);
    this.camera.updateProjectionMatrix();
  }

  private pose(shot: Shot, t: number, music: Music, eye: THREE.Vector3, target: THREE.Vector3): void {
    const z = -walked(music, t), info = music.at(t), side = rng(shot.seed)() < 0.5 ? -1 : 1;
    const bob = Math.sin(Math.PI * (info.pos % 1)) * 0.04;
    if (shot.variant === 'low') {
      eye.set(side * 0.6, 0.45, z);
      target.set(side * 0.2, 1.6, z - 20);
    } else if (shot.variant === 'up') {
      eye.set(-side * 0.8, 1.5, z);
      target.set(side * 0.5, 6.5, z - 12);
    } else {
      eye.set(Math.sin(t * 0.13) * 0.4, 1.7 + bob, z);
      target.set(Math.sin(t * 0.11) * 0.6, 2.6, z - 20);
    }
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    this.pose(shot, t, music, eye, target);
    this.camera.position.copy(eye);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    for (const u of this.wallU) (u.uCam.value as THREE.Vector3).copy(eye);
    // A snare makes the newest lit sign buzz (a quick flutter of its tube).
    let bi = -1;
    for (let lo = 0, hi = this.buzz.length; lo < hi;) { const mid = (lo + hi) >> 1; if (this.buzz[mid] <= t) { bi = mid; lo = mid + 1; } else hi = mid; }
    const bAge = bi >= 0 ? t - this.buzz[bi] : 99;
    const flutter = bAge < 0.18 ? (Math.floor(bAge / 0.045) % 2 ? 0.35 : 1) : 1;
    let newest = -1;
    const st = this.aState.array as Float32Array;
    this.signs.forEach((s, i) => {
      const lit = smooth((t - s.start + 0.05) / 0.12);
      if (t >= s.start) newest = i;
      // Boards appear out of the dark ahead and are gone once walked past.
      const ahead = eye.z - s.z;
      const presence = smooth((ahead + 0.5) / 1.5) * (1 - smooth((ahead - 60) / 20));
      st[i * 3] = s.h; st[i * 3 + 1] = lit; st[i * 3 + 2] = presence;
    });
    if (newest >= 0) st[newest * 3 + 1] *= flutter;
    this.aState.needsUpdate = true;

    const sign = (c: Chunk) => this.signs[c.ordinal];
    const fadeOf = (s: Sign) => smooth((eye.z - s.z + 0.5) / 1.5);
    this.gates.update(ctx.lyrics, t, shot.section.energy, (c, _t, root) => {
      const s = sign(c);
      if (!s) return 0;
      root.position.set(s.x, s.y, s.z);
      return fadeOf(s) * (c.ordinal === newest ? flutter : 1);
    }, (state, _t, root) => {
      // The translation under the line's newest sign.
      const s = this.signs.filter(x => x.start <= t && x.start >= state.line.start - 0.01 && x.end <= state.line.end + 0.01).pop();
      if (!s) return 0;
      root.position.set(s.x, s.y - s.h * 0.75, s.z);
      return fadeOf(s);
    });
    // (Neon keeps its colour once lit: the hook type fades a sung word back to paper.)
    this.gates.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; m?.color?.lerp(this.tube, 0.5); });
    ctx.fx.bloom = 0.45;
    ctx.fx.vignette = 0.5;
    ctx.fx.grain = 0.05;
  }
}
