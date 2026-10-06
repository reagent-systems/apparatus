// appearance.gif: Settings, Appearance on the tablet layout (780 px: the icon
// rail and the thread). The settings popover is open for the whole GIF:
// Light (borderless, the client's default), then Dark, then Borders on, then
// Borders off, then Light again, about 2 s each, so the last frame matches
// the first. The thread holds one
// finished job, short enough that the popover covers only empty page and the
// empty composer. The crop runs from just above the job card to the bottom.

import { assertNoEndButton, parkPointer, primeSwitch, turnOff } from "../lib/browser.mjs";
import { LINES, askForJob, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { openSettings, withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

const DEVICE = { viewport: { width: 780, height: 1000 }, deviceScaleFactor: 1.2, hasTouch: false };
const HOLD = 1900;

export default {
  name: "appearance",
  kind: "gif",
  makes: "appearance.gif: Light, Dark, Borders on and off in Settings (tablet layout)",
  async run(ctx) {
    return withApp(ctx, { name: "appearance", device: DEVICE }, async (app) => {
      const { page } = app;
      await primeSwitch(app);
      const a = await askForJob(app, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob });
      await speakResult(app, a);
      await turnOff(app);
      await sleep(600);
      await assertNoEndButton(page, "appearance");
      const job = await page.locator('[data-kind="job"]').first().boundingBox();
      const vp = page.viewportSize();
      const top = Math.max(0, Math.round(job.y - 28));
      const clip = { x: 0, y: top, width: vp.width, height: vp.height - top };
      await openSettings(app);
      await parkPointer(page);
      await sleep(600);
      const rec = await record(app, ctx, { fps: 12, clip });
      await sleep(300);
      rec.mark("start");
      await sleep(HOLD);
      const pick = async (loc) => {
        await loc.hover();
        await sleep(200);
        await loc.click();
        await sleep(150);
        await parkPointer(page);
        await sleep(HOLD);
      };
      const radio = (name) => page.getByRole("radio", { name, exact: true }).first();
      const borders = page.getByRole("switch", { name: "Borders", exact: true }).first();
      await pick(radio("Dark"));
      await pick(borders);
      await pick(borders);
      await pick(radio("Light"));
      rec.mark("end");
      return [await finish(rec, ctx, "appearance.gif", { width: null })];
    });
  },
};
