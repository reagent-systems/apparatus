// A steady-rate recording of one page, resampled to a constant frame rate on
// stop. Two sources: CDP screencast frames (PNG, lossless, cheap; Chromium
// sends them at 1x whatever the scale factor), or a loop of Playwright
// screenshots (PNG at the context's scale factor, about 20 a second for a
// 390 px page at 2x). Marks let a scene trim the holds at the start and the end.
// `PageTimeRecorder` (below) records on page time instead (lib/vtime.mjs):
// one screenshot per step of the page's own clock, so every frame is its own
// moment whatever the screenshot costs. The GIFs use it; the wall-time
// `Recorder` stays for a page that runs on the wall clock.

import fs from "node:fs";
import path from "node:path";
import { mkdirp } from "./util.mjs";

export class Recorder {
  constructor(page, dir, { fps = 12, via = "screencast", clip = null } = {}) {
    this.page = page;
    this.via = clip ? "screenshot" : via;
    /** CSS px; screenshots only, which is also faster for a small region. */
    this.clip = clip;
    // A fresh folder: frames a failed earlier run left behind would join the encode.
    fs.rmSync(dir, { recursive: true, force: true });
    this.dir = mkdirp(dir);
    this.fps = fps;
    this.frames = [];
    this.marks = {};
    this.n = 0;
  }

  async start() {
    if (this.via === "screenshot") return this.startShots();
    const vp = this.page.viewportSize();
    const dpr = await this.page.evaluate(() => window.devicePixelRatio);
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (f) => {
      // Ack first: Chromium sends the next frame only after the ack, so the write must not hold it back.
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {
        // the session closed while a frame was in flight
      });
      const file = path.join(this.dir, `raw-${String(this.n++).padStart(5, "0")}.png`);
      this.frames.push({ t: f.metadata.timestamp * 1000, file });
      this.writing = (this.writing ?? 0) + 1;
      fs.writeFile(file, Buffer.from(f.data, "base64"), (e) => {
        this.writing--;
        if (e) this.writeError = e;
      });
    });
    await this.cdp.send("Page.startScreencast", {
      format: "png",
      maxWidth: Math.round(vp.width * dpr),
      maxHeight: Math.round(vp.height * dpr),
      everyNthFrame: 1,
    });
    this.t0 = Date.now();
  }

  async startShots() {
    this.t0 = Date.now();
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const t = Date.now();
        let buf;
        try {
          buf = await this.page.screenshot({ type: "png", animations: "allow", caret: "initial", clip: this.clip ?? undefined });
        } catch {
          break; // the page closed
        }
        const file = path.join(this.dir, `raw-${String(this.n++).padStart(5, "0")}.png`);
        fs.writeFileSync(file, buf);
        // The frame shows the page at about the middle of the capture.
        this.frames.push({ t: (t + Date.now()) / 2, file });
      }
    })();
  }

  /** Frame pixels per CSS pixel. A mobile-emulated page can screencast at 1x whatever its scale factor. */
  scale() {
    const head = fs.readFileSync(this.frames[0].file).subarray(16, 24);
    return head.readUInt32BE(0) / (this.clip?.width ?? this.page.viewportSize().width);
  }

  /** Name this moment; `encode` can trim to marks. */
  mark(name) {
    this.marks[name] = Date.now();
  }

  /**
   * Stop and write `frame-%05d.png` at a constant rate between `from` and `to`
   * (mark names or ms since start). Each output tick takes the newest frame at
   * or before it, so a still screen repeats its last frame.
   */
  async stop({ from = null, to = null } = {}) {
    if (this.via === "screenshot") {
      this.running = false;
      await this.loop;
    } else {
      await this.cdp.send("Page.stopScreencast").catch(() => {});
      await this.cdp.detach().catch(() => {});
    }
    if (this.frames.length === 0) throw new Error("the screencast produced no frames");
    // Let the last frames' writes land.
    for (let i = 0; i < 400 && this.writing > 0; i++) await new Promise((r) => setTimeout(r, 25));
    if (this.writing > 0) throw new Error(`${this.writing} screencast frames were not written`);
    if (this.writeError) throw this.writeError;
    return this.resample({ from, to });
  }

  /**
   * Write `frame-%05d.png` from the captured frames at `fps` (the recorder's
   * own by default) between `from` and `to`, replacing any frames written
   * before: a stopped recording can be resampled at another rate.
   */
  resample({ from = null, to = null, fps = this.fps } = {}) {
    for (const f of fs.readdirSync(this.dir)) if (/^frame-\d+\.png$/.test(f)) fs.rmSync(path.join(this.dir, f));
    const t = (x, dflt) => (x === null ? dflt : typeof x === "number" ? this.t0 + x : this.marks[x] ?? dflt);
    const first = this.frames[0].t;
    const start = Math.max(first, t(from, first));
    const end = t(to, this.frames[this.frames.length - 1].t);
    const step = 1000 / fps;
    let j = 0;
    let k = 0;
    // For each output frame, the captured frame it shows and the tick's time:
    // a scene can prove which ticks repeat a captured frame (`repeats`).
    const ticks = [];
    for (let i = 0; start + i * step <= end; i++) {
      const tick = start + i * step;
      while (j + 1 < this.frames.length && this.frames[j + 1].t <= tick) j++;
      fs.copyFileSync(this.frames[j].file, path.join(this.dir, `frame-${String(k++).padStart(5, "0")}.png`));
      ticks.push({ t: tick, raw: j });
    }
    return { pattern: path.join(this.dir, "frame-%05d.png"), count: k, fps, raw: this.frames.length, scale: this.scale(), start, ticks, rawTimes: this.frames.map((f) => f.t) };
  }

  /** Output frames, of those whose tick lies in [a, b] (wall times), that show the same captured frame as the frame before. */
  static repeats(ticks, a = -Infinity, b = Infinity) {
    let n = 0;
    for (let k = 1; k < ticks.length; k++) if (ticks[k].t >= a && ticks[k].t <= b && ticks[k].raw === ticks[k - 1].raw) n++;
    return n;
  }
}

