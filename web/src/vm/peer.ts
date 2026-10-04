// ScreenPeer: the answerer side of one screen stream. agentd makes the
// offer and the "input" data channel; this side answers, keeps the channel
// and hands the video track to the widget. Touches the WebRTC API only in
// methods, so the module loads without a window.

import type { IceServer, SignalPayload } from "../protocol.ts";
import { candidatePayload, descriptionPayload, encodeInput, parseSignal, type InputEvent, type SignalingState } from "./input.ts";
import { Negotiation } from "./negotiation.ts";

export type ScreenPeerEvents = {
  /** An outgoing description or candidate for `C2S.signal`. */
  onSignal: (payload: SignalPayload) => void;
  /** The remote video, for `<video>.srcObject`. */
  onTrack: (stream: MediaStream) => void;
  /** The "input" channel opened or closed. */
  onChannel: (open: boolean) => void;
  onState: (state: RTCPeerConnectionState) => void;
  onError?: (err: unknown) => void;
};

export const INPUT_CHANNEL = "input";

export class ScreenPeer {
  private readonly events: ScreenPeerEvents;
  private readonly negotiation = new Negotiation();
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(events: ScreenPeerEvents) {
    this.events = events;
  }

  get channelOpen(): boolean {
    return this.channel !== null && this.channel.readyState === "open";
  }

  get signalingState(): SignalingState {
    return (this.pc?.signalingState ?? "closed") as SignalingState;
  }

  open(iceServers: IceServer[]): void {
    if (this.pc || this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      if (!c) return;
      this.events.onSignal(candidatePayload({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }));
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.events.onTrack(stream);
    };
    pc.ondatachannel = (ev) => {
      if (ev.channel.label !== INPUT_CHANNEL) return;
      this.attach(ev.channel);
    };
    pc.onconnectionstatechange = () => this.events.onState(pc.connectionState);
  }

  /** Signals are applied one at a time, in arrival order. */
  handleSignal(payload: unknown): Promise<void> {
    this.chain = this.chain.then(() => this.apply(payload)).catch((err: unknown) => this.events.onError?.(err));
    return this.chain;
  }

  /** False when the channel is not open; the event is dropped. */
  send(event: InputEvent): boolean {
    if (!this.channelOpen || !this.channel) return false;
    this.channel.send(encodeInput(event));
    return true;
  }

  close(): void {
    this.closed = true;
    const wasOpen = this.channelOpen;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.close();
      this.channel = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.ondatachannel = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.negotiation.reset();
    if (wasOpen) this.events.onChannel(false);
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => this.events.onChannel(true);
    channel.onclose = () => {
      if (this.channel === channel) this.channel = null;
      this.events.onChannel(false);
    };
    if (channel.readyState === "open") this.events.onChannel(true);
  }

  private async apply(payload: unknown): Promise<void> {
    const pc = this.pc;
    if (!pc || this.closed) return;
    const decision = this.negotiation.decide(parseSignal(payload), pc.signalingState as SignalingState);
    switch (decision.action) {
      case "describe": {
        if (decision.rollback) await pc.setLocalDescription({ type: "rollback" });
        await pc.setRemoteDescription({ type: decision.type, sdp: decision.sdp });
        for (const candidate of this.negotiation.described()) await this.addCandidate(pc, candidate);
        if (decision.answer) {
          await pc.setLocalDescription();
          const local = pc.localDescription;
          if (local) this.events.onSignal(descriptionPayload(local));
        }
        return;
      }
      case "candidate":
        await this.addCandidate(pc, decision.candidate);
        return;
      case "queue":
      case "ignore":
        return;
    }
  }

  private async addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      // A candidate for a rolled-back or replaced description; the next
      // negotiation brings fresh ones.
      this.events.onError?.(err);
    }
  }
}
