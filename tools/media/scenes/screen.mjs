// screen.png (+ -dark): the whole desktop window, like the other desktop
// stills: the rail, the thread with the job that wrote report.csv, and the
// pane on the Screen while this device holds Control (the holder chip and
// Release). The stream is real (x11grab over WebRTC) from the same X desktop
// as screen-control.gif: an xclock and a terminal in ~/reports, where the
// table shows that the user printed through the page.

import { parkPointer, threadToEnd } from "../lib/browser.mjs";
import { setTheme, shot, variant } from "../lib/scene.mjs";
import { openScreen, seedOrders, takeControlAndType } from "../lib/screenflow.mjs";
import { withScreen } from "../lib/screen.mjs";
import { sleep } from "../lib/util.mjs";

/** The rail open, the pane at its widest (640 px). */
const PREFS = { "apparatus.pane.width": "80" };
const DEVICE = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

export default {
  name: "screen",
  kind: "still",
  makes: "screen.png (+ -dark): the whole window, the VM screen in the pane under Control (needs Xvfb, xterm, xdotool, ffmpeg)",
  async run(ctx) {
    return withScreen(ctx, { name: "screen", device: DEVICE, prefs: PREFS, platform: "desktop" }, async (app, { desk }) => {
      await seedOrders(app, desk);
      await openScreen(app, "screen");
      await takeControlAndType(app, desk, { beat: 0.5 });
      const made = [];
      for (const theme of ctx.themes) {
        // The video holds the keyboard under Control; the palette key belongs to the page.
        await app.page.evaluate(() => document.activeElement?.blur?.());
        if (theme !== app.theme) await setTheme(app, theme);
        await threadToEnd(app.page);
        await parkPointer(app.page);
        await sleep(800);
        made.push(await shot(app, variant(ctx.out, "screen", theme)));
      }
      return made;
    });
  },
};
