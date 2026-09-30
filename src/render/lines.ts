// Hairlines for motion-graphics scenes: 3D segments drawn as quads whose width is set in screen pixels, added
// (glowing) over the frame. Refilled every frame from the CPU; segments crossing the camera plane are clipped.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec3 aColor;
  attribute float aWidth;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vSide;
  void main() {
    vec4 va = modelViewMatrix * vec4(aStart, 1.0);
    vec4 vb = modelViewMatrix * vec4(aEnd, 1.0);
    const float nearZ = -0.06;
    if (va.z > nearZ && vb.z > nearZ) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    if (va.z > nearZ) va = mix(va, vb, (va.z - nearZ) / (va.z - vb.z));
    if (vb.z > nearZ) vb = mix(vb, va, (vb.z - nearZ) / (vb.z - va.z));
    vec4 a = projectionMatrix * va;
    vec4 b = projectionMatrix * vb;
    vec2 d = (b.xy / b.w - a.xy / a.w) * uResolution;
    vec2 n = length(d) > 1e-5 ? normalize(vec2(-d.y, d.x)) : vec2(0.0, 1.0);
    vec4 p = mix(a, b, position.x);
    // One extra pixel each side for the soft edge.
    float w = aWidth * uPixelRatio + 2.0;
    p.xy += n * position.y * (w / uResolution) * p.w;
    vColor = aColor;
    vSide = position.y * w / max(aWidth * uPixelRatio, 0.5);
    gl_Position = p;
  }`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vSide;
  void main() {
    // |vSide| ≤ 1 is the line itself; the extra pixel outside feathers the edge.
    gl_FragColor = vec4(vColor * (1.0 - smoothstep(1.0, 1.9, abs(vSide))), 1.0);
  }`;

export class LineBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private start: THREE.InstancedBufferAttribute;
  private end: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private width: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor(readonly capacity: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aStart', this.start = attr(3));
    g.setAttribute('aEnd', this.end = attr(3));
    g.setAttribute('aColor', this.color = attr(3));
    g.setAttribute('aWidth', this.width = attr(1));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uResolution: { value: new THREE.Vector2(1920, 1080) }, uPixelRatio: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  clear(): void { this.n = 0; }

  get count(): number { return this.n; }

  /** A segment `width` px wide (logical px), colour pre-multiplied by its intensity. */
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number): void {
    if (this.n >= this.capacity || (r + g + b) < 1e-4) return;
    const i = this.n++;
    const s = this.start.array as Float32Array, e = this.end.array as Float32Array, c = this.color.array as Float32Array, w = this.width.array as Float32Array;
    s[i * 3] = ax; s[i * 3 + 1] = ay; s[i * 3 + 2] = az;
    e[i * 3] = bx; e[i * 3 + 1] = by; e[i * 3 + 2] = bz;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    w[i] = width;
  }

  /** Upload what was drawn this frame. `resolution` is the drawing buffer size in device px. */
  commit(resolution: THREE.Vector2, pixelRatio: number): void {
    // (An empty update range would upload the whole buffer.)
    if (this.n > 0) for (const a of [this.start, this.end, this.color, this.width]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = this.n;
    this.mesh.material.uniforms.uResolution.value.copy(resolution);
    this.mesh.material.uniforms.uPixelRatio.value = pixelRatio;
  }
}
