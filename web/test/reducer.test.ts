import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CARDS,
  MAX_PROGRESS,
  cardHeight,
  detailsText,
  initialFeed,
  jobOf,
  needsYou,
  openApprovals,
  openHandoffs,
  pendingApprovals,
  recentJobs,
  reduceFeed,
  runningJobs,
  seedFromReady,
  type FeedState,
} from "../src/feed/reducer.ts";
import { bucketOf, glyphOf } from "../src/lib/status.ts";
import type { S2CMessage, S2CReady } from "../src/protocol.ts";

const T0 = Date.UTC(2026, 9, 4, 9, 0, 0);

function serve(state: FeedState, ...msgs: S2CMessage[]): FeedState {
  return msgs.reduce((s, msg) => reduceFeed(s, { kind: "server", msg }, T0), state);
}

function serveAt(state: FeedState, now: number, ...msgs: S2CMessage[]): FeedState {
  return msgs.reduce((s, msg) => reduceFeed(s, { kind: "server", msg }, now), state);
}

function ready(jobs: S2CReady["jobs"]): S2CReady {
  return { type: "ready", user_id: "u", device_id: "d", voice_holder: null, balance: 1, gate: {}, jobs };
}

test("job events build the running and recent lists", () => {
  let s = serve(
    initialFeed(),
    { type: "job.started", job_id: "a", request: "first" },
    { type: "job.started", job_id: "b", request: "second" },
    { type: "job.progress", job_id: "a", text: "half", percent: 50 },
  );
  assert.deepEqual(
    runningJobs(s).map((j) => j.jobId),
    ["b", "a"],
  );
  assert.equal(s.jobs.a.progress, "half");
  assert.equal(s.jobs.a.percent, 50);
  assert.deepEqual(recentJobs(s), []);

  s = serve(s, { type: "job.done", job_id: "a", status: "done", say: "done with first", show: "# out" });
  assert.deepEqual(
    runningJobs(s).map((j) => j.jobId),
    ["b"],
  );
  assert.deepEqual(
    recentJobs(s).map((j) => j.jobId),
    ["a"],
  );
  assert.equal(s.jobs.a.say, "done with first");
  assert.equal(s.jobs.a.show, "# out");
  assert.equal(s.show, "# out");
  assert.equal(s.spoken, "done with first");
  assert.equal(jobOf(s, "a"), s.jobs.a);
  assert.equal(jobOf(s, "zz"), undefined);
});

test("a job carries its start and end times and its artifacts", () => {
  let s = serveAt(initialFeed(), T0, { type: "job.started", job_id: "a", request: "first" });
  assert.equal(s.jobs.a.startedAt, T0);
  assert.equal(s.jobs.a.endedAt, null);
  assert.deepEqual(s.jobs.a.artifacts, []);
  assert.equal(s.cards[0].kind === "job" && s.cards[0].at, T0);
  s = serveAt(s, T0 + 8_000, {
    type: "job.done",
    job_id: "a",
    status: "done",
    say: "ok",
    artifacts: ["/home/agent/out/report.md", "/home/agent/out/data.csv"],
  });
  assert.equal(s.jobs.a.endedAt, T0 + 8_000);
  assert.deepEqual(s.jobs.a.artifacts, ["/home/agent/out/report.md", "/home/agent/out/data.csv"]);
  // A second start for the same job keeps the first start time and the request.
  s = serveAt(s, T0 + 9_000, { type: "job.started", job_id: "a", request: "" });
  assert.equal(s.jobs.a.startedAt, T0);
  assert.equal(s.jobs.a.request, "first");
});

test("progress lines accumulate, newest last, capped at MAX_PROGRESS", () => {
  let s = serve(initialFeed(), { type: "job.started", job_id: "a", request: "r" });
  for (let i = 1; i <= MAX_PROGRESS + 7; i++) {
    s = serve(s, { type: "job.progress", job_id: "a", text: `step ${i}`, percent: null });
  }
  assert.equal(s.jobs.a.progressHistory.length, MAX_PROGRESS);
  assert.equal(s.jobs.a.progressHistory[0], "step 8");
  assert.equal(s.jobs.a.progressHistory[MAX_PROGRESS - 1], `step ${MAX_PROGRESS + 7}`);
  assert.equal(s.jobs.a.progress, `step ${MAX_PROGRESS + 7}`);
  // An empty progress text updates the percent only.
  s = serve(s, { type: "job.progress", job_id: "a", text: "", percent: 90 });
  assert.equal(s.jobs.a.progressHistory.length, MAX_PROGRESS);
  assert.equal(s.jobs.a.percent, 90);
});

