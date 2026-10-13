// Song time for rendering, from NetEase's PlayProgress events. They arrive about every 31 ms with jitter (each one up
// to ~25 ms late) and 10 ms resolution, so the clock runs on the wall clock and only learns, slowly, where the song
// stands against it: each event moves that estimate by 2 % of its error (a time constant of about fifty events, a
// second and a half). The picture's time then moves at the wall clock's pace, frame after frame — it used to take 12 %
// of each event's error at once, a nudge every 31 ms that made every motion in the MV speed up and slow down by up to
// a tenth from frame to frame (simulated on the probe's event timing; the user: “动画不线性”“动画曲线不好”).
// Jumps of more than a quarter second — seeks, song changes — are taken at once.
// A pause holds the frame on screen the moment it is known (NetEase's play state in its store, its PlayState event,
// or our own pause button). Past the last event the clock runs on at most COAST seconds, so if the events simply stop
// the picture stops too, a hair later, instead of running on and then snapping back.

/** Longest the clock runs on past the last progress event (they come about every 31 ms, 95 % within 59 ms). */
const COAST = 0.2;
/** How much of each event's error the clock takes in. */
const GAIN = 0.02;

export class ProgressClock {
  /** Song time minus wall time (seconds), while playing. */
  private lead = 0;
  /** Wall time (ms) the clock may run on from: the last event, seek or resume. */
  private wall = -COAST * 1000;
  private lastEvent = -1e9;
  /** 'asked': we sent a pause and hold already; 'yes': NetEase reported it. */
  private paused: 'no' | 'asked' | 'yes' = 'no';
  private pausedAt = 0;
  /** The song time held while paused. */
  private held = 0;
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
        if (playId !== this.playId || Math.abs(reported - this.held) > 0.25) { this.held = reported; this.playId = playId; }
        return;
      }
      this.paused = 'no';
      this.lastEvent = -1e9;
    }
    const error = reported - (this.lead + now / 1000);
    const fresh = playId !== this.playId || now - this.lastEvent > 400;
    if (fresh || Math.abs(error) > 0.25) this.lead = reported - now / 1000;
    else this.lead += error * GAIN;
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
    this.held = this.time();
    this.paused = 'asked';
    this.pausedAt = performance.now();
  }

  /** Let go of a hold; the clock starts again from where it held, and the next PlayProgress puts it in step. */
  resume(): void {
    if (this.paused === 'no') return;
    this.paused = 'no';
    const now = performance.now();
    this.lead = this.held - now / 1000;
    this.wall = now;
    this.lastEvent = -1e9;
  }

  /** Jump to a song time right away (a seek we asked for; NetEase's next event confirms it). */
  seek(seconds: number): void {
    const now = performance.now();
    if (this.paused !== 'no') { this.held = seconds; return; }
    this.lead = seconds - now / 1000;
    this.wall = now;
  }

  get playing(): boolean { return this.paused === 'no' && performance.now() - this.lastEvent < 350; }

  /** Song id from the play id ("<songId>_<random>"). */
  get songId(): number { return Number(this.playId.split('_')[0]) || 0; }

  /** The song position NetEase is playing (for the progress bar and seeking). */
  time(): number {
    if (this.paused !== 'no') return this.held;
    return this.lead + Math.min(performance.now(), this.wall + COAST * 1000) / 1000;
  }

  /** The song time to draw: what is being heard, so the picture waits out the output's latency. */
  now(): number { return this.time() - this.offset; }
}
