// Flip: the cover laid out on a board of square tiles, almost touching, so at rest it is one picture. Every beat (or
// two) a wave crosses the board: each tile lifts towards the camera, rolls over on the axis across the wave's travel
// and drops back, a little past flat and settling, like a split-flap card. Each flip shows the next picture: back to
// the cover on every second flip, otherwise in turn a close-up of the cover and the cover printed in ink and the
// signal colour. A key light from the upper left catches the tiles as they turn; behind the board a dim recess shows
// through where a tile has lifted.
// The words are printed on the board (a LyricLayer, on both faces of every tile), so each wave rolls the letters over
// with the tiles they sit on, like the letters of a split-flap board.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricLayer } from './lyricSpace.ts';

const COLS = 34, ROWS = 20; // larger than the frame, so an angled camera never sees the edge
const VIEW_W = 23.8; // board units across the frame, camera straight on at its usual distance

const vertexShader = /* glsl */ `
  attribute vec2 aTile;
  attribute float aRand;
  uniform vec2 uGrid, uView, uOrigin;
  uniform float uBeat, uPeriod, uSpread, uTurn, uWidth, uLift, uBack, uPattern, uAngle, uReach, uKick, uAlt;
  varying vec3 vN, vWorld;
  varying vec2 vBoard;
  varying float vFace, vImg;
  mat3 rot(vec3 a, float t) {
    float s = sin(t), c = cos(t), o = 1.0 - c;
    return mat3(o*a.x*a.x + c, o*a.x*a.y + a.z*s, o*a.z*a.x - a.y*s,
                o*a.x*a.y - a.z*s, o*a.y*a.y + c, o*a.y*a.z + a.x*s,
                o*a.z*a.x + a.y*s, o*a.y*a.z - a.x*s, o*a.z*a.z + c);
  }
  float ease(float x) {
    x = clamp(x, 0.0, 1.0);
    if (uBack <= 0.0) return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
    x -= 1.0;
    return 1.0 + (uBack + 1.0) * x * x * x + uBack * x * x;
  }
  // The picture shown after s flips: the cover on even counts, otherwise close-up and duotone in turn.
  float img(float s) { return mod(s, 2.0) < 0.5 ? 0.0 : 1.0 + mod(floor(s * 0.5) + uAlt, 2.0); }
  void main() {
    vec2 cell = aTile - uGrid * 0.5 + 0.5;
    vec2 c = cell / uView;
    // When the wave reaches this tile (0..1 of the spread) and the axis it rolls over on.
    float key; vec2 axis;
    if (uPattern < 0.5) {            // a straight front at an angle
      vec2 d = vec2(cos(uAngle), sin(uAngle));
      key = dot(c, d) / (abs(d.x) + abs(d.y)) + 0.5;
      axis = vec2(-d.y, d.x);
    } else if (uPattern < 1.5) {     // a ring from a point
      vec2 d = cell - uOrigin;
      key = length(d) / uReach;
      axis = normalize(vec2(-d.y, d.x) + vec2(1e-4, 0.0));
    } else {                         // row by row from the top, like a departures board
      key = 0.5 - c.y + aRand * 0.05;
      axis = vec2(1.0, 0.0);
    }
    key = clamp(key, 0.0, 1.0);
    // A half turn on an in-plane axis mirrors the tile across it: only an axis along a side or a diagonal brings the
    // square back onto itself (any other leaves it twisted, with holes at the corners). Snap to the nearest of those.
    float aa = floor(atan(axis.y, axis.x) / 0.78539816 + 0.5) * 0.78539816;
    axis = vec2(cos(aa), sin(aa));
    // p: beats from this tile's first flip (its middle); flip n is at p = n·period, turning over uTurn beats.
    float p = uBeat - key * uSpread - uTurn * 0.5;
    float started = p + uTurn * 0.5 >= 0.0 ? floor((p + uTurn * 0.5) / uPeriod) + 1.0 : 0.0;
    float cur = max(started - 1.0, 0.0);
    float ang = 3.14159265 * (started < 0.5 ? 0.0 : cur + ease((p - cur * uPeriod + uTurn * 0.5) / uTurn));
    float n = max(0.0, floor(p / uPeriod + 0.5)), tn = p - n * uPeriod;
    float lift = uLift * exp(-tn * tn / (uWidth * uWidth));
    vec3 A = vec3(axis, 0.0);
    mat3 R = rot(A, ang);
    float grow = 1.0 + 0.06 * lift / max(uLift, 1e-3);
    vec3 world = vec3(cell, lift + uKick * 0.16 * (0.3 + aRand)) + R * position * grow;
    // After an odd number of turns the back faces the camera, mirrored across the axis: sample it unmirrored.
    vFace = normal.z;
    vec2 q = position.xy;
    if (vFace < -0.5) q = 2.0 * dot(axis, q) * axis - q;
    // Front shows the even state of the turn in progress (before / after), back the odd one.
    float s1 = started, s0 = started - 1.0;
    bool even = mod(s1, 2.0) < 0.5;
    vImg = vFace > 0.5 ? img(even ? s1 : s0) : img(even ? s0 : s1);
    vBoard = cell + q;
    vN = R * normal;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uCover, uLyric;
  uniform vec4 uLyricRect;
  uniform float uLyricOn;
  uniform vec3 uSignal, uInk, uPaper;
  uniform vec2 uDetail;
  uniform float uScale;
  varying vec3 vN, vWorld;
  varying vec2 vBoard;
  varying float vFace, vImg;
  vec2 coverUv(vec2 b) { vec2 u = 0.5 + b * uScale; return 1.0 - abs(1.0 - mod(u, 2.0)); } // mirrored past the edges
  vec3 picture(float k) {
    if (k < 0.5) return texture2D(uCover, coverUv(vBoard)).rgb;
    if (k < 1.5) return texture2D(uCover, uDetail + (coverUv(vBoard) - 0.5) * 0.38).rgb;
    vec3 c = texture2D(uCover, coverUv(vBoard)).rgb;
    float l = pow(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.6);
    return mix(mix(uInk, uSignal, smoothstep(0.12, 0.62, l)), uPaper, smoothstep(0.72, 0.98, l));
  }
  void main() {
    vec3 n = normalize(vN);
    vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
    float dif = max(dot(n, L), 0.0);
    if (abs(vFace) < 0.5) { gl_FragColor = vec4(mix(uInk, uPaper, 0.16) * (0.45 + 0.7 * dif), 1.0); return; }
    vec3 V = normalize(cameraPosition - vWorld), H = normalize(L + V);
    // Lit as at rest when flat; brighter turned to the light, darker away. A glint only while turning.
    float shade = 1.0 + 0.65 * (dif - L.z);
    float glint = pow(max(dot(n, H), 0.0), 90.0) * smoothstep(0.02, 0.25, 1.0 - abs(n.z));
    vec3 col = picture(vImg);
    // The words, printed on whichever face is up (rect: centre and size in board units).
    vec2 q = (vBoard - uLyricRect.xy) / uLyricRect.zw + 0.5;
    if (uLyricOn > 0.5 && q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      vec4 w = texture2D(uLyric, q);
      col = col * (1.0 - w.a) + w.rgb;
    }
    gl_FragColor = vec4(col * shade + uPaper * glint * 0.35, 1.0);
  }`;