test("ready.jobs seeds the list without duplicating live jobs", () => {
  let s = serve(initialFeed(), { type: "job.started", job_id: "live", request: "live one" });
  s = serve(
    s,
    ready([
      { job_id: "old", request: "older", status: "done", say: "ok" },
      { job_id: "live", request: "stale copy", status: "queued" },
    ]),
  );
  assert.equal(Object.keys(s.jobs).length, 2);
  assert.equal(s.cards.filter((c) => c.kind === "job").length, 1);
  assert.equal(s.jobs.live.request, "live one");
  assert.equal(s.jobs.old.status, "done");
  assert.deepEqual(
    recentJobs(s).map((j) => j.jobId),
    ["old"],
  );
  assert.deepEqual(s.credits, { balance: 1, state: "ok" });
});

test("seedFromReady reads progress_history, artifacts and the epoch-second times", () => {
  const s = seedFromReady(
    initialFeed(),
    ready([
      {
        job_id: "h",
        request: "with history",
        status: "running",
        created: 1_700_000_000,
        started: 1_700_000_010,
        ended: null,
        progress: "step 3",
        percent: 40,
        progress_history: ["step 1", "step 2", "step 3"],
        artifacts: ["/x/a.txt"],
      } as never,
      { job_id: "n", request: "no history", status: "done", created: 1_600_000_000.4, ended: 1_600_000_100, progress: "last" },
    ]),
  );
  assert.deepEqual(s.jobs.h.progressHistory, ["step 1", "step 2", "step 3"]);
  assert.equal(s.jobs.h.progress, "step 3");
  assert.deepEqual(s.jobs.h.artifacts, ["/x/a.txt"]);
  assert.equal(s.jobs.h.startedAt, 1_700_000_010_000);
  assert.equal(s.jobs.h.endedAt, null);
  // Without a history the latest progress line is the one history row.
  assert.deepEqual(s.jobs.n.progressHistory, ["last"]);
  assert.equal(s.jobs.n.startedAt, 1_600_000_000_400);
  assert.equal(s.jobs.n.endedAt, 1_600_000_100_000);
  assert.deepEqual(s.jobs.n.artifacts, []);
  // A history longer than the cap keeps the newest lines.
  const long = seedFromReady(
    initialFeed(),
    ready([{ job_id: "l", request: "long", status: "running", progress_history: Array.from({ length: 80 }, (_, i) => `s${i}`) } as never]),
  );
  assert.equal(long.jobs.l.progressHistory.length, MAX_PROGRESS);
  assert.equal(long.jobs.l.progressHistory[0], "s30");
});

test("a reconnect's ready ends a job that finished while the socket was down", () => {
  let s = serveAt(
    initialFeed(),
    T0,
    { type: "job.started", job_id: "r", request: "build the report" },
    { type: "job.progress", job_id: "r", text: "one", percent: 10 },
    { type: "job.progress", job_id: "r", text: "two", percent: 20 },
  );
  assert.deepEqual(
    runningJobs(s).map((j) => j.jobId),
    ["r"],
  );
  s = serveAt(
    s,
    T0 + 60_000,
    ready([
      {
        job_id: "r",
        request: "build the report",
        status: "done",
        say: "Report ready.",
        show: "# Report",
        progress: "two",
        percent: 100,
        ended: (T0 + 30_000) / 1000,
        artifacts: ["/out/report.md"],
      } as never,
    ]),
  );
  const r = s.jobs.r;
  assert.equal(r.status, "done");
  assert.equal(r.say, "Report ready.");
  assert.equal(r.show, "# Report");
  assert.equal(r.percent, null);
  assert.equal(r.startedAt, T0);
  assert.equal(r.endedAt, T0 + 30_000);
  assert.deepEqual(r.artifacts, ["/out/report.md"]);
  // The live history is longer than the server's, so it stays.
  assert.deepEqual(r.progressHistory, ["one", "two"]);
  assert.deepEqual(runningJobs(s), []);
  assert.deepEqual(
    recentJobs(s).map((j) => j.jobId),
    ["r"],
  );
  assert.equal(s.cards.filter((c) => c.kind === "job").length, 1);
});

test("seedFromReady(ready) starts from an empty feed", () => {
  const s = seedFromReady(ready([{ job_id: "a", request: "alpha", status: "queued", progress_history: ["x", "y"] } as never]));
  assert.equal(jobOf(s, "a")?.status, "queued");
  assert.deepEqual(s.jobs.a.progressHistory, ["x", "y"]);
  assert.deepEqual(s.cards, []);
});

test("progress and done for an unknown job create its card", () => {
  let s = serve(initialFeed(), { type: "job.progress", job_id: "x", text: "step", percent: 150 });
  assert.equal(s.cards.length, 1);
  assert.equal(s.jobs.x.percent, 100);
  assert.deepEqual(s.jobs.x.progressHistory, ["step"]);
  s = serve(s, { type: "job.done", job_id: "y", status: "failed", say: "no" });
  assert.equal(s.cards.filter((c) => c.kind === "job").length, 2);
  assert.equal(s.jobs.y.status, "failed");
});

