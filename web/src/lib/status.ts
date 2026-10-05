// Pure: a job's bucket and glyph, and the short times the rows show. No DOM;
// tested in `test/status.test.ts`.
//
// Buckets follow Paseo's order (DESIGN.md 5): needs_you > failed > running >
// done. A job needs you when its status is `needs_user` or an approval or a
// handoff for it is still open; the glyph says which.

import type { HandoffOutcome, JobStatus } from "../protocol.ts";

export type Bucket = "needs_you" | "failed" | "running" | "done";

export type GlyphKind = "running" | "queued" | "paused" | "approval" | "handoff" | "done" | "failed" | "cancelled";

export type Glyph = { kind: GlyphKind };

/** The part of a job entry the status reads. `feed/reducer.ts`'s `JobEntry` fits. */
export type StatusJob = { jobId: string; status: JobStatus };

export type StatusApproval = { jobId?: string | null; approved: boolean | null };
export type StatusHandoff = { jobId?: string | null; outcome: HandoffOutcome | null };

/** The part of the feed state the status reads. The reducer indexes
 *  approvals and handoffs by their own id and by `jobId`; either key
 *  finds them here, and a state without the tables has nothing open. */
export type StatusState = {
  approvals?: Record<string, StatusApproval>;
  handoffs?: Record<string, StatusHandoff>;
};

function openApproval(jobId: string, state: StatusState): boolean {
  const table = state.approvals;
  if (!table) return false;
  const direct = table[jobId];
  if (direct && direct.approved === null && (direct.jobId ?? jobId) === jobId) return true;
  return Object.values(table).some((a) => a.jobId === jobId && a.approved === null);
}

function openHandoff(jobId: string, state: StatusState): boolean {
  const table = state.handoffs;
  if (!table) return false;
  const direct = table[jobId];
  if (direct && direct.outcome === null && (direct.jobId ?? jobId) === jobId) return true;
  return Object.values(table).some((h) => h.jobId === jobId && h.outcome === null);
}

export function bucketOf(job: StatusJob, state: StatusState): Bucket {
  if (job.status === "needs_user" || openApproval(job.jobId, state) || openHandoff(job.jobId, state)) return "needs_you";
  if (job.status === "failed") return "failed";
  if (job.status === "running" || job.status === "queued" || job.status === "paused") return "running";
  return "done";
}

export function glyphOf(job: StatusJob, state: StatusState): Glyph {
  const bucket = bucketOf(job, state);
  if (bucket === "needs_you") {
    if (openApproval(job.jobId, state)) return { kind: "approval" };
    if (openHandoff(job.jobId, state)) return { kind: "handoff" };
    return { kind: "approval" };
  }
  if (bucket === "failed") return { kind: "failed" };
  if (bucket === "running") {
    if (job.status === "queued") return { kind: "queued" };
    if (job.status === "paused") return { kind: "paused" };
    return { kind: "running" };
  }
  return { kind: job.status === "cancelled" ? "cancelled" : "done" };
}

export const BUCKETS: readonly Bucket[] = ["needs_you", "failed", "running", "done"];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `4 Oct`, the day divider's date form. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The row meta: `now` under a minute, then `12m`, `3h`, `2d`, then the date.
 * A future time reads as `now`.
 */
export function relativeTime(ms: number, now: number): string {
  const delta = now - ms;
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  return shortDate(ms);
}

/** A job's run length once ended: `0:08`, `1:24`, `1:02:05`. */
export function elapsedTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Whether two instants fall on the same local calendar day. */
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** The fields of a job that decide whether its thread card has anything to show. */
export type CardJob = StatusJob & {
  progressHistory: readonly string[];
  say: string;
  show: string | null;
  artifacts: readonly string[];
};

/**
 * A job that has shown nothing yet and waits on an open approval or handoff
 * folds into that card: the card carries the request as its title, so the
 * thread shows one card, not a bare job header above it.
 */
export function foldsIntoRequest(job: CardJob, state: StatusState): boolean {
  if (job.progressHistory.length > 0 || job.say.length > 0 || job.show || job.artifacts.length > 0) return false;
  return openApproval(job.jobId, state) || openHandoff(job.jobId, state);
}
