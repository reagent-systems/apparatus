// The thread and job state as a pure reducer. DOM-free: tests run it in Node.
//
// Cards hold the thing itself (a transcript, a request, a say text) and
// nothing about it; every card carries `at`, the ms clock when it arrived,
// for the day dividers and the turn headers. The reducer also keeps the job
// table (with the last 50 progress lines, the artifacts and the start and
// end times), the approval and handoff tables, the latest `show` markdown,
// the latest spoken line and the active handoff.
//
// `reduceFeed(state, action, now)` takes the clock as a parameter so the
// tests fix it; `useReducer` leaves it at `Date.now()`.

import type { CreditsState, HandoffOutcome, JobStatus, JobSummary, S2CMessage, S2CReady, TranscriptRole } from "../protocol.ts";
import { JOB_TERMINAL } from "../protocol.ts";

export const MAX_CARDS = 100;
export const MAX_PROGRESS = 50;

export type TranscriptCard = {
  id: string;
  kind: "transcript";
  role: TranscriptRole;
  text: string;
  final: boolean;
  at: number;
};
export type JobCard = { id: string; kind: "job"; jobId: string; at: number };
export type ApprovalCard = {
  id: string;
  kind: "approval";
  approvalId: string;
  jobId: string;
  action: string;
  details: string;
  approved: boolean | null;
  at: number;
};
export type HandoffCard = {
  id: string;
  kind: "handoff";
  handoffId: string;
  jobId: string;
  reason: string;
  outcome: HandoffOutcome | null;
  at: number;
};
export type CreditsCard = { id: string; kind: "credits"; text: string; balance: number; state: CreditsState; at: number };

export type FeedCard = TranscriptCard | JobCard | ApprovalCard | HandoffCard | CreditsCard;

export type CardHeight = "short" | "tall";

export type JobEntry = {
  jobId: string;
  request: string;
  status: JobStatus;
  /** The live progress line. */
  progress: string;
  /** Every progress line seen, oldest first, the last MAX_PROGRESS. */
  progressHistory: string[];
  percent: number | null;
  say: string;
  show: string | null;
  artifacts: string[];
  startedAt: number | null;
  endedAt: number | null;
  /** Insertion order; higher is newer. */
  seq: number;
};

export type ApprovalEntry = {
  kind: "approval";
  approvalId: string;
  jobId: string;
  action: string;
  details: string;
  approved: boolean | null;
  at: number;
  seq: number;
};

export type HandoffEntry = {
  kind: "handoff";
  handoffId: string;
  jobId: string;
  reason: string;
  outcome: HandoffOutcome | null;
  at: number;
  seq: number;
};

export type NeedsYouEntry = ApprovalEntry | HandoffEntry;

export type ActiveHandoff = { handoffId: string; reason: string };

export type Credits = { balance: number; state: CreditsState };

export type FeedState = {
  cards: FeedCard[];
  /** The id of the transcript card that interim text still replaces. */
  openTranscript: string | null;
  jobs: Record<string, JobEntry>;
  /**
   * Keyed twice: by `approvalId` and by `jobId`, where the job key holds the
   * latest approval for that job. `lib/status.ts` reads either key; iterate
   * with `openApprovals` / `needsYou`, which dedupe.
   */
  approvals: Record<string, ApprovalEntry>;
  /** Keyed twice, as `approvals`. */
  handoffs: Record<string, HandoffEntry>;
  /** The latest `show` markdown, or null before the first. */
  show: string | null;
  /** The last agent transcript or say text. */
  spoken: string | null;
  handoff: ActiveHandoff | null;
  /** The latest balance the server sent. */
  credits: Credits | null;
  seq: number;
};

export type FeedAction =
  | { kind: "server"; msg: S2CMessage }
  | { kind: "transcript"; role: TranscriptRole; text: string; final: boolean }
  | { kind: "handoffOpened"; handoffId: string }
  | { kind: "handoffClosed" };

export function initialFeed(): FeedState {
  return {
    cards: [],
    openTranscript: null,
    jobs: {},
    approvals: {},
    handoffs: {},
    show: null,
    spoken: null,
    handoff: null,
    credits: null,
    seq: 0,
  };
}

export function cardHeight(card: FeedCard): CardHeight {
  return card.kind === "transcript" || card.kind === "credits" ? "short" : "tall";
}

const ACTIVE: ReadonlySet<JobStatus> = new Set<JobStatus>(["queued", "running", "paused"]);

export function isJobActive(status: JobStatus): boolean {
  return ACTIVE.has(status);
}

export function jobOf(state: FeedState, jobId: string): JobEntry | undefined {
  return state.jobs[jobId];
}

/** Jobs that still run, newest first. */
export function runningJobs(state: FeedState): JobEntry[] {
  return Object.values(state.jobs)
    .filter((j) => isJobActive(j.status))
    .sort((a, b) => b.seq - a.seq);
}

