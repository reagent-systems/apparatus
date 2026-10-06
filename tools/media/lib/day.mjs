// A plain working day, played through the page's own voice path. Each user
// line is one switch-on: a tap turns the agent on, the microphone opens and
// the fake microphone file plays its speech segment from the start (MIC), the
// gate opens and closes the turn, and the stand-in streams what the model
// heard. Each agent line is Live audio with its transcription. A request is
// the agent's short line and a start_job tool call in the same model turn,
// before turnComplete, as Live sends it; the client relays the call to the
// session server. The demo model on the server runs every job for real on
// agentd: a python step that writes report.csv, a show step, the result.
//
// The demo model picks a story from the request (server/apparatus_server/demo.py):
// the weekly orders table, "compare" or "last week", "revenue", "approve"
// (an email to Dana after an approval) and "login" (a handoff first). Each
// story has its own steps, say line, table and CSV. The agent speaks a job's
// say line unchanged, as the voice prompt asks; its own lines use no
// contractions (docs/STYLE.md rule 7).

import { turnOff, turnOn } from "./browser.mjs";
import { LiveStandIn, speakMs } from "./live.mjs";
import { sleep } from "./util.mjs";

/** The fake microphone: silence, then one spoken line from leadMs to leadMs + sayMs after the microphone opens. */
export const MIC = { leadMs: 600, sayMs: 2600 };
export const MIC_SEGMENTS = [[MIC.leadMs, MIC.leadMs + MIC.sayMs]];
/**
 * The GIFs: the request starts 0.25 s after the microphone opens and lasts
 * 2.6 s; what the model heard is complete after 1.5 s, so the final heard
 * line stays on screen for about 1.5 s before the turn ends. The agent
 * speaks at a brisk 3.4 words a second.
 */
export const GIF_MIC = [[250, 2850]];
/**
 * The request GIFs (voice-to-job, phone): the same request, voiced 0.5 s
 * longer, so the final heard line, the selling point, holds about 2 s above
 * the orb before the turn ends.
 */
export const GIF_MIC_HOLD = [[250, 3350]];
export const GIF_HEARD_MS = 1500;
export const GIF_WPS = 3.4;
/** What the model heard streams in over the voiced part of the segment. */
export const HEARD_MS = MIC.sayMs - 300;

export const LINES = {
  ordersAsk: "Pull this week's orders by region into a table.",
  ordersAck: "On it.",
  ordersJob: "Pull this week's orders by region into a table",
  danaAsk: "Send Dana this week's orders, but let me approve it first.",
  danaAck: "I will draft it and check with you first.",
  danaJob: "Send Dana this week's orders, but let me approve it first",
  danaWait: "It is ready for you to approve.",
  compareAsk: "Compare this week's orders with last week's.",
  compareAck: "Sure, give me a minute.",
  compareJob: "Compare this week's orders with last week's",
  growthAsk: "Which region grew the most since last week?",
  growthAck: "I will check.",
  growthJob: "Which region grew the most since last week",
  revenueAsk: "Which region brought in the most revenue?",
  revenueAck: "Let me check.",
  revenueJob: "Which region brought in the most revenue",
  exportAsk: "Get the export from the reports site. I'll do the login.",
  exportAck: "Okay, I will open the site for you.",
  exportJob: "Get the export from the reports site. I'll do the login",
  exportWait: "The sign-in page is open on your computer.",
  orbAsk: "Check the orders.",
  orbAck: "On it.",
  orbJob: "Check which region had the most orders",
};

/**
 * A fresh switch-on for the next spoken line: off first when the agent is on,
 * so the microphone reopens and the file plays its segment from the start.
 */
export async function freshTurn(app) {
  await turnOff(app);
  await sleep(250);
  await turnOn(app);
}

/** One spoken exchange that starts a job. Resolves with the job id. */
export async function askForJob(app, { ask, ack, request, fresh = true, heardMs = HEARD_MS, wps = null }) {
  const { live } = app;
  if (fresh) await freshTurn(app);
  await live.user(ask, { ms: heardMs });
  const res = await live.agent(ack, { tool: { name: "start_job", args: { request } }, ...(wps ? { ms: speakMs(ack, wps) } : {}) });
  return res.job_id;
}

/**
 * Wait for a job's done event; the agent then speaks the event's say line
 * unchanged, as the voice prompt asks (server/apparatus_server/voice.py:
 * "speak it with almost no change, then stop"). Resolves with the line.
 */
export async function speakResult(app, jobId, { timeout = 60_000, wps = null } = {}) {
  const text = await app.live.event(new RegExp(`^<event>job\\.done ${jobId}:`), { timeout });
  const line = LiveStandIn.sayOf(text);
  await app.live.agent(line, wps ? { ms: speakMs(line, wps) } : {});
  return line;
}
