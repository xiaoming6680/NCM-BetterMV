// Oscilloscope music: songs written to draw pictures on an oscilloscope in XY mode (left channel across, right channel
// up), like "Oscillofun" (the user: "这首歌是示波器音乐，应该在示波器效果里有图案的"). Two things give them away, measured on
// short windows across the song:
// - the two channels differ about as much as they agree (side ÷ mid energy): ordinary songs keep most of the sound in
//   the middle (0.03–0.28 on seven songs), Oscillofun 0.61;
// - the picture is redrawn over and over: the (left, right) path comes back onto itself within 2–25 ms (the residual
//   of the best lag, relative to the window's energy: Oscillofun 0.055, the seven songs 0.46–0.87).

export interface XyVerdict {
  xy: boolean;
  /** Median side ÷ mid energy over the loud windows. */
  side: number;
  /** Median 2-D self-similarity residual at the best lag (NaN when the side test already said no). */
  residual: number;
}

const median = (a: number[]) => (a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : NaN);

export function xyMusic(left: Float32Array, right: Float32Array, rate: number): XyVerdict {
  const n = Math.min(left.length, right.length);
  const win = Math.round(0.1 * rate), count = Math.floor(n / win);
  if (count < 10) return { xy: false, side: 0, residual: NaN };
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
  if (!(side > 0.35)) return { xy: false, side: side || 0, residual: NaN };
  // Periodicity of the 2-D path, on every other sample, at 40 windows spread over the song.
  const step = Math.max(1, Math.round(rate / 22050));
  const base = Math.round(0.03 * rate), lag0 = Math.round(0.002 * rate), lag1 = Math.round(0.025 * rate);
  const residuals: number[] = [];
  for (let k = 0; k < 40; k++) {
    const a = Math.floor(((k + 0.5) / 40) * (n - base - lag1 - 1));
    let e = 0;
    for (let i = 0; i < base; i += step) e += left[a + i] * left[a + i] + right[a + i] * right[a + i];
    if (e / (base / step) < 1e-5) continue;
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
  return { xy: residual < 0.2, side, residual };
}
