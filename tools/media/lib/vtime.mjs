// Page time: frame-by-frame capture on the page's own clock.
//
// A GIF recorded in wall time gets as many frames as the screenshots keep up
// with (about 20 a second at 2x), so its motion jumps. Here the page's clocks
// stand still and the harness moves them one frame at a time: every frame of
// a GIF is a distinct moment of the app, exactly 1000 / fps ms after the one
// before it, however long the capture of each frame takes.
//
// What moves with page time, all through `PageTime.step`:
// - JS time: Playwright's page.clock (installed before the app loads) is
//   paused and stepped with runFor, so Date, performance.now and timers move
//   together. requestAnimationFrame callbacks run once per step at the step's
//   time (the clock alone would run them on its own 16 ms grid), so the orb's
//   shared clock (web/src/components/orb/orb-clock.ts) draws one new frame
//   per step.
// - CSS transitions and animations and Web Animations: each one is paused
//   when it appears and its currentTime moved on by the step; one that
//   reaches its end is finished, so its end events fire as they would.
// - The microphone: Chromium's fake device plays the scene's WAV in wall
//   time; the capture worklet's 20 ms frames are held at the page and handed
//   to the client's handler as page time reaches them, so the gate opens and
//   closes a turn on page time, after the same voiced and silent spans.
// - The agent's audio: the playback context's currentTime reads page time
//   and a source's `ended` fires when page time passes its end, so the client
//   reads "speaking" for as long as the line lasts in page time.
// - The session server's messages (browser.mjs gates the client socket) and
//   the Live stand-in's (lib/live.mjs sleeps on this clock) are released on
//   page time.
//
// What stays in wall time: the network, React's own scheduling (a message
// channel, not a timer), the server and agentd. Page time stands still while
// they work, so a wait for them (`until`) costs page time only when the page
// needs its clock to move for the thing to happen.
//
// Nothing here draws or edits a pixel: the client's code runs unchanged and
// each frame is a screenshot of it.

import { sleep } from "./util.mjs";

/** The clock of a scene without page time: the wall. */
export const WALL = {
  stepped: false,
  now: () => Date.now(),
  sleep,
  until: (p) => Promise.resolve(p),
};

/** Centiseconds per frame at `fps`; GIF delays are whole centiseconds and browsers slow anything under 2. */
export function frameCs(fps) {
  const cs = 100 / fps;
  if (!Number.isInteger(cs) || cs < 2) throw new Error(`${fps} fps is not a GIF rate: a frame must last a whole number of centiseconds, at least 2 (50 fps)`);
  return cs;
}

/**
 * Install page time on a context before its page loads: the clock, then the
 * shim, which wraps what the clock installed (the order matters).
 */
export async function installPageTime(ctx) {
  await ctx.clock.install();
  await ctx.addInitScript(pageShim);
}

/**
 * The page side, run before the app's own scripts. Free mode (the default)
 * passes everything through, so setup before a recording runs as usual;
 * `enter` starts stepped mode and `leave` ends it.
 */
