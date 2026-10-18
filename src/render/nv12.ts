// The finished picture as NV12 bytes, made on the GPU (docs/EXPORT.md). A video encoder takes YUV; a 1080p frame read
// back as NV12 is 3.1 MB where RGBA is 8.3 MB, and the page's JS (3–4× slower in NetEase than in a browser) can't convert
// 2 million pixels a frame in the time a frame has. So after the engine has drawn the picture to the canvas, a pass
// converts it (BT.709, limited range, 2×2 averaged chroma) into a w/4 × 1.5h RGBA8 target: every texel is four bytes of
// the NV12 buffer (the Y plane, then the interleaved U/V rows), so reading the target back gives the buffer as is.
// Several frames share the target, one under the other (a batch), so that one read-back and one send serve them all.
// The read-back is two steps: `start` has the GPU copy the target into a pixel pack buffer, `finish` copies that out to
// the page. `finish` waits for the GPU behind everything already queued, so it is called for the frame before the one
// just drawn (draw i, then finish i-1): called with later frames queued, it waited for their drawing too (6–7 ms a
// frame instead of 1–2 in measurements at 1080p).
import * as THREE from 'three';

const VERT = /* glsl */`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tFrame;
uniform sampler2D tHud;
uniform vec2 uSize;
uniform float uHud;
uniform float uRow0;
// The picture's pixel (x right, y down; the pixel's centre is at +0.5), the HUD (premultiplied) laid over it.
vec3 src(float x, float y) {
  vec2 uv = vec2(x / uSize.x, 1.0 - y / uSize.y);
  vec3 c = texture2D(tFrame, uv).rgb;
  if (uHud > 0.5) { vec4 h = texture2D(tHud, uv); c = c * (1.0 - h.a) + h.rgb; }
  return c;
}
float luma(vec3 c) { return 16.0 / 255.0 + 219.0 / 255.0 * dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The chroma sample (x, y): the 2×2 pixels it stands for, averaged.
vec2 chroma(float x, float y) {
  vec3 c = (src(2.0 * x + 0.5, 2.0 * y + 0.5) + src(2.0 * x + 1.5, 2.0 * y + 0.5) + src(2.0 * x + 0.5, 2.0 * y + 1.5) + src(2.0 * x + 1.5, 2.0 * y + 1.5)) * 0.25;
  return 128.0 / 255.0 + 224.0 / 255.0 * vec2(dot(c, vec3(-0.114572, -0.385428, 0.5)), dot(c, vec3(0.5, -0.454153, -0.045847)));
}
void main() {
  float x = floor(gl_FragCoord.x), y = floor(gl_FragCoord.y - uRow0);
  if (y < uSize.y) {
    gl_FragColor = vec4(luma(src(4.0 * x + 0.5, y + 0.5)), luma(src(4.0 * x + 1.5, y + 0.5)), luma(src(4.0 * x + 2.5, y + 0.5)), luma(src(4.0 * x + 3.5, y + 0.5)));
  } else {
    float r = y - uSize.y;
    gl_FragColor = vec4(chroma(2.0 * x, r), chroma(2.0 * x + 1.0, r));
  }
}`;

/** The next task on the page (a MessageChannel: unlike a timer, not held to 4 ms, nor to 1 s in a background page). */
const channel = new MessageChannel();
let waiters: Array<() => void> = [];
channel.port1.onmessage = () => { const w = waiters; waiters = []; for (const f of w) f(); };
export const tick = () => new Promise<void>(r => { waiters.push(r); channel.port2.postMessage(0); });

/** Buffers in the ring: the one being filled and the one being read. */
const READ_BUFFERS = 2;
/** Frames to a batch. */
export const BATCH = 6;

