// Relief: the album cover rebuilt as a field of columns (colour = pixel, height = brightness), tiled forever.
// The camera flies over it at a speed set in beats, so the flight follows every tempo change; kicks send
// ripples through the field, each bar a scan line sweeps away from the camera, and the sung words stand
// in the air ahead so the camera flies through them just after they are sung.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, outExpo, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { textMesh, hasCjk } from '../render/text.ts';
import type { LineState } from '../director/lyrics.ts';

const N = 192;
const CELL = 0.36;
const W = N * CELL;
const SPEED = 2.4; // world units per beat
const RIPPLES = 8;
const RIDE = 2.0; // a line's banner rides this far ahead (seconds of flight) until the camera catches up
const CLIMB = 2.5; // fastest the camera climbs over (or settles after) the columns, units per second

const vertexShader = /* glsl */ `
  attribute vec2 aCell;
  attribute vec3 aColor;
  attribute float aLum;
  uniform vec2 uOrigin;
  uniform float uHeight, uFlat, uKick, uSink, uIsland;
  uniform vec4 uRipples[${RIPPLES}];
  uniform vec3 uCam;
  varying vec3 vColor, vNormal, vWorld;
  varying float vTop, vRel, vLum;
  // Same curve as Relief.flyer(): the flight line, as x for a world z.
  float pathX(float z) {
    float b = -z / ${SPEED.toFixed(4)};
    return sin(b / 32.0 * 6.2831853) * 3.2 + sin(b / 13.0 * 6.2831853) * 0.8;
  }
  void main() {
    vec2 base = (aCell + 0.5) * ${CELL.toFixed(4)};
    vec2 rel = mod(base - uOrigin + ${(W / 2).toFixed(4)}, ${W.toFixed(4)}) - ${(W / 2).toFixed(4)};
    vec2 xz = uOrigin + rel;
    float h = mix(0.12 + pow(aLum, 1.5) * uHeight, 0.05 + aLum * 0.12, uFlat);
    float r = 0.0;
    for (int k = 0; k < ${RIPPLES}; k++) {
      vec4 rp = uRipples[k];
      if (rp.w <= 0.0) continue;
      float d = length(xz - rp.xy);
      r += exp(-pow((d - rp.z * 11.0) / 1.4, 2.0)) * exp(-rp.z * 1.8) * rp.w;
    }
    // (Ripples die down right round the camera, so a kick never heaves the field up into the lens.)
    r *= smoothstep(1.5, 4.5, length(xz - uCam.xz));
    h += r * (0.8 + uHeight * 0.25) * (1.0 - uFlat * 0.7);
    h *= 1.0 + uKick * 0.3 * aLum * (1.0 - uFlat);
    // A valley along the flight line keeps the camera clear of the columns; the walls either side stay tall.
    float valley = smoothstep(1.3, 4.8, abs(xz.x - pathX(xz.y)));
    h *= mix(mix(0.2, 1.0, valley), 1.0, max(uIsland, uFlat));
    vec3 p = position;
    p.xz *= ${(CELL * 0.9).toFixed(4)};
    p.y *= h;
    float edge = max(abs(rel.x), abs(rel.y)) / ${(W / 2).toFixed(4)};
    vec3 world = vec3(xz.x + p.x, p.y - smoothstep(0.62, 1.0, edge) * uSink, xz.y + p.z);
    // Island mode: everything outside one tile drops away.
    world.y -= step(0.5, uIsland) * step(0.999, edge) * 40.0;
    vWorld = world; vNormal = normal; vColor = aColor; vLum = aLum;
    vTop = step(0.99, position.y); vRel = clamp(position.y, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uFog, uSignal, uCam, uKeyColor;
  uniform float uFogDensity, uKick, uScanZ, uScan, uGlow;
  varying vec3 vColor, vNormal, vWorld;
  varying float vTop, vRel, vLum;
  void main() {
    vec3 n = normalize(vNormal);
    float key = max(dot(n, normalize(vec3(-0.45, 0.8, 0.4))), 0.0);
    float back = pow(max(dot(n, normalize(vec3(0.6, 0.25, -0.75))), 0.0), 2.0);
    vec3 col = vColor * (0.2 + key * 0.7 * uKeyColor) + vColor * back * 0.25;
    col *= mix(0.3, 1.0, vRel) * mix(0.7, 1.0, vTop);
    // Compress the cover's brightest areas so only the signal accents reach the bloom threshold.
    col /= 1.0 + max(col.r, max(col.g, col.b)) * 0.35;
    float band = exp(-pow((vWorld.z - uScanZ) / 0.55, 2.0)) * uScan;
    col += uSignal * (band * (0.6 + vTop * 1.6) + vTop * uKick * uGlow * smoothstep(0.55, 0.95, vLum) * 1.8);
    float d = length(vWorld - uCam);
    col = mix(col, uFog, 1.0 - exp(-pow(d * uFogDensity, 2.0)));
    gl_FragColor = vec4(col, 1.0);
  }`;

