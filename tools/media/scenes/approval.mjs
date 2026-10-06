// approval.gif: the thread column. The first frame is the poster: a job needs
// you, its approval card waits with the amber bar, Approve and Deny. The user
// presses Approve (the pressed state shows for about 3 frames), the bar goes
// and the card reads "Approved", the job's card returns with its steps, the
// job ends with its table and report.csv, and the agent speaks its say line.
// The loop closes through the page colour (lib/gif.mjs fadeThroughLoop): the
// end fades out, the poster fades in; two layouts never show at once.

import { parkPointer } from "../lib/browser.mjs";
import { COLUMN_GIF, RAIL_COLLAPSED, columnClip } from "../lib/column.mjs";
import { GIF_HEARD_MS, GIF_MIC, GIF_WPS, LINES, askForJob, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

const DEVICE = { ...COLUMN_GIF, viewport: { width: 1024, height: 960 } };

export default {
  name: "approval",
  kind: "gif",
  makes: "approval.gif: the approval card, Approve, the job runs and ends (thread column)",
  async run(ctx) {
    return withApp(ctx, { name: "approval", device: DEVICE, prefs: RAIL_COLLAPSED, platform: "desktop", mic: GIF_MIC, paceJobsMs: 600 }, async (app) => {
      const { page, live } = app;
      // Before the recording: the request, and the card that needs you.
      const jobId = await askForJob(app, { ask: LINES.danaAsk, ack: LINES.danaAck, request: LINES.danaJob, heardMs: GIF_HEARD_MS });
      await live.event(/^<event>approval: /);
      await live.agent(LINES.danaWait);
      await parkPointer(page);
      await sleep(800);
      const rec = await record(app, ctx, { fps: 12, clip: await columnClip(page) });
      await sleep(300);
      rec.mark("start");
      await sleep(1300); // the card waits with its amber bar
      const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
      await approve.hover();
      await sleep(500);
      await page.mouse.down();
      await sleep(250); // active:scale-[.97]: about 3 frames
      await page.mouse.up();
      await sleep(150);
      await parkPointer(page);
      await speakResult(app, jobId, { wps: GIF_WPS });
      await sleep(1000);
      rec.mark("end");
      return [await finish(rec, ctx, "approval.gif", { width: null, fadeThrough: 4 })];
    });
  },
};
