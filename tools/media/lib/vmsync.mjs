// Frame-by-frame capture of the VM screen stream (screen-control.gif).
//
// The stream's video runs in wall time: agentd grabs the X screen with
// x11grab, encodes it and sends it over WebRTC, and the page's <video> shows
// it when it arrives. The page itself runs on page time (lib/vtime.mjs). A
// frame of the GIF is taken only when the video shows the X server's state
// at that step of page time:
//
// 1. What the step's input asked for has landed on the X server: the pointer
//    is where the page moved it, or the terminal shows a typed key (the X
//    screen changed).
// 2. The X screen is still: two grabs in a row are equal (a table that is
//    still printing is not a state to show). A grab is the root window with
//    the X cursor drawn on it as x11grab draws it (XFixes cursor image at the
//    pointer, less its hotspot), taken by one long-running helper on the
//    display (python-xlib), so a grab costs no process start.
// 3. The page's video, drawn to a canvas at its own size (the X screen's),
//    matches that grab: at most `maxBad` of its pixels differ by more than
//    `lumaTol` in luma, and none at all around the pointer, where it is and
//    where it was a frame before; and two patches of the bare root window
//    carry the root colour, so a frame the decoder shows with a grey cast
//    after a large change is waited out, not shown.
//
// Then the recorder screenshots the page. Every frame is the real page with
// the real decoded stream; the sync decides only when to take it. The proof
// of each frame (the X pointer, how many video frames it waited for, how
// many pixels differ) is kept in `log` and written by the scene.

import { execFile, spawn } from "node:child_process";
import { sleep } from "./util.mjs";

/** Around the X pointer (its hotspot), in X pixels: the arrow and the I-beam fit. */
const POINTER = { left: 12, top: 12, right: 24, bottom: 28 };

/**
 * The X helper: on each "g" line it writes the pointer (two int32 LE) and the
 * root window as RGB with the cursor drawn in (premultiplied ARGB, as ffmpeg's
 * xcbgrab composes it). It also turns the display's key autorepeat off.
 */
const HELPER = `
import sys, struct
from Xlib import display, X
from Xlib.ext import xfixes
d = display.Display(); root = d.screen().root
d.xfixes_query_version()
geo = root.get_geometry(); W, H = geo.width, geo.height
# A key the page holds 40 ms of page time stays down for as long in wall time as the frames
# between its down and up take to capture: X's autorepeat would type it again. Off, as for
# a key that is down 40 ms.
d.change_keyboard_control(auto_repeat_mode=X.AutoRepeatModeOff); d.sync()
out = sys.stdout.buffer
for line in sys.stdin:
    raw = root.get_image(0, 0, W, H, X.ZPixmap, 0xffffffff).data
    rgb = bytearray(W * H * 3)
    rgb[0::3] = raw[2::4]; rgb[1::3] = raw[1::4]; rgb[2::3] = raw[0::4]
    c = d.xfixes_get_cursor_image(root)
    x0, y0 = c.x - c.xhot, c.y - c.yhot
    img = c.cursor_image
    for j in range(c.height):
        y = y0 + j
        if y < 0 or y >= H: continue
        for i in range(c.width):
            x = x0 + i
            if x < 0 or x >= W: continue
            p = img[j * c.width + i]
            a = (p >> 24) & 255
            if not a: continue
            k = (y * W + x) * 3
            for ch, sh in ((0, 16), (1, 8), (2, 0)):
                v = (p >> sh) & 255
                rgb[k + ch] = v if a == 255 else min(255, (rgb[k + ch] * (255 - a) + 127) // 255 + v)
    out.write(struct.pack("<ii", c.x, c.y)); out.write(rgb); out.flush()
`;

class XGrabber {
  constructor(env, w, h) {
    this.size = 8 + w * h * 3;
    this.proc = spawn("uv", ["run", "--quiet", "--no-project", "--with", "python-xlib", "python", "-c", HELPER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.chunks = [];
    this.have = 0;
    this.waiting = null;
    this.err = "";
    this.proc.stderr.on("data", (d) => {
      this.err += d;
    });
    this.proc.stdout.on("data", (d) => {
      this.chunks.push(d);
      this.have += d.length;
      this.pump();
    });
    this.proc.on("exit", (code) => {
      if (this.waiting) this.waiting.reject(new Error(`the X helper exited ${code}: ${this.err.slice(-2000)}`));
    });
  }

  pump() {
    if (!this.waiting || this.have < this.size) return;
    const all = Buffer.concat(this.chunks);
    const one = all.subarray(0, this.size);
    this.chunks = [all.subarray(this.size)];
    this.have -= this.size;
    const w = this.waiting;
    this.waiting = null;
    w.resolve({ ptr: { x: one.readInt32LE(0), y: one.readInt32LE(4) }, rgb: Buffer.from(one.subarray(8)) });
  }

  /** { ptr, rgb }: the pointer and the screen with the cursor, one moment. */
  grab() {
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.proc.stdin.write("g\n");
      this.pump();
    });
  }

