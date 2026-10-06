// screen.png (+ -dark): the pane only (its header, the VM screen, the Control
// bar), while this device holds Control. The stream is real (x11grab over
// WebRTC); the terminal shows the table the user printed through the page.

import { parkPointer } from "../lib/browser.mjs";
import { setTheme, shot, variant } from "../lib/scene.mjs";
import { openScreen, paneClip, seedOrders, takeControlAndType } from "../lib/screenflow.mjs";
import { withScreen } from "../lib/screen.mjs";
import { sleep } from "../lib/util.mjs";

const PREFS = { "apparatus.rail": "1", "apparatus.pane.width": "80" };
const DEVICE = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

export default {
  name: "screen",
  kind: "still",
  makes: "screen.png (+ -dark): the VM screen in the pane under Control (needs Xvfb, xterm, xdotool, ffmpeg)",
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
        await parkPointer(app.page);
        await sleep(800);
        made.push(await shot(app, variant(ctx.out, "screen", theme), { clip: await paneClip(app.page) }));
      }
      return made;
    });
  },
};
