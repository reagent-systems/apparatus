// appearance.gif: Settings, Appearance on the desktop layout, the whole
// window (1024 x 720): the full rail, the thread with one finished job and
// the composer, and the settings popover open from the rail footer for the
// whole GIF. The pointer moves to each choice (its hover fill shows) and
// clicks: Light (borderless, the client's default), Dark, Borders on, Borders
// off, Light again, so the last frame matches the first. Light and Dark hold
// 1.5 s; the Borders states hold 2 s, because in dark the card fill and the
// outlines are the only difference. The frames of each repaint (the 150 ms
// colour transition) are cut, not blended.

import { assertNoEndButton, parkPointer, primeSwitch, threadToEnd, turnOff } from "../lib/browser.mjs";
import { LINES, askForJob, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { openSettings, withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

const DEVICE = { viewport: { width: 1024, height: 720 }, deviceScaleFactor: 1.15 };
/** The repaint after a click: these frames are cut. */
const REPAINT_MS = 260;

export default {
  name: "appearance",
  kind: "gif",
  makes: "appearance.gif: Light, Dark, Borders on and off in Settings (desktop layout, the whole window)",
  async run(ctx) {
    return withApp(ctx, { name: "appearance", device: DEVICE, platform: "desktop" }, async (app) => {
      const { page } = app;
      await primeSwitch(app);
      const a = await askForJob(app, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob });
      await speakResult(app, a);
      await turnOff(app);
      await sleep(600);
      await threadToEnd(page);
      await assertNoEndButton(page, "appearance");
      await openSettings(app);
      await parkPointer(page);
      await sleep(600);
      const rec = await record(app, ctx, { fps: 12 });
      await sleep(300);
      rec.mark("start");
      await sleep(1500);
      const cuts = [];
      // The pointer travels from where it last was to the choice, so its hover fill shows on the way.
      const pick = async (loc, hold) => {
        const box = await loc.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
        await sleep(350);
        const t = Date.now();
        await page.mouse.down();
        await sleep(90);
        await page.mouse.up();
        cuts.push([t + 40, t + REPAINT_MS]);
        await sleep(hold);
      };
      const radio = (name) => page.getByRole("radio", { name, exact: true }).first();
      const borders = page.getByRole("switch", { name: "Borders", exact: true }).first();
      await pick(radio("Dark"), 1500);
      await pick(borders, 2000);
      await pick(borders, 2000);
      await pick(radio("Light"), 1200);
      // The pointer rests where it started, so the last frame matches the first.
      await parkPointer(page);
      await sleep(400);
      rec.mark("end");
      return [await finish(rec, ctx, "appearance.gif", { width: null, cuts })];
    });
  },
};
