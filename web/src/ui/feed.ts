// The feed: short cards, newest at the bottom. Cards hold the thing itself
// (a transcript, a request, a say text) and nothing about it.

import type { TranscriptRole, JobStatus } from "../protocol.ts";

const MAX_CARDS = 100;

type Card = HTMLElement;

export class Feed {
  readonly el: HTMLElement;
  private openTranscript: { role: TranscriptRole; card: Card } | null = null;
  private readonly jobs = new Map<string, Card>();
  private readonly approvals = new Map<string, Card>();

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "feed";
  }

  private card(kind: string): Card {
    const card = document.createElement("article");
    card.className = `card card--${kind}`;
    this.el.appendChild(card);
    while (this.el.childElementCount > MAX_CARDS) {
      const first = this.el.firstElementChild;
      if (!first) break;
      first.remove();
    }
    this.el.scrollTop = this.el.scrollHeight;
    return card;
  }

  /** Interim text replaces the open card of the same role; final closes it. */
  transcript(role: TranscriptRole, text: string, final: boolean): void {
    if (text.trim().length === 0 && !final) return;
    let card: Card;
    if (this.openTranscript && this.openTranscript.role === role) {
      card = this.openTranscript.card;
    } else {
      card = this.card(role === "user" ? "user" : "agent");
      this.openTranscript = { role, card };
    }
    card.textContent = text;
    this.el.scrollTop = this.el.scrollHeight;
    if (final) {
      if (text.trim().length === 0) card.remove();
      this.openTranscript = null;
    }
  }

  /** Any non-transcript card closes an open transcript. */
  private breakTranscript(): void {
    this.openTranscript = null;
  }

  jobStarted(jobId: string, request: string): void {
    this.breakTranscript();
    const card = this.card("job");
    const req = document.createElement("p");
    req.className = "card__request";
    req.textContent = request;
    const progress = document.createElement("p");
    progress.className = "card__progress";
    const bar = document.createElement("div");
    bar.className = "card__bar";
    card.append(req, progress, bar);
    this.jobs.set(jobId, card);
  }

  jobProgress(jobId: string, text: string, percent: number | null): void {
    let card = this.jobs.get(jobId);
    if (!card) {
      this.jobStarted(jobId, "");
      card = this.jobs.get(jobId) as Card;
    }
    const progress = card.querySelector<HTMLElement>(".card__progress");
    if (progress) progress.textContent = text;
    const bar = card.querySelector<HTMLElement>(".card__bar");
    if (bar) {
      if (percent === null || Number.isNaN(percent)) {
        bar.style.width = "";
        bar.classList.remove("card__bar--set");
      } else {
        bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        bar.classList.add("card__bar--set");
      }
    }
  }

  jobDone(jobId: string, status: JobStatus, say: string): void {
    const card = this.jobs.get(jobId);
    if (card) {
      card.classList.add("card--done", `card--${status}`);
      card.querySelector(".card__bar")?.remove();
      const progress = card.querySelector<HTMLElement>(".card__progress");
      if (progress) progress.textContent = say;
      this.jobs.delete(jobId);
    } else {
      this.breakTranscript();
      const fresh = this.card("job");
      fresh.classList.add("card--done", `card--${status}`);
      fresh.textContent = say;
    }
    this.el.scrollTop = this.el.scrollHeight;
  }

  get runningJobs(): number {
    return this.jobs.size;
  }

  handoff(reason: string): void {
    this.breakTranscript();
    const card = this.card("handoff");
    card.textContent = reason;
  }

  approval(approvalId: string, action: string, details: string, answer: (approved: boolean) => void): void {
    this.breakTranscript();
    const card = this.card("approval");
    const head = document.createElement("p");
    head.className = "card__action";
    head.textContent = action;
    const body = document.createElement("p");
    body.textContent = details;
    const buttons = document.createElement("div");
    buttons.className = "card__buttons";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "approve";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = "deny";
    approve.addEventListener("click", () => answer(true));
    deny.addEventListener("click", () => answer(false));
    buttons.append(approve, deny);
    card.append(head, body, buttons);
    this.approvals.set(approvalId, card);
  }

  approvalEnded(approvalId: string, approved: boolean): void {
    const card = this.approvals.get(approvalId);
    if (!card) return;
    card.querySelector(".card__buttons")?.remove();
    card.classList.add(approved ? "card--approved" : "card--denied");
    this.approvals.delete(approvalId);
  }

  /** Only the spoken text, when there is one. */
  credits(voice: string | undefined): void {
    if (!voice) return;
    this.breakTranscript();
    const card = this.card("credits");
    card.textContent = voice;
  }
}