/** Jobs that ended, newest first. */
export function recentJobs(state: FeedState): JobEntry[] {
  return Object.values(state.jobs)
    .filter((j) => !isJobActive(j.status))
    .sort((a, b) => b.seq - a.seq);
}

function uniqueApprovals(state: FeedState): ApprovalEntry[] {
  const seen = new Set<string>();
  const out: ApprovalEntry[] = [];
  for (const a of Object.values(state.approvals)) {
    if (seen.has(a.approvalId)) continue;
    seen.add(a.approvalId);
    out.push(a);
  }
  return out;
}

function uniqueHandoffs(state: FeedState): HandoffEntry[] {
  const seen = new Set<string>();
  const out: HandoffEntry[] = [];
  for (const h of Object.values(state.handoffs)) {
    if (seen.has(h.handoffId)) continue;
    seen.add(h.handoffId);
    out.push(h);
  }
  return out;
}

/** Open approvals, oldest first. */
export function openApprovals(state: FeedState): ApprovalEntry[] {
  return uniqueApprovals(state)
    .filter((a) => a.approved === null)
    .sort((a, b) => a.seq - b.seq);
}

/** Open handoffs, oldest first. */
export function openHandoffs(state: FeedState): HandoffEntry[] {
  return uniqueHandoffs(state)
    .filter((h) => h.outcome === null)
    .sort((a, b) => a.seq - b.seq);
}

/** Everything that waits for the user: open approvals and handoffs, oldest first. */
export function needsYou(state: FeedState): NeedsYouEntry[] {
  const all: NeedsYouEntry[] = [...openApprovals(state), ...openHandoffs(state)];
  return all.sort((a, b) => a.seq - b.seq);
}

/** The open approval cards, oldest first. */
export function pendingApprovals(state: FeedState): ApprovalCard[] {
  return state.cards.filter((c): c is ApprovalCard => c.kind === "approval" && c.approved === null);
}

// ---- internals -------------------------------------------------------------

function nextId(state: FeedState): [FeedState, string] {
  const seq = state.seq + 1;
  return [{ ...state, seq }, `c${seq}`];
}

/** Append a card; the oldest cards fall off past MAX_CARDS. Closes any open transcript. */
function push(state: FeedState, make: (id: string) => FeedCard): FeedState {
  const [next, id] = nextId(state);
  const cards = [...next.cards, make(id)];
  while (cards.length > MAX_CARDS) cards.shift();
  return { ...next, cards, openTranscript: null };
}

function replaceCard(state: FeedState, id: string, patch: (card: FeedCard) => FeedCard): FeedState {
  return { ...state, cards: state.cards.map((c) => (c.id === id ? patch(c) : c)) };
}

function transcript(state: FeedState, role: TranscriptRole, text: string, final: boolean, now: number): FeedState {
  if (text.trim().length === 0 && !final) return state;
  const open = state.openTranscript ? state.cards.find((c) => c.id === state.openTranscript) : undefined;
  let next: FeedState;
  if (open && open.kind === "transcript" && open.role === role) {
    next = replaceCard(state, open.id, (c) => ({ ...c, text, final }) as TranscriptCard);
    next = { ...next, openTranscript: open.id };
  } else {
    next = push(state, (id) => ({ id, kind: "transcript", role, text, final, at: now }));
    next = { ...next, openTranscript: `c${next.seq}` };
  }
  if (role === "agent" && text.trim().length > 0) next = { ...next, spoken: text };
  if (final) {
    if (text.trim().length === 0) {
      const id = next.openTranscript;
      next = { ...next, cards: next.cards.filter((c) => c.id !== id) };
    }
    next = { ...next, openTranscript: null };
  }
  return next;
}

function upsertJob(state: FeedState, jobId: string, patch: Partial<JobEntry>): FeedState {
  const existing = state.jobs[jobId];
  const seq = existing ? existing.seq : state.seq + 1;
  const base: JobEntry = existing ?? {
    jobId,
    request: "",
    status: "running",
    progress: "",
    progressHistory: [],
    percent: null,
    say: "",
    show: null,
    artifacts: [],
    startedAt: null,
    endedAt: null,
    seq,
  };
  const entry: JobEntry = { ...base, ...patch, jobId, seq };
  return { ...state, seq: Math.max(state.seq, seq), jobs: { ...state.jobs, [jobId]: entry } };
}

/** A job as `ready.jobs` carries it: the `GET /jobs` dict, times in epoch seconds. */
export type ReadyJob = JobSummary & {
  started?: number | null;
  artifacts?: string[] | null;
  progress_history?: string[] | null;
};

function seconds(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) : null;
}

