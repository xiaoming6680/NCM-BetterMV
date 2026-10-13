// Cards: the opening — the song read out as one lit object. (It was hairlines on a Swiss grid, a step a beat, five
// readouts in five corners; the user: “不够高级”.) The whole song is wrapped into a ring of light standing on dark
// glass: once round is the whole song, a pillar's height is how loud it is there, the choruses and drops stand in
// the signal colour, a gap parts each section from the next, and the playhead burns where the song is now. The
// song's armillary floats over the middle of it, a pool of the cover's colour on the floor, and the camera drifts round
// and in. Beside it, set large and quiet: the title, the artists and four figures (tempo, metre, length, sections).
// Over the intro's first one or two bars:
//   first half   the ring draws itself round from the playhead, its pillars rising as the head passes; the title
//                and the artists come up
//   second half  the armillary swings together over the ring, landing on the bar line; the figures come up
//   to the end   it holds, still drifting in, and the cut pushes on through into the first plate
// All of it is the analysis itself; nothing flickers or slams. Laid out inside the intro's 2.39:1 letterbox.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, lerp, smooth, surge } from './types.ts';
import { textMesh, hasCjk, type Face } from '../render/text.ts';
import { LineBatch } from '../render/lines.ts';
import { Armillary } from '../sigil/armillary.ts';
import { lastIndex } from '../director/music.ts';

