// Song time for rendering, from NetEase's PlayProgress events. They arrive about every 31 ms with jitter and
// 10 ms resolution, so the clock runs on the wall clock between them and only eases towards what they report
// (jumps of more than a quarter second — seeks, song changes — are taken at once).
// A pause holds the frame on screen the moment it is known (NetEase's play state in its store, its PlayState event,
// or our own pause button). Between events the clock coasts at most COAST seconds, so if the events simply stop the
// picture stops too, a hair later, instead of running on and then snapping back to the last one.

/** Longest the clock runs on past the last progress event (they come about every 31 ms, 95 % within 59 ms). */
const COAST = 0.12;

export class ProgressClock {
  private base = 0;
  private wall = 0;
  private lastEvent = -1e9;
  /** 'asked': we sent a pause and hold already; 'yes': NetEase reported it. */
  private paused: 'no' | 'asked' | 'yes' = 'no';
  private pausedAt = 0;
  /** Consecutive events with a steadily moving position (NetEase is playing, whatever we think). */
  private advancing = 0;
  private lastReported = 0;
  playId = '';
  /** How much later the sound is heard than NetEase reports it, in seconds (the latency setting; Bluetooth ≈ 0.2). */
  offset = 0;

  onProgress = (playId: string, seconds: number): void => {
    const now = performance.now();
    const reported = seconds + 0.005;
    const step = reported - this.lastReported;
    this.advancing = playId === this.playId && step > 0.004 && step < 0.2 ? this.advancing + 1 : 0;
    this.lastReported = reported;
    if (this.paused !== 'no') {
      // Held: only a seek or another song moves the frame. Twenty moving events in a row (about 0.6 s), or events
      // still coming a second after a pause we only asked for, mean the pause never happened.
      if (this.advancing < 20 && (this.paused === 'yes' || now - this.pausedAt < 1000)) {
        if (playId !== this.playId || Math.abs(reported - this.base) > 0.25) { this.base = reported; this.playId = playId; }
        return;
      }
      this.paused = 'no';
    }
    const predicted = this.base + (now - this.wall) / 1000;
    const fresh = playId !== this.playId || now - this.lastEvent > 400;
    if (fresh || Math.abs(reported - predicted) > 0.25) this.base = reported;
    else this.base = predicted + (reported - predicted) * 0.12;
    this.wall = now;
    this.lastEvent = now;
    this.playId = playId;
  };

  /** NetEase's PlayState event: (playId, "<playId>|<action>|…", state), state 1 = playing. */
  onState = (_playId: string, _info: string, state: number): void => {
    if (Number(state) === 1) this.resume();
    else { this.pause(); this.paused = 'yes'; }
  };

  /** Hold the frame now (we are about to pause NetEase). */
  pause(): void {
    if (this.paused !== 'no') return;
    this.base = this.time();
    this.paused = 'asked';
    this.pausedAt = performance.now();
  }

  /** Let go of a hold; the clock starts again with the next PlayProgress, in step with the sound. */
  resume(): void {
    if (this.paused === 'no') return;
    this.paused = 'no';
    this.lastEvent = -1e9;
  }

  /** Jump to a song time right away (a seek we asked for; NetEase's next event confirms it). */
  seek(seconds: number): void {
    this.base = seconds;
    this.wall = performance.now();
  }

  get playing(): boolean { return this.paused === 'no' && performance.now() - this.lastEvent < 350; }

  /** Song id from the play id ("<songId>_<random>"). */
  get songId(): number { return Number(this.playId.split('_')[0]) || 0; }

  /** The song position NetEase is playing (for the progress bar and seeking). */
  time(): number {
    if (this.paused !== 'no') return this.base;
    return this.base + Math.min(COAST, Math.max(0, performance.now() - this.wall) / 1000);
  }

  /** The song time to draw: what is being heard, so the picture waits out the output's latency. */
  now(): number { return this.time() - this.offset; }
}