function pageShim() {
  if (window.__mediaVT) return;
  const pw = globalThis.__pwClock;
  if (!pw || !Date.isFake) {
    window.__mediaVT = { installError: "the page clock was not installed before the page-time shim" };
    return;
  }
  const native = pw.builtins;
  const fakeRaf = window.requestAnimationFrame;
  const fakeCaf = window.cancelAnimationFrame;
  const fakeSetTimeout = window.setTimeout;
  const fakeClearTimeout = window.clearTimeout;
  const M = { stepped: false, raf: new Map(), nextRaf: 3e12, anims: new Set(), mics: [], watching: false, error: null };
  window.__mediaVT = M;

  // requestAnimationFrame: in stepped mode, once per step at the step's time.
  const raf = function requestAnimationFrame(cb) {
    if (!M.stepped) return fakeRaf(cb);
    const h = M.nextRaf++;
    M.raf.set(h, cb);
    return h;
  };
  raf.pageTime = true;
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = function cancelAnimationFrame(h) {
    if (M.raf.delete(h)) return;
    fakeCaf(h);
  };

  // Animations: paused as soon as they appear, at 0, until a step moves them.
  const adopt = (a) => {
    if (M.anims.has(a)) return;
    const s = a.playState;
    if (s === "finished" || s === "idle") return;
    try {
      a.pause();
      a.currentTime = 0;
      M.anims.add(a);
    } catch (e) {
      M.error = String(e);
    }
  };
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function animate(...args) {
    const a = nativeAnimate.apply(this, args);
    if (M.stepped) adopt(a);
    return a;
  };
  // Style changes start CSS transitions and animations at the next rendering
  // update, in wall time: a watcher on the real frame loop pauses them there.
  const watch = () => {
    if (!M.stepped) {
      M.watching = false;
      return;
    }
    for (const a of document.getAnimations()) adopt(a);
    native.requestAnimationFrame(watch);
  };

  // The microphone: the capture worklet's frames, held and released on page time.
  const portOnMessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage").set;
  const hookMic = (node) => {
    const port = node.port;
    const mic = { node, handler: null, q: [], clock: performance.now(), frames: 0 };
    Object.defineProperty(port, "onmessage", {
      configurable: true,
      get: () => mic.handler,
      set: (h) => {
        mic.handler = h;
      },
    });
    portOnMessage.call(port, (ev) => {
      const ms = ev.data && ev.data.length ? (ev.data.length / 16000) * 1000 : 20;
      if (!M.stepped) {
        mic.clock = performance.now();
        deliver(mic, ev);
        return;
      }
      mic.q.push({ ev, ms });
    });
    M.mics.push(mic);
  };
  const deliver = (mic, ev) => {
    mic.frames++;
    try {
      mic.handler?.call(mic.node.port, ev);
    } catch (e) {
      M.error = String(e);
    }
  };
  /** Frames due by `now`; true when an open microphone has not produced them yet. */
  const pumpMics = (now) => {
    let short = false;
    for (const mic of [...M.mics]) {
      if (mic.node.context.state === "closed") {
        M.mics.splice(M.mics.indexOf(mic), 1);
        continue;
      }
      while (mic.q.length && mic.clock + mic.q[0].ms <= now + 1e-6) {
        const f = mic.q.shift();
        mic.clock += f.ms;
        deliver(mic, f.ev);
      }
      if (!mic.q.length && mic.clock + 20 <= now + 1e-6) short = true;
    }
    return short;
  };
  if (window.AudioWorkletNode) {
    window.AudioWorkletNode = new Proxy(window.AudioWorkletNode, {
      construct(target, args, newTarget) {
        const node = Reflect.construct(target, args, newTarget);
        if (args[1] === "pcm-capture") hookMic(node);
        return node;
      },
    });
  }

  // The agent's audio: the context's clock is page time, and a source ends when page time passes its end.
  if (window.BaseAudioContext && window.AudioBufferSourceNode) {
    const born = new WeakMap();
    const ctime = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "currentTime").get;
    Object.defineProperty(BaseAudioContext.prototype, "currentTime", {
      configurable: true,
      get() {
        if (!(this instanceof AudioContext)) return ctime.call(this);
        if (!born.has(this)) born.set(this, performance.now());
        return (performance.now() - born.get(this)) / 1000;
      },
    });
    const S = new WeakMap();
    const st = (n) => {
      if (!S.has(n)) S.set(n, { handler: null, timer: null, fired: false });
      return S.get(n);
    };
    const proto = AudioBufferSourceNode.prototype;
    const nStart = proto.start;
    const nStop = proto.stop;
    const fire = (n) => {
      const s = st(n);
      if (s.fired) return;
      s.fired = true;
      try {
        s.handler?.call(n, new Event("ended"));
      } catch (e) {
        M.error = String(e);
      }
    };
    Object.defineProperty(proto, "onended", {
      configurable: true,
      get() {
        return st(this).handler;
      },
      set(h) {
        st(this).handler = h;
      },
    });
    proto.start = function start(when = 0) {
      nStart.call(this, 0);
      const s = st(this);
      const now = this.context.currentTime;
      const end = Math.max(when, now) + (this.buffer ? this.buffer.duration : 0);
      s.timer = fakeSetTimeout(() => fire(this), Math.max(0, (end - now) * 1000));
    };
    proto.stop = function stop() {
      nStop.call(this);
      const s = st(this);
      if (s.timer) fakeClearTimeout(s.timer);
      s.timer = fakeSetTimeout(() => fire(this), 0);
    };
  }

  M.enter = () => {
    M.stepped = true;
    for (const a of document.getAnimations()) {
      try {
        a.pause();
        M.anims.add(a);
      } catch (e) {
        M.error = String(e);
      }
    }
    for (const mic of M.mics) mic.clock = performance.now();
    if (!M.watching) {
      M.watching = true;
      native.requestAnimationFrame(watch);
    }
    return Date.now();
  };

  M.leave = () => {
    M.stepped = false;
    for (const a of M.anims) {
      try {
        if (a.playState === "paused") a.play();
      } catch {
        // gone with its element
      }
    }
    M.anims.clear();
    const cbs = [...M.raf.values()];
    M.raf.clear();
    for (const cb of cbs) fakeRaf(cb);
    for (const mic of M.mics) {
      for (const f of mic.q.splice(0)) deliver(mic, f.ev);
      mic.clock = performance.now();
    }
    return Date.now();
  };

  /** The microphone only: true while it is still short of page time. */
  M.mic = () => pumpMics(performance.now());

  /**
   * One frame at the time the clock was just stepped to: the microphone's due
   * frames, the animations moved on by `step`, the animation frame callbacks,
   * then two real frames so what they changed is painted.
   */
  M.frame = async (step, force) => {
    const now = performance.now();
    if (pumpMics(now) && !force) return { short: true };
    const live = new Set(document.getAnimations());
    for (const a of M.anims) if (!live.has(a)) M.anims.delete(a);
    let moved = 0;
    for (const a of live) {
      if (!M.anims.has(a)) {
        adopt(a);
        continue;
      }
      try {
        if (a.playState !== "paused") a.pause();
        const rate = a.playbackRate;
        const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
        const t = (a.currentTime ?? 0) + step * rate;
        if ((rate >= 0 && t >= end) || (rate < 0 && t <= 0)) {
          a.finish();
          M.anims.delete(a);
        } else a.currentTime = t;
        moved++;
      } catch (e) {
        M.error = String(e);
      }
    }
    const cbs = [...M.raf.values()];
    M.raf.clear();
    for (const cb of cbs) {
      try {
        cb(now);
      } catch (e) {
        M.error = String(e);
      }
    }
    await new Promise((r) => native.requestAnimationFrame(() => native.requestAnimationFrame(r)));
    return { now: Date.now(), perf: now, rafs: cbs.length, anims: moved, error: M.error };
  };
}

