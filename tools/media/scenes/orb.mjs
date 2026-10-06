// orb.gif and orb-dark.gif: a square close-up of the phone composer's orb
// (56 px at 3x; the orb draws its dots at 2x, its own cap) through one
// exchange: idle (the agent off), a tap, listening while the composer shows
// what the model heard ("Check the orders."), the short answer, working while
// the job runs, speaking its result, a tap, idle. Borders off, so the
// composer draws no line around the orb. The GIF starts and ends with the
// agent off, so the loop joins two idle frames. The light and dark scenes run
// the same script with the same waits.

import { orb, parkPointer, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { GIF_MIC, GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

/** CSS px: wide enough for the heard line; the 56 px orb sits 14 px above the bottom edge. */
const SIDE = 140;
const BELOW = 14;
const ORB_GIF = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true };

async function shoot(ctx, theme) {
  const file = theme === "dark" ? "orb-dark.gif" : "orb.gif";
  return withApp(ctx, { name: `orb-${theme}`, device: ORB_GIF, theme, borders: "off", mic: GIF_MIC, paceJobsMs: 500 }, async (app) => {
    const { page, live } = app;
    await primeSwitch(app);
    const b = await orb(page).boundingBox();
    const clip = { x: Math.round(b.x + b.width / 2 - SIDE / 2), y: Math.round(b.y + b.height + BELOW - SIDE), width: SIDE, height: SIDE };
    const rec = await record(app, ctx, { fps: 15, clip });
    await sleep(500);
    rec.mark("start");
    await sleep(1600); // idle: the agent is off, the orb breathes slowly
    await tapOrb(app);
    await parkPointer(page);
    await live.user(LINES.orbAsk, { ms: 1400 });
    const { job_id } = await live.agent(LINES.orbAck, { tool: { name: "start_job", args: { request: LINES.orbJob } }, ms: 850 });
    await speakResult(app, job_id, { wps: GIF_WPS });
    await tapOrb(app); // off: idle
    await parkPointer(page);
    await sleep(1600);
    rec.mark("end");
    return finish(rec, ctx, file, { width: null });
  });
}

export default {
  name: "orb",
  kind: "gif",
  makes: "orb.gif, orb-dark.gif: the orb close: idle, listening, working, speaking, idle",
  async run(ctx) {
    return [await shoot(ctx, "light"), await shoot(ctx, "dark")];
  },
};
