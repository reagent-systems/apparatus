// The voice gate. Decides what audio leaves the device and when a turn ends.
//
// Order per frame: VAD -> minimum duration -> barge-in bar (while the model
// speaks) -> speaker check -> turn detector. Echo cancellation and noise
// suppression run before this, in the capture constraints (OS/browser).
//
// Events: speechStart, audio(frame), speechEnd(reason), bargeIn, drop(reason).
// The decision log holds {t, decision, reason} and never audio.

import type { GateConfig } from "../config.ts";
import { EnergyVad, type Vad } from "./vad.ts";
import { TurnDetector, type CompletenessModel, type TurnEnd } from "./turn.ts";
import { BargeInRule } from "./bargein.ts";
import { EnergyBurstWordEstimator, TranscriptWordCounter, type WordEstimator } from "./words.ts";
import { NoSpeakerCheck, type SpeakerCheck } from "./speaker.ts";

export const InputMode = {
  PUSH_TO_TALK: "push_to_talk",
  OPEN_MIC: "open_mic",
} as const;
export type InputMode = (typeof InputMode)[keyof typeof InputMode];

// TODO(wake-word): no detector ships yet. When one does, open_mic with a
// detector set keeps the gate closed until the word is heard, then opens it
// for one turn. The Live session stays closed until then (spec: Input modes).
export interface WakeWordDetector {
  process(frame: Int16Array): boolean;
  reset(): void;
}

export type SpeechEndReason = TurnEnd | "manual_release" | "manual_stop" | "max_duration";
export type DropReason = "too_short" | "bargein_rejected" | "speaker_mismatch" | "manual_stop";

export type GateEvent =
  | { kind: "speechStart"; forced: boolean }
  | { kind: "audio"; frame: Int16Array }
  | { kind: "speechEnd"; reason: SpeechEndReason }
  | { kind: "bargeIn"; voiceMs: number; words: number }
  | { kind: "drop"; reason: DropReason; voiceMs: number };

export type GateLogEntry = { t: number; decision: string; reason: string };

export type GateState = "idle" | "pending" | "speaking" | "rejected";

export type GateOptions = {
  config: GateConfig;
  sampleRate?: number;
  mode?: InputMode;
  /** Polled every frame. True while playback has audio scheduled. */
  isModelSpeaking?: () => boolean;
  vad?: Vad;
  completeness?: CompletenessModel;
  wordEstimator?: WordEstimator;
  speakerCheck?: SpeakerCheck;
  wakeWord?: WakeWordDetector;
  logCapacity?: number;
  /** A barge-in candidate that never clears the bar is dropped after this. */
  maxPendingMs?: number;
  /** Safety stop for an automatic turn that never goes silent. */
  maxTurnMs?: number;
};

export type GateListener = (event: GateEvent) => void;

