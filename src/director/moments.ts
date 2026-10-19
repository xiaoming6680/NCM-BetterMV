// Moments the director lays over every plate, after the rhythm-game BGAs of issue #3:
//  · Time stop (时停): where the sound falls off a cliff — loud, then all but silent within a fifth of a second, for a
//    quarter of a second up to two and a half, and back — the plate's time stands still at the cliff. When the sound
//    comes back the plate's time rushes to catch up (a fast-forward that dies away: no frame is skipped, the world
//    lunges on), and the frame pushes in.
//  · Push (瞬间推进): a spike inside a loud section — an accent (a hit the whole spectrum jumps on) where the level
//    leaps — pushes the frame in for an instant, light ribbons rushing out of the middle. A section's sharpest one at
//    most, ten seconds apart, about one every 35 s of song; never on a section's first bar (its own transition is
//    there), nor in an intro or outro.
// Both are decided up front from the analysis: a frame is a function of t.
import type { Music } from './music.ts';
import { lastIndex } from './music.ts';

/** The plate's time stands at `at` from `at` to `end`, then catches up. */
export interface Stop { at: number; end: number }
export interface Push { at: number; strength: number }

/** How fast a stop's lag dies away after it ends (seconds per e-fold): the catch-up's speed is 1 + lag / tau. */
const tau = (s: Stop) => Math.max(0.1, (s.end - s.at) * 0.12);

export function findStops(music: Music): Stop[] {
  const { fps, rms } = music.a.env, n = rms.length;
  if (!n) return [];
  const mean = (a: number, b: number) => {
    a = Math.max(0, Math.round(a * fps)); b = Math.min(n, Math.round(b * fps));
    let s = 0;
    for (let i = a; i < b; i++) s += rms[i];
    return b > a ? s / (b - a) : 0;
  };
  const hits = [...music.a.hits.kick, ...music.a.hits.snare, ...music.a.hits.accent].map(h => h[0]).sort((x, y) => x - y);
  const out: Stop[] = [];
  let i = Math.round(3 * fps);
  while (i < n - 1) {
    const t = i / fps;
    // A frame well below the level of the half second before: is it the foot of a cliff?
    const pre0 = mean(t - 0.75, t - 0.2);
    if (pre0 < 0.35 || rms[i] >= 0.25 * pre0) { i++; continue; }
    // The level 0.2 s earlier was still up (the envelope's release takes ~0.12 s to fall this far): a cliff, not a
    // fade. The cut itself is where the fall began.
    const back = Math.round(0.2 * fps);
    if (i - back < 0 || rms[i - back] < 0.7 * pre0) { i++; continue; }
    let cut = i;
    while (cut > i - back && rms[cut - 1] >= rms[cut]) cut--;
    const at = cut / fps, pre = mean(at - 0.6, at - 0.02);
    // Silence until the sound comes back.
    let r = i;
    while (r < n && rms[r] < 0.45 * pre) r++;
    const end0 = r / fps, dur = end0 - at;
    const skip = () => { i = r + 1; };
    if (r >= n || dur < 0.25 || dur > 2.5 || end0 > music.duration - 2) { skip(); continue; }
    // Back strongly (not the song thinning out).
    if (mean(end0, end0 + 0.4) < Math.max(0.3, 0.5 * pre)) { skip(); continue; }
    // Not in a gated or chopped passage: no other gap in the two seconds before.
    let gaps = 0;
    for (let k = Math.max(0, Math.round((at - 2) * fps)); k < cut - 2; k++) if (rms[k] < 0.3 * pre) gaps++;
    if (gaps > 0.08 * fps) { skip(); continue; }
    if (out.length && at - out[out.length - 1].end < 4) { skip(); continue; }
    // The sound comes back on a drum: the stop ends on it.
    const h = lastIndex(hits, end0 + 0.08);
    const end = h >= 0 && hits[h] >= end0 - 0.05 ? hits[h] : end0;
    out.push({ at, end });
    skip();
  }
  return out;
}

export function findPushes(music: Music, stops: Stop[]): Push[] {
  const { fps, rms } = music.a.env, n = rms.length;
  const mean = (a: number, b: number) => {
    a = Math.max(0, Math.round(a * fps)); b = Math.min(n, Math.round(b * fps));
    let s = 0;
    for (let i = a; i < b; i++) s += rms[i];
    return b > a ? s / (b - a) : 0;
  };
  // Each loud section's sharpest spike (not on its first bar, nor its last half bar, nor near a stop).
  const cands: Push[] = [];
  for (const sec of music.a.sections) {
    if (sec.energy < 0.6 || sec.label === 'intro' || sec.label === 'outro') continue;
    const bar = music.barDuration(sec.start + 0.01);
    let best: Push | null = null, bestJump = 0;
    for (const [at, s] of music.a.hits.accent) {
      if (s < 0.6 || at < sec.start + bar * 0.95 || at > sec.end - bar * 0.5) continue;
      if (stops.some(st => at > st.at - 1 && at < st.end + 1.5)) continue;
      // A spike: the level leaps at it.
      const jump = mean(at, at + 0.25) - mean(at - 0.5, at - 0.05);
      if (jump >= 0.22 && jump * s > bestJump) { bestJump = jump * s; best = { at, strength: Math.min(1, 0.55 + jump) }; }
    }
    if (best) cands.push(best);
  }
  // The strongest of them, ten seconds from each other and from the stops' ends, about one every 35 s of song at most.
  // (A stop that ends on a section's start leaves the push to the section's own entrance.)
  const out: Push[] = stops.filter(s => !music.a.sections.some(sec => Math.abs(sec.start - s.end) < 0.15)).map(s => ({ at: s.end, strength: 1 }));
  const cap = out.length + Math.max(2, Math.floor(music.duration / 35));
  cands.sort((a, b) => b.strength - a.strength);
  for (const c of cands) {
    if (out.length >= cap) break;
    if (out.some(p => Math.abs(p.at - c.at) < 10)) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The plate's time at song time t, given the song's stops: held through a stop, then rushing to catch up. */
export function plateTime(stops: readonly Stop[], t: number): number {
  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    if (t < s.at) continue;
    if (t < s.end) return s.at;
    const lag = (s.end - s.at) * Math.exp(-(t - s.end) / tau(s));
    return lag < 1e-4 ? t : t - lag;
  }
  return t;
}

/** The stop t is in (held or catching up), or null. */
export function stopAt(stops: readonly Stop[], t: number): Stop | null {
  for (const s of stops) if (t >= s.at && t < s.end + 8 * tau(s)) return s;
  return null;
}
