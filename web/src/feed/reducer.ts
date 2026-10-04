// The feed and job state as a pure reducer. DOM-free: tests run it in Node.
//
// Cards hold the thing itself (a transcript, a request, a say text) and
// nothing about it. Transcripts are short cards; job, approval and handoff
// cards are tall. The reducer also keeps the job list for the sidebar, the
// latest `show` markdown for the pane, the latest spoken line for the wide
// bar, and the active handoff.

import type { HandoffOutcome, JobStatus, JobSummary, S2CMessage, TranscriptRole } from "../protocol.ts";
import { JOB_TERMINAL } from "../protocol.ts";

export const MAX_CARDS = 100;

export type TranscriptCard = { id: string; kind: "transcript"; role: TranscriptRole; text: string; final: boolean };
export type JobCard = { id: string; kind: "job"; jobId: string };
export type ApprovalCard = {
  id: string;
  kind: "approval";
  approvalId: string;
  action: string;
  details: string;
  approved: boolean | null;
};
export type HandoffCard = { id: string; kind: "handoff"; handoffId: string; reason: string; outcome: HandoffOutcome | null };
export type CreditsCard = { id: string; kind: "credits"; text: string };

export type FeedCard = TranscriptCard | JobCard | ApprovalCard | HandoffCard | CreditsCard;

export type CardHeight = "short" | "tall";

export type JobEntry = {
  jobId: string;
  request: string;
  status: JobStatus;
  progress: string;
  percent: number | null;
  say: string;
  show: string | null;
  /** Insertion order; higher is newer. */
  seq: number;
};

export type ActiveHandoff = { handoffId: string; reason: string };

export type FeedState = {
  cards: FeedCard[];
  /** The id of the transcript card that interim text still replaces. */
  openTranscript: string | null;
  jobs: Record<string, JobEntry>;
  /** The latest `show` markdown, or null before the first. */
  show: string | null;
  /** The last agent transcript or say text. */
  spoken: string | null;
  handoff: ActiveHandoff | null;
  seq: number;
};

export type FeedAction =
  | { kind: "server"; msg: S2CMessage }
  | { kind: "transcript"; role: TranscriptRole; text: string; final: boolean }
  | { kind: "handoffOpened"; handoffId: string }
  | { kind: "handoffClosed" };

export function initialFeed(): FeedState {
  return { cards: [], openTranscript: null, jobs: {}, show: null, spoken: null, handoff: null, seq: 0 };
}

export function cardHeight(card: FeedCard): CardHeight {
  return card.kind === "transcript" || card.kind === "credits" ? "short" : "tall";
}

const ACTIVE: ReadonlySet<JobStatus> = new Set<JobStatus>(["queued", "running", "paused"]);