/**
 * A recording on page time (lib/vtime.mjs): from `start()` the page's clocks
 * stand still, and every step the scene's waits take is one frame, a
 * screenshot (PNG, `clip` in CSS px, at the context's scale factor) of the
 * page painted at that step's time. Frames are 1000 / fps ms of page time
 * apart by construction: none is repeated or resampled. Marks are page times.
 */
export class PageTimeRecorder {
  constructor(page, vt, dir, { clip = null } = {}) {
    this.page = page;
    this.vt = vt;
    this.clip = clip;
    fs.rmSync(dir, { recursive: true, force: true });
    this.dir = mkdirp(dir);
    this.frames = [];
    this.marks = {};
    this.n = 0;
  }

  get fps() {
    return this.vt.fps;
  }

  async start() {
    await this.vt.pause();
    this.t0 = this.vt.now();
    this.hook = async (t) => {
      const buf = await this.page.screenshot({ type: "png", animations: "allow", caret: "initial", clip: this.clip ?? undefined });
      const file = path.join(this.dir, `raw-${String(this.n++).padStart(5, "0")}.png`);
      fs.writeFileSync(file, buf);
      this.frames.push({ t, file });
    };
    this.vt.afterFrame.add(this.hook);
  }

  /** Name this page time; `stop` trims to marks. */
  mark(name) {
    this.marks[name] = this.vt.now();
  }

  /**
   * Stop (page time runs with the wall again) and write the frames between
   * `from` and `to` (mark names or ms of page time since start), inclusive, as
   * `frame-%05d.png`. Throws when two frames are not exactly one step apart.
   */
  async stop({ from = null, to = null } = {}) {
    this.vt.afterFrame.delete(this.hook);
    await this.vt.resume();
    if (this.frames.length === 0) throw new Error("the recording has no frames: page time never moved");
    const t = (x, dflt) => (x === null ? dflt : typeof x === "number" ? this.t0 + x : this.marks[x] ?? dflt);
    const start = t(from, this.frames[0].t);
    const end = t(to, this.frames[this.frames.length - 1].t);
    const keep = this.frames.filter((f) => f.t >= start && f.t <= end);
    const step = this.vt.stepMs;
    for (let k = 1; k < keep.length; k++) {
      if (Math.abs(keep[k].t - keep[k - 1].t - step) > 1e-6) throw new Error(`page-time frames ${k - 1} and ${k} are ${keep[k].t - keep[k - 1].t} ms apart, not ${step}`);
    }
    keep.forEach((f, k) => fs.renameSync(f.file, path.join(this.dir, `frame-${String(k).padStart(5, "0")}.png`)));
    if (!keep.length) throw new Error("no page-time frames between the marks");
    const head = fs.readFileSync(path.join(this.dir, "frame-00000.png")).subarray(16, 24);
    const scale = head.readUInt32BE(0) / (this.clip?.width ?? this.page.viewportSize().width);
    for (const f of this.frames) fs.rmSync(f.file, { force: true });
    return { pattern: path.join(this.dir, "frame-%05d.png"), count: keep.length, fps: this.fps, raw: this.frames.length, scale, start: keep[0].t, times: keep.map((f) => f.t) };
  }
}
