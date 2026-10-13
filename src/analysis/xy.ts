// Oscilloscope music: songs written to draw pictures on an oscilloscope in XY mode (left channel across, right channel
// up), like "Oscillofun" (the user: "这首歌是示波器音乐，应该在示波器效果里有图案的"). Three things give them away, measured on
// short windows across the song:
// - the two channels differ about as much as they agree (side ÷ mid energy): most songs keep the sound in the middle
//   (median 0.18 over the 260 songs in the NetEase cache), Oscillofun 0.61 — but 35 of those songs are above 0.35 too;
// - the picture is drawn in strokes: where it is wide, the beam runs straight and turns in corners, so the path's
//   acceleration (second difference a, below 3 kHz) is bunched into a few samples. (Σ|a|)² ÷ (n·Σ|a|²) is π/4 ≈ 0.79
//   for sound made of many partials and noise (the cached songs 0.59–0.85, the 35 wide ones 0.74–0.82), Oscillofun 0.56
//   (0.57 as a 128 kbit/s MP3). Sustained tones in wide stereo trace smooth Lissajous loops and pass the other two
//   tests: RADWIMPS「かたわれ時」0.79, Stafford Bawler "The Garden" 0.82;
// - the picture is redrawn over and over: the (left, right) path comes back onto itself within 2–25 ms (the residual
//   of the best lag, relative to the window's energy: Oscillofun 0.06–0.08, the two Lissajous songs 0.08–0.09, the
//   other wide songs 0.26 and up).

export interface XyVerdict {
  xy: boolean;
  /** Median side ÷ mid energy over the loud windows. */
  side: number;
  /** Median corner sparsity of the path on the wide windows (NaN when the side test already said no). */
  corners: number;
  /** Median 2-D self-similarity residual at the best lag (NaN when an earlier test already said no). */
  residual: number;
}

const median = (a: number[]) => (a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : NaN);

/** x[from, to) through two Butterworth low-pass sections (RBJ, Q = 1/√2). */
function lowpass(x: Float32Array, from: number, to: number, cutoff: number, rate: number): Float64Array {
  const w = (2 * Math.PI * cutoff) / rate, cw = Math.cos(w), al = Math.sin(w) * Math.SQRT1_2, a0 = 1 + al;
  const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
  const y = Float64Array.from(x.subarray(from, to));
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i], o = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
    }
  }
  return y;
}

export function xyMusic(left: Float32Array, right: Float32Array, rate: number): XyVerdict {
  const n = Math.min(left.length, right.length);
  const win = Math.round(0.1 * rate), count = Math.floor(n / win);
  if (count < 10) return { xy: false, side: 0, corners: NaN, residual: NaN };
  // Side ÷ mid on 100 ms windows louder than a tenth of the median.
  const mids: number[] = [], sides: number[] = [];
  for (let w = 0; w < count; w++) {
    let m = 0, s = 0;
    for (let i = w * win; i < (w + 1) * win; i += 2) { const a = left[i], b = right[i]; m += (a + b) * (a + b); s += (a - b) * (a - b); }
    mids.push(m); sides.push(s);
  }
  const level = median(mids.map((m, i) => m + sides[i]));
  const ratios: number[] = [];
  for (let w = 0; w < count; w++) if (mids[w] + sides[w] > 0.1 * level && mids[w] > 0) ratios.push(sides[w] / mids[w]);
  const side = median(ratios);
  if (!(side > 0.35)) return { xy: false, side: side || 0, corners: NaN, residual: NaN };
  // The other two tests look at 40 windows spread over the song, on every other sample; the cheap one first.
  const step = Math.max(1, Math.round(rate / 22050));
  const base = Math.round(0.03 * rate), lag0 = Math.round(0.002 * rate), lag1 = Math.round(0.025 * rate);
  // Corners: the second difference over h samples (0.07 ms) of the path below 3 kHz — it lifts hiss with the square of
  // its frequency, and a little hiss would otherwise hide the corners of a plain shape.
  const h = Math.max(1, Math.round(rate / 14700)), warm = Math.round(0.005 * rate);
  const windows: { a: number; e: number }[] = [], sparsity: number[] = [];
  for (let k = 0; k < 40; k++) {
    const a = Math.floor(((k + 0.5) / 40) * (n - base - lag1 - 1));
    let e = 0, m = 0, s = 0;
    for (let i = a; i < a + base; i += step) { const l = left[i], r = right[i]; e += l * l + r * r; m += (l + r) * (l + r); s += (l - r) * (l - r); }
    if (e / (base / step) < 1e-5) continue;
    windows.push({ a, e });
    // Only where the picture is wide: loud near-mono windows are often clipped flat, which is sparse too.
    if (s < 0.2 * m) continue;
    const from = Math.max(0, a - warm), x = lowpass(left, from, a + base, 3000, rate), y = lowpass(right, from, a + base, 3000, rate);
    let s1 = 0, s2 = 0, c = 0;
    for (let i = a - from + h; i + h < a - from + base; i += step) {
      const ax = x[i + h] - 2 * x[i] + x[i - h], ay = y[i + h] - 2 * y[i] + y[i - h];
      const q = ax * ax + ay * ay;
      s1 += Math.sqrt(q); s2 += q; c++;
    }
    if (s2 > 0) sparsity.push((s1 * s1) / (c * s2));
  }
  const corners = median(sparsity);
  if (!(corners < 0.65)) return { xy: false, side, corners, residual: NaN };
  // Periodicity of the 2-D path.
  const residuals: number[] = [];
  for (const { a, e } of windows) {
    let best = Infinity;
    for (let lag = lag0; lag < lag1; lag += step) {
      let d = 0;
      for (let i = 0; i < base && d < best; i += step) {
        const dx = left[a + lag + i] - left[a + i], dy = right[a + lag + i] - right[a + i];
        d += dx * dx + dy * dy;
      }
      if (d < best) best = d;
    }
    residuals.push(best / e);
  }
  const residual = median(residuals);
  return { xy: residual < 0.2, side, corners, residual };
}
