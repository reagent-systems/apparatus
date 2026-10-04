// The answerer's negotiation state, DOM-free. ScreenPeer asks it what to do
// with each incoming signal; it holds the candidates that arrive before the
// remote description and hands them back once it is set.

import { offerCollision, type ParsedSignal, type SignalingState } from "./input.ts";

export type Candidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type Decision =
  /** Set the remote description. `rollback` first undoes our own pending
   *  offer; `answer` then makes and sends the answer. */
  | { action: "describe"; type: "offer" | "answer"; sdp: string; rollback: boolean; answer: boolean }
  | { action: "candidate"; candidate: Candidate }
  | { action: "queue"; candidate: Candidate }
  | { action: "ignore"; reason: "unknown" | "closed" | "stale-answer" | "duplicate-offer" };

export class Negotiation {
  private remoteSet = false;
  private queued: Candidate[] = [];

  get remoteDescribed(): boolean {
    return this.remoteSet;
  }

  get queuedCount(): number {
    return this.queued.length;
  }

  decide(signal: ParsedSignal, signalingState: SignalingState): Decision {
    if (!signal) return { action: "ignore", reason: "unknown" };
    if (signalingState === "closed") return { action: "ignore", reason: "closed" };
    if (signal.kind === "candidate") {
      const candidate: Candidate = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
      if (!this.remoteSet) {
        this.queued.push(candidate);
        return { action: "queue", candidate };
      }
      return { action: "candidate", candidate };
    }
    if (signal.type === "offer") {
      // A second offer while the first is still being answered carries the
      // same session; the browser rejects it. The next one comes with a
      // fresh negotiation.
      if (signalingState === "have-remote-offer") return { action: "ignore", reason: "duplicate-offer" };
      const collision = offerCollision(signal.type, false, signalingState);
      return { action: "describe", type: "offer", sdp: signal.sdp, rollback: collision, answer: true };
    }
    if (signal.type === "answer") {
      if (signalingState !== "have-local-offer") return { action: "ignore", reason: "stale-answer" };
      return { action: "describe", type: "answer", sdp: signal.sdp, rollback: false, answer: false };
    }
    return { action: "ignore", reason: "unknown" };
  }

  /** The remote description is set: returns the held candidates, oldest first, and clears them. */
  described(): Candidate[] {
    this.remoteSet = true;
    const out = this.queued;
    this.queued = [];
    return out;
  }

  reset(): void {
    this.remoteSet = false;
    this.queued = [];
  }
}
