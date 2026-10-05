// A steady-rate recording of one page: CDP screencast frames (PNG, lossless)
// with their timestamps, resampled to a constant frame rate on stop. Marks let
// a scene trim the holds at the start and the end.

import fs from "node:fs";
import path from "node:path";
import { mkdirp } from "./util.mjs";

export class Recorder {
  constructor(page, dir, { fps = 12 } = {}) {
    this.page = page;
    this.dir = mkdirp(dir);
    this.fps = fps;
    this.frames = [];
    this.marks = {};
    this.n = 0;
  }

  async start() {
    const vp = this.page.viewportSize();
    const dpr = await this.page.evaluate(() => window.devicePixelRatio);
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (f) => {
      const file = path.join(this.dir, `raw-${String(this.n++).padStart(5, "0")}.png`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ t: f.metadata.timestamp * 1000, file });
      try {
        await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
      } catch {
        // the session closed while a frame was in flight
      }
    });
    await this.cdp.send("Page.startScreencast", {
      format: "png",
      maxWidth: Math.round(vp.width * dpr),
      maxHeight: Math.round(vp.height * dpr),
      everyNthFrame: 1,
    });
    this.t0 = Date.now();
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
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp.detach().catch(() => {});
    if (this.frames.length === 0) throw new Error("the screencast produced no frames");
    const t = (x, dflt) => (x === null ? dflt : typeof x === "number" ? this.t0 + x : this.marks[x] ?? dflt);
    const first = this.frames[0].t;
    const start = Math.max(first, t(from, first));
    const end = t(to, this.frames[this.frames.length - 1].t);
    const step = 1000 / this.fps;
    let j = 0;
    let k = 0;
    for (let tick = start; tick <= end; tick += step) {
      while (j + 1 < this.frames.length && this.frames[j + 1].t <= tick) j++;
      fs.copyFileSync(this.frames[j].file, path.join(this.dir, `frame-${String(k++).padStart(5, "0")}.png`));
    }
    return { pattern: path.join(this.dir, "frame-%05d.png"), count: k, fps: this.fps, raw: this.frames.length };
  }
}