/**
 * The scene's handle on page time. `now()` is the page's Date.now(). In free
 * mode page time runs with the wall and `sleep` is a wall sleep; after
 * `pause()` page time moves only in steps of 1000 / fps ms, and `sleep(ms)`
 * steps it ms forward. Hooks: `beforeStep` (t) runs before each step,
 * `afterFrame` (t) after each frame is painted (the recorder's screenshot).
 */
export class PageTime {
  constructor(page, { fps = 50, log = () => {} } = {}) {
    this.page = page;
    this.log = log;
    this.setFps(fps);
    this.stepped = false;
    this.t = null;
    this.free = { page: Date.now(), wall: Date.now() };
    this.waiters = new Set();
    this.beforeStep = new Set();
    this.afterFrame = new Set();
    this.loop = null;
    this.running = false;
    this.steps = 0;
    this.stats = { micWaitMs: 0, wallMs: 0 };
  }

  setFps(fps) {
    if (this.stepped && 1000 / fps !== this.stepMs) throw new Error("page time: the rate cannot change while stepped");
    frameCs(fps);
    this.fps = fps;
    this.stepMs = 1000 / fps;
  }

  now() {
    if (this.stepped) return this.t;
    return this.free.page + (Date.now() - this.free.wall);
  }

  /** Stop the page's clocks; from here page time moves only in steps. */
  async pause() {
    if (this.stepped) return;
    const err = await this.page.evaluate(() => (window.__mediaVT ? window.__mediaVT.installError ?? null : "no page-time shim"));
    if (err) throw new Error(`page time: ${err}`);
    // pauseAt must lie ahead of the page's clock when it lands; a busy machine
    // can take longer than the margin to get there, so the margin grows.
    for (const margin of [50, 250, 1000, 3000]) {
      const now = await this.page.evaluate(() => Date.now());
      try {
        await this.page.clock.pauseAt(now + margin);
        break;
      } catch (e) {
        if (!/fast-forward to the past/.test(String(e.message)) || margin === 3000) throw e;
      }
    }
    const ok = await this.page.evaluate(() => window.requestAnimationFrame.pageTime === true);
    if (!ok) throw new Error("page time: requestAnimationFrame is not the page-time shim");
    this.t = await this.page.evaluate(() => window.__mediaVT.enter());
    this.stepped = true;
    this.log(`page time: paused at ${this.t}, ${this.fps} fps`);
  }