function toInt16(frame: Int16Array | Float32Array): Int16Array {
  if (frame instanceof Int16Array) return frame;
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const v = Math.max(-1, Math.min(1, frame[i]));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

function concat(frames: Int16Array[]): Int16Array {
  let n = 0;
  for (const f of frames) n += f.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

export class Gate {
  readonly config: GateConfig;
  readonly sampleRate: number;
  private modeValue: InputMode;
  private readonly isModelSpeaking: () => boolean;
  private readonly vad: Vad;
  private readonly turn: TurnDetector;
  private readonly bargein: BargeInRule;
  private readonly words: WordEstimator;
  private readonly transcriptWords = new TranscriptWordCounter();
  private readonly speaker: SpeakerCheck;
  private readonly wakeWord: WakeWordDetector | null;
  private readonly maxPendingMs: number;
  private readonly maxTurnMs: number;

  private listeners: GateListener[] = [];
  private stateValue: GateState = "idle";
  private forced = false;
  private armed = false;
  private buffer: Int16Array[] = [];
  private voiceMs = 0;
  private pendingMs = 0;
  private turnMs = 0;
  private clock = 0;

  private readonly entries: GateLogEntry[];
  private readonly logCapacity: number;
  private logHead = 0;
  private logSize = 0;

  constructor(opts: GateOptions) {
    this.config = opts.config;
    this.sampleRate = opts.sampleRate ?? 16000;
    this.modeValue = opts.mode ?? InputMode.OPEN_MIC;
    this.isModelSpeaking = opts.isModelSpeaking ?? (() => false);
    this.vad =
      opts.vad ??
      new EnergyVad({
        threshold: opts.config.vad_energy_threshold,
        hangoverMs: opts.config.vad_hangover_ms,
        sampleRate: this.sampleRate,
      });
    this.turn = new TurnDetector(
      { silenceCompleteMs: opts.config.silence_complete_ms, silenceIncompleteMs: opts.config.silence_incomplete_ms },
      opts.completeness,
    );
    this.bargein = new BargeInRule({
      minVoiceMs: opts.config.bargein_min_voice_ms,
      minWords: opts.config.bargein_min_words,
    });
    this.words = opts.wordEstimator ?? new EnergyBurstWordEstimator();
    this.speaker = opts.speakerCheck ?? new NoSpeakerCheck();
    this.wakeWord = opts.wakeWord ?? null;
    this.maxPendingMs = opts.maxPendingMs ?? 3000;
    this.maxTurnMs = opts.maxTurnMs ?? 120_000;
    this.logCapacity = opts.logCapacity ?? 200;
    this.entries = new Array<GateLogEntry>(this.logCapacity);
  }

  // ---- public surface ----------------------------------------------------

  subscribe(fn: GateListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  get state(): GateState {
    return this.stateValue;
  }

  /** True between speechStart and speechEnd. */
  get open(): boolean {
    return this.stateValue === "speaking";
  }

  get mode(): InputMode {
    return this.modeValue;
  }

  setMode(mode: InputMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.record("mode", mode);
    if (mode === InputMode.PUSH_TO_TALK && !this.forced) this.stopAll();
  }

  /** Time in ms, derived from frames processed. */
  get now(): number {
    return this.clock;
  }

  /** Latest interim transcript of the open turn, from Live inputTranscription. */
  setTranscript(text: string): void {
    this.turn.setTranscript(text);
    this.transcriptWords.setText(text);
  }

  /** Oldest first. Never contains audio. */
  log(): GateLogEntry[] {
    const out: GateLogEntry[] = [];
    for (let i = 0; i < this.logSize; i++) {
      const idx = (this.logHead - this.logSize + i + this.logCapacity) % this.logCapacity;
      out.push(this.entries[idx]);
    }
    return out;
  }

  /** Talk button down. Opens the turn at once, past every filter. */
  pressTalk(): void {
    if (this.forced) return;
    this.forced = true;
    this.record("manual_press", this.stateValue);
    if (this.stateValue === "speaking") return;
    if (this.isModelSpeaking()) this.emit({ kind: "bargeIn", voiceMs: this.voiceMs, words: 0 });
    this.confirm(true);
  }

  /** Talk button up. Ends the turn at once. */
  releaseTalk(): void {
    if (!this.forced) return;
    this.forced = false;
    this.record("manual_release", this.stateValue);
    if (this.stateValue === "speaking") this.endTurn("manual_release");
  }

  /** Stop button. Ends any open turn and clears any candidate. */
  stopAll(): void {
    this.forced = false;
    if (this.stateValue === "speaking") {
      this.endTurn("manual_stop");
    } else if (this.stateValue === "pending") {
      this.drop("manual_stop");
    }
    this.record("manual_stop", "");
    this.reset();
  }

  /** One 20 ms frame of microphone audio, 16 kHz mono. */
  pushFrame(input: Int16Array | Float32Array): void {
    const frame = toInt16(input);
    const frameMs = (frame.length / this.sampleRate) * 1000;
    this.clock += frameMs;
    const v = this.vad.process(frame);

    if (this.forced) {
      this.emit({ kind: "audio", frame });
      this.turn.observe(frame);
      return;
    }

    if (this.stateValue === "speaking") {
      this.emit({ kind: "audio", frame });
      this.turn.observe(frame);
      this.turnMs += frameMs;
      // Silence counts from the last raw voiced frame, not from the end of
      // the hangover, so the limits in the config mean what they say.
      const end = this.turn.update(v.raw, frameMs);
      if (end) this.endTurn(end);
      else if (this.turnMs >= this.maxTurnMs) this.endTurn("max_duration");
      return;
    }

    if (this.stateValue === "rejected") {
      if (!v.active) this.reset();
      return;
    }

    if (this.stateValue === "idle") {
      if (this.modeValue === InputMode.PUSH_TO_TALK) return;
      if (this.wakeWord && !this.armed) {
        if (this.wakeWord.process(frame)) {
          this.armed = true;
          this.record("wake_word", "armed");
        }
        return;
      }
      if (!v.raw) return;
      this.stateValue = "pending";
      this.buffer = [];
      this.voiceMs = 0;
      this.pendingMs = 0;
      this.words.reset();
      this.transcriptWords.reset();
    }

    // pending: a candidate segment, buffered on the device
    this.buffer.push(frame);
    this.pendingMs += frameMs;
    if (v.raw) this.voiceMs += frameMs;
    this.words.push(v.raw, frameMs);

    if (!v.active) {
      this.drop(this.voiceMs < this.config.min_speech_ms ? "too_short" : "bargein_rejected");
      this.reset();
      return;
    }
    if (this.voiceMs < this.config.min_speech_ms) return;

    if (this.isModelSpeaking()) {
      const words = Math.max(this.words.count(), this.transcriptWords.count());
      if (!this.bargein.allows(this.voiceMs, words)) {
        if (this.pendingMs >= this.maxPendingMs) {
          this.drop("bargein_rejected");
          this.stateValue = "rejected";
          this.buffer = [];
        }
        return;
      }
      this.record("barge_in", `voice_ms=${Math.round(this.voiceMs)} words=${words}`);
      this.emit({ kind: "bargeIn", voiceMs: this.voiceMs, words });
    }

    if (this.speaker.enabled && !this.speaker.matches(concat(this.buffer))) {
      this.drop("speaker_mismatch");
      this.stateValue = "rejected";
      this.buffer = [];
      return;
    }

    this.confirm(false);
  }

  // ---- internals -----------------------------------------------------------

  private confirm(forced: boolean): void {
    const buffered = this.buffer;
    this.buffer = [];
    this.stateValue = "speaking";
    this.turnMs = 0;
    this.armed = false;
    this.turn.start();
    this.transcriptWords.reset();
    this.record("speech_start", forced ? "manual" : `voice_ms=${Math.round(this.voiceMs)}`);
    this.emit({ kind: "speechStart", forced });
    for (const f of buffered) this.emit({ kind: "audio", frame: f });
  }

  private endTurn(reason: SpeechEndReason): void {
    this.record("speech_end", reason);
    this.emit({ kind: "speechEnd", reason });
    this.reset();
  }

  private drop(reason: DropReason): void {
    this.record("drop", `${reason} voice_ms=${Math.round(this.voiceMs)}`);
    this.emit({ kind: "drop", reason, voiceMs: this.voiceMs });
  }

  private reset(): void {
    this.stateValue = "idle";
    this.buffer = [];
    this.voiceMs = 0;
    this.pendingMs = 0;
    this.turnMs = 0;
    this.words.reset();
    this.wakeWord?.reset();
  }

  private emit(event: GateEvent): void {
    for (const l of this.listeners) l(event);
  }

  private record(decision: string, reason: string): void {
    this.entries[this.logHead] = { t: Math.round(this.clock), decision, reason };
    this.logHead = (this.logHead + 1) % this.logCapacity;
    if (this.logSize < this.logCapacity) this.logSize += 1;
  }
}
