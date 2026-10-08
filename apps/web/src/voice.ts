// The voice path on this device: capture -> gate -> Live session -> playback,
// plus the relays to the session server. One instance per page.

import { Gate, InputMode, type GateEvent } from "./gate/gate.ts";
import { onStep, releasesVoice, toggleAction } from "./composer/orb-toggle.ts";
import { LiveSession } from "./live/session.ts";
import { ReplyLatch } from "./live/reply-latch.ts";
import type { LiveEvent } from "./live/messages.ts";
import { Capture } from "./audio/capture.ts";
import { Playback } from "./audio/playback.ts";
import { C2S, hasVoice, type C2SMessage, type JsonObject, type S2CMessage, type TranscriptRole } from "./protocol.ts";
import type { GateConfig, LiveConfig } from "./config.ts";
import {
  EmbeddingSpeakerCheck,
  EnrollmentStore,
  NoSpeakerCheck,
  StubEmbedder,
  enrollSpeaker,
  type EnrollmentStorage,
  type SpeakerCheck,
  type SpeakerProfile,
} from "./gate/speaker.ts";

export type TokenResponse = {
  token: string;
  model: string;
  setup: JsonObject;
  expires_at: string;
  resumption_handle: string | null;
};

// Gemini counts audio at 32 tokens per second. CONFIRM against the current
// pricing page (spec: Facts to verify) before metering with it.
export const AUDIO_TOKENS_PER_SECOND = 32;

export function tokensToMs(tokens: number): number {
  return Math.round((tokens / AUDIO_TOKENS_PER_SECOND) * 1000);
}

export function bytesToMs(bytes: number, sampleRate: number): number {
  return Math.round((bytes / (sampleRate * 2)) * 1000);
}

export type VoiceOptions = {
  /** `http(s)://host` of the session server, for POST /token. */
  serverOrigin: string;
  auth: string;
  gateConfig: GateConfig;
  liveConfig: LiveConfig;
  /** False when the server socket is down and the message was dropped. */
  send: (msg: C2SMessage) => boolean;
  onTranscript: (role: TranscriptRole, text: string, final: boolean) => void;
  onChange?: () => void;
  /** On-device storage for the speaker profile. Null disables enrollment. */
  storage: EnrollmentStorage | null;
};