  /** Let the page's clocks run with the wall again. */
  async resume() {
    if (!this.stepped) return;
    while (this.loop) await this.loop;
    await this.page.evaluate(() => window.__mediaVT.leave());
    await this.page.clock.resume();
    this.stepped = false;
    this.free = { page: this.t, wall: Date.now() };
    this.log(`page time: resumed after ${this.steps} steps`);
  }

  /** Wait `ms` of page time (wall time in free mode). */
  sleep(ms) {
    if (!this.stepped) return sleep(ms);
    if (ms <= 0) return Promise.resolve();
    return this.wait({ due: this.t + ms });
  }

  /**
   * Wait for `p`, something outside the page's clock (a message, a reply).
   * Page time stands still for `graceMs` of wall time first, so a quick reply
   * costs no page time; then it steps until `p` settles.
   */
  async until(p, { graceMs = 400 } = {}) {
    if (!this.stepped) return p;
    let settled = false;
    const tracked = Promise.resolve(p).finally(() => {
      settled = true;
    });
    tracked.catch(() => {});
    await Promise.race([tracked.catch(() => {}), sleep(graceMs)]);
    if (!settled && this.stepped) await this.wait({ cond: () => settled });
    return tracked;
  }

  wait(w) {
    return new Promise((resolve, reject) => {
      w.resolve = resolve;
      w.reject = reject;
      this.waiters.add(w);
      if (!this.running) {
        this.running = true;
        this.loop = this.run();
      }
    });
  }

  /** Steps while anyone waits. `running` drops in the tick the last waiter resolves, so a waiter it wakes starts the next run. */
  async run() {
    try {
      while (true) {
        for (const w of [...this.waiters]) {
          if ((w.due !== undefined && this.t >= w.due) || (w.cond && w.cond())) {
            this.waiters.delete(w);
            w.resolve();
          }
        }
        if (!this.waiters.size) break;
        await this.step();
        // Let what the step resolved run before the next.
        await new Promise((r) => setImmediate(r));
      }
    } catch (e) {
      for (const w of this.waiters) w.reject(e);
      this.waiters.clear();
    } finally {
      this.running = false;
      this.loop = null;
    }
  }

  /** One frame: release what is due, step the clock, move the animations, run the frame callbacks, paint. */
  async step() {
    const w0 = Date.now();
    const t = this.t + this.stepMs;
    for (const h of this.beforeStep) await h(t);
    await this.page.clock.runFor(this.stepMs);
    this.t = t;
    let r = await this.page.evaluate(([ms, force]) => window.__mediaVT.frame(ms, force), [this.stepMs, false]);
    if (r.short) {
      // An open microphone has not yet played what page time reached: wait for it.
      const m0 = Date.now();
      while (Date.now() - m0 < 3000 && (await this.page.evaluate(() => window.__mediaVT.mic()))) await sleep(5);
      this.stats.micWaitMs += Date.now() - m0;
      if (Date.now() - m0 >= 3000) this.log("page time: the microphone fell 3 s behind; going on without it");
      r = await this.page.evaluate(([ms, force]) => window.__mediaVT.frame(ms, force), [this.stepMs, true]);
    }
    if (r.now !== t) throw new Error(`page time: the page reads ${r.now}, expected ${t}`);
    if (r.error && r.error !== this.lastError) {
      this.lastError = r.error;
      this.log(`page time: page error ${r.error}`);
    }
    this.steps++;
    for (const h of this.afterFrame) await h(t);
    this.stats.wallMs += Date.now() - w0;
  }
}
