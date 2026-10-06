// approval.gif: the thread column, drawn at 2x and scaled to 880 px. The
// first frame is the poster: a job needs you, its approval card waits with
// the amber bar, Approve and Deny. The pointer rests on Approve (its hover
// fill), the user presses it and holds the press for 0.6 s, the bar
// goes and the card reads "Approved" for 0.7 s before the job's next event
// reaches the page (pacer.notBefore), then the job's card returns with its
// steps, the job ends with its table and report.csv, and the agent speaks its
// say line. The end runs on 1.2 s (recorded, not a held frame), then the loop
// closes through the page colour (lib/frames.mjs fadeThroughFrames): two
// layouts never show at once.
//
// 50 fps on page time (lib/vtime.mjs): every frame is its own moment of the
// app, 20 ms after the one before; the hover fill and the press are CSS
// transitions moved on with the page's clock.

import { parkPointer } from "../lib/browser.mjs";
import { RAIL_COLLAPSED, columnClip } from "../lib/column.mjs";
import { GIF_HEARD_MS, GIF_MIC, GIF_WPS, LINES, askForJob, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";

const DEVICE = { viewport: { width: 1024, height: 960 }, deviceScaleFactor: 2 };
const FPS = 50;

export default {
  name: "approval",
  kind: "gif",
  makes: "approval.gif: the approval card, Approve, the job runs and ends (thread column)",
  async run(ctx) {
    return withApp(ctx, { name: "approval", device: DEVICE, prefs: RAIL_COLLAPSED, platform: "desktop", mic: GIF_MIC, paceJobsMs: 600, vtime: FPS }, async (app) => {
      const { page, live, clock } = app;
      const sleep = (ms) => clock.sleep(ms);
      // Before the recording (page time runs with the wall): the request, and the card that needs you.
      const jobId = await askForJob(app, { ask: LINES.danaAsk, ack: LINES.danaAck, request: LINES.danaJob, heardMs: GIF_HEARD_MS });
      await live.event(/^<event>approval: /);
      await live.agent(LINES.danaWait);
      await parkPointer(page);
      await sleep(800);
      const rec = await record(app, ctx, { fps: FPS, clip: await columnClip(page) });
      await sleep(300);
      rec.mark("start");
      await sleep(1300); // the card waits with its amber bar
      const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
      await approve.hover();
      await sleep(700); // the hover fill
      await page.mouse.down();
      await sleep(600); // active:scale-[.97]
      // The job's next event waits 0.7 s of page time at the browser, so "Approved" reads before the card moves.
      app.pacer.notBefore = clock.now() + 700;
      await page.mouse.up();
      await sleep(150);
      await parkPointer(page);
      await speakResult(app, jobId, { wps: GIF_WPS });
      await sleep(1500); // the end, 1.2 s of it after the line's last word
      rec.mark("end");
      // The loop closes through the page colour over 17 + 1 + 17 frames, 0.7 s at 50 fps.
      return [await finish(rec, ctx, "approval.gif", { width: 880, fadeThrough: 17 })];
    });
  },
};
