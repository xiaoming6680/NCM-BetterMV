// An oscilloscope's electron beam (after m1el's woscope): the trace is a Gaussian spot swept along each segment between
// two consecutive samples, every segment taking the same time, so a pixel's light is the exact integral of the spot
// over the segment divided by its length. Where the beam moves slowly (short segments) it glows bright, where it jumps
// it is barely there, and where it rests it burns a dot — what a phosphor screen shows, unlike lines of one weight.
// Segments are instanced quads in the screen's own plane (local x, y), added together.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec4 aSeg;   // start x, y, end x, y
  attribute float aEnergy;
  uniform float uSigma;
  varying vec3 vL;       // along, across, length
  varying float vE;
  void main() {
    vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
    float r = 3.0 * uSigma;
    // position.x: 0 at the start, 1 at the end; position.y: −1 / +1 across.
    float along = position.x * len + (position.x * 2.0 - 1.0) * r;
    vec2 p = a + dir * along + nrm * position.y * r;
    vL = vec3(along, position.y * r, len);
    vE = aEnergy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform float uSigma;
  uniform vec3 uColor;
  varying vec3 vL;
  varying float vE;
  float erf(float x) { // Abramowitz & Stegun 7.1.26
    float s = sign(x); x = abs(x);
    float t = 1.0 / (1.0 + 0.3275911 * x);
    return s * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x));
  }
  void main() {
    float L = max(vL.z, 1e-5), k = 0.70710678 / uSigma;
    float along = 0.5 * (erf((L - vL.x) * k) + erf(vL.x * k)) / L;
    float I = vE * uSigma * along * exp(-vL.y * vL.y / (2.0 * uSigma * uSigma));
    // A burnt-in spot turns white at its core, as an overdriven phosphor does.
    gl_FragColor = vec4(uColor * I + vec3(0.6) * max(0.0, I - 1.2), 1.0);
  }`;

export class BeamBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private seg: Float32Array;
  private energy: Float32Array;
  private n = 0;

  constructor(private capacity: number, color: THREE.Color, sigma: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.seg = new Float32Array(capacity * 4);
    this.energy = new Float32Array(capacity);
    g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(this.seg, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aEnergy', new THREE.InstancedBufferAttribute(this.energy, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: { uSigma: { value: sigma }, uColor: { value: color.clone() } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }

  get color(): THREE.Color { return this.mesh.material.uniforms.uColor.value as THREE.Color; }
  set sigma(s: number) { this.mesh.material.uniforms.uSigma.value = s; }

  clear(): void { this.n = 0; }

  /** One stretch of the beam's path, carrying `energy` (the light of one sample's time). */
  add(ax: number, ay: number, bx: number, by: number, energy: number): void {
    if (this.n >= this.capacity || energy <= 0) return;
    const o = this.n * 4;
    this.seg[o] = ax; this.seg[o + 1] = ay; this.seg[o + 2] = bx; this.seg[o + 3] = by;
    this.energy[this.n++] = energy;
  }

  commit(): void {
    const g = this.mesh.geometry;
    (g.getAttribute('aSeg') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('aEnergy') as THREE.InstancedBufferAttribute).needsUpdate = true;
    g.instanceCount = this.n;
  }
}