function cappedHistory(lines: readonly string[]): string[] {
  return lines.length > MAX_PROGRESS ? lines.slice(lines.length - MAX_PROGRESS) : [...lines];
}

function readyHistory(j: ReadyJob): string[] {
  const history = Array.isArray(j.progress_history) ? j.progress_history.filter((t) => typeof t === "string") : [];
  const progress = j.progress ?? "";
  if (progress.length > 0 && history[history.length - 1] !== progress) history.push(progress);
  return cappedHistory(history);
}

/**
 * Seed the job table from `ready`. `ready` is the first message of every
 * connection, so on a reconnect it is newer than anything seen live: a known
 * job takes the server's status, texts, artifacts and end time (a job that
 * ended while the socket was down ends here too) and keeps its live history
 * when that is the longer one. `seedFromReady(ready)` starts from an empty feed.
 */
export function seedFromReady(ready: Pick<S2CReady, "jobs">): FeedState;
export function seedFromReady(state: FeedState, ready: Pick<S2CReady, "jobs">): FeedState;
export function seedFromReady(a: FeedState | Pick<S2CReady, "jobs">, b?: Pick<S2CReady, "jobs">): FeedState {
  const ready = b ?? (a as Pick<S2CReady, "jobs">);
  let next = b ? (a as FeedState) : initialFeed();
  for (const raw of ready.jobs ?? []) {
    const j = raw as ReadyJob;
    const known = next.jobs[j.job_id];
    const history = readyHistory(j);
    const artifacts = Array.isArray(j.artifacts) ? j.artifacts.filter((x) => typeof x === "string") : [];
    if (known) {
      next = upsertJob(next, j.job_id, {
        request: known.request || j.request,
        status: j.status,
        say: j.say ?? known.say,
        show: j.show ?? known.show,
        progress: j.progress ?? known.progress,
        progressHistory: known.progressHistory.length >= history.length ? known.progressHistory : history,
        percent: isJobActive(j.status) ? (j.percent ?? known.percent) : null,
        artifacts: artifacts.length > 0 ? artifacts : known.artifacts,
        startedAt: known.startedAt ?? seconds(j.started) ?? seconds(j.created),
        endedAt: seconds(j.ended) ?? (isJobActive(j.status) ? null : known.endedAt),
      });
      continue;
    }
    next = upsertJob(next, j.job_id, {
      request: j.request,
      status: j.status,
      say: j.say ?? "",
      show: j.show ?? null,
      progress: j.progress ?? "",
      progressHistory: history,
      percent: j.percent ?? null,
      artifacts,
      startedAt: seconds(j.started) ?? seconds(j.created),
      endedAt: seconds(j.ended),
    });
  }
  return next;
}

function jobStarted(state: FeedState, jobId: string, request: string, now: number): FeedState {
  const known = state.jobs[jobId];
  let next = upsertJob(state, jobId, {
    request: request || known?.request || "",
    status: "running",
    startedAt: known?.startedAt ?? now,
  });
  if (!next.cards.some((c) => c.kind === "job" && c.jobId === jobId)) {
    next = push(next, (id) => ({ id, kind: "job", jobId, at: now }));
  }
  return next;
}

function jobProgress(state: FeedState, jobId: string, text: string, percent: number | null, now: number): FeedState {
  const p = percent === null || Number.isNaN(percent) ? null : Math.max(0, Math.min(100, percent));
  const next = state.jobs[jobId] ? state : jobStarted(state, jobId, "", now);
  const job = next.jobs[jobId];
  const history = text.length > 0 ? cappedHistory([...job.progressHistory, text]) : job.progressHistory;
  return upsertJob(next, jobId, { progress: text, percent: p, progressHistory: history });
}

function jobDone(
  state: FeedState,
  jobId: string,
  status: JobStatus,
  say: string,
  show: string | null,
  artifacts: string[],
  now: number,
): FeedState {
  let next = state.jobs[jobId] ? state : jobStarted(state, jobId, "", now);
  next = upsertJob(next, jobId, {
    status,
    say,
    show: show ?? next.jobs[jobId]?.show ?? null,
    artifacts,
    percent: null,
    endedAt: now,
  });
  if (say.trim().length > 0) next = { ...next, spoken: say };
  if (show) next = { ...next, show };
  return next;
}

/**
 * An approval's details as literal text: a string as is, an object as one
 * `key: value` line per key, anything else as JSON. Nothing is dropped.
 */
