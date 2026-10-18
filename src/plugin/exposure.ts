// How long each plate has been on the MV page's screen over the plays so far, kept in the plugin's settings: the
// planner puts the plates seen least first (planShots' `exposure`), so across songs every plate of a pool comes round
// about as often. Recent plays weigh most: each new song the record counts for a little less (×0.97 a song, half after
// about 23), so a plate added later, or one the user turns back on, catches up within a few dozen songs instead of
// holding the screen until it has matched months of the others.
// Only the MV page's own frames count, while the song plays: not a download (drawn off screen), not the OBS page.

const KEY = 'sceneExposure';
const FADE = 0.97;
/** Seconds of new screen time between saves. */
const SAVE_EVERY = 15;

export class Exposure {
  private seen: Record<string, number> = {};
  private unsaved = 0;

  constructor() {
    try {
      const raw = JSON.parse(String(plugin.getConfig(KEY, '{}'))) || {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.seen[k] = v;
    } catch { /* a new record */ }
  }

  /** A new song: what was seen before counts a little less. */
  newSong(): void {
    for (const k of Object.keys(this.seen)) this.seen[k] *= FADE;
    this.save();
  }

  /** The record as it stands, for planning a play (and handing to the OBS page with it). */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.seen)) out[k] = Math.round(v * 10) / 10;
    return out;
  }

  /** `scene` was on screen for `dt` seconds. */
  add(scene: string, dt: number): void {
    if (!(dt > 0)) return;
    this.seen[scene] = (this.seen[scene] ?? 0) + dt;
    this.unsaved += dt;
    if (this.unsaved >= SAVE_EVERY) this.save();
  }

  save(): void {
    this.unsaved = 0;
    plugin.setConfig(KEY, JSON.stringify(this.snapshot()));
  }
}
