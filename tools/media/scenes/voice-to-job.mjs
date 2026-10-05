// voice-to-job.gif: the user speaks, the orb listens and the composer fills in
// what the model heard, the agent answers, a job card appears, its steps
// advance, the result lands with its artifact and the agent says it.

import { orb, parkPointer } from "../lib/browser.mjs";
import { LINES, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { sleep } from "../lib/util.mjs";

const LEAD_MS = 500; // from the tap to the first word
const SAY_MS = 2600; // the user's line

export default {
  name: "voice-to-job",
  kind: "gif",
  makes: "voice-to-job.gif: speak, listen, answer, job card, steps, result with artifact",
  async run(ctx) {
    return withApp(ctx, { name: "voice-to-job", device: "gif", paceJobsMs: 1100, mic: [[LEAD_MS, LEAD_MS + SAY_MS]] }, async (app) => {
      const { page, live } = app;
      await parkPointer(page);
      const rec = await record(app, ctx);
      await sleep(600);
      rec.mark("start");
      await orb(page).click();
      await parkPointer(page);
      await live.user(LINES.ordersAsk, { via: "mic", ms: SAY_MS - 300 });
      await live.agent(LINES.ordersAck);
      const { job_id } = await live.tool("start_job", { request: LINES.ordersJob });
      await speakResult(app, job_id);
      await sleep(1000);
      rec.mark("end");
      return [await finish(rec, ctx, "voice-to-job.gif", { width: 1200 })];
    });
  },
};
