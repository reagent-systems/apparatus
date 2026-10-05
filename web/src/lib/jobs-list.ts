// Pure: the Jobs view's filter chips, counts, bucket groups and row
// subtitles (DESIGN.md 5). No DOM; tested in `test/jobs-list.test.ts`.
//
// Three chips cover the four buckets: `failed` counts under Done. No chip
// selected is the `all` filter; it has no chip and no word. Groups keep the bucket order of
// `lib/status.ts`; inside a group a "Today" / "Earlier" sub-divider splits
// the rows. What waits for the user lists oldest first, everything else
// newest first.

import type { ApprovalEntry, FeedState, HandoffEntry, JobEntry, NeedsYouEntry } from "../feed/reducer.ts";
import { BUCKETS, bucketOf, sameDay, type Bucket } from "./status.ts";

export type JobFilter = "all" | "needs_you" | "running" | "done";

export const JOB_FILTERS: readonly JobFilter[] = ["all", "needs_you", "running", "done"];

export type JobChip = Exclude<JobFilter, "all">;

/** The chips, in order. Deselecting the selected chip is `all`. */
export const JOB_CHIPS: readonly JobChip[] = ["needs_you", "running", "done"];

export const FILTER_LABEL: Record<JobChip, string> = {
  needs_you: "Needs you",
  running: "Running",
  done: "Done",
};

export const BUCKET_LABEL: Record<Bucket, string> = {
  needs_you: "Needs you",
  failed: "Failed",
  running: "Running",
  done: "Done",
};

export type JobDay = "today" | "earlier";

export const DAY_LABEL: Record<JobDay, string> = { today: "Today", earlier: "Earlier" };

export type JobSection = { day: JobDay; jobs: JobEntry[] };
export type JobGroup = { bucket: Bucket; sections: JobSection[] };
export type JobCounts = Record<JobFilter, number>;

/** The part of the feed the list reads. */
export type JobsListState = Pick<FeedState, "jobs" | "approvals" | "handoffs">;

export function isJobFilter(value: unknown): value is JobFilter {
  return typeof value === "string" && (JOB_FILTERS as readonly string[]).includes(value);
}

/** The chip a bucket counts under. */
export function filterOfBucket(bucket: Bucket): Exclude<JobFilter, "all"> {
  if (bucket === "failed") return "done";
  return bucket;
}

export function matchesFilter(bucket: Bucket, filter: JobFilter): boolean {
  return filter === "all" || filterOfBucket(bucket) === filter;
}

/** The instant a row shows: the end once ended, else the start. */
export function jobTime(job: Pick<JobEntry, "startedAt" | "endedAt">): number | null {
  return job.endedAt ?? job.startedAt;
}

/** A job without a time is old news. */
export function dayOf(time: number | null, now: number): JobDay {
  return time !== null && sameDay(time, now) ? "today" : "earlier";
}

/** The oldest open approval or handoff for the job, or null. */
export function blockerOf(state: Pick<FeedState, "approvals" | "handoffs">, jobId: string): NeedsYouEntry | null {
  let best: NeedsYouEntry | null = null;
  const consider = (entry: ApprovalEntry | HandoffEntry): void => {
    if (entry.jobId !== jobId) return;
    const open = entry.kind === "approval" ? entry.approved === null : entry.outcome === null;
    if (open && (best === null || entry.seq < best.seq)) best = entry;
  };
  for (const a of Object.values(state.approvals)) consider(a);
  for (const h of Object.values(state.handoffs)) consider(h);
  return best;
}

export function jobCounts(state: JobsListState): JobCounts {
  const counts: JobCounts = { all: 0, needs_you: 0, running: 0, done: 0 };
  for (const job of Object.values(state.jobs)) {
    counts.all += 1;
    counts[filterOfBucket(bucketOf(job, state))] += 1;
  }
  return counts;
}

function newestFirst(a: JobEntry, b: JobEntry): number {
  return (jobTime(b) ?? 0) - (jobTime(a) ?? 0) || b.seq - a.seq;
}

/** The groups for one chip, in bucket order; an empty group or section is absent. */
export function groupJobs(state: JobsListState, filter: JobFilter, now: number): JobGroup[] {
  const byBucket = new Map<Bucket, JobEntry[]>();
  for (const job of Object.values(state.jobs)) {
    const bucket = bucketOf(job, state);
    if (!matchesFilter(bucket, filter)) continue;
    const list = byBucket.get(bucket) ?? [];
    list.push(job);
    byBucket.set(bucket, list);
  }
  const groups: JobGroup[] = [];
  for (const bucket of BUCKETS) {
    const jobs = byBucket.get(bucket);
    if (!jobs) continue;
    if (bucket === "needs_you") {
      // The one that waited longest is at the top.
      const waited = (j: JobEntry): number => blockerOf(state, j.jobId)?.seq ?? j.seq;
      jobs.sort((a, b) => waited(a) - waited(b));
    } else {
      jobs.sort(newestFirst);
    }
    const sections: JobSection[] = [];
    for (const day of ["today", "earlier"] as const) {
      const inDay = jobs.filter((j) => dayOf(jobTime(j), now) === day);
      if (inDay.length > 0) sections.push({ day, jobs: inDay });
    }
    groups.push({ bucket, sections });
  }
  return groups;
}

/** The muted line under the request: the blocker while blocked, the live
 *  progress while running, the `say` line once ended. A job that needs the
 *  user with nothing open (`needs_user`) shows its last progress line. */
export function jobSubtitle(job: JobEntry, bucket: Bucket, blocker: NeedsYouEntry | null): string {
  if (blocker) return blocker.kind === "approval" ? blocker.action : blocker.reason;
  if (bucket === "running" || bucket === "needs_you") return job.progress || job.say;
  return job.say || job.progress;
}
