// screen-control.gif: the pane only (its header, the VM screen, the Control
// bar). The agent wrote report.csv; a terminal is open where it is. Control:
// the ring turns primary; the real X pointer (x11grab draws it) moves into
// the terminal and clicks; the user types `column -ts, report.csv` through
// the page and the VM prints the table; the user clears the terminal, moves
// the pointer back and releases. The last frame matches the first, so the
// loop has no cut. Real frames only: the scene fails unless the stream
// decodes and the X server shows the keys landed.

import { parkPointer } from "../lib/browser.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { clearTerminal, openScreen, paneClip, pointerPath, release, restPoint, seedOrders, takeControlAndType } from "../lib/screenflow.mjs";
import { withScreen } from "../lib/screen.mjs";
import { run, sleep } from "../lib/util.mjs";

/** The rail collapsed, the pane at its widest (640 px). */
const PREFS = { "apparatus.rail": "1", "apparatus.pane.width": "80" };
const DEVICE = { viewport: { width: 1280, height: 660 }, deviceScaleFactor: 1.5 };

export default {
  name: "screen-control",
  kind: "gif",
  makes: "screen-control.gif: Control, a click and a command land in the VM, Release (needs Xvfb, xterm, xdotool, ffmpeg)",
  async run(ctx) {
    return withScreen(ctx, { name: "screen-control", device: DEVICE, prefs: PREFS, platform: "desktop" }, async (app, { desk }) => {
      await seedOrders(app, desk);
      // The X pointer rests where the user last left it, beside the terminal.
      const rest = await restPoint(desk);
      await run("xdotool", ["mousemove", String(rest.x), String(rest.y)], { env: desk.env });
      await openScreen(app, "screen-control");
      const rec = await record(app, ctx, { fps: 12, clip: await paneClip(app.page) });
      await sleep(300);
      rec.mark("start");
      await sleep(800);
      await takeControlAndType(app, desk, { beat: 0.8 });
      await sleep(1000); // the table
      await clearTerminal(app);
      await sleep(500);
      const { from } = await pointerPath(app.page, desk);
      await app.page.mouse.move(from.x, from.y, { steps: 10 });
      await sleep(300);
      await release(app);
      await parkPointer(app.page);
      await sleep(1100);
      rec.mark("end");
      return [await finish(rec, ctx, "screen-control.gif", { width: null })];
    });
  },
};
