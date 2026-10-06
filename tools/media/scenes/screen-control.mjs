// screen-control.gif: the pane only (its header, the VM screen, the Control
// bar). The X screen is 960 x 540, so the pane (640 px at 1.5x) shows it at
// 1:1. The agent wrote report.csv; a terminal is open where it is, beside an
// xclock. Control: the ring turns primary; the real X pointer (x11grab draws
// it) moves into the terminal and clicks; the user types
// `column -ts, report.csv` through the page and the VM prints the table,
// which holds 1.5 s; the user clears the terminal, moves the pointer back and
// releases. The last frame matches the first, so the loop has no cut. Real
// frames only: the scene fails unless the stream decodes and the X server
// shows the keys landed. A frame the video decoder shows with a grey cast
// while it waits for a key frame is dropped (lib/screen.mjs
// dropDecodeGlitches): the frame before it holds instead.

import fs from "node:fs";
import path from "node:path";
import { parkPointer } from "../lib/browser.mjs";
import { dropFrames, encodeChecked, record } from "../lib/gifscene.mjs";
import { clearTerminal, openScreen, paneClip, pointerPath, release, restPoint, seedOrders, takeControlAndType } from "../lib/screenflow.mjs";
import { dropDecodeGlitches, videoPoint, withScreen } from "../lib/screen.mjs";
import { run, sleep } from "../lib/util.mjs";

/** The rail collapsed, the pane at its widest (640 px). */
const PREFS = { "apparatus.rail": "1", "apparatus.pane.width": "80" };
const DEVICE = { viewport: { width: 1280, height: 660 }, deviceScaleFactor: 1.5 };
const SCREEN = { width: 960, height: 540 };

export default {
  name: "screen-control",
  kind: "gif",
  makes: "screen-control.gif: Control, a click and a command land in the VM, Release (needs Xvfb, xterm, xclock, xdotool, ffmpeg)",
  async run(ctx) {
    return withScreen(ctx, { name: "screen-control", device: DEVICE, prefs: PREFS, platform: "desktop", screen: SCREEN }, async (app, { desk }) => {
      await seedOrders(app, desk);
      // The X pointer rests where the user last left it, beside the terminal.
      const rest = await restPoint(desk);
      await run("xdotool", ["mousemove", String(rest.x), String(rest.y)], { env: desk.env });
      await openScreen(app, "screen-control");
      const clip = await paneClip(app.page);
      // A patch of the bare root window, bottom left, for the glitch check (CSS px in the clip).
      const a = await videoPoint(app.page, 12, SCREEN.height - 60);
      const b = await videoPoint(app.page, 90, SCREEN.height - 12);
      const rec = await record(app, ctx, { fps: 12, clip });
      await sleep(300);
      rec.mark("start");
      await sleep(900);
      await takeControlAndType(app, desk, { beat: 0.8 });
      await sleep(1500); // the table
      await clearTerminal(app);
      await sleep(500);
      const { from } = await pointerPath(app.page, desk);
      await app.page.mouse.move(from.x, from.y, { steps: 10 });
      await sleep(300);
      await release(app);
      await parkPointer(app.page);
      await sleep(1100);
      rec.mark("end");
      const frames = await rec.stop({ from: "start", to: "end" });
      const k = frames.scale;
      await dropDecodeGlitches(rec.dir, { x: Math.round((a.x - clip.x) * k), y: Math.round((a.y - clip.y) * k), w: Math.round((b.x - a.x) * k), h: Math.round((b.y - a.y) * k) });
      const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, "screen-control.gif"), width: null, raw: frames.raw });
      dropFrames(rec, ctx);
      if (!fs.existsSync(gif.file)) throw new Error("screen-control.gif was not written");
      return [gif];
    });
  },
};
