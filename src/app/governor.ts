// Automatic quality (the 画质 setting's 自动): what each frame costs the GPU, and the drawing resolution stepped down
// when frames can't keep up with 60 a second, back up when there is room. Measured with EXT_disjoint_timer_query_webgl2
// (NetEase's Chromium 91 has it on the machines tried); without it, from how far apart the frames come.
// The step changes at a cut (the caller applies it), so the picture never goes soft in the middle of a shot.

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/**
 * The drawing buffer's pixels per CSS pixel at each step, from 画质 高's (`top`): each step ~70% of the pixels of the
 * one above, down to half of them (1.5× → 1.26× → 1.06×). No lower and the lens stays on: below that, text and fine
 * lines go soft (the user's choice from the comparison stills); a machine that needs more takes 中 or 低.
 */
export function ladder(top: number): number[] {
  const steps = [top];
  for (let i = 0; i < 2; i++) steps.push(Math.round(steps[i] * 0.84 * 100) / 100);
  return steps;
}

const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)];

export class Governor {
  private ext: TimerExt | null;
  private pending: Array<{ query: WebGLQuery; counts: boolean }> = [];
  private open: WebGLQuery | null = null;
  /** GPU ms of the recent frames (or, without the timer, ms between them). */
  private recent: number[] = [];
  /** The frames of the shot on screen, and the slower ones (p90) of each shot since the last change. */
  private shot: number[] = [];
  private shots: number[] = [];
  private lastAt = 0;
  private since = 0;
  /** When it last stepped up, and how long it waits at a step before trying the one above. */
  private upAt = -Infinity;
  private upHold = 15000;
  step = 0;

  constructor(private gl: WebGL2RenderingContext, readonly steps: number[]) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get pixelRatio(): number { return this.steps[this.step]; }

  /** Around the frame's drawing. */
  begin(): void {
    this.collect();
    if (!this.ext || this.open) return;
    this.open = this.gl.createQuery();
    if (this.open) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.open);
  }

  /** `counts`: false for a frame that says little about the shots' own cost (two plates drawn under a transition). */
  end(now: number, counts = true): void {
    if (this.ext && this.open) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push({ query: this.open, counts });
      this.open = null;
    } else if (!this.ext) {
      if (counts && this.lastAt && now - this.lastAt < 250) this.push(now - this.lastAt);
      this.lastAt = now;
    }
  }

  /** Frames hidden or held up: what came before says nothing about what comes next. */
  reset(): void { this.recent = []; this.shot = []; this.shots = []; this.lastAt = 0; this.since = performance.now(); }

  private collect(): void {
    const gl = this.gl, ext = this.ext;
    if (!ext || !this.pending.length) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const p of this.pending.splice(0)) gl.deleteQuery(p.query);
      return;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const p = this.pending.shift()!;
      if (p.counts) this.push(gl.getQueryParameter(p.query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(p.query);
    }
  }

  private push(ms: number): void {
    this.recent.push(ms);
    if (this.recent.length > 120) this.recent.shift();
    this.shot.push(ms);
  }

  /**
   * At a cut, the step the frames call for, given the frame budget (ms; 1000/60 unless the user caps lower). One down
   * when the slower quarter of the last ~2 s overran 85% of it (held 3 s after a change). One up when every shot since
   * the last change would still leave a third spare at the step above, after 15 s at this one, twice as long each time
   * a step up didn't hold: plates differ several times over in cost, and the last shot alone would have it go up on a
   * light plate and back down on the next heavy one. Only with the timer: frame spacing can't tell how much room there is.
   */
  wanted(budget: number, now: number): number {
    if (this.shot.length >= 10) this.shots.push(quantile(this.shot, 0.9));
    this.shot = [];
    const n = this.recent.length;
    if (n < 60 || now - this.since < 3000) return this.step;
    // (Without the timer the spacing includes vsync: a frame on time is the budget itself, so only clear misses count.)
    const p75 = quantile(this.recent, 0.75);
    if (this.step < this.steps.length - 1 && (this.ext ? p75 > budget * 0.85 : p75 > budget * 1.25)) return this.step + 1;
    if (this.ext && this.step > 0 && this.shots.length >= 3 && now - this.since > this.upHold) {
      const scale = (this.steps[this.step - 1] / this.steps[this.step]) ** 2;
      if (Math.max(...this.shots) * scale < budget * 0.66) return this.step - 1;
    }
    return this.step;
  }

  /** Moves to a step (the caller has applied it). */
  go(step: number, now: number): void {
    // (Back down within a minute of a step up: that step didn't hold, so the next try waits twice as long.)
    if (step > this.step && now - this.upAt < 60000) { this.upHold = Math.min(this.upHold * 2, 240000); this.upAt = -Infinity; }
    if (step < this.step) this.upAt = now;
    this.step = step;
    this.recent = [];
    this.shot = [];
    this.shots = [];
    this.since = now;
  }

  dispose(): void {
    for (const p of this.pending.splice(0)) this.gl.deleteQuery(p.query);
    if (this.open) { this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT); this.gl.deleteQuery(this.open); this.open = null; }
  }
}
