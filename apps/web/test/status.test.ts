import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUCKETS,
  bucketOf,
  elapsedTime,
  foldsIntoRequest,
  glyphOf,
  relativeTime,
  sameDay,
  shortDate,
  type StatusState,
} from "../src/lib/status.ts";
import type { JobStatus } from "../src/protocol.ts";

const job = (status: JobStatus, jobId = "j1") => ({ jobId, status });
const none: StatusState = {};

test("every status lands in one bucket in Paseo's order", () => {
  assert.deepEqual(BUCKETS, ["needs_you", "failed", "running", "done"]);
  assert.equal(bucketOf(job("needs_user"), none), "needs_you");
  assert.equal(bucketOf(job("failed"), none), "failed");
  for (const s of ["running", "queued", "paused"] as JobStatus[]) assert.equal(bucketOf(job(s), none), "running");
  for (const s of ["done", "cancelled"] as JobStatus[]) assert.equal(bucketOf(job(s), none), "done");
});

test("an open approval or handoff for the job beats failed and running", () => {
  const approval: StatusState = { approvals: { a1: { jobId: "j1", approved: null } } };
  const handoff: StatusState = { handoffs: { h1: { jobId: "j1", outcome: null } } };
  for (const s of ["running", "failed", "done"] as JobStatus[]) {
    assert.equal(bucketOf(job(s), approval), "needs_you");
    assert.equal(bucketOf(job(s), handoff), "needs_you");
  }
  // Another job's approval changes nothing.
  assert.equal(bucketOf(job("running", "j2"), approval), "running");
  assert.equal(bucketOf(job("failed", "j2"), handoff), "failed");
});

test("an answered approval or an ended handoff no longer needs you", () => {
  const state: StatusState = {
    approvals: { a1: { jobId: "j1", approved: true } },
    handoffs: { h1: { jobId: "j1", outcome: "done" } },
  };
  assert.equal(bucketOf(job("running"), state), "running");
  assert.equal(bucketOf(job("done"), state), "done");
});

test("the tables may be keyed by job id as well as by their own id", () => {
  const byJob: StatusState = {
    approvals: { j1: { jobId: "j1", approved: null }, a1: { jobId: "j1", approved: null } },
  };
  assert.equal(bucketOf(job("running"), byJob), "needs_you");
  assert.equal(glyphOf(job("running"), byJob).kind, "approval");
  const stale: StatusState = { approvals: { j1: { jobId: "j9", approved: null } } };
  assert.equal(bucketOf(job("running"), stale), "running");
});

test("glyphs: one per state, the open request names the kind", () => {
  assert.equal(glyphOf(job("running"), none).kind, "running");
  assert.equal(glyphOf(job("queued"), none).kind, "queued");
  assert.equal(glyphOf(job("paused"), none).kind, "paused");
  assert.equal(glyphOf(job("done"), none).kind, "done");
  assert.equal(glyphOf(job("failed"), none).kind, "failed");
  assert.equal(glyphOf(job("cancelled"), none).kind, "cancelled");
  assert.equal(glyphOf(job("needs_user"), none).kind, "approval");
  const approval: StatusState = { approvals: { a1: { jobId: "j1", approved: null } } };
  const handoff: StatusState = { handoffs: { h1: { jobId: "j1", outcome: null } } };
  assert.equal(glyphOf(job("needs_user"), approval).kind, "approval");
  assert.equal(glyphOf(job("needs_user"), handoff).kind, "handoff");
  assert.equal(glyphOf(job("running"), handoff).kind, "handoff");
  // An approval and a handoff open at once: the approval glyph wins.
  assert.equal(glyphOf(job("running"), { ...approval, ...handoff }).kind, "approval");
});

test("relativeTime: now, minutes, hours, days, then the date", () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 0);
  const s = 1000;
  assert.equal(relativeTime(now, now), "now");
  assert.equal(relativeTime(now + 5 * s, now), "now");
  assert.equal(relativeTime(now - 59 * s, now), "now");
  assert.equal(relativeTime(now - 60 * s, now), "1m");
  assert.equal(relativeTime(now - 53 * 60 * s, now), "53m");
  assert.equal(relativeTime(now - 60 * 60 * s, now), "1h");
  assert.equal(relativeTime(now - 23 * 3600 * s, now), "23h");
  assert.equal(relativeTime(now - 24 * 3600 * s, now), "1d");
  assert.equal(relativeTime(now - 6 * 86400 * s, now), "6d");
  const week = now - 7 * 86400 * s;
  assert.equal(relativeTime(week, now), shortDate(week));
  assert.match(shortDate(week), /^\d{1,2} Sep$/);
});

test("elapsedTime: m:ss, then h:mm:ss", () => {
  assert.equal(elapsedTime(0), "0:00");
  assert.equal(elapsedTime(8_000), "0:08");
  assert.equal(elapsedTime(84_000), "1:24");
  assert.equal(elapsedTime(3_725_000), "1:02:05");
  assert.equal(elapsedTime(-5), "0:00");
});

test("sameDay compares local calendar days", () => {
  const t = new Date(2026, 9, 4, 23, 30).getTime();
  assert.equal(sameDay(t, t - 60_000), true);
  assert.equal(sameDay(t, t + 60 * 60_000), false);
});


test("a job with nothing to show folds into its open approval or handoff", () => {
  const bare = { jobId: "j1", status: "running" as JobStatus, progressHistory: [], say: "", show: null, artifacts: [] };
  const approval: StatusState = { approvals: { a1: { jobId: "j1", approved: null } } };
  const handoff: StatusState = { handoffs: { h1: { jobId: "j1", outcome: null } } };
  assert.equal(foldsIntoRequest(bare, approval), true);
  assert.equal(foldsIntoRequest(bare, handoff), true);
  // Nothing open: the job card shows.
  assert.equal(foldsIntoRequest(bare, none), false);
  assert.equal(foldsIntoRequest(bare, { approvals: { a1: { jobId: "j1", approved: false } } }), false);
  // Anything to show keeps the job card: steps, a say line, an output, an artifact.
  assert.equal(foldsIntoRequest({ ...bare, progressHistory: ["python: rows = load()"] }, approval), false);
  assert.equal(foldsIntoRequest({ ...bare, say: "Sent." }, approval), false);
  assert.equal(foldsIntoRequest({ ...bare, show: "# Report" }, approval), false);
  assert.equal(foldsIntoRequest({ ...bare, artifacts: ["/home/agent/x.csv"] }, handoff), false);
});
