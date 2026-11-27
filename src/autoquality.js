// ---------------------------------------------------------------------------
// autoquality.js — the watchdog behind the "Auto" quality setting.
//
// It watches real frame times and decides when to step the picture down a
// level (or back up). It is deliberately patient, so it can never make the
// picture flicker:
//   * it judges whole 2.5-second windows, never single frames;
//   * one-off hitches (a shader compiling, the town re-meshing) are left out;
//   * stepping DOWN needs several slow windows in a row;
//   * stepping UP needs half a minute of smooth running, and if that step up
//     makes things slow again it stops trying for the rest of the session;
//   * after any change it waits before judging again (the change itself
//     causes a hitch), and the change is held back while the camera moves.
//
// Pure logic (no Three.js, no DOM), so it is unit-tested in Node. The idea of
// the dead band and the "stop trying" latch comes from Wattle Creek's
// frame-time watchdog.
// ---------------------------------------------------------------------------

export const AUTO_DEFAULTS = {
  windowSeconds: 2.5,    // length of one judging window
  slowMs: 28,            // a window slower than this (mean frame time) counts as slow (≈ 36 fps)
  goodMs: 18,            // a window faster than this counts as smooth (≈ 55 fps); between = leave alone
  slowWindows: 3,        // slow windows in a row before stepping down (≈ 7.5 s)
  goodSeconds: 30,       // smooth running needed before stepping back up
  dwellSeconds: 10,      // after any change, wait this long before judging again
  regressSeconds: 30,    // slow again this soon after a step up → stop stepping up
  hitchFactor: 4,        // a frame this many times slower than usual is a hitch…
  hitchMinMs: 90,        // …if it is also at least this long; hitches are not counted
  restSeconds: 0.35,     // a pending change waits until the camera has been still this long…
  maxHoldSeconds: 4,     // …but no longer than this
};

export class AutoQuality {
  /**
   * @param {number} levels  how many rungs the ladder has (0 = best)
   * @param {number} start   the rung to start on
   * @param {object} opts    overrides for AUTO_DEFAULTS
   */
  constructor(levels, start = 0, opts = {}) {
    this.o = { ...AUTO_DEFAULTS, ...opts };
    this.levels = levels;
    this.reset(start);
  }

  /** Start again (the player changed a setting). `ceiling` = best rung Auto may use. */
  reset(level = 0, ceiling = level) {
    this.level = level;
    this.ceiling = ceiling;
    this.t = 0; this.n = 0;            // current window: seconds and frames counted
    this.usual = 0;                    // running "usual" frame time (ms), for spotting hitches
    this.hitchRun = 0;
    this.slowRun = 0;                  // slow windows in a row
    this.good = 0;                     // seconds of smooth running in a row
    this.dwell = this.o.dwellSeconds;  // seconds left before judging resumes
    this.sinceUp = Infinity;           // seconds since the last step up
    this.noUp = false;                 // latched: stop stepping up
    this.pending = 0;                  // -1 = step up waiting, +1 = step down waiting
    this.held = 0; this.still = 0;
    this.lastMs = 0;                   // mean frame time of the last full window
  }

  /**
   * Feed one frame. Returns the new level when the level should change now,
   * otherwise null.
   * @param {number} dt      real seconds since the previous frame
   * @param {boolean} moving is the camera moving this frame?
   * @param {boolean} paused true while the tab is hidden or frames are slow on purpose
   */
  tick(dt, moving = false, paused = false) {
    const o = this.o;
    if (paused || !(dt > 0)) { this.t = 0; this.n = 0; this.good = 0; return null; }
    this.sinceUp += dt;
    this.still = moving ? 0 : this.still + dt;

    // a pending change waits for the camera to rest (or for the hold to run out)
    if (this.pending) {
      this.held += dt;
      if (this.still >= o.restSeconds || this.held >= o.maxHoldSeconds) return this._apply();
      return null;
    }
    if (this.dwell > 0) { this.dwell -= dt; this.t = 0; this.n = 0; return null; }

    // leave out one-off hitches (but if "hitches" keep coming, that is the real speed)
    const ms = dt * 1000;
    if (this.usual > 0 && ms > Math.max(o.hitchMinMs, this.usual * o.hitchFactor) && this.hitchRun < 4) {
      this.hitchRun++;
      return null;
    }
    this.hitchRun = 0;
    this.usual = this.usual ? this.usual + (ms - this.usual) * 0.1 : ms;

    this.t += dt; this.n++;
    if (this.t < o.windowSeconds) return null;
    const mean = (this.t / this.n) * 1000, span = this.t;
    this.t = 0; this.n = 0;
    this.lastMs = mean;

    if (mean > o.slowMs) {
      this.good = 0;
      if (this.sinceUp < o.regressSeconds) this.noUp = true;   // the step up was a mistake: don't repeat it
      if (++this.slowRun >= o.slowWindows && this.level < this.levels - 1) { this.pending = 1; this.held = 0; }
      return null;
    }
    this.slowRun = 0;
    if (mean >= o.goodMs || this.noUp || this.level <= this.ceiling) { this.good = 0; return null; }
    this.good += span;
    if (this.good >= o.goodSeconds) { this.pending = -1; this.held = 0; }
    return null;
  }

  _apply() {
    this.level = Math.min(this.levels - 1, Math.max(this.ceiling, this.level + this.pending));
    if (this.pending < 0) this.sinceUp = 0;
    this.pending = 0;
    this.slowRun = 0; this.good = 0; this.t = 0; this.n = 0;
    this.dwell = this.o.dwellSeconds;
    this.usual = 0; this.hitchRun = 0;
    return this.level;
  }
}