test("interim transcripts replace the open card; final closes it; empty final removes it", () => {
  let s = reduceFeed(initialFeed(), { kind: "transcript", role: "user", text: "hel", final: false }, T0);
  s = reduceFeed(s, { kind: "transcript", role: "user", text: "hello", final: false }, T0 + 500);
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0].kind === "transcript" && s.cards[0].text, "hello");
  // The card keeps the time it opened.
  assert.equal(s.cards[0].at, T0);
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "hi there", final: false }, T0 + 1000);
  assert.equal(s.cards.length, 2);
  assert.equal(s.spoken, "hi there");
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "hi there.", final: true }, T0 + 1500);
  assert.equal(s.cards.length, 2);
  assert.equal(s.openTranscript, null);
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "", final: true }, T0 + 2000);
  assert.equal(s.cards.length, 2);
  // a blank interim is ignored
  s = reduceFeed(s, { kind: "transcript", role: "user", text: "   ", final: false }, T0 + 2500);
  assert.equal(s.cards.length, 2);
});

test("a job card closes an open transcript", () => {
  let s = reduceFeed(initialFeed(), { kind: "transcript", role: "user", text: "start it", final: false });
  s = serve(s, { type: "job.started", job_id: "j", request: "start it" });
  assert.equal(s.openTranscript, null);
  s = reduceFeed(s, { kind: "transcript", role: "user", text: "more", final: false });
  assert.equal(s.cards.length, 3);
});

test("cards have mixed heights", () => {
  let s = reduceFeed(initialFeed(), { kind: "transcript", role: "user", text: "short", final: true });
  s = serve(
    s,
    { type: "job.started", job_id: "j", request: "tall" },
    { type: "approval.requested", approval_id: "ap", job_id: "j", action: "send", details: "an email" },
    { type: "handoff.requested", handoff_id: "h", job_id: "j", reason: "log in" },
    { type: "credits", balance: 3, state: "low", voice: "credits are low" },
  );
  assert.deepEqual(s.cards.map(cardHeight), ["short", "tall", "tall", "tall", "short"]);
  assert.equal(s.spoken, "credits are low");
  const credits = s.cards[4];
  assert.ok(credits.kind === "credits" && credits.balance === 3 && credits.state === "low");
});

test("approvals answer and handoffs end", () => {
  let s = serve(
    initialFeed(),
    { type: "approval.requested", approval_id: "ap", job_id: "j", action: "send", details: "an email" },
    { type: "handoff.requested", handoff_id: "h", job_id: "j", reason: "log in" },
  );
  assert.equal(pendingApprovals(s).length, 1);
  assert.deepEqual(s.handoff, { handoffId: "h", reason: "log in" });
  s = serve(s, { type: "approval.ended", approval_id: "ap", approved: true });
  assert.equal(pendingApprovals(s).length, 0);
  assert.equal(s.cards[0].kind === "approval" && s.cards[0].approved, true);
  s = serve(s, { type: "handoff.ended", handoff_id: "other", outcome: "cancel" });
  assert.notEqual(s.handoff, null);
  s = serve(s, { type: "handoff.ended", handoff_id: "h", outcome: "done" });
  assert.equal(s.handoff, null);
  assert.equal(s.cards[1].kind === "handoff" && s.cards[1].outcome, "done");
});

test("approvals and handoffs are indexed by their own id and by job id", () => {
  let s = serve(
    initialFeed(),
    { type: "job.started", job_id: "j", request: "r" },
    { type: "approval.requested", approval_id: "a1", job_id: "j", action: "send", details: "mail" },
  );
  assert.equal(s.approvals.a1.jobId, "j");
  assert.equal(s.approvals.j.approvalId, "a1");
  assert.equal(bucketOf(s.jobs.j, s), "needs_you");
  assert.equal(glyphOf(s.jobs.j, s).kind, "approval");

  s = serve(s, { type: "approval.ended", approval_id: "a1", approved: false });
  assert.equal(s.approvals.a1.approved, false);
  assert.equal(s.approvals.j.approved, false);
  assert.equal(bucketOf(s.jobs.j, s), "running");

  // A second approval for the same job takes over the job key; answering
  // the first afterwards leaves the job key on the second.
  s = serve(
    s,
    { type: "approval.requested", approval_id: "a2", job_id: "j", action: "delete", details: "rm -rf build" },
    { type: "approval.ended", approval_id: "a1", approved: true },
  );
  assert.equal(s.approvals.j.approvalId, "a2");
  assert.equal(s.approvals.a1.approved, true);
  assert.equal(openApprovals(s).length, 1);

  s = serve(s, { type: "handoff.requested", handoff_id: "h1", job_id: "j", reason: "log in" });
  assert.equal(s.handoffs.h1.reason, "log in");
  assert.equal(s.handoffs.j.handoffId, "h1");
  assert.equal(glyphOf(s.jobs.j, s).kind, "approval");
  s = serve(s, { type: "approval.ended", approval_id: "a2", approved: true });
  assert.equal(glyphOf(s.jobs.j, s).kind, "handoff");
  s = serve(s, { type: "handoff.ended", handoff_id: "h1", outcome: "timeout" });
  assert.equal(s.handoffs.j.outcome, "timeout");
  assert.equal(openHandoffs(s).length, 0);
  assert.equal(bucketOf(s.jobs.j, s), "running");
});