  stop() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/** The bounding box of the pixels that differ between two RGB grabs, or null. */
function diffBox(a, b, w, h) {
  if (!a) return { x: 0, y: 0, w, h };
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 3;
    if (a.compare(b, row, row + w * 3, row, row + w * 3) === 0) continue;
    for (let x = 0; x < w; x++) {
      const i = row + x * 3;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The page side: draws the video to a canvas and checks it against the X grab. */
function pageHelper() {
  if (window.__vmsync) return;
  const S = {
    x: null,
    w: 0,
    h: 0,
    canvas: null,
    g: null,
    video() {
      return document.querySelector("video");
    },
    setX(b64, w, h) {
      const bin = atob(b64);
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      S.x = a;
      S.w = w;
      S.h = h;
    },
    draw() {
      const v = S.video();
      if (!v || v.videoWidth !== S.w || v.videoHeight !== S.h) return null;
      if (!S.canvas) {
        S.canvas = document.createElement("canvas");
        S.canvas.width = S.w;
        S.canvas.height = S.h;
        S.g = S.canvas.getContext("2d", { willReadFrequently: true });
      }
      S.g.drawImage(v, 0, 0);
      return S.g.getImageData(0, 0, S.w, S.h).data;
    },
    /** The next frame the video presents (or a second of wall time). The page's own timers stand still on page time: the real ones. */
    next() {
      const v = S.video();
      const real = globalThis.__pwClock?.builtins ?? window;
      return new Promise((r) => {
        const t = real.setTimeout(() => r(false), 1000);
        v.requestVideoFrameCallback(() => {
          real.clearTimeout(t);
          r(true);
        });
      });
    },
    /** One check of the current video frame against the X grab: pixels off by more than `lumaTol` in luma, round the pointer (`ptr`, `prev`) and elsewhere. */
    check({ ptr, prev, lumaTol, patches, root }) {
      const f = S.draw();
      if (!f) return { bad: -1, ptrBad: -1, off: 999, why: "no video at the X size" };
      const inBox = (x, y, b) => b && x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
      const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
      let bad = 0;
      let ptrBad = 0;
      for (let y = 0; y < S.h; y++) {
        for (let x = 0; x < S.w; x++) {
          const i = (y * S.w + x) * 4;
          const j = (y * S.w + x) * 3;
          const d = Math.abs(luma(f[i], f[i + 1], f[i + 2]) - luma(S.x[j], S.x[j + 1], S.x[j + 2]));
          if (d <= lumaTol) continue;
          if (inBox(x, y, ptr) || inBox(x, y, prev)) ptrBad++;
          else bad++;
        }
      }
      const means = patches.map((p) => {
        const s = [0, 0, 0];
        let n = 0;
        for (let y = p.y; y < p.y + p.h; y++) {
          for (let x = p.x; x < p.x + p.w; x++) {
            const i = (y * S.w + x) * 4;
            s[0] += f[i];
            s[1] += f[i + 1];
            s[2] += f[i + 2];
            n++;
          }
        }
        return s.map((v) => v / n);
      });
      const off = Math.max(...means.flatMap((m) => m.map((v, c) => Math.abs(v - root[c]))));
      return { bad, ptrBad, off };
    },
  };
  window.__vmsync = S;
}

export class VmSync {
  /**
   * `env` is the X display's environment (desk.env); `screen` the X size;
   * `root` the root window colour [r, g, b]; `patches` boxes (X px) of the bare
   * root window that no window covers and the pointer never crosses.
   * A frame matches when at most `maxBad` pixels away from the pointer and
   * `maxPtrBad` round it are off by more than `lumaTol` in luma, and each
   * patch's mean is within `rootTol` of the root colour.
   */
  constructor(page, env, { screen, root, patches, lumaTol = 48, maxBad = 40, maxPtrBad = 3, rootTol = 5, timeoutMs = 30_000, log = () => {} }) {
    Object.assign(this, { page, env, screen, root, patches, lumaTol, maxBad, maxPtrBad, rootTol, timeoutMs, log });
    this.prevGrab = null;
    this.prevPtr = null;
    this.want = { pointer: null, change: null };
    this.frames = [];
  }

  async install() {
    this.x = new XGrabber(this.env, this.screen.width, this.screen.height);
    await this.page.evaluate(pageHelper);
    this.prevPtr = (await this.x.grab()).ptr;
  }

  stop() {
    this.x?.stop();
  }

  /** For a failed match: the X grab and the video frame as PNGs in `dumpDir`. */
  async dump(g) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(this.dumpDir, { recursive: true });
    const raw = `${this.dumpDir}/x.rgb`;
    writeFileSync(raw, g);
    await new Promise((r) => execFile("convert", ["-size", `${this.screen.width}x${this.screen.height}`, "-depth", "8", `rgb:${raw}`, `${this.dumpDir}/x.png`], () => r()));
    const url = await this.page.evaluate(() => (window.__vmsync.draw(), window.__vmsync.canvas.toDataURL("image/png")));
    writeFileSync(`${this.dumpDir}/video.png`, Buffer.from(url.split(",")[1], "base64"));
    this.log(`vmsync: wrote the X grab and the video frame to ${this.dumpDir}`);
  }

  /** The next frame must show the X pointer at `p` (X px), within 1 px. */
  expectPointer(p) {
    this.want.pointer = p;
  }

  /** The next frame must show the X screen changed from what it shows now (a typed key landing). */
  async expectChange(label) {
    this.want.change = { label, before: this.prevGrab ?? (await this.x.grab()).rgb };
  }

  /** Wait for the step's input to land on X, then for the video to show X; resolves with the frame's proof. */
  async settle(t) {
    const t0 = Date.now();
    const deadline = t0 + this.timeoutMs;
    const want = this.want;
    this.want = { pointer: null, change: null };
    let g = await this.x.grab();
    const off = (p) => Math.abs(g.ptr.x - p.x) > 1 || Math.abs(g.ptr.y - p.y) > 1;
    while ((want.pointer && off(want.pointer)) || (want.change && g.rgb.equals(want.change.before))) {
      if (Date.now() > deadline) throw new Error(want.change ? `vmsync: ${want.change.label} never reached the X screen` : `vmsync: the X pointer is at ${g.ptr.x},${g.ptr.y}, not ${want.pointer.x},${want.pointer.y}`);
      await sleep(5);
      g = await this.x.grab();
    }
    // The X screen holds still: two grabs in a row agree.
    for (;;) {
      await sleep(15);
      const g2 = await this.x.grab();
      if (g2.rgb.equals(g.rgb)) break;
      g = g2;
      if (Date.now() > deadline) throw new Error("vmsync: the X screen never held still");
    }
    const ptr = g.ptr;
    const changed = diffBox(this.prevGrab, g.rgb, this.screen.width, this.screen.height);
    if (changed || !this.sent) {
      await this.page.evaluate(([b64, w, h]) => window.__vmsync.setX(b64, w, h), [g.rgb.toString("base64"), this.screen.width, this.screen.height]);
      this.sent = true;
    }
    const box = (p) => (p ? { x0: p.x - POINTER.left, y0: p.y - POINTER.top, x1: p.x + POINTER.right, y1: p.y + POINTER.bottom } : null);
    const moved = !this.prevPtr || this.prevPtr.x !== ptr.x || this.prevPtr.y !== ptr.y;
    const args = { ptr: box(ptr), prev: moved ? box(this.prevPtr) : null, lumaTol: this.lumaTol, patches: this.patches, root: this.root };
    // Video frames until one matches; the first check looks at the frame already shown.
    let waited = 0;
    let r;
    for (;;) {
      r = await this.page.evaluate((a) => window.__vmsync.check(a), args);
      r.ok = r.bad >= 0 && r.bad <= this.maxBad && r.ptrBad <= this.maxPtrBad && r.off <= this.rootTol;
      if (r.ok) break;
      if (Date.now() > deadline) {
        if (this.dumpDir) await this.dump(g.rgb);
        throw new Error(`vmsync: at page time ${t} the video never matched the X screen (${JSON.stringify(r)}, pointer ${ptr.x},${ptr.y})`);
      }
      await this.page.evaluate(() => window.__vmsync.next());
      waited++;
    }
    const proof = { t, ptr, moved, changed, waited, bad: r.bad, ptrBad: r.ptrBad, off: Number(r.off.toFixed(2)), wallMs: Date.now() - t0 };
    this.frames.push(proof);
    if (process.env.VMSYNC_DEBUG) this.log(`vmsync ${JSON.stringify(proof)}`);
    if (this.frames.length % 100 === 0) this.log(`vmsync: ${this.frames.length} frames; this one waited ${waited} video frames, ${proof.wallMs} ms`);
    this.prevGrab = g.rgb;
    this.prevPtr = ptr;
    return proof;
  }
}