export class Nv12Packer {
  /** A frame's size in bytes: width × height × 3/2. */
  readonly bytes: number;
  /** Rows of the target a frame takes. */
  private readonly rows: number;
  /** Frames to a batch: `BATCH`, fewer when they wouldn't fit in a texture (a 4K portrait frame is 5760 rows). */
  readonly batch: number;
  private frame: THREE.FramebufferTexture;
  private hud: THREE.CanvasTexture | null = null;
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private gl: WebGL2RenderingContext;
  /** The pixel pack buffers, used in turn. */
  private buffers: WebGLBuffer[] = [];
  private next = 0;
  /** Where the time went, ms: waiting for and copying out of the buffers (and how many). */
  readonly stats = { copy: 0, copies: 0 };

  /** `width` and `height` are the canvas's pixels (pixel ratio 1) and even; the width a multiple of 4. */
  constructor(private renderer: THREE.WebGLRenderer, readonly width: number, readonly height: number) {
    if (width % 4 || height % 2) throw new Error('size not a multiple of 4 × 2');
    this.bytes = (width * height * 3) / 2;
    this.rows = (height * 3) / 2;
    this.batch = Math.max(1, Math.min(BATCH, Math.floor(renderer.capabilities.maxTextureSize / this.rows)));
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.frame = new THREE.FramebufferTexture(width, height);
    this.target = new THREE.WebGLRenderTarget(width / 4, this.rows * this.batch, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: { tFrame: { value: this.frame }, tHud: { value: null }, uSize: { value: new THREE.Vector2(width, height) }, uHud: { value: 0 }, uRow0: { value: 0 } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * The canvas as it stands (the engine has just drawn it, in this task: the drawing buffer is cleared once the page
   * shows it) packed into the target as frame `k` of the batch; `hud`: a canvas of the same size drawn over it
   * (premultiplied alpha), or none.
   */
  pack(hud: HTMLCanvasElement | null, k = 0): void {
    const r = this.renderer, prev = r.getRenderTarget();
    if (r.domElement.width !== this.width || r.domElement.height !== this.height) throw new Error(`canvas is ${r.domElement.width}×${r.domElement.height}, not ${this.width}×${this.height}`);
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.frame);
    const u = this.material.uniforms;
    if (hud) {
      if (!this.hud) {
        this.hud = new THREE.CanvasTexture(hud);
        this.hud.premultiplyAlpha = true;
        this.hud.generateMipmaps = false;
        this.hud.minFilter = this.hud.magFilter = THREE.NearestFilter;
        u.tHud.value = this.hud;
      }
      this.hud.needsUpdate = true;
    }
    u.uHud.value = hud ? 1 : 0;
    u.uRow0.value = k * this.rows;
    this.target.viewport.set(0, k * this.rows, this.width / 4, this.rows);
    const clear = r.autoClear;
    r.autoClear = false; // (the quad covers the frame's rows; the rest of the batch stays)
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = clear;
  }

  /** Starts the GPU's copy of the first `n` frames of the batch into a buffer; the buffer's number for finish(). */
  start(n = this.batch): number {
    const gl = this.gl, r = this.renderer;
    const fb = (r.properties.get(this.target) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
    if (!fb) throw new Error('nothing packed yet');
    const slot = this.next;
    this.next = (this.next + 1) % READ_BUFFERS;
    if (!this.buffers[slot]) {
      const b = this.buffers[slot] = gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes * this.batch, gl.STREAM_READ);
    }
    r.state.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffers[slot]);
    gl.readPixels(0, 0, this.width / 4, this.rows * n, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    r.state.bindFramebuffer(gl.FRAMEBUFFER, null);
    return slot;
  }

  /** The buffer's `n` frames (NV12, one after the other) copied into `into`: waits for the GPU if it isn't done. */
  finish(slot: number, into: Uint8Array, n = this.batch): Uint8Array {
    const gl = this.gl, t0 = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffers[slot]);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, into, 0, this.bytes * n);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.stats.copy += performance.now() - t0;
    this.stats.copies++;
    return into;
  }

  dispose(): void {
    for (const b of this.buffers.splice(0)) this.gl.deleteBuffer(b);
    this.frame.dispose();
    this.hud?.dispose();
    this.target.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
