// voice-to-job.gif: the thread column only. The first frame is the poster:
// the finished thread (the request, the done job card with its table and
// report.csv, the agent's line), held 1 s. Then the empty thread: a tap turns
// the agent on, the orb listens and the composer fills in what the model
// heard, the user card lands, the agent answers and starts the job in the same
// turn, the job card's steps advance, the result lands with its artifact, and
// the agent speaks the job's say line. The story ends on the poster frame, so
// the loop has no cut. The window is tall enough that the thread never scrolls.

import { parkPointer, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { COLUMN_GIF, RAIL_COLLAPSED, columnClip } from "../lib/column.mjs";
import { GIF_HEARD_MS, GIF_MIC, GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

const DEVICE = { ...COLUMN_GIF, viewport: { width: 1024, height: 820 } };

export default {
  name: "voice-to-job",
  kind: "gif",
  makes: "voice-to-job.gif: tap, speak, listen, answer, job card, steps, result with artifact (thread column)",
  async run(ctx) {
    return withApp(ctx, { name: "voice-to-job", device: DEVICE, prefs: RAIL_COLLAPSED, platform: "desktop", mic: GIF_MIC, paceJobsMs: 600 }, async (app) => {
      const { page, live } = app;
      await primeSwitch(app);
      const rec = await record(app, ctx, { fps: 12, clip: await columnClip(page) });
      await sleep(1200);
      await tapOrb(app, { big: true });
      await parkPointer(page);
      // The story starts 0.9 s before the gate opens: the tap, the Live
      // session opening and the first sound, with no long idle.
      rec.marks.start = (await live.activity("activityStart", live.turnCursor, 20_000)).at - 900;
      await live.user(LINES.ordersAsk, { ms: GIF_HEARD_MS });
      const { job_id } = await live.agent(LINES.ordersAck, { tool: { name: "start_job", args: { request: LINES.ordersJob } }, ms: 850 });
      await speakResult(app, job_id, { wps: GIF_WPS });
      await sleep(1000);
      rec.mark("end");
      return [await finish(rec, ctx, "voice-to-job.gif", { width: null, posterMs: 1000 })];
    });
  },
};
