import { test } from "node:test";
import assert from "node:assert/strict";
import { initialFeed, reduceFeed, type FeedState } from "../src/feed/reducer.ts";
import {
  DAY_LABEL,
  FILTER_LABEL,
  JOB_CHIPS,
  JOB_FILTERS,
  blockerOf,
  dayOf,
  filterOfBucket,
  groupJobs,
  isJobFilter,
  jobCounts,
  jobSubtitle,
  jobTime,
  matchesFilter,
} from "../src/lib/jobs-list.ts";
import { bucketOf } from "../src/lib/status.ts";
import type { S2CMessage } from "../src/protocol.ts";

// Local times, so the Today / Earlier split does not depend on the zone.
const NOW = new Date(2026, 9, 4, 15, 0, 0).getTime();
const MORNING = new Date(2026, 9, 4, 9, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 3, 18, 0, 0).getTime();

function at(state: FeedState, now: number, ...msgs: S2CMessage[]): FeedState {
  return msgs.reduce((s, msg) => reduceFeed(s, { kind: "server", msg }, now), state);
}

/** Nine jobs: 2 need you, 3 run, 4 ended (one failed), the chip example of DESIGN.md 5. */
function nine(): FeedState {
  let s = initialFeed();
  s = at(
    s,
    YESTERDAY,
    { type: "job.started", job_id: "old-done", request: "old report" },
    { type: "job.done", job_id: "old-done", status: "done", say: "report filed" },
  );
  s = at(
    s,
    MORNING,
    { type: "job.started", job_id: "done-1", request: "sort mail" },
    { type: "job.started", job_id: "failed-1", request: "build site" },
    { type: "job.started", job_id: "cancelled-1", request: "book table" },
    { type: "job.started", job_id: "appr", request: "send invoice" },
    { type: "job.started", job_id: "hand", request: "log in to bank" },
  );
  s = at(
    s,
    NOW - 60_000,
    { type: "job.done", job_id: "done-1", status: "done", say: "mail sorted" },
    { type: "job.done", job_id: "failed-1", status: "failed", say: "build broke" },
    { type: "job.done", job_id: "cancelled-1", status: "cancelled", say: "" },
    { type: "approval.requested", approval_id: "a1", job_id: "appr", action: "send email", details: "to: x@y" },
    { type: "handoff.requested", handoff_id: "h1", job_id: "hand", reason: "enter the code" },
    { type: "job.started", job_id: "run-1", request: "scan files" },
    { type: "job.progress", job_id: "run-1", text: "reading 4 of 9", percent: 44 },
    { type: "job.started", job_id: "run-2", request: "draft post" },
    { type: "job.started", job_id: "run-3", request: "clean disk" },
  );
  return s;
}

test("three chips and the chipless all filter; failed counts under Done", () => {
  assert.deepEqual(JOB_FILTERS, ["all", "needs_you", "running", "done"]);
  assert.deepEqual(JOB_CHIPS, ["needs_you", "running", "done"]);
  assert.deepEqual(Object.values(FILTER_LABEL), ["Needs you", "Running", "Done"]);
  assert.equal(filterOfBucket("failed"), "done");
  assert.equal(filterOfBucket("needs_you"), "needs_you");
  assert.ok(matchesFilter("failed", "done"));
  assert.ok(matchesFilter("running", "all"));
  assert.ok(!matchesFilter("running", "done"));
  assert.ok(isJobFilter("needs_you"));
  assert.ok(!isJobFilter("failed"));
  assert.ok(!isJobFilter(""));
});

test("counts add up to All: 9 = 2 + 3 + 4", () => {
  assert.deepEqual(jobCounts(nine()), { all: 9, needs_you: 2, running: 3, done: 4 });
  assert.deepEqual(jobCounts(initialFeed()), { all: 0, needs_you: 0, running: 0, done: 0 });
});

