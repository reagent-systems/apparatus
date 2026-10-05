// A plain working day, played through the page's own voice path: each user
// line is a held orb turn, each agent line is Live audio with its
// transcription, each job is a start_job tool call the client relays to the
// session server. The demo model on the server runs every job for real on
// agentd: a python step that writes report.csv, a show step, the result.
//
// The demo model knows one story (server/apparatus_server/demo.py): a weekly
// orders table, "approve" in a request adds an approval to send a note to
// Dana, "login" in a request starts with a handoff. The lines below are
// written to that story.

import { orb } from "./browser.mjs";
import { LiveStandIn } from "./live.mjs";
import { sleep } from "./util.mjs";

export const LINES = {
  ordersAsk: "Pull this week's orders by region into a table.",
  ordersAck: "Sure, I will pull them now.",
  ordersJob: "Pull this week's orders by region into a table",
  danaAsk: "Email Dana the weekly numbers for Thursday once I approve.",
  danaAck: "I will draft it and check with you before it goes out.",
  danaJob: "Email Dana the weekly numbers for Thursday once I approve",
  danaWait: "The note to Dana is ready. Approve it on your screen.",
};

/** One spoken exchange that starts a job. Resolves with the job id. */
export async function askForJob(app, { ask, ack, request, via = "hold" }) {
  const { page, live } = app;
  await live.user(ask, { via, orb: orb(page), page });
  // The call follows the spoken line's turnComplete. A job card that lands
  // while an agent line is still interim leaves that interim card behind in
  // the thread (feed/reducer.ts closes the open transcript on any new card).
  await live.agent(ack);
  const res = await live.tool("start_job", { request });
  return res.job_id;
}

/** Wait for a job's done event and speak its say line. */
export async function speakResult(app, jobId, { timeout = 60_000 } = {}) {
  const text = await app.live.event(new RegExp(`^<event>job\\.done ${jobId}:`), { timeout });
  await app.live.agent(LiveStandIn.sayOf(text));
}

/**
 * The day behind the stills: a finished orders table, then a note to Dana
 * that waits on an approval (unless `approve` is true, which clicks Approve).
 */
export async function seedDay(app, { approve = false, via = "hold" } = {}) {
  const orders = await askForJob(app, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob, via });
  await speakResult(app, orders);
  await sleep(400);
  const dana = await askForJob(app, { ask: LINES.danaAsk, ack: LINES.danaAck, request: LINES.danaJob, via });
  await app.live.event(/^<event>approval: /);
  await app.live.agent(LINES.danaWait);
  if (approve) {
    await app.page.getByRole("button", { name: "Approve" }).first().click();
    await speakResult(app, dana);
  }
  return { orders, dana };
}
