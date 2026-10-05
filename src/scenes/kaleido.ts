// Kaleido: the cover folded into a kaleidoscope — 6, 8 or 12 mirrored segments, an endless zoom in log-polar
// space, hairlines on the segment and band edges. Pulse: holds, then snaps half a segment on every beat
// (the fold count changes on downbeats) and pushes in on kicks. Ballad: turns and drifts slowly.
// The words come out of the middle as arcs, a few at a time, and are carried outwards and round by the zoom and the
// turn like the bands of the pattern; the translation goes the same way round the bottom, a line at a time.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit } from './types.ts';
import { clamp01, outExpo, rng, smooth } from './types.ts';
import { LyricGates } from './lyricSpace.ts';

const vertexShader = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform float uAspect, uSeg, uRot, uZoom, uKick, uLines, uSpiral;
  uniform vec3 uPaper, uInk;
  varying vec2 vP;
  void main() {
    vec2 p = vP * vec2(uAspect, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x) + uRot;
    float seg = 6.2831853 / uSeg;
    float la = mod(a, seg);
    float m = abs(la - seg * 0.5);
    float lr = log(max(r, 1e-3)) * 1.25 - uZoom + uSpiral * a * 0.3;
    float band = fract(lr);
    vec2 uv = vec2(cos(m), sin(m)) * mix(0.06, 0.47, band) + 0.5;
    vec3 col = texture2D(uCover, uv).rgb;
    float edgeA = 1.0 - smoothstep(0.0015, 0.0045, min(la, seg - la) * r);
    float edgeB = 1.0 - smoothstep(0.0, 0.025, min(band, 1.0 - band));
    col = mix(col, uPaper, max(edgeA, edgeB * 0.7) * uLines);
    col *= 0.9 + uKick * 0.2;
    col = mix(col, uInk, smoothstep(0.85, 1.7, r) * 0.65);
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Kaleido implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  private material: THREE.ShaderMaterial;
  private gates: LyricGates;

  constructor(private init: SceneInit, private look: 'pulse' | 'ballad' = 'pulse') {
    const { palette } = init;
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uAspect: { value: 16 / 9 }, uSeg: { value: 6 }, uRot: { value: 0 }, uZoom: { value: 0 },
        uKick: { value: 0 }, uLines: { value: 0.6 }, uSpiral: { value: 0 },
        uPaper: { value: palette.paper.clone() }, uInk: { value: palette.ink.clone() },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);
    this.camera.position.set(0, 0, 10);
    this.gates = new LyricGates(palette, { style: look === 'ballad' ? 'poem' : 'hook', em: 0.46, maxW: 99, arc: 1.5, trans: { em: 0.22, vertical: false, arc: 1.6 }, linger: 8 });
    this.scene.add(this.gates.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uAspect.value = aspect;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    const info = music.at(t);
    const soft = this.look === 'ballad';
    const random = rng((info.bar * 2654435761) ^ shot.seed);
    const seg = soft ? 6 : [6, 8, 12][Math.floor(random() * 3)];
    const kick = soft ? 0 : music.pulse('kick', t, 0.12);
    u.uSeg.value = seg;
    u.uSpiral.value = shot.variant === 'spiral' ? 1 : 0;
    if (soft) {
      u.uRot.value = t * 0.05;
      u.uZoom.value = t * 0.06;
    } else {
      // Hold, then snap half a segment at every beat.
      const i = Math.floor(info.pos), ph = info.pos - i;
      u.uRot.value = (Math.PI / seg) * (i + outExpo(clamp01(ph / 0.3)));
      u.uZoom.value = info.pos * 0.3 + kick * 0.08;
    }
    u.uKick.value = kick;
    u.uLines.value = soft ? 0.35 : 0.55 + kick * 0.4;
    ctx.fx.bloom = soft ? 0.4 : 0.45 + kick * 0.3;
    // The words ride the pattern: from where a chunk begins they grow as the bands do, and once it has been sung they
    // turn as the segments do (in pulse a beat's snap, whatever the fold count) — while sung it stays upright over the
    // top; they fade once they have grown past the frame.
    const grow = (a: number, b: number) => soft ? Math.exp(0.12 * (b - a)) : Math.exp(((music.beatPos(b) - music.beatPos(a)) * 0.3) / 1.25);
    const snap = (x: number) => { const i = Math.floor(music.beatPos(x)), ph = music.beatPos(x) - i; return i + outExpo(clamp01(ph / 0.3)); };
    const turn = (a: number, b: number) => soft ? -0.05 * (b - a) : -(Math.PI / 8) * (snap(b) - snap(a));
    const ride = (from: number, sung: number, root: THREE.Object3D) => {
      const g = grow(from, t);
      root.scale.setScalar(g);
      root.rotation.z = t > sung ? turn(sung, t) : 0;
      return 1 - smooth((g - 2.6) / 0.9);
    };
    this.gates.update(ctx.lyrics, t, shot.section.energy, (c, _t, root) => ride(c.start, c.end, root), (st, _t, root) => ride(st.line.start, st.line.end, root));
  }
}