export function isJobActive(status: JobStatus): boolean {
  return ACTIVE.has(status);
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

function transcript(state: FeedState, role: TranscriptRole, text: string, final: boolean): FeedState {
  if (text.trim().length === 0 && !final) return state;
  const open = state.openTranscript ? state.cards.find((c) => c.id === state.openTranscript) : undefined;
  let next: FeedState;
  if (open && open.kind === "transcript" && open.role === role) {
    next = replaceCard(state, open.id, (c) => ({ ...c, text, final }) as TranscriptCard);
    next = { ...next, openTranscript: open.id };
  } else {
    next = push(state, (id) => ({ id, kind: "transcript", role, text, final }));
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
    percent: null,
    say: "",
    show: null,
    seq,
  };
  const entry: JobEntry = { ...base, ...patch, jobId, seq };
  return { ...state, seq: Math.max(state.seq, seq), jobs: { ...state.jobs, [jobId]: entry } };
}

function seedJobs(state: FeedState, jobs: JobSummary[]): FeedState {
  let next = state;
  for (const j of jobs) {
    if (next.jobs[j.job_id]) continue;
    next = upsertJob(next, j.job_id, {
      request: j.request,
      status: j.status,
      say: j.say ?? "",
      show: j.show ?? null,
      progress: j.progress ?? "",
      percent: j.percent ?? null,
    });
  }
  return next;
}

function jobStarted(state: FeedState, jobId: string, request: string): FeedState {
  let next = upsertJob(state, jobId, { request, status: "running" });
  if (!next.cards.some((c) => c.kind === "job" && c.jobId === jobId)) {
    next = push(next, (id) => ({ id, kind: "job", jobId }));
  }
  return next;
}

function jobProgress(state: FeedState, jobId: string, text: string, percent: number | null): FeedState {
  const p = percent === null || Number.isNaN(percent) ? null : Math.max(0, Math.min(100, percent));
  const next = state.jobs[jobId] ? state : jobStarted(state, jobId, "");
  return upsertJob(next, jobId, { progress: text, percent: p });
}

function jobDone(state: FeedState, jobId: string, status: JobStatus, say: string, show: string | null): FeedState {
  let next = state.jobs[jobId] ? state : jobStarted(state, jobId, "");
  next = upsertJob(next, jobId, { status, say, show: show ?? next.jobs[jobId]?.show ?? null, percent: null });
  if (say.trim().length > 0) next = { ...next, spoken: say };
  if (show) next = { ...next, show };
  return next;
}

function server(state: FeedState, msg: S2CMessage): FeedState {
  switch (msg.type) {
    case "ready":
      return msg.jobs ? seedJobs(state, msg.jobs) : state;
    case "transcript":
      return transcript(state, msg.role, msg.text, true);
    case "job.started":
      return jobStarted(state, msg.job_id, msg.request);
    case "job.progress":
      return jobProgress(state, msg.job_id, msg.text, msg.percent ?? null);
    case "job.done":
      return jobDone(state, msg.job_id, msg.status, msg.say, msg.show ?? null);
    case "show":
      return { ...state, show: msg.content };
    case "handoff.requested": {
      const next = push(state, (id) => ({ id, kind: "handoff", handoffId: msg.handoff_id, reason: msg.reason, outcome: null }));
      return { ...next, handoff: { handoffId: msg.handoff_id, reason: msg.reason } };
    }
    case "handoff.ended": {
      const cards = state.cards.map((c) =>
        c.kind === "handoff" && c.handoffId === msg.handoff_id ? { ...c, outcome: msg.outcome } : c,
      );
      const handoff = state.handoff?.handoffId === msg.handoff_id ? null : state.handoff;
      return { ...state, cards, handoff };
    }
    case "approval.requested":
      return push(state, (id) => ({
        id,
        kind: "approval",
        approvalId: msg.approval_id,
        action: msg.action,
        details: msg.details,
        approved: null,
      }));
    case "approval.ended":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.kind === "approval" && c.approvalId === msg.approval_id ? { ...c, approved: msg.approved } : c,
        ),
      };
    case "credits": {
      if (!msg.voice) return state;
      const text = msg.voice;
      const next = push(state, (id) => ({ id, kind: "credits", text }));
      return { ...next, spoken: text };
    }
    default:
      return state;
  }
}

export function reduceFeed(state: FeedState, action: FeedAction): FeedState {
  switch (action.kind) {
    case "server":
      return server(state, action.msg);
    case "transcript":
      return transcript(state, action.role, action.text, action.final);
    case "handoffOpened":
      return state.handoff?.handoffId === action.handoffId
        ? state
        : { ...state, handoff: { handoffId: action.handoffId, reason: "" } };
    case "handoffClosed":
      return state.handoff ? { ...state, handoff: null } : state;
  }
}

/** Open approvals, oldest first. */
export function pendingApprovals(state: FeedState): ApprovalCard[] {
  return state.cards.filter((c): c is ApprovalCard => c.kind === "approval" && c.approved === null);
}

export { JOB_TERMINAL };