interface Banner {
  root: THREE.Group;
  words: Array<{ mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; x: number; y: number }>;
}

export class Relief implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
  private material: THREE.ShaderMaterial;
  private ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4());
  private caption: LyricRig;
  private banners = new Map<number, Banner>();
  private captionFull: LyricRig;
  private lums: Float32Array;

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = box.index;
    geometry.setAttribute('position', box.getAttribute('position'));
    geometry.setAttribute('normal', box.getAttribute('normal'));
    const cells = new Float32Array(N * N * 2), colors = new Float32Array(N * N * 3), lums = new Float32Array(N * N);
    const src = init.coverPixels, S = init.coverSize, c = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const sx = Math.min(S - 1, Math.floor(((i + 0.5) / N) * S)), sy = Math.min(S - 1, Math.floor(((j + 0.5) / N) * S));
      const o = (sy * S + sx) * 4;
      c.setRGB(src[o] / 255, src[o + 1] / 255, src[o + 2] / 255, THREE.SRGBColorSpace);
      cells[k * 2] = i; cells[k * 2 + 1] = j;
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
      lums[k] = 0.2126 * (src[o] / 255) + 0.7152 * (src[o + 1] / 255) + 0.0722 * (src[o + 2] / 255);
    }
    geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aLum', new THREE.InstancedBufferAttribute(lums, 1));
    geometry.instanceCount = N * N;
    this.lums = lums;
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uOrigin: { value: new THREE.Vector2() }, uHeight: { value: 2.4 }, uFlat: { value: 0 }, uKick: { value: 0 },
        uSink: { value: 5 }, uIsland: { value: 0 }, uRipples: { value: this.ripples },
        uFog: { value: palette.ink.clone() }, uSignal: { value: palette.signal.clone() }, uCam: { value: new THREE.Vector3() },
        uKeyColor: { value: palette.paper.clone() }, uFogDensity: { value: 0.045 }, uScanZ: { value: 0 }, uScan: { value: 0 }, uGlow: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.caption = new LyricRig(palette, 'caption', { main: false, translation: true });
    this.captionFull = new LyricRig(palette, 'caption', { main: true, translation: true });
    this.scene.add(this.caption.group, this.captionFull.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Where the flight line is at time t (camera height is added per shot). */
  private flyer(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.init.music.beatPos(t);
    return out.set(Math.sin((b / 32) * Math.PI * 2) * 3.2 + Math.sin((b / 13) * Math.PI * 2) * 0.8, 0, -b * SPEED);
  }

  /**
   * The lowest the camera may fly at (x, z): clear of every column around it, by the vertex shader's own height
   * formula (at full kick, so the limit doesn't jump on the beat). Nearby columns count fully, farther ones less,
   * so the limit changes smoothly as the camera moves.
   */
  private floorAt(x: number, z: number): number {
    const u = this.material.uniforms;
    const height = u.uHeight.value as number, flat = u.uFlat.value as number, island = u.uIsland.value as number;
    const reach = 2.2, n = Math.ceil(reach / CELL);
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let floor = -Infinity;
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
      const cx = (ci + di + 0.5) * CELL, cz = (cj + dj + 0.5) * CELL;
      const dist = Math.max(0, Math.hypot(cx - x, cz - z) - CELL * 0.64);
      if (dist > reach) continue;
      const i = ((ci + di) % N + N) % N, j = ((cj + dj) % N + N) % N;
      const lum = this.lums[j * N + i];
      // (Ripples are left out: the shader flattens them round the camera.)
      let h = lerp(0.12 + Math.pow(lum, 1.5) * height, 0.05 + lum * 0.12, flat);
      h *= 1 + 0.3 * lum * (1 - flat);
      const b = -cz / SPEED;
      const pathX = Math.sin((b / 32) * Math.PI * 2) * 3.2 + Math.sin((b / 13) * Math.PI * 2) * 0.8;
      const valley = smooth((Math.abs(cx - pathX) - 1.3) / 3.5);
      h *= lerp(lerp(0.2, 1, valley), 1, Math.max(island, flat));
      floor = Math.max(floor, h + 0.8 - Math.max(0, dist - 0.35));
    }
    return floor;
  }

  /**
   * How high the camera must be lifted at t to clear the columns, as a pilot would fly it: the shot's own path is
   * looked at a second and a half either way (at fixed steps of song time, so nothing shimmers as t moves), and the
   * lift is the lowest curve that clears all of it while climbing or settling no faster than CLIMB units a second —
   * so the camera starts up before a tall stretch and eases down after it (averaged over a few frames so it turns
   * softly) instead of hopping over each column as it passes.
   */
  private lift(t: number, shot: Shot, air: number): number {
    const G = 0.1, reach = 1.5, needs = new Map<number, number>();
    const need = (j: number) => {
      let v = needs.get(j);
      if (v === undefined) {
        const q = this.pose(Math.min(shot.end, Math.max(shot.start, j * G)), shot).pos;
        v = Math.max(0, this.floorAt(q.x, q.z) + air - q.y);
        needs.set(j, v);
      }
      return v;
    };
    const envelope = (at: number) => {
      let best = 0;
      for (let j = Math.ceil((at - reach) / G); j * G <= at + reach; j++) best = Math.max(best, need(j) - CLIMB * Math.abs(j * G - at));
      return best;
    };
    return (envelope(t - 0.12) + 2 * envelope(t) + envelope(t + 0.12)) / 4;
  }

  /** The shot's framing at time t, before the lift, the beat's punch and the shake. */
  private pose(t: number, shot: Shot) {
    const p = this.flyer(t);
    const ahead = this.flyer(t + 0.6);
    const dir = ahead.clone().sub(p).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const shotLen = Math.max(0.2, shot.end - shot.start);
    const k = clamp01((t - shot.start) / shotLen);
    const random = rng(shot.seed);
    const side = random() < 0.5 ? -1 : 1;
    let fov = 55, flat = 0, island = 0, origin = new THREE.Vector2(p.x, p.z - W * 0.22);
    const pos = new THREE.Vector3(p.x, 4.2, p.z);
    const look = new THREE.Vector3();
    // bank: flying along the line (the look rides with the camera); the others look at the line from off it.
    let bank = true;
    const lookAlong = (pitch: number) => look.copy(pos).addScaledVector(dir, Math.cos(pitch) * 10).add(new THREE.Vector3(0, Math.sin(pitch) * 10, 0));
    switch (shot.variant) {
      case 'rise': {
        // Pull up from the field to the whole cover, which settles into a flat, readable image floating in the dark.
        const from = this.flyer(shot.start);
        const tileX = (Math.floor(from.x / W) + 0.5) * W, tileZ = (Math.floor(from.z / W) + 0.5) * W;
        const e = inOutCubic(k);
        flat = smooth((k - 0.25) / 0.5);
        island = 1;
        origin = new THREE.Vector2(tileX, tileZ);
        pos.set(lerp(p.x, tileX, e), lerp(6, 56, e), lerp(p.z, tileZ, e));
        look.copy(pos).add(new THREE.Vector3(0, Math.sin(lerp(-0.45, -1.55, e)) * 10, -Math.cos(lerp(-0.45, -1.55, e)) * 10));
        fov = 45;
        bank = false;
        break;
      }
      case 'dive': {
        const e = outExpo(k * 1.6);
        pos.y = lerp(11, 3.6, e);
        lookAlong(lerp(-0.62, -0.18, e));
        fov = lerp(48, 58, e);
        break;
      }
      case 'low': {
        // Skimming the valley floor, looking slightly up at the walls.
        pos.y = 1.25;
        lookAlong(0.07);
        fov = 66;
        break;
      }
      case 'crane': {
        pos.copy(p).addScaledVector(dir, -5).setY(lerp(11, 13.5, k));
        look.copy(p).addScaledVector(dir, 9);
        fov = 50;
        bank = false;
        break;
      }
      case 'side': {
        // Tracking alongside the flight line from above one wall.
        pos.copy(p).addScaledVector(right, 7 * side).addScaledVector(dir, 2).setY(3.6);
        look.copy(p).addScaledVector(dir, 4).setY(1.4);
        fov = 46;
        bank = false;
        break;
      }
      case 'orbit': {
        const a = random() * Math.PI * 2 + k * Math.PI * 0.8 * side;
        pos.copy(p).add(new THREE.Vector3(Math.cos(a) * 6.5, 3.2, Math.sin(a) * 6.5));
        look.copy(p).addScaledVector(dir, 2).setY(1.6);
        fov = 52;
        bank = false;
        break;
      }
      default:
        lookAlong(-0.2);
    }
    return { p, pos, look, fov, flat, island, origin, bank, k };
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const u = this.material.uniforms;
    const info = music.at(t);
    const energy = shot.section.energy;
    const kick = music.pulse('kick', t, 0.14);
    // How far into a section that rises into a louder one: drives the heat-up.
    const next = music.a.sections[shot.sectionIndex + 1];
    const build = next && next.energy > shot.section.energy + 0.08 && shot.section.label !== 'intro'
      ? smooth((t - shot.section.start) / Math.max(1, shot.section.end - shot.section.start)) : 0;
    // The field's height for this shot first: the camera's clearance is worked out against it.
    u.uHeight.value = 1.6 + energy * 2.2;
    const framing = this.pose(t, shot);
    const { p, pos, look, flat, island, origin, bank, k } = framing;
    let fov = framing.fov;
    const cam = this.camera;
    // Downbeat punch, the bob of the beat, and (while heating up) a widening lens and a shake.
    fov -= info.inBar < 1 ? Math.exp(-info.inBar * 6) * 2.5 * (0.4 + energy) : 0;
    fov += build * 12;
    pos.y += Math.sin(info.pos * Math.PI) * 0.06 + kick * 0.05;
    const shake = build * build * 0.14 + kick * build * 0.1;
    pos.x += (Math.sin(t * 37.1) + Math.sin(t * 23.3)) * shake * 0.5;
    pos.y += (Math.sin(t * 31.7) + Math.sin(t * 19.9)) * shake * 0.5;

    // Keep the camera clear of the field: whatever the shot, it climbs over the columns ahead in one smooth move
    // instead of passing through them. (Shots off the line sit over a wall: more air under them, so its tops don't
    // fill the frame.)
    u.uFlat.value = flat;
    u.uIsland.value = island;
    this.updateRipples(t, energy, build);
    if (shot.variant !== 'rise') {
      const lift = this.lift(t, shot, bank ? 0.15 : 1.4);
      pos.y += lift;
      if (bank) look.y += lift;
    }

    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (bank) cam.rotateZ(-(this.flyer(t + 0.35).x - this.flyer(t - 0.35).x) * 0.06);

    // Heat: the air turns towards the signal colour and the scan line goes from once a bar to every beat.
    u.uFog.value.copy(palette.ink).lerp(palette.signal, build * 0.16);
    (this.scene.background as THREE.Color).copy(palette.ink).lerp(palette.signal, build * 0.08);
    u.uKeyColor.value.copy(palette.paper).lerp(palette.signal, build * 0.45);
    u.uOrigin.value.copy(origin);
    u.uKick.value = kick;
    u.uSink.value = island ? 0 : 6;
    u.uCam.value.copy(cam.position);
    u.uFogDensity.value = shot.variant === 'rise' ? lerp(0.03, 0.006, smooth(k * 1.4)) : shot.variant === 'crane' ? 0.018 : 0.026;
    const perBeat = build > 0.45;
    const scanPhase = perBeat ? info.phase : info.barPhase;
    u.uScanZ.value = p.z - scanPhase * (perBeat ? 16 : 34);
    u.uScan.value = (1 - scanPhase) * (0.4 + energy * 0.9 + build * 0.6);
    u.uGlow.value = 0.6 + energy + build * 0.6;
    ctx.fx.bloom = 0.28 + energy * 0.22 + build * 0.15;
    ctx.fx.ca = build * build * 0.5 + kick * build * 0.4;
    // Through the closing outro the picture dims to a quarter (the closing credits stand over it).
    ctx.fx.fade = 0.75 * smooth(music.endingProgress(t));

    // Banners stand across the flight line facing along it, so only shots flying down the line can read them;
    // the others set the line as a caption.
    const banners = shot.variant === 'fly' || shot.variant === 'dive' || shot.variant === 'low';
    this.updateBanners(ctx, banners);
    this.caption.group.visible = banners;
    this.captionFull.group.visible = !banners;
    (banners ? this.caption : this.captionFull).update(cam, ctx.lyrics, t, ctx.aspect, energy);
  }

  /** Ripples from the latest kicks, centred on the path ahead of where the camera was. */
  private updateRipples(t: number, energy: number, build: number): void {
    const hits = this.init.music.hitsBetween('kick', t - 1.5, t + 1e-3).filter(h => h[1] > 0.3).slice(-RIPPLES);
    for (let i = 0; i < RIPPLES; i++) {
      const h = hits[i];
      if (!h) { this.ripples[i].set(0, 0, 0, 0); continue; }
      const at = this.flyer(h[0] + 1.2);
      const jitter = rng(Math.floor(h[0] * 1000))();
      this.ripples[i].set(at.x + (jitter - 0.5) * 6, at.z, t - h[0], h[1] * (0.5 + energy + build * 0.5));
    }
  }

  private buildBanner(state: LineState): Banner {
    const root = new THREE.Group();
    root.userData.lyrics = true;
    const cjk = hasCjk(state.line.text);
    const h = cjk ? 0.78 : 0.72, gap = cjk ? h * 0.1 : h * 0.3, maxW = 10;
    const meshes = state.line.words.map(w => textMesh(w.text, 'display', h, { px: 180 }));
    const widths = meshes.map(m => m.userData.width as number);
    const rows: number[][] = [[]];
    let acc = 0;
    widths.forEach((w, i) => {
      if (acc > 0 && acc + w > maxW) { rows.push([]); acc = 0; }
      rows[rows.length - 1].push(i);
      acc += w + gap;
    });
    const lineH = h * (cjk ? 1.3 : 1.14);
    const words: Banner['words'] = [];
    rows.forEach((row, r) => {
      const rowW = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
      let x = -rowW / 2;
      for (const i of row) {
        const mesh = meshes[i];
        // Wider than the valley, a banner reaches into the walls: draw it over them so no word is hidden.
        mesh.material.depthWrite = false;
        mesh.material.depthTest = false;
        mesh.renderOrder = 5;
        root.add(mesh);
        words[i] = { mesh, x, y: ((rows.length - 1) * lineH) / 2 - r * lineH };
        x += widths[i] + gap;
      }
    });
    this.scene.add(root);
    return { root, words };
  }

  /**
   * Each line stands across the flight line as a banner of words, revealed word by word as sung. It rides
   * RIDE seconds ahead of the camera, then holds still for the last stretch so the camera flies through it
   * just after the line ends.
   */
  private updateBanners(ctx: FrameCtx, enabled: boolean): void {
    const { t, lyrics, palette } = ctx;
    const live = new Set<number>();
    if (enabled) {
      const lines = lyrics.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const pass = line.end + 0.3;
        if (t < line.start - 0.6 || t > pass + 0.1) continue;
        live.add(i);
        const state = lyrics.state(i, t);
        const b = this.banners.get(i) ?? this.banners.set(i, this.buildBanner(state)).get(i)!;
        const tb = Math.min(t + RIDE, pass);
        const at = this.flyer(tb);
        const dir = this.flyer(tb + 0.2).sub(this.flyer(tb - 0.2));
        const rise = outExpo((t - (line.start - 0.6)) / 0.5);
        b.root.position.set(at.x, 3.9 - (1 - rise) * 3, at.z);
        b.root.rotation.set(0, Math.atan2(dir.x, dir.z) + Math.PI, 0);
        b.root.scale.setScalar(Math.min(1, ctx.aspect / 1.5));
        const dist = this.camera.position.distanceTo(b.root.position);
        const near = clamp01((dist - 0.6) / 2.6);
        state.words.forEach((ws, wi) => {
          const g = b.words[wi];
          if (!g) return;
          const shown = ws.age > -0.05;
          g.mesh.visible = shown;
          if (!shown) return;
          const k = outExpo((ws.age + 0.05) / 0.18);
          g.mesh.position.set(g.x, g.y + (1 - k) * 0.4, (1 - k) * 0.6);
          const glow = ws.progress > 0 && ws.progress < 1 ? 1 : Math.exp(-Math.max(0, ws.age - (ws.word.end - ws.word.start)) / 0.3);
          g.mesh.material.color.copy(palette.paper).multiplyScalar(0.9).lerp(palette.signal, glow).multiplyScalar(1 + glow * 0.35);
          g.mesh.material.opacity = k * near * rise;
        });
      }
    }
    for (const [i, b] of this.banners) {
      if (live.has(i)) continue;
      this.scene.remove(b.root);
      for (const g of b.words) if (g) { g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
      this.banners.delete(i);
    }
  }
}