test("groups follow the bucket order and drop empty buckets", () => {
  const s = nine();
  const all = groupJobs(s, "all", NOW);
  assert.deepEqual(
    all.map((g) => g.bucket),
    ["needs_you", "failed", "running", "done"],
  );
  const done = groupJobs(s, "done", NOW);
  assert.deepEqual(
    done.map((g) => g.bucket),
    ["failed", "done"],
  );
  assert.deepEqual(groupJobs(initialFeed(), "all", NOW), []);
  const running = groupJobs(s, "running", NOW);
  assert.equal(running.length, 1);
  assert.deepEqual(
    running[0].sections.flatMap((x) => x.jobs.map((j) => j.jobId)),
    ["run-3", "run-2", "run-1"],
  );
});

test("Today and Earlier split a group; an empty section is absent", () => {
  const done = groupJobs(nine(), "done", NOW).find((g) => g.bucket === "done");
  assert.ok(done);
  assert.deepEqual(
    done.sections.map((x) => x.day),
    ["today", "earlier"],
  );
  assert.deepEqual(
    done.sections[0].jobs.map((j) => j.jobId).sort(),
    ["cancelled-1", "done-1"],
  );
  assert.deepEqual(
    done.sections[1].jobs.map((j) => j.jobId),
    ["old-done"],
  );
  const failed = groupJobs(nine(), "all", NOW).find((g) => g.bucket === "failed");
  assert.deepEqual(
    failed?.sections.map((x) => x.day),
    ["today"],
  );
  assert.equal(DAY_LABEL.today, "Today");
  assert.equal(DAY_LABEL.earlier, "Earlier");
});

test("what needs you lists the longest wait first", () => {
  const needs = groupJobs(nine(), "needs_you", NOW)[0];
  assert.equal(needs.bucket, "needs_you");
  // The approval came before the handoff.
  assert.deepEqual(
    needs.sections.flatMap((x) => x.jobs.map((j) => j.jobId)),
    ["appr", "hand"],
  );
});

test("an answered blocker moves the job out of Needs you", () => {
  let s = nine();
  s = at(s, NOW, { type: "approval.ended", approval_id: "a1", approved: true });
  assert.equal(blockerOf(s, "appr"), null);
  assert.equal(bucketOf(s.jobs.appr, s), "running");
  assert.deepEqual(jobCounts(s), { all: 9, needs_you: 1, running: 4, done: 4 });
});

test("the blocker is the oldest open approval or handoff of the job", () => {
  let s = nine();
  assert.equal(blockerOf(s, "appr")?.kind, "approval");
  assert.equal(blockerOf(s, "hand")?.kind, "handoff");
  assert.equal(blockerOf(s, "run-1"), null);
  s = at(s, NOW, { type: "approval.requested", approval_id: "a2", job_id: "appr", action: "pay", details: "" });
  const b = blockerOf(s, "appr");
  assert.ok(b && b.kind === "approval");
  assert.equal(b.approvalId, "a1");
});

test("the subtitle is the blocker, the progress, or the say line", () => {
  const s = nine();
  const sub = (id: string): string => jobSubtitle(s.jobs[id], bucketOf(s.jobs[id], s), blockerOf(s, id));
  assert.equal(sub("appr"), "send email");
  assert.equal(sub("hand"), "enter the code");
  assert.equal(sub("run-1"), "reading 4 of 9");
  assert.equal(sub("done-1"), "mail sorted");
  assert.equal(sub("failed-1"), "build broke");
  const needsUser = at(s, NOW, { type: "job.progress", job_id: "run-2", text: "waiting for a reply", percent: null });
  const job = { ...needsUser.jobs["run-2"], status: "needs_user" as const };
  assert.equal(jobSubtitle(job, "needs_you", null), "waiting for a reply");
});

test("a row's time is the end once ended, else the start", () => {
  assert.equal(jobTime({ startedAt: 1, endedAt: 2 }), 2);
  assert.equal(jobTime({ startedAt: 1, endedAt: null }), 1);
  assert.equal(jobTime({ startedAt: null, endedAt: null }), null);
  assert.equal(dayOf(null, NOW), "earlier");
  assert.equal(dayOf(MORNING, NOW), "today");
  assert.equal(dayOf(YESTERDAY, NOW), "earlier");
});
