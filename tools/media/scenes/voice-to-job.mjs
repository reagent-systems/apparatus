// voice-to-job.gif: the thread column only, drawn at 2x and scaled to the
// README's 880 px. The first frame is the poster: the finished thread (the
// request, the done job card with its table and report.csv, the agent's
// line), held 1 s, then a fade through the page colour into the empty
// thread. A tap turns the agent on, the orb listens and the composer fills in
// what the model heard, the line holds, the user card lands, the agent
// answers and starts the job in the same turn, the job card's steps advance,
// the result lands with its artifact, and the agent speaks the job's say
// line. The story ends on the poster frame, so the loop has no cut. The
// window is tall enough that the thread never scrolls, and no taller.

import { parkPointer, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { RAIL_COLLAPSED, columnClip } from "../lib/column.mjs";
import { GIF_HEARD_MS, GIF_MIC, GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { finish, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { log, sleep } from "../lib/util.mjs";

const DEVICE = { viewport: { width: 1024, height: 780 }, deviceScaleFactor: 2 };

/** The thread must not scroll during the story: the poster would lose its top. */
async function assertNoScroll(page) {
  const s = await page.evaluate(() => {
    const vp = document.querySelector('[data-kind="thread"] [data-radix-scroll-area-viewport]');
    return vp ? { top: vp.scrollTop, over: vp.scrollHeight - vp.clientHeight } : null;
  });
  log(`voice-to-job: thread scrollTop ${s?.top}, overflow ${s?.over}`);
  if (s && s.top > 0) throw new Error(`voice-to-job: the thread scrolled by ${s.top} px; make the window taller`);
}

export default {
  name: "voice-to-job",
  kind: "gif",
  makes: "voice-to-job.gif: tap, speak, listen, answer, job card, steps, result with artifact (thread column, 880 px)",
  async run(ctx) {
    return withApp(ctx, { name: "voice-to-job", device: DEVICE, prefs: RAIL_COLLAPSED, platform: "desktop", mic: GIF_MIC, paceJobsMs: 600 }, async (app) => {
      const { page, live } = app;
      await primeSwitch(app);
      const rec = await record(app, ctx, { fps: 12, clip: await columnClip(page) });
      await sleep(600);
      // The story opens 0.3 s before the tap: the idle orb, then the switch.
      rec.marks.start = Date.now() - 300;
      await tapOrb(app, { big: true });
      await parkPointer(page);
      await live.user(LINES.ordersAsk, { ms: GIF_HEARD_MS });
      const { job_id } = await live.agent(LINES.ordersAck, { tool: { name: "start_job", args: { request: LINES.ordersJob } }, ms: 850 });
      await speakResult(app, job_id, { wps: GIF_WPS });
      await sleep(1000);
      rec.mark("end");
      await assertNoScroll(page);
      return [await finish(rec, ctx, "voice-to-job.gif", { width: 880, posterMs: 1000, posterFade: 4 })];
    });
  },
};