test("needsYou lists open approvals and handoffs oldest first, each once", () => {
  let s = serve(
    initialFeed(),
    { type: "handoff.requested", handoff_id: "h1", job_id: "j1", reason: "first" },
    { type: "approval.requested", approval_id: "a1", job_id: "j2", action: "second", details: "" },
    { type: "handoff.requested", handoff_id: "h2", job_id: "j1", reason: "third" },
    { type: "approval.requested", approval_id: "a2", job_id: "j3", action: "fourth", details: "" },
  );
  assert.deepEqual(
    needsYou(s).map((n) => (n.kind === "approval" ? n.approvalId : n.handoffId)),
    ["h1", "a1", "h2", "a2"],
  );
  s = serve(s, { type: "approval.ended", approval_id: "a1", approved: true }, { type: "handoff.ended", handoff_id: "h1", outcome: "done" });
  assert.deepEqual(
    needsYou(s).map((n) => (n.kind === "approval" ? n.approvalId : n.handoffId)),
    ["h2", "a2"],
  );
  assert.equal(needsYou(initialFeed()).length, 0);
});

test("Done or Cancel closes the handoff locally", () => {
  let s = serve(initialFeed(), { type: "handoff.requested", handoff_id: "h", job_id: "j", reason: "log in" });
  s = reduceFeed(s, { kind: "handoffClosed" });
  assert.equal(s.handoff, null);
  assert.equal(reduceFeed(s, { kind: "handoffClosed" }), s);
});

test("a push notification opens a handoff by id", () => {
  let s = reduceFeed(initialFeed(), { kind: "handoffOpened", handoffId: "h" });
  assert.deepEqual(s.handoff, { handoffId: "h", reason: "" });
  assert.equal(reduceFeed(s, { kind: "handoffOpened", handoffId: "h" }), s);
  s = serve(s, { type: "handoff.ended", handoff_id: "h", outcome: "timeout" });
  assert.equal(s.handoff, null);
  // A known handoff reopened by id keeps its reason.
  let k = serve(initialFeed(), { type: "handoff.requested", handoff_id: "h2", job_id: "j", reason: "sign" });
  k = reduceFeed(k, { kind: "handoffClosed" });
  k = reduceFeed(k, { kind: "handoffOpened", handoffId: "h2" });
  assert.deepEqual(k.handoff, { handoffId: "h2", reason: "sign" });
});

test("credits without voice adds no card but keeps the balance; show updates the pane", () => {
  let s = serve(initialFeed(), { type: "credits", balance: 3, state: "ok" });
  assert.equal(s.cards.length, 0);
  assert.deepEqual(s.credits, { balance: 3, state: "ok" });
  s = serve(s, { type: "show", content: "**bold**" });
  assert.equal(s.show, "**bold**");
  assert.equal(s.cards.length, 0);
});

test("the feed keeps at most MAX_CARDS cards", () => {
  let s = initialFeed();
  for (let i = 0; i < MAX_CARDS + 20; i++) {
    s = reduceFeed(s, { kind: "transcript", role: "user", text: `t${i}`, final: true });
  }
  assert.equal(s.cards.length, MAX_CARDS);
  assert.equal(s.cards[0].kind === "transcript" && s.cards[0].text, "t20");
});

test("approval details become literal text", () => {
  const s = serve(initialFeed(), {
    type: "approval.requested",
    approval_id: "ap",
    job_id: "j",
    action: "send",
    details: { to: "dana@example.com", subject: "Thursday" },
  });
  const card = s.cards[0];
  assert.ok(card.kind === "approval");
  assert.equal(card.details, "to: dana@example.com\nsubject: Thursday");
  assert.equal(detailsText(null), "");
  assert.equal(detailsText("rm -rf build"), "rm -rf build");
  assert.equal(detailsText(["a", 1]), '["a",1]');
  assert.equal(detailsText({ n: 2, list: [1] }), "n: 2\nlist: [1]");
});