// Behind the board: the cover, very dim, so a lifted tile opens onto depth rather than a black hole.
const recessFragment = /* glsl */ `
  uniform sampler2D uCover;
  uniform vec3 uInk;
  uniform float uScale;
  varying vec2 vB;
  void main() { vec2 u = 0.5 + vB * uScale; u = 1.0 - abs(1.0 - mod(u, 2.0)); gl_FragColor = vec4(uInk + texture2D(uCover, u).rgb * 0.16, 1.0); }`;
const recessVertex = /* glsl */ `
  varying vec2 vB;
  void main() { vB = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export class Flip implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  private material: THREE.ShaderMaterial;
  private recess: THREE.ShaderMaterial;
  private layer: LyricLayer;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    const box = new THREE.BoxGeometry(0.97, 0.97, 0.05);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    for (const name of ['position', 'normal']) g.setAttribute(name, box.getAttribute(name));
    const tiles = new Float32Array(COLS * ROWS * 2), rand = new Float32Array(COLS * ROWS);
    const random = rng(3);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const k = j * COLS + i; tiles[k * 2] = i; tiles[k * 2 + 1] = j; rand[k] = random(); }
    g.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
    g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
    g.instanceCount = COLS * ROWS;
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uCover: { value: init.cover }, uSignal: { value: palette.signal.clone() }, uInk: { value: palette.ink.clone() }, uPaper: { value: palette.paper.clone() },
        uGrid: { value: new THREE.Vector2(COLS, ROWS) }, uView: { value: new THREE.Vector2(VIEW_W, VIEW_W * 9 / 16) }, uOrigin: { value: new THREE.Vector2() },
        uDetail: { value: new THREE.Vector2(0.5, 0.5) }, uScale: { value: 1 / VIEW_W },
        uBeat: { value: 0 }, uPeriod: { value: 2 }, uSpread: { value: 1 }, uTurn: { value: 0.3 }, uWidth: { value: 0.3 }, uLift: { value: 1 }, uBack: { value: 1.2 },
        uPattern: { value: 0 }, uAngle: { value: 0 }, uReach: { value: 10 }, uKick: { value: 0 }, uAlt: { value: 0 },
        uLyric: { value: null }, uLyricRect: { value: new THREE.Vector4(0, 0, VIEW_W, VIEW_W * 9 / 16) }, uLyricOn: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.recess = new THREE.ShaderMaterial({
      vertexShader: recessVertex, fragmentShader: recessFragment,
      uniforms: { uCover: { value: init.cover }, uInk: { value: palette.ink.clone() }, uScale: { value: 1 / VIEW_W } },
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS), this.recess);
    back.position.z = -0.45;
    this.scene.add(back);
    this.layer = new LyricLayer(palette, look === 'ballad' ? 'poem' : 'hook');
    this.material.uniforms.uLyric.value = this.layer.target.texture;
    this.scene.add(this.layer.token);
    this.scene.onBeforeRender = renderer => {
      this.layer.render(renderer);
      this.material.uniforms.uLyricOn.value = this.layer.on ? 1 : 0;
    };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const soft = this.look === 'ballad', burst = !soft && shot.variant === 'burst';
    const random = rng(shot.seed);
    // Straight on, the frame shows VIEW_W board units across (fewer on a wider screen, so the edge stays out).
    const dist = 25 * Math.min(1, (16 / 9) / ctx.aspect);
    const viewH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2), viewW = viewH * ctx.aspect;
    u.uView.value.set(viewW, viewH);
    u.uScale.value = this.recess.uniforms.uScale.value = 1 / Math.max(viewW, viewH);

    // Beats per wave, how long the front takes to cross, how long one tile turns and lifts, the overshoot. The front
    // is narrow (a quarter of the frame turning at once) and the board rests between waves: a wider front or no rest
    // read as noise.
    u.uPeriod.value = soft ? 4 : burst ? 1 : 2;
    u.uSpread.value = soft ? 2 : burst ? 0.5 : 1;
    u.uTurn.value = soft ? 0.9 : burst ? 0.2 : 0.26;
    u.uWidth.value = soft ? 0.7 : burst ? 0.16 : 0.22;
    u.uLift.value = soft ? 0.6 : burst ? 1 : 1.2;
    u.uBack.value = soft ? 0 : 1.2;
    u.uBeat.value = music.beatPos(t) - music.beatPos(shot.start);
    const pattern = soft ? 0 : burst ? (random() < 0.6 ? 1 : 0) : (random() < 0.5 ? 0 : 2);
    u.uPattern.value = pattern;
    u.uAngle.value = (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 1.6;
    const ox = (random() - 0.5) * viewW * 0.5, oy = (random() - 0.5) * viewH * 0.4;
    u.uOrigin.value.set(ox, oy);
    u.uReach.value = Math.hypot(viewW / 2 + Math.abs(ox), viewH / 2 + Math.abs(oy));
    u.uAlt.value = Math.floor(random() * 2);
    u.uDetail.value.set(0.3 + random() * 0.4, 0.3 + random() * 0.4);
    u.uKick.value = soft ? 0 : music.pulse('kick', t, 0.1);

    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const sign = random() < 0.5 ? -1 : 1;
    const cam = this.camera;
    if (soft) {
      cam.position.set(sign * lerp(1.2, -1.2, k), lerp(0.8, -0.4, k), lerp(dist, dist * 0.92, inOutCubic(k)));
      cam.lookAt(0, 0, 0);
    } else if (burst) {
      // Straight on, pushing in.
      cam.position.set(sign * lerp(0.8, -0.8, k), lerp(0.5, -0.3, k), lerp(dist, dist * 0.86, inOutCubic(k)));
      cam.lookAt(0, 0, 0);
    } else if (random() < 0.5) {
      // From the side, swinging round towards the front.
      const a = sign * lerp(0.32, 0.18, inOutCubic(k));
      cam.position.set(Math.sin(a) * dist, lerp(0.6, 1.6, k), Math.cos(a) * dist);
      cam.lookAt(-sign * 0.8, 0, 0);
    } else {
      // From below, drifting across.
      const a = lerp(0.3, 0.2, inOutCubic(k));
      cam.position.set(sign * lerp(1.6, -1.6, k), -Math.sin(a) * dist, Math.cos(a) * dist);
      cam.lookAt(0, 0.6, 0);
    }
    cam.updateMatrixWorld();
    ctx.fx.bloom = soft ? 0.35 : 0.4;
    // The words over the part of the board a straight-on camera frames.
    this.layer.rig.align = sign > 0 ? 'left' : 'right';
    (u.uLyricRect.value as THREE.Vector4).set(0, 0, viewW, viewH);
    this.layer.update(ctx.lyrics, t, shot.section.energy, viewW, viewH);
  }
}