export function detailsText(details: unknown): string {
  if (details === null || details === undefined) return "";
  if (typeof details === "string") return details;
  if (typeof details === "object" && !Array.isArray(details)) {
    return Object.entries(details as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
  }
  return JSON.stringify(details);
}

function putApproval(state: FeedState, entry: ApprovalEntry): FeedState {
  const approvals = { ...state.approvals, [entry.approvalId]: entry };
  if (entry.jobId) approvals[entry.jobId] = entry;
  return { ...state, approvals };
}

function putHandoff(state: FeedState, entry: HandoffEntry): FeedState {
  const handoffs = { ...state.handoffs, [entry.handoffId]: entry };
  if (entry.jobId) handoffs[entry.jobId] = entry;
  return { ...state, handoffs };
}

function patchApproval(state: FeedState, approvalId: string, patch: Partial<ApprovalEntry>): FeedState {
  const entry = state.approvals[approvalId];
  if (!entry) return state;
  const updated = { ...entry, ...patch };
  const approvals = { ...state.approvals, [approvalId]: updated };
  // The job key follows only while it still points at this approval.
  if (entry.jobId && state.approvals[entry.jobId]?.approvalId === approvalId) approvals[entry.jobId] = updated;
  return { ...state, approvals };
}

function patchHandoff(state: FeedState, handoffId: string, patch: Partial<HandoffEntry>): FeedState {
  const entry = state.handoffs[handoffId];
  if (!entry) return state;
  const updated = { ...entry, ...patch };
  const handoffs = { ...state.handoffs, [handoffId]: updated };
  if (entry.jobId && state.handoffs[entry.jobId]?.handoffId === handoffId) handoffs[entry.jobId] = updated;
  return { ...state, handoffs };
}

function server(state: FeedState, msg: S2CMessage, now: number): FeedState {
  switch (msg.type) {
    case "ready": {
      const next = seedFromReady(state, msg);
      return { ...next, credits: { balance: msg.balance, state: next.credits?.state ?? "ok" } };
    }
    case "transcript":
      return transcript(state, msg.role, msg.text, true, now);
    case "job.started":
      return jobStarted(state, msg.job_id, msg.request, now);
    case "job.progress":
      return jobProgress(state, msg.job_id, msg.text, msg.percent ?? null, now);
    case "job.done":
      return jobDone(state, msg.job_id, msg.status, msg.say, msg.show ?? null, msg.artifacts ?? [], now);
    case "show":
      return { ...state, show: msg.content };
    case "handoff.requested": {
      let next = push(state, (id) => ({
        id,
        kind: "handoff",
        handoffId: msg.handoff_id,
        jobId: msg.job_id,
        reason: msg.reason,
        outcome: null,
        at: now,
      }));
      next = putHandoff(next, {
        kind: "handoff",
        handoffId: msg.handoff_id,
        jobId: msg.job_id,
        reason: msg.reason,
        outcome: null,
        at: now,
        seq: next.seq,
      });
      return { ...next, handoff: { handoffId: msg.handoff_id, reason: msg.reason } };
    }
    case "handoff.ended": {
      const cards = state.cards.map((c) =>
        c.kind === "handoff" && c.handoffId === msg.handoff_id ? { ...c, outcome: msg.outcome } : c,
      );
      const handoff = state.handoff?.handoffId === msg.handoff_id ? null : state.handoff;
      return patchHandoff({ ...state, cards, handoff }, msg.handoff_id, { outcome: msg.outcome });
    }
    case "approval.requested": {
      const next = push(state, (id) => ({
        id,
        kind: "approval",
        approvalId: msg.approval_id,
        jobId: msg.job_id,
        action: msg.action,
        details: detailsText(msg.details),
        approved: null,
        at: now,
      }));
      return putApproval(next, {
        kind: "approval",
        approvalId: msg.approval_id,
        jobId: msg.job_id,
        action: msg.action,
        details: detailsText(msg.details),
        approved: null,
        at: now,
        seq: next.seq,
      });
    }
    case "approval.ended": {
      const cards = state.cards.map((c) =>
        c.kind === "approval" && c.approvalId === msg.approval_id ? { ...c, approved: msg.approved } : c,
      );
      return patchApproval({ ...state, cards }, msg.approval_id, { approved: msg.approved });
    }
    case "credits": {
      const credits: Credits = { balance: msg.balance, state: msg.state };
      if (!msg.voice) return { ...state, credits };
      const text = msg.voice;
      const next = push(state, (id) => ({ id, kind: "credits", text, balance: msg.balance, state: msg.state, at: now }));
      return { ...next, spoken: text, credits };
    }
    default:
      return state;
  }
}

export function reduceFeed(state: FeedState, action: FeedAction, now: number = Date.now()): FeedState {
  switch (action.kind) {
    case "server":
      return server(state, action.msg, now);
    case "transcript":
      return transcript(state, action.role, action.text, action.final, now);
    case "handoffOpened":
      return state.handoff?.handoffId === action.handoffId
        ? state
        : { ...state, handoff: { handoffId: action.handoffId, reason: state.handoffs[action.handoffId]?.reason ?? "" } };
    case "handoffClosed":
      return state.handoff ? { ...state, handoff: null } : state;
  }
}

export { JOB_TERMINAL };