async function fetchToken(origin: string, auth: string): Promise<TokenResponse> {
  const res = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

function withHandle(setup: JsonObject, handle: string | null): JsonObject {
  if (!handle) return setup;
  const inner = setup.setup;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return setup;
  const existing = (inner as JsonObject).sessionResumption;
  const resumption: JsonObject =
    typeof existing === "object" && existing !== null && !Array.isArray(existing) ? { ...(existing as JsonObject) } : {};
  if (typeof resumption.handle !== "string") resumption.handle = handle;
  return { ...setup, setup: { ...(inner as JsonObject), sessionResumption: resumption } };
}

export class VoiceController {
  readonly gate: Gate;
  readonly playback = new Playback();
  readonly capture = new Capture();
  private readonly opts: VoiceOptions;
  private live: LiveSession | null = null;
  private next: LiveSession | null = null;
  private handle: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  /** The device id from `ready`, and the device that holds the voice session as last heard. */
  private self: string | null = null;
  private holder: string | null = null;
  /** The switch: on from the tap that turned it on until hang-up or a self-close. */
  private onValue = false;
  /** `voice.claim`s sent on this connection whose `voice.granted` has not come yet. The server grants every claim, in order. */
  private claimsInFlight = 0;
  /** How many of those were released before their grant: their grants are stale. */
  private staleGrants = 0;
  private readonly reply = new ReplyLatch();
  private userText = "";
  private agentText = "";
  private speaker: SpeakerCheck;
  private readonly store: EnrollmentStore | null;

  constructor(opts: VoiceOptions) {
    this.opts = opts;
    this.store = opts.storage ? new EnrollmentStore(opts.storage) : null;
    this.speaker = opts.gateConfig.speaker_check
      ? new EmbeddingSpeakerCheck({
          embedder: new StubEmbedder(),
          profile: this.store?.load() ?? null,
          threshold: opts.gateConfig.speaker_match_threshold,
        })
      : new NoSpeakerCheck();
    // Full duplex is the only mode: the gate listens while the Live session is open.
    this.gate = new Gate({
      config: opts.gateConfig,
      mode: InputMode.OPEN_MIC,
      isModelSpeaking: () => this.playback.isSpeaking(),
      speakerCheck: this.speaker,
    });
    this.gate.subscribe((e) => this.onGate(e));
  }

  // ---- state ---------------------------------------------------------------

  get holdsVoice(): boolean {
    return this.self !== null && this.holder === this.self;
  }

  /** Another device holds the voice session: the orb dims. */
  get otherHoldsVoice(): boolean {
    return this.holder !== null && this.holder !== this.self;
  }

  /** The device that holds the voice session, as last heard; null when none does. */
  get voiceHolder(): string | null {
    return this.holder;
  }

  /** The switch reads on. */
  get on(): boolean {
    return this.onValue;
  }

  get liveOpen(): boolean {
    return this.live !== null;
  }

  get listening(): boolean {
    return this.gate.open;
  }

  get speaking(): boolean {
    return this.playback.isSpeaking();
  }

  // ---- the voice session ---------------------------------------------------

  /** `ready`: the holder the server knows, on a new connection with no claim in flight. */
  syncHolder(holder: string | null, self: string): void {
    const held = this.holdsVoice;
    this.self = self;
    this.holder = holder;
    this.claimsInFlight = 0;
    this.staleGrants = 0;
    // A switch that held the voice session lost it while the socket was down.
    if (this.onValue && held && this.otherHoldsVoice) this.hangUp("revoked", false);
    else this.advance();
    this.opts.onChange?.();
  }

  /** `voice.granted`. */
  granted(): void {
    this.claimsInFlight = Math.max(0, this.claimsInFlight - 1);
    if (this.staleGrants > 0) {
      // The release that followed the claim already freed it on the server:
      // as last heard on this socket, nobody holds the voice session.
      this.staleGrants--;
      this.holder = null;
      this.opts.onChange?.();
      return;
    }
    if (!this.onValue) {
      // A grant while the switch is off (a claim the switch no longer wants,
      // or a server grant nobody asked for): give it straight back.
      this.opts.send({ type: C2S.VOICE_RELEASE });
      this.holder = null;
      this.opts.onChange?.();
      return;
    }
    this.holder = this.self;
    this.advance();
    this.opts.onChange?.();
  }

  /** `voice.revoked`: another device took the voice session. */
  revoked(by: string): void {
    this.holder = by;
    this.hangUp("revoked", false);
    this.opts.onChange?.();
  }

  // ---- user actions --------------------------------------------------------

  /** The orb's tap: the agent's on-switch (`composer/orb-toggle.ts`). */
  toggle(): void {
    if (toggleAction({ holdsVoice: this.holdsVoice, on: this.onValue }) === "on") this.start();
    else this.end();
  }

  /** On: claim the voice session when needed, then open the Live session and the microphone. */
  start(): void {
    if (this.onValue) return;
    this.onValue = true;
    void this.playback.unlock();
    this.advance();
    // A claim that never gets its grant still ends at the idle limit.
    this.touchIdle();
    this.opts.onChange?.();
  }

  /** Off: hang up and give the voice session back. */
  end(): void {
    this.hangUp("user", true);
  }

  /** The next step of an on switch that waits on the server: the claim, then Live and the microphone. */
  private advance(): void {
    if (!this.onValue) return;
    if (onStep({ holdsVoice: this.holdsVoice }) === "claim") {
      // One live claim at a time; claims released before their grant do not count.
      if (this.self !== null && this.claimsInFlight === this.staleGrants && this.opts.send({ type: C2S.VOICE_CLAIM })) {
        this.claimsInFlight++;
      }
      return;
    }
    this.ensureLive();
    if (!this.capture.running) {
      this.capture.start((frame) => this.gate.pushFrame(frame)).catch((err: unknown) => {
        console.error("capture", err);
        if (this.onValue) this.hangUp("microphone_unavailable", true);
      });
    }
    this.touchIdle();
  }

  /**
   * Hang-up, by the user or because the session cannot go on. Every resource
   * the switch took is released here. `release` gives the voice session back,
   * also a claim still in flight: the server handles this socket in order, so
   * the release lands after the claim.
   */
  private hangUp(reason: string, release: boolean): void {
    const wasOn = this.onValue;
    this.onValue = false;
    // An open turn ends here, so its activityEnd goes out before the close.
    this.gate.stopAll();
    this.closeLive(reason);
    if (release && wasOn && releasesVoice({ holdsVoice: this.holdsVoice, claimPending: this.claimsInFlight > 0 })) {
      this.opts.send({ type: C2S.VOICE_RELEASE });
      // The release lands after every claim still in flight, so all their grants are stale.
      this.staleGrants = this.claimsInFlight;
      if (this.holdsVoice) this.holder = null;
    }
    this.opts.onChange?.();
  }

  /** On-device enrollment; throws without consent. */
  enroll(samples: Int16Array, consent: boolean): SpeakerProfile {
    if (!this.store) throw new Error("no storage for enrollment");
    const profile = enrollSpeaker(samples, consent, { embedder: new StubEmbedder(), store: this.store });
    if (this.speaker instanceof EmbeddingSpeakerCheck) this.speaker.setProfile(profile);
    return profile;
  }

  // ---- server messages -----------------------------------------------------

  handleServer(msg: S2CMessage): void {
    switch (msg.type) {
      case "tool.result":
        this.live?.sendToolResponse({ id: msg.call_id, name: msg.name, response: msg.response, scheduling: msg.scheduling });
        break;
      case "job.started":
      case "job.progress":
      case "job.done":
        if (this.live) this.touchIdle();
        break;
      default:
        break;
    }
    if (hasVoice(msg) && this.holdsVoice && this.live) {
      this.live.sendEventTurn(msg.voice);
      this.touchIdle();
    }
  }

  // ---- gate ------------------------------------------------------------------

  private onGate(e: GateEvent): void {
    switch (e.kind) {
      case "speechStart":
        this.userText = "";
        this.ensureLive();
        this.live?.sendActivityStart();
        this.touchIdle();
        this.opts.onChange?.();
        break;
      case "audio":
        this.live?.sendAudio(e.frame);
        break;
      case "speechEnd":
        this.live?.sendActivityEnd();
        this.touchIdle();
        if (this.next?.setupDone) this.swap();
        this.opts.onChange?.();
        break;
      case "bargeIn":
        // Voice over the agent: playback stops inside bargein_stop_ms, and the
        // rest of the reply, in flight until `interrupted`, stays silent.
        this.reply.interrupt();
        this.playback.stop();
        break;
      case "drop":
        break;
    }
  }

  // ---- live session --------------------------------------------------------

  private ensureLive(): void {
    if (this.live || !this.onValue || !this.holdsVoice) return;
    const session = this.createSession();
    this.live = session;
    void this.openSession(session);
  }

  private createSession(): LiveSession {
    const session: LiveSession = new LiveSession({
      onEvent: (ev) => this.onLive(session, ev),
      onClose: (reason) => this.onLiveClose(session, reason),
      onError: (err) => console.error("live", err),
    });
    return session;
  }

  private async openSession(session: LiveSession): Promise<void> {
    try {
      const tok = await fetchToken(this.opts.serverOrigin, this.opts.auth);
      if (session !== this.live && session !== this.next) return;
      session.connect(tok.token, withHandle(tok.setup, this.handle ?? tok.resumption_handle));
    } catch (err) {
      console.error("token", err);
      if (session === this.live) {
        this.live = null;
        this.opts.send({ type: C2S.LIVE_CLOSED, reason: "token_failed" });
        this.hangUp("token_failed", true);
      } else if (session === this.next) {
        this.next = null;
      }
      this.opts.onChange?.();
    }
  }

  private onLive(session: LiveSession, ev: LiveEvent): void {
    if (session !== this.live && session !== this.next) return;
    switch (ev.kind) {
      case "setupComplete":
        if (session === this.next && !this.gate.open) this.swap();
        this.opts.onChange?.();
        break;
      case "audio":
        if (session === this.live && this.reply.audio()) this.playback.enqueue(ev.data, ev.sampleRate);
        break;
      case "interrupted":
        this.playback.stop();
        this.reply.end();
        break;
      case "generationComplete":
        if (session === this.live) this.reply.end();
        break;
      case "turnComplete":
        if (session === this.live) this.reply.end();
        if (this.agentText.length > 0) {
          this.relayTranscript("agent", this.agentText, true);
          this.agentText = "";
        }
        if (this.userText.length > 0) {
          this.relayTranscript("user", this.userText, true);
          this.userText = "";
        }
        break;
      case "inputTranscription":
        this.userText += ev.text;
        this.gate.setTranscript(this.userText);
        this.relayTranscript("user", this.userText, ev.finished);
        if (ev.finished) this.userText = "";
        break;
      case "outputTranscription":
        this.agentText += ev.text;
        this.relayTranscript("agent", this.agentText, ev.finished);
        if (ev.finished) this.agentText = "";
        break;
      case "toolCall":
        for (const call of ev.calls) {
          this.opts.send({ type: C2S.TOOL_CALL, call_id: call.id, name: call.name, args: call.args });
        }
        this.touchIdle();
        break;
      case "toolCallCancellation":
        break;
      case "usage": {
        const bytes = session.takeAudioBytes();
        this.opts.send({
          type: C2S.LIVE_USAGE,
          audio_in_ms:
            ev.promptAudioTokens !== null
              ? tokensToMs(ev.promptAudioTokens)
              : bytesToMs(bytes.inBytes, this.opts.liveConfig.input_sample_rate),
          audio_out_ms:
            ev.responseAudioTokens !== null
              ? tokensToMs(ev.responseAudioTokens)
              : bytesToMs(bytes.outBytes, this.opts.liveConfig.output_sample_rate),
          input_tokens: ev.promptTokens,
          output_tokens: ev.responseTokens,
        });
        break;
      }
      case "resumptionUpdate":
        if (ev.newHandle) {
          this.handle = ev.newHandle;
          this.opts.send({ type: C2S.LIVE_RESUMPTION, handle: ev.newHandle });
        }
        break;
      case "goAway":
        if (session === this.live) this.prepareNext(ev.timeLeftMs);
        break;
      case "text":
      case "unknown":
        break;
    }
  }

  private onLiveClose(session: LiveSession, reason: string): void {
    if (session === this.live) {
      this.live = null;
      this.opts.send({ type: C2S.LIVE_CLOSED, reason });
      if (this.next) {
        this.live = this.next;
        this.next = null;
      } else {
        // Closed by itself (idle, error, server drop): the switch reads off.
        this.hangUp(reason, true);
      }
      this.opts.onChange?.();
    } else if (session === this.next) {
      this.next = null;
    }
  }

  private relayTranscript(role: TranscriptRole, text: string, final: boolean): void {
    this.opts.onTranscript(role, text, final);
    this.opts.send({ type: C2S.TRANSCRIPT, role, text, final });
  }

  /** goAway: open the replacement now, switch when it is ready and the user
   *  is not mid-turn, or at the latest 1 s before the old session ends. */
  private prepareNext(timeLeftMs: number | null): void {
    if (this.next || !this.live) return;
    const session = this.createSession();
    this.next = session;
    void this.openSession(session);
    if (this.swapTimer) clearTimeout(this.swapTimer);
    const wait = timeLeftMs === null ? 5000 : Math.max(0, timeLeftMs - 1000);
    this.swapTimer = setTimeout(() => this.swap(), wait);
  }

  private swap(): void {
    const next = this.next;
    if (!next) return;
    if (this.swapTimer) {
      clearTimeout(this.swapTimer);
      this.swapTimer = null;
    }
    const old = this.live;
    this.live = next;
    this.next = null;
    old?.close("goAway");
    this.opts.onChange?.();
  }

  /** Close the Live session and stop the microphone and playback. `hangUp` also turns the switch off. */
  private closeLive(reason: string): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.swapTimer) clearTimeout(this.swapTimer);
    this.swapTimer = null;
    this.next?.close(reason);
    this.next = null;
    const session = this.live;
    this.live = null;
    if (session) {
      session.close(reason);
      this.opts.send({ type: C2S.LIVE_CLOSED, reason });
    }
    this.gate.stopAll();
    this.capture.stop();
    this.playback.stop();
    this.reply.end();
    this.opts.onChange?.();
  }

  // ---- idle ------------------------------------------------------------------

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.onIdle(), this.opts.liveConfig.idle_close_seconds * 1000);
  }

  private onIdle(): void {
    if (this.gate.open || this.playback.isSpeaking()) {
      this.touchIdle();
      return;
    }
    this.hangUp("idle", true);
  }
}
