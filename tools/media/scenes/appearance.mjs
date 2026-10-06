// appearance.gif: Settings, Appearance on the desktop layout, the whole
// window (1024 x 720): the full rail, the thread with one finished job and
// the composer, and the settings popover open from the rail footer for the
// whole GIF. The pointer moves to each choice (its hover fill shows) and
// clicks: Light (borderless, the client's default), Dark, Borders on, Borders
// off, Light again, so the last frame matches the first. Light and Dark hold
// 1.5 s; the Borders states hold 2 s, because in dark the card fill and the
// outlines are the only difference.
//
// 50 fps on page time (lib/vtime.mjs): the pointer glides to each choice a
// frame at a time, and each repaint (the buttons' 150 ms colour transition)
// shows as the app draws it, frame by frame.

import { assertNoEndButton, parkPointer, primeSwitch, threadToEnd, turnOff } from "../lib/browser.mjs";
import { LINES, askForJob, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { openSettings, withApp } from "../lib/scene.mjs";
import { log } from "../lib/util.mjs";

const DEVICE = { viewport: { width: 1024, height: 720 }, deviceScaleFactor: 1.15 };
const FPS = 50;
/** Frames the pointer takes to reach a choice: 0.32 s. */
const GLIDE_FRAMES = 16;

export default {
  name: "appearance",
  kind: "gif",
  makes: "appearance.gif: Light, Dark, Borders on and off in Settings (desktop layout, the whole window)",
  async run(ctx) {
    return withApp(ctx, { name: "appearance", device: DEVICE, platform: "desktop", vtime: FPS }, async (app) => {
      const { page, clock } = app;
      const sleep = (ms) => clock.sleep(ms);
      // Before the recording (page time runs with the wall): one finished job, the agent off, Settings open.
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
      const vp = page.viewportSize();
      const rest = { x: Math.round(vp.width * 0.55), y: 12 }; // where parkPointer leaves it
      let at = { ...rest };
      // The pointer moves one step a frame, eased, so its hover fill shows on the way.
      const glide = async (to) => {
        const from = at;
        for (let i = 1; i <= GLIDE_FRAMES; i++) {
          const e = 0.5 - Math.cos((Math.PI * i) / GLIDE_FRAMES) / 2;
          await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
          await sleep(1000 / FPS);
        }
        at = to;
      };
      const rec = await record(app, ctx, { fps: FPS });
      await sleep(300);
      rec.mark("start");
      await sleep(1500);
      const pick = async (loc, hold) => {
        const box = await loc.boundingBox();
        await glide({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
        await sleep(350);
        log(`appearance: click at page time ${clock.now() - rec.marks.start} ms`);
        await page.mouse.down();
        await sleep(90);
        await page.mouse.up();
        await sleep(hold);
      };
      const radio = (name) => page.getByRole("radio", { name, exact: true }).first();
      const borders = page.getByRole("switch", { name: "Borders", exact: true }).first();
      await pick(radio("Dark"), 1500);
      await pick(borders, 2000);
      await pick(borders, 2000);
      await pick(radio("Light"), 1200);
      // The pointer goes back to where it started, so the last frame matches the first.
      await glide(rest);
      await sleep(400);
      rec.mark("end");
      return [await finish(rec, ctx, "appearance.gif", { width: null })];
    });
  },
};
