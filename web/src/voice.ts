// The voice path on this device: capture -> gate -> Live session -> playback,
// plus the relays to the session server. One instance per page.

import { Gate, InputMode, type GateEvent } from "./gate/gate.ts";
import { LiveSession } from "./live/session.ts";
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
  send: (msg: C2SMessage) => void;
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
  private holds = false;
  private pendingStart = false;
  /** Text typed before this device held the voice session; sent once granted. */
  private pendingText: string[] = [];
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
    return this.holds;
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

  get inputMode(): InputMode {
    return this.gate.mode;
  }

  setHoldsVoice(holds: boolean): void {
    if (holds === this.holds) return;
    this.holds = holds;
    if (!holds) {
      this.closeLive("revoked");
      this.pendingText = [];
    } else {
      if (this.pendingStart) {
        this.pendingStart = false;
        this.start();
      }
      const texts = this.pendingText;
      this.pendingText = [];
      for (const t of texts) this.sendText(t);
    }
    this.opts.onChange?.();
  }

  // ---- user actions --------------------------------------------------------

  /** Orb or talk press: open the microphone and the Live session. */
  start(): void {
    if (!this.holds) {
      this.pendingStart = true;
      this.opts.send({ type: C2S.VOICE_CLAIM });
      return;
    }
    this.ensureLive();
    void this.playback.unlock();
    if (!this.capture.running) {
      this.capture.start((frame) => this.gate.pushFrame(frame)).catch((err: unknown) => {
        console.error("capture", err);
      });
    }
    this.touchIdle();
    this.opts.onChange?.();
  }

  /** Orb click while live: microphone and session off. */
  end(): void {
    this.closeLive("user");
  }

  pressTalk(): void {
    this.start();
    if (this.holds) this.gate.pressTalk();
  }

  releaseTalk(): void {
    this.gate.releaseTalk();
  }

  /** The stop button: always works. */
  stop(): void {
    this.playback.stop();
    this.gate.stopAll();
  }

  /** Push to talk or open mic; `gate.setMode` does the work. */
  setInputMode(mode: InputMode): void {
    this.gate.setMode(mode);
    this.opts.onChange?.();
  }

  /**
   * Typed text goes to the same voice model: the Live session opens when it
   * is closed, the text is one plain user turn (no `<event>` wrapper), and
   * the server gets the transcript so other devices show the card. Without
   * the voice session the text waits for `voice.granted`.
   */
  sendText(text: string): void {
    const t = text.trim();
    if (t.length === 0) return;
    if (!this.holds) {
      this.pendingText.push(t);
      this.opts.send({ type: C2S.VOICE_CLAIM });
      return;
    }
    this.ensureLive();
    void this.playback.unlock();
    this.live?.sendUserTextTurn(t);
    this.relayTranscript("user", t, true);
    this.touchIdle();
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
    if (hasVoice(msg) && this.holds && this.live) {
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
        this.playback.stop();
        break;
      case "drop":
        break;
    }
  }

  // ---- live session --------------------------------------------------------

  private ensureLive(): void {
    if (this.live || !this.holds) return;
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
        if (session === this.live) this.playback.enqueue(ev.data, ev.sampleRate);
        break;
      case "interrupted":
        this.playback.stop();
        break;
      case "turnComplete":
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
      case "generationComplete":
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

  closeLive(reason: string): void {
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
    this.closeLive("idle");
  }
}
