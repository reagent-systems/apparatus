// The handoff view: the VM desktop over WebRTC, with Done and Cancel.
//
// Signaling goes through the session server as `signal {handoff_id, payload}`.
// The payload is the perfect-negotiation shape: `{description}` or
// `{candidate}`. This side is the polite peer and offers first; it also
// answers an offer from the VM. Input goes back on a data channel named
// "input" as JSON with normalized coordinates. Nothing in this view is
// captured or logged (spec: handoff rules).

import type { JsonObject } from "../protocol.ts";

export type InputEvent =
  | { kind: "mouse.move"; x: number; y: number }
  | { kind: "mouse.down"; x: number; y: number; button: number }
  | { kind: "mouse.up"; x: number; y: number; button: number }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number }
  | { kind: "key.down"; key: string; code: string }
  | { kind: "key.up"; key: string; code: string }
  | { kind: "touch"; x: number; y: number; phase: "start" | "move" | "end" };

export type HandoffViewOptions = {
  sendSignal: (handoffId: string, payload: JsonObject) => void;
  onDone: (handoffId: string) => void;
  onCancel: (handoffId: string) => void;
  iceServers?: RTCIceServer[];
};

export class HandoffView {
  readonly el: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly opts: HandoffViewOptions;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private handoffId: string | null = null;
  private makingOffer = false;

  constructor(opts: HandoffViewOptions) {
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "handoff";
    this.el.tabIndex = 0;

    this.video = document.createElement("video");
    this.video.className = "handoff__video";
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    const bar = document.createElement("div");
    bar.className = "handoff__bar";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "handoff__done";
    done.textContent = "Done";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "handoff__cancel";
    cancel.textContent = "Cancel";
    done.addEventListener("click", () => {
      if (this.handoffId) this.opts.onDone(this.handoffId);
    });
    cancel.addEventListener("click", () => {
      if (this.handoffId) this.opts.onCancel(this.handoffId);
    });
    bar.append(done, cancel);
    this.el.append(this.video, bar);
    this.bindInput();
  }

  get active(): string | null {
    return this.handoffId;
  }

  open(handoffId: string): void {
    if (this.handoffId === handoffId && this.pc) return;
    this.teardown();
    this.handoffId = handoffId;
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? [] });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    this.attachChannel(pc.createDataChannel("input"));
    pc.ondatachannel = (ev) => {
      if (ev.channel.label === "input") this.attachChannel(ev.channel);
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      if (this.video.srcObject !== stream) {
        this.video.srcObject = stream;
        void this.video.play().catch(() => undefined);
      }
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this.signal({ candidate: ev.candidate.toJSON() as JsonObject });
    };
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.signal({ description: descriptionJson(pc.localDescription) });
      } catch {
        // the VM may offer first; its offer is handled in handleSignal
      } finally {
        this.makingOffer = false;
      }
    };
    this.el.focus();
  }

  async handleSignal(handoffId: string, payload: JsonObject): Promise<void> {
    const pc = this.pc;
    if (!pc || handoffId !== this.handoffId) return;
    const description = payload.description;
    const candidate = payload.candidate;
    if (isRecord(description) && typeof description.type === "string") {
      const desc = description as unknown as RTCSessionDescriptionInit;
      const collision = desc.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
      if (collision) {
        // polite peer: drop our offer and take theirs
        await Promise.all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(desc)]);
      } else {
        await pc.setRemoteDescription(desc);
      }
      if (desc.type === "offer") {
        await pc.setLocalDescription();
        if (pc.localDescription) this.signal({ description: descriptionJson(pc.localDescription) });
      }
    } else if (isRecord(candidate)) {
      try {
        await pc.addIceCandidate(candidate as unknown as RTCIceCandidateInit);
      } catch {
        // a candidate for a description we rolled back
      }
    }
  }

  close(): void {
    this.teardown();
    this.handoffId = null;
  }

  // ---- internals -----------------------------------------------------------

  private signal(payload: JsonObject): void {
    if (this.handoffId) this.opts.sendSignal(this.handoffId, payload);
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
  }

  private send(event: InputEvent): void {
    if (this.channel && this.channel.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private teardown(): void {
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    this.video.srcObject = null;
  }

  /** Pointer position on the video content box, 0..1. Null outside the picture. */
  private normalize(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = this.video.getBoundingClientRect();
    const vw = this.video.videoWidth || rect.width;
    const vh = this.video.videoHeight || rect.height;
    if (rect.width === 0 || rect.height === 0 || vw === 0 || vh === 0) return null;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = rect.left + (rect.width - w) / 2;
    const top = rect.top + (rect.height - h) / 2;
    const x = (ev.clientX - left) / w;
    const y = (ev.clientY - top) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  private bindInput(): void {
    const v = this.video;
    v.addEventListener("contextmenu", (e) => e.preventDefault());
    v.addEventListener("pointermove", (e) => {
      const p = this.normalize(e);
      if (!p) return;
      if (e.pointerType === "touch") this.send({ kind: "touch", ...p, phase: "move" });
      else this.send({ kind: "mouse.move", ...p });
    });
    v.addEventListener("pointerdown", (e) => {
      const p = this.normalize(e);
      if (!p) return;
      v.setPointerCapture(e.pointerId);
      this.el.focus();
      if (e.pointerType === "touch") this.send({ kind: "touch", ...p, phase: "start" });
      else this.send({ kind: "mouse.down", ...p, button: e.button });
    });
    v.addEventListener("pointerup", (e) => {
      const p = this.normalize(e) ?? { x: 0, y: 0 };
      if (e.pointerType === "touch") this.send({ kind: "touch", ...p, phase: "end" });
      else this.send({ kind: "mouse.up", ...p, button: e.button });
    });
    v.addEventListener(
      "wheel",
      (e) => {
        const p = this.normalize(e);
        if (!p) return;
        e.preventDefault();
        this.send({ kind: "wheel", ...p, dx: e.deltaX, dy: e.deltaY });
      },
      { passive: false },
    );
    this.el.addEventListener("keydown", (e) => {
      if (!this.pc) return;
      e.preventDefault();
      this.send({ kind: "key.down", key: e.key, code: e.code });
    });
    this.el.addEventListener("keyup", (e) => {
      if (!this.pc) return;
      e.preventDefault();
      this.send({ kind: "key.up", key: e.key, code: e.code });
    });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function descriptionJson(d: RTCSessionDescription): JsonObject {
  return { type: d.type, sdp: d.sdp };
}