type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
const FOV = 26;
/** The type sits on a plane this far in front of the camera, which the frame shows 2 units tall. */
const UI_Z = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
/** How far right of the frame's middle the object sits (in NDC, by shifting the lens); the type is to its left. */
const SHIFT = 0.36;
const PILLARS = 168;
const R = 1, H = 0.5;
/** The gap between two sections round the ring (rad). */
const GAP = 0.045;
const ARM_Y = 0.5, ARM_S = 0.42;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A soft round glow, added over the frame. */
function glow(color: THREE.Color, k: number): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color.clone() }, uK: { value: k } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec2 vUv;
      void main() { float d = length(vUv - 0.5) * 2.0, g = max(0.0, 1.0 - d * d); gl_FragColor = vec4(uColor * uK * g * g * g, 1.0); }`,
  }));
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/** The title as set: the name (one or two lines) and what follows it in brackets or after a dash, smaller. */
function splitTitle(title: string): { name: string; sub: string } {
  const m = title.match(/^(.+?)\s*([(（\[【].*|\s[-–—]\s.*)$/);
  return m && m[1].trim() ? { name: m[1].trim(), sub: m[2].replace(/^\s*[-–—]\s*/, '').trim() } : { name: title, sub: '' };
}

/** Breaks a line in two near its middle (between words; anywhere for CJK). */
function breakLine(s: string): [string, string] {
  if (hasCjk(s) && !/\s/.test(s)) { const c = Array.from(s), h = Math.ceil(c.length / 2); return [c.slice(0, h).join(''), c.slice(h).join('')]; }
  const words = s.split(/\s+/);
  let best = 1, bestD = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < bestD) { bestD = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export class CardsScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 100);
  private lines = new LineBatch(6000);
  /** The type, fixed to the lens. */
  private ui = new THREE.Group();
  private arm: Armillary;
  private aspect = 16 / 9;
  private resolution = new THREE.Vector2(1920, 1080);
  private pixelRatio = 1;
  /** Per pillar: its height (0..1), its angle round the ring, and whether it stands in a chorus or a drop. */
  private height = new Float32Array(PILLARS);
  private angle = new Float32Array(PILLARS);
  private loud = new Uint8Array(PILLARS);
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private titleLines: Mesh[] = [];
  private sub: Mesh | null = null;
  private artists: Mesh;
  private figures: Array<{ value: Mesh; label: Mesh }> = [];
  /** The angle round the ring of a moment of the song. */
  private angleOf: (time: number) => number;

  constructor(init: SceneInit) {
    const { palette, music } = init;
    const a = music.a;
    this.scene.background = palette.ink.clone();
    this.scene.add(this.camera);
    this.camera.add(this.ui);
    this.ui.position.z = -UI_Z;

    // The loudness under each pillar: mostly its loudest moment, a little of its mean, opened up by a power.
    const e = a.env.rms, per = e.length / PILLARS, raw = new Float32Array(PILLARS);
    let top = 1e-6;
    for (let i = 0; i < PILLARS; i++) {
      let m = 0, sum = 0, n = 0;
      for (let k = Math.floor(i * per); k < Math.min(e.length, Math.floor((i + 1) * per)); k++) { m = Math.max(m, e[k]); sum += e[k]; n++; }
      raw[i] = 0.65 * m + 0.35 * (n ? sum / n : 0);
      top = Math.max(top, raw[i]);
    }
    const secs = a.sections, span = Math.PI * 2 - GAP * Math.max(1, secs.length);
    const at = (time: number) => {
      let j = 0;
      while (j + 1 < secs.length && time >= secs[j + 1].start) j++;
      return { angle: (time / a.duration) * span + (j + 0.5) * GAP, j };
    };
    this.angleOf = (time: number) => at(time).angle;
    for (let i = 0; i < PILLARS; i++) {
      const p = at(((i + 0.5) / PILLARS) * a.duration);
      this.height[i] = Math.pow(raw[i] / top, 1.5);
      this.angle[i] = p.angle;
      const label = secs[p.j]?.label;
      this.loud[i] = label === 'chorus' || label === 'drop' ? 1 : 0;
    }

    // The light: a pool of the cover's colour on the floor inside the ring. (A glow behind the armillary as well
    // reached the letterbox, which cut it flat.)
    this.pool = glow(palette.signal, 0.1);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.scale.setScalar(R * 3.2);
    this.scene.add(this.pool);

    this.arm = new Armillary(init.armillary, palette, init.cover, init.title);
    this.scene.add(this.arm.group, this.lines.mesh);

    // The type.
    const mk = (s: string, face: Face, h: number, px = 128) => {
      const m = textMesh(s, face, h, { px, halo: 'none' });
      m.material.toneMapped = false;
      m.material.depthTest = false;
      m.renderOrder = 10;
      m.visible = false;
      this.ui.add(m);
      return m;
    };
    const maxW = this.columnWidth(init.aspect);
    const { name, sub } = splitTitle(init.title || '正在播放');
    // The name on one line, a size or so smaller if need be; only a name that would have to shrink further than
    // that breaks onto two lines (a short CJK name never does: it shrinks).
    const one = mk(name, 'bold', 0.15, 200);
    const cjkShort = hasCjk(name) && Array.from(name).length <= 10;
    if ((one.userData.width as number) * 0.78 > maxW && !cjkShort) {
      this.ui.remove(one);
      const [l1, l2] = breakLine(name);
      this.titleLines = [mk(l1, 'bold', 0.13, 200), mk(l2, 'bold', 0.13, 200)];
    } else this.titleLines = [one];
    if (sub) this.sub = mk(sub, 'light', 0.058);
    this.artists = mk((init.artists ?? []).join(' / ') || ' ', 'bold', 0.056);
    this.figures = [
      [String(Math.round(a.namedBpm ?? a.bpm)), 'BPM'],
      [`${a.meter}/4`, '拍号'],
      [fmt(a.duration), '时长'],
      [String(secs.length), '段落'],
    ].map(([v, l]) => ({ value: mk(v, 'light', 0.12, 200), label: mk(l, 'bold', 0.04) }));
    this.resize(init.aspect);
  }

  /** How much further back the camera stands in a frame narrower than 16:9, so the ring keeps clear of the type. */
  private static back(aspect: number): number { return Math.max(1, 1.72 / aspect); }

  /** How wide the type may run: from the left margin to just short of the ring. */
  private columnWidth(aspect: number): number {
    return (SHIFT * aspect - 0.85 / CardsScene.back(aspect)) - (-aspect + 0.26) - 0.1;
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.resolution.set(width, height);
    this.pixelRatio = pixelRatio;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const { paper, signal } = palette;
    const a = music.a, info = music.at(t), beat = 60 / Math.max(40, info.bpm);
    const D = Math.max(1, shot.end - shot.start), s = t - shot.start, half = D / 2;
    const L = this.lines;
    L.clear();

    // The camera: drifting round the ring and in over the whole shot, at an even pace (it is already moving on the
    // first frame, so nothing starts with a jolt); the lens shifted so the object sits right of the middle.
    const u = clamp01(s / D);
    const az = lerp(-0.34, 0.06, u), el = lerp(0.27, 0.21, u), dist = lerp(6.1, 5.3, u) * CardsScene.back(this.aspect);
    const ty = 0.3;
    const cam = this.camera;
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    cam.lookAt(0, ty, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -SHIFT;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    // Front-on is where the camera is: the near side of the ring reads brighter than the far side.
    const fx0 = Math.sin(az), fz0 = Math.cos(az);


    // The ring draws itself round from the playhead (the song's start) over most of the first half.
    const s0 = Math.min(0.15, D * 0.03), sw = Math.max(1.1, half * 0.9);
    const head = clamp01((s - s0) / sw), eased = (1 - Math.cos(Math.PI * head)) / 2;
    const reach = eased * (Math.PI * 2);
    // The light on the floor comes up as the ring is drawn round it.
    this.pool.material.uniforms.uK.value = 0.12 * smooth(eased * 1.3);
    // (Widths in pixels at 720p, scaled with the frame so the picture is the same at any size.)
    const px = Math.max(1, this.resolution.y / this.pixelRatio / 720), W = 2 * px;
    const seg = (ax: number, ay: number, az2: number, bx: number, by: number, bz: number, w: number, c: THREE.Color, k: number) => {
      if (k > 0.004) L.seg(ax, ay, az2, bx, by, bz, w, c.r * k, c.g * k, c.b * k);
    };
    const near = (x: number, z: number) => 0.4 + 0.6 * (0.5 + 0.5 * (x * fx0 + z * fz0) / R);
    // Seen edge-on at the sides, the pillars line up and their light piles up: thinned out there.
    const side = (x: number, z: number) => 0.2 + 0.8 * Math.abs(x * fx0 + z * fz0) / R;

    // The floor: a faint circle through the pillars' feet.
    const CIRC = 160;
    for (let k = 0; k < CIRC; k++) {
      const a0 = (k / CIRC) * Math.PI * 2, a1 = ((k + 1) / CIRC) * Math.PI * 2;
      if (a0 > reach) break;
      const x0 = Math.sin(a0) * R, z0 = Math.cos(a0) * R, x1 = Math.sin(a1) * R, z1 = Math.cos(a1) * R;
      seg(x0, 0, z0, x1, 0, z1, 1, paper, 0.16 * near(x0, z0));
    }

    // Once the ring is whole, each downbeat sends a swell out both ways round it from the playhead, meeting on the
    // far side a bar later: the pillars it passes lift a little and brighten, then settle.
    const here = this.angleOf(Math.min(a.duration, t));
    const di = lastIndex(music.downbeats, t), down = di >= 0 ? music.downbeats[di] : -1;
    const drawn = shot.start + s0 + sw;
    const swell = down >= drawn ? clamp01((t - down) / (beat * a.meter)) : 1;
    const swellAt = (ang: number) => {
      if (swell >= 1) return 0;
      let d = Math.abs(ang - here) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const x = (d - swell * Math.PI) / 0.42;
      return Math.exp(-x * x) * Math.sin(Math.PI * Math.min(1, swell * 1.15));
    };
    // The pillars: rising as the head passes, brightening up their length to a bright tip, reflected in the floor.
    const ageOf = (ang: number) => ((reach - ang) / (Math.PI * 2)) * sw;
    for (let i = 0; i < PILLARS; i++) {
      const ang = this.angle[i];
      if (ang > reach) continue;
      const rise = surge(ageOf(ang), 0.07);
      const lift = swellAt(ang);
      const h = H * (0.04 + 0.96 * this.height[i]) * rise * (1 + 0.28 * lift) + H * 0.06 * lift;
      const x = Math.sin(ang) * R, z = Math.cos(ang) * R;
      const w = W, c = this.loud[i] ? signal : paper;
      const k = near(x, z) * side(x, z) * (this.loud[i] ? 1.2 : 0.65) * (0.55 + 0.45 * this.height[i]) * (1 + 0.9 * lift);
      seg(x, 0, z, x, h * 0.4, z, w, c, k * 0.3);
      seg(x, h * 0.4, z, x, h * 0.8, z, w, c, k * 0.6);
      seg(x, h * 0.8, z, x, h * 0.97, z, w, c, k * 0.9);
      seg(x, h * 0.97, z, x, h, z, w, c, k * 1.7);
      seg(x, 0, z, x, -h * 0.22, z, w, c, k * 0.12);
      seg(x, -h * 0.22, z, x, -h * 0.45, z, w, c, k * 0.04);
    }
    // The head while it draws, then the playhead: where the song is now, a touch taller, brightening on the kicks.
    if (head > 0 && head < 1) {
      const x = Math.sin(reach) * R, z = Math.cos(reach) * R;
      seg(x, 0, z, x, H * 1.05, z, W, signal, 1.4 * (1 - smooth((head - 0.85) / 0.15)));
    }
    if (head > 0) {
      const x = Math.sin(here) * R, z = Math.cos(here) * R;
      const kick = music.pulse('kick', t, 0.18), k = (1.3 + 0.7 * kick) * smooth(s / 0.3);
      seg(x, 0, z, x, H * 1.15, z, W * 1.2, signal, k);
      seg(x * 0.94, 0, z * 0.94, x * 1.08, 0, z * 1.08, W * 1.2, signal, k);
    }

    // The armillary swings together over the ring, landing on the bar line halfway through.
    const openFrom = half - Math.max(0.9, beat * 1.6);
    const open = clamp01((s - openFrom) / (half - openFrom));
    const arm = this.arm;
    arm.group.position.set(0, ARM_Y, 0);
    arm.group.scale.setScalar(ARM_S);
    arm.set({ turn: t * 0.35, beat: info.pos, bar: open >= 1 ? info.barPhase : 0, whirl: 0, open, align: 0, recede: 0, merge: 0, pulse: music.pulse('kick', t, 0.12), alpha: open > 0 ? 1 : 0 });
    if (open > 0) arm.lines(L, 1.3 * px, 1, cam.position);
    L.commit(this.resolution, this.pixelRatio);

    // The type: up from below and in, one after another (never slammed).
    const A = this.aspect, x0 = -A + 0.26 - SHIFT * A;
    const show = (m: Mesh, x: number, y: number, from: number, color: THREE.Color, k: number) => {
      const p = smooth((s - from) / 0.6);
      m.visible = p > 0.005;
      m.position.set(x, y - 0.03 * (1 - p), 0);
      m.material.color.copy(color).multiplyScalar(k);
      m.material.opacity = p;
    };
    const tFrom = Math.min(0.5, D * 0.08), maxW = this.columnWidth(A);
    // Laid out top down, then the whole block centred on the frame's middle.
    const fit = (m: Mesh) => { m.scale.setScalar(Math.min(1, maxW / (m.userData.width as number))); return m; };
    const lh = this.titleLines.length > 1 ? 0.15 : 0.17;
    const rows: Array<[Mesh, number, number, number]> = [];
    let y = 0;
    this.titleLines.forEach((m, i) => { rows.push([fit(m), y, tFrom + i * 0.08, 1]); y -= lh; });
    y += lh - 0.12;
    if (this.sub) { rows.push([fit(this.sub), y, tFrom + 0.14, 0.6]); y -= 0.085; }
    rows.push([fit(this.artists), y, tFrom + 0.22, 0.62]);
    const figY = y - 0.27, mid = (0 + 0.075 - (figY - 0.13)) / 2, dy = mid - 0.075 + 0.02;
    for (const [m, yy, from, k] of rows) show(m, x0, yy + dy, from, paper, k);
    // The figures, in a row under it, each its value large and light over a small label (all smaller if the row
    // would run into the ring).
    const cols = this.figures.map(({ value, label }) => Math.max(value.userData.width as number, label.userData.width as number));
    const row = cols.reduce((sum, c) => sum + c, 0) + 0.15 * (cols.length - 1), f = Math.min(1, maxW / row);
    let fx = x0;
    const fFrom = half + 0.05;
    this.figures.forEach(({ value, label }, i) => {
      const from = fFrom + i * 0.1;
      value.scale.setScalar(f);
      label.scale.setScalar(f);
      show(value, fx, figY + dy, from, paper, 0.95);
      show(label, fx + 0.006 * f, figY + dy - 0.115 * f, from + 0.05, paper, 0.5);
      fx += (cols[i] + 0.15) * f;
    });

    ctx.fx.bloom = 0.38;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.035;
  }
}
