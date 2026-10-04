import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CARDS,
  cardHeight,
  initialFeed,
  pendingApprovals,
  recentJobs,
  reduceFeed,
  runningJobs,
  type FeedState,
} from "../src/feed/reducer.ts";
import type { S2CMessage } from "../src/protocol.ts";

function serve(state: FeedState, ...msgs: S2CMessage[]): FeedState {
  return msgs.reduce((s, msg) => reduceFeed(s, { kind: "server", msg }), state);
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
});

test("ready.jobs seeds the list without duplicating live jobs", () => {
  let s = serve(initialFeed(), { type: "job.started", job_id: "live", request: "live one" });
  s = serve(s, {
    type: "ready",
    user_id: "u",
    device_id: "d",
    voice_holder: null,
    balance: 1,
    gate: {},
    jobs: [
      { job_id: "old", request: "older", status: "done", say: "ok" },
      { job_id: "live", request: "stale copy", status: "queued" },
    ],
  });
  assert.equal(Object.keys(s.jobs).length, 2);
  assert.equal(s.jobs.live.request, "live one");
  assert.equal(s.jobs.old.status, "done");
  assert.deepEqual(
    recentJobs(s).map((j) => j.jobId),
    ["old"],
  );
});

test("progress and done for an unknown job create its card", () => {
  let s = serve(initialFeed(), { type: "job.progress", job_id: "x", text: "step", percent: 150 });
  assert.equal(s.cards.length, 1);
  assert.equal(s.jobs.x.percent, 100);
  s = serve(s, { type: "job.done", job_id: "y", status: "failed", say: "no" });
  assert.equal(s.cards.filter((c) => c.kind === "job").length, 2);
  assert.equal(s.jobs.y.status, "failed");
});

test("interim transcripts replace the open card; final closes it; empty final removes it", () => {
  let s = reduceFeed(initialFeed(), { kind: "transcript", role: "user", text: "hel", final: false });
  s = reduceFeed(s, { kind: "transcript", role: "user", text: "hello", final: false });
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0].kind === "transcript" && s.cards[0].text, "hello");
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "hi there", final: false });
  assert.equal(s.cards.length, 2);
  assert.equal(s.spoken, "hi there");
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "hi there.", final: true });
  assert.equal(s.cards.length, 2);
  assert.equal(s.openTranscript, null);
  s = reduceFeed(s, { kind: "transcript", role: "agent", text: "", final: true });
  assert.equal(s.cards.length, 2);
  // a blank interim is ignored
  s = reduceFeed(s, { kind: "transcript", role: "user", text: "   ", final: false });
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
});

test("credits without voice adds nothing; show updates the pane", () => {
  let s = serve(initialFeed(), { type: "credits", balance: 3, state: "ok" });
  assert.equal(s.cards.length, 0);
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
