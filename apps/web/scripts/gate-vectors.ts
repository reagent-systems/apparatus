// Shared gate vectors: the web gate in open-mic mode, driven by synthetic
// frames, recorded as input plus the exact ordered event list. The watch ports
// of apps/web/src/gate (Swift, Kotlin) replay the same input and must produce the
// same events. `npm run gate-vectors` writes packages/gate-vectors/gate-vectors.json;
// test/gate-vectors.test.ts fails when the committed file drifts from this.
//
// Everything here is deterministic: no randomness, no wall clock, integer
// sample values.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GATE, DEFAULT_LIVE, FRAME_MS, FRAME_SAMPLES, type GateConfig } from "../src/config.ts";
import { Gate, InputMode, type GateEvent, type GateState } from "../src/gate/gate.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_PATH = join(here, "..", "..", "..", "packages", "gate-vectors", "gate-vectors.json");

const SAMPLE_RATE = DEFAULT_LIVE.input_sample_rate;
// The two gate limits that are constructor defaults, not config. The web
// passes neither, so a port uses the same values.
const MAX_PENDING_MS = 3000;
const MAX_TURN_MS = 120_000;
// A square wave of period 80 samples (200 Hz at 16 kHz): 40 samples at +q,
// 40 at -q. 320 samples hold 4 whole periods, so every frame of a segment is
// identical and its RMS is q / 32768.
const HALF_PERIOD = 40;

export type SegmentKind = "silence" | "noise" | "speech" | "dip" | "click" | "cough";
type Segment = { ms: number; amplitude: number; kind: SegmentKind };
type Step = { before_frame: number; op: "transcript"; text: string } | { before_frame: number; op: "stop" };
type Interval = { from_ms: number; to_ms: number };

type Scenario = {
  name: string;
  covers: string;
  config?: Partial<GateConfig>;
  segments: Segment[];
  model_speaking?: Interval[];
  /** Control calls between frames, by frame index (ms / 20). */
  steps?: Step[];
  /** Non-audio events the scenario is built to produce, "kind" or "kind:reason". Checked, not emitted. */
  expect: string[];
};

export type VectorEvent =
  | { at: number; t_ms: number; kind: "speechStart"; forced: boolean }
  | { at: number; t_ms: number; kind: "audio"; first_frame: number; frames: number }
  | { at: number; t_ms: number; kind: "speechEnd"; reason: string }
  | { at: number; t_ms: number; kind: "bargeIn"; voice_ms: number; words: number }
  | { at: number; t_ms: number; kind: "drop"; reason: string; voice_ms: number };

const AMP = { speech: 0.2, noise: 0.005, click: 0.5, cough: 0.3 } as const;

const seg = (kind: SegmentKind, ms: number, amplitude = 0): Segment => ({ ms, amplitude, kind });
const silence = (ms: number) => seg("silence", ms);
const speech = (ms: number, amplitude: number = AMP.speech) => seg("speech", ms, amplitude);

/** `n` words of `wordMs` voice each, split by `dipMs` of silence (the energy-burst word estimator counts them). */
function words(n: number, wordMs: number, dipMs: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) out.push(seg("dip", dipMs));
    out.push(speech(wordMs));
  }
  return out;
}

const totalMs = (segments: Segment[]) => segments.reduce((n, s) => n + s.ms, 0);

const SCENARIOS: Scenario[] = [
  {
    name: "silence_only",
    covers: "Digital silence and room noise under the VAD threshold open nothing.",
    segments: [silence(1000), seg("noise", 1000, AMP.noise), silence(200)],
    expect: [],
  },
  {
    name: "one_utterance",
    covers: "Speech confirms once min_speech_ms of voice is buffered, flushes the buffer, and ends complete after silence_complete_ms of silence.",
    segments: [silence(200), speech(800), silence(1000)],
    expect: ["speechStart", "speechEnd:complete"],
  },
  {
    name: "mid_sentence_pause",
    covers: "A 480 ms pause, one frame under silence_complete_ms, keeps the turn open; one turn ends after the second phrase.",
    segments: [silence(200), speech(600), silence(480), speech(600), silence(1000)],
    expect: ["speechStart", "speechEnd:complete"],
  },
  {
    name: "cough_and_click",
    covers: "A 40 ms click and a 280 ms cough (one frame under min_speech_ms) are dropped too_short once the VAD hangover runs out; no audio leaves.",
    segments: [silence(200), seg("click", 40, AMP.click), silence(600), seg("cough", 280, AMP.cough), silence(600)],
    expect: ["drop:too_short", "drop:too_short"],
  },
  {
    name: "bargein_rejected",
    covers: "While the model speaks, one continuous burst counts as one word, under bargein_min_words: a 400 ms burst is dropped bargein_rejected when the hangover ends; a 3.6 s burst is dropped at the 3000 ms pending limit and stays rejected, emitting nothing, until the VAD goes inactive.",
    segments: [silence(200), speech(400), silence(600), speech(3600), silence(800)],
    model_speaking: [{ from_ms: 0, to_ms: 5600 }],
    expect: ["drop:bargein_rejected", "drop:bargein_rejected"],
  },
  {
    name: "bargein_accepted",
    covers: "While the model speaks, three 160 ms words split by 60 ms dips clear the bar (300 ms voice, 2 words): bargeIn, then speechStart with the buffer. The client stops playback within bargein_stop_ms. After the model stops, the next utterance needs no barge-in.",
    segments: [silence(200), ...words(3, 160, 60), silence(800), speech(600), silence(800)],
    model_speaking: [{ from_ms: 0, to_ms: 1400 }],
    expect: ["bargeIn", "speechStart", "speechEnd:complete", "speechStart", "speechEnd:complete"],
  },
  {
    name: "incomplete_transcript",
    covers: "The interim transcript picks the silence limit: a sentence ending on 'to' waits silence_incomplete_ms; one ending on '.' ends after silence_complete_ms.",
    segments: [silence(200), speech(800), silence(2600), speech(800), silence(800)],
    steps: [
      { before_frame: 40, op: "transcript", text: "Book a flight to" },
      { before_frame: 200, op: "transcript", text: "Book a flight to Paris." },
    ],
    expect: ["speechStart", "speechEnd:incomplete", "speechStart", "speechEnd:complete"],
  },
  {
    name: "line_terminator_transcript",
    covers: "A transcript ending in U+0085 (NEL) is read as JavaScript reads it: `$` without the m flag matches only at the true end and trim keeps U+0085, so 'Well,\\u0085' is complete (silence_complete_ms) and 'Book a flight to.\\u0085' is incomplete (silence_incomplete_ms). A Java or Kotlin `$` would also match before the final U+0085 and pick the other limit.",
    segments: [silence(200), speech(800), silence(800), speech(800), silence(2600)],
    steps: [
      { before_frame: 40, op: "transcript", text: "Well,\u0085" },
      { before_frame: 120, op: "transcript", text: "Book a flight to.\u0085" },
    ],
    expect: ["speechStart", "speechEnd:complete", "speechStart", "speechEnd:incomplete"],
  },
  {
    name: "max_duration",
    covers: "An automatic turn that never goes silent ends max_duration after 120000 ms; the voice that continues opens a new turn.",
    segments: [silence(200), speech(121_000), silence(800)],
    expect: ["speechStart", "speechEnd:max_duration", "speechStart", "speechEnd:complete"],
  },
  {
    name: "back_to_back",
    covers: "Two utterances with exactly silence_complete_ms between them: the first ends on the last silent frame, the second confirms on its own.",
    segments: [silence(200), speech(600), silence(500), speech(600), silence(800)],
    expect: ["speechStart", "speechEnd:complete", "speechStart", "speechEnd:complete"],
  },
  {
    name: "hang_up_mid_utterance",
    covers: "Hang-up while the user speaks: stopAll ends the open turn manual_stop. The microphone stops, so no frame follows.",
    segments: [silence(200), speech(600)],
    steps: [{ before_frame: 40, op: "stop" }],
    expect: ["speechStart", "speechEnd:manual_stop"],
  },
  {
    name: "hang_up_pending",
    covers: "Hang-up while a candidate is still buffered: stopAll drops it manual_stop and no audio leaves.",
    segments: [silence(200), speech(200)],
    steps: [{ before_frame: 20, op: "stop" }],
    expect: ["drop:manual_stop"],
  },
  {
    name: "server_config",
    covers: "Thresholds come from the config, not the code: under this table 0.03 RMS is silence, a 60 ms burst drops too_short after a 100 ms hangover, 100 ms of voice confirms, and 300 ms of silence ends the turn.",
    config: { vad_energy_threshold: 0.05, vad_hangover_ms: 100, min_speech_ms: 100, silence_complete_ms: 300 },
    segments: [silence(200), speech(600, 0.03), silence(400), speech(60), silence(400), speech(120), silence(600)],
    expect: ["drop:too_short", "speechStart", "speechEnd:complete"],
  },
];

/** Integer peak sample value of a segment. Ports build frames from this, not from `amplitude`. */
export function peak(amplitude: number): number {
  return Math.round(amplitude * 32767);
}

/** One 20 ms frame: sample k is +q when (k mod 80) < 40, else -q. */
export function makeFrame(q: number): Int16Array {
  const out = new Int16Array(FRAME_SAMPLES);
  for (let k = 0; k < FRAME_SAMPLES; k++) out[k] = k % (2 * HALF_PERIOD) < HALF_PERIOD ? q : -q;
  return out;
}

function speakingAt(intervals: Interval[], frameIndex: number): boolean {
  const t = frameIndex * FRAME_MS;
  return intervals.some((iv) => iv.from_ms <= t && t < iv.to_ms);
}

function run(s: Scenario, config: GateConfig): { events: VectorEvent[]; frames: number; endState: GateState } {
  const segments = s.segments;
  for (const g of segments) {
    if (g.ms <= 0 || g.ms % FRAME_MS !== 0) throw new Error(`${s.name}: segment of ${g.ms} ms is not a whole number of frames`);
  }
  const intervals = s.model_speaking ?? [];
  let current = 0;
  const gate = new Gate({
    config,
    sampleRate: SAMPLE_RATE,
    mode: InputMode.OPEN_MIC,
    isModelSpeaking: () => speakingAt(intervals, current),
    maxPendingMs: MAX_PENDING_MS,
    maxTurnMs: MAX_TURN_MS,
  });

  const index = new Map<Int16Array, number>();
  const events: VectorEvent[] = [];
  let pushed = 0;
  gate.subscribe((e: GateEvent) => {
    const at = pushed;
    const t_ms = Math.round(gate.now);
    switch (e.kind) {
      case "audio": {
        const i = index.get(e.frame);
        if (i === undefined) throw new Error(`${s.name}: audio frame not from the input`);
        const last = events[events.length - 1];
        if (last && last.kind === "audio" && last.first_frame + last.frames === i) last.frames += 1;
        else events.push({ at, t_ms, kind: "audio", first_frame: i, frames: 1 });
        break;
      }
      case "speechStart":
        events.push({ at, t_ms, kind: "speechStart", forced: e.forced });
        break;
      case "speechEnd":
        events.push({ at, t_ms, kind: "speechEnd", reason: e.reason });
        break;
      case "bargeIn":
        events.push({ at, t_ms, kind: "bargeIn", voice_ms: e.voiceMs, words: e.words });
        break;
      case "drop":
        events.push({ at, t_ms, kind: "drop", reason: e.reason, voice_ms: e.voiceMs });
        break;
    }
  });

  const steps = s.steps ?? [];
  const total = totalMs(segments) / FRAME_MS;
  for (const st of steps) {
    if (st.before_frame < 0 || st.before_frame > total) throw new Error(`${s.name}: step outside the input`);
  }
  const applySteps = (frameIndex: number) => {
    for (const st of steps) {
      if (st.before_frame !== frameIndex) continue;
      if (st.op === "transcript") gate.setTranscript(st.text);
      else gate.stopAll();
    }
  };

  for (const g of segments) {
    const q = peak(g.amplitude);
    for (let n = 0; n < g.ms / FRAME_MS; n++) {
      applySteps(current);
      const f = makeFrame(q);
      index.set(f, current);
      pushed = current + 1;
      gate.pushFrame(f);
      current += 1;
    }
  }
  applySteps(current);
  return { events, frames: current, endState: gate.state };
}

function label(e: VectorEvent): string {
  return "reason" in e ? `${e.kind}:${e.reason}` : e.kind;
}

export function buildVectors(): Record<string, unknown> {
  const scenarios = SCENARIOS.map((s) => {
    const config: GateConfig = { ...DEFAULT_GATE, ...s.config };
    const { events, frames, endState } = run(s, config);
    const got = events.filter((e) => e.kind !== "audio").map(label);
    if (JSON.stringify(got) !== JSON.stringify(s.expect)) {
      throw new Error(`${s.name}: expected ${JSON.stringify(s.expect)}, the gate emitted ${JSON.stringify(got)}`);
    }
    const counts: Record<string, number> = { speechStart: 0, audio_frames: 0, speechEnd: 0, bargeIn: 0, drop: 0 };
    for (const e of events) {
      if (e.kind === "audio") counts.audio_frames += e.frames;
      else counts[e.kind] += 1;
    }
    return {
      name: s.name,
      covers: s.covers,
      config,
      input: {
        frames,
        segments: s.segments.map((g) => ({ ms: g.ms, amplitude: g.amplitude, q: peak(g.amplitude), kind: g.kind })),
        model_speaking: s.model_speaking ?? [],
        steps: s.steps ?? [],
      },
      events,
      counts,
      end_state: endState,
    };
  });

  return {
    what: "Voice gate parity vectors. The web gate (apps/web/src/gate, open-mic mode, NoSpeakerCheck, energy VAD, heuristic completeness, energy-burst word estimator) run over synthetic input. A port of the gate replays each scenario's input and must emit exactly these events.",
    regenerate: "npm run gate-vectors -w apps/web (apps/web/scripts/gate-vectors.ts). apps/web/test/gate-vectors.test.ts fails when this file drifts from the web gate.",
    audio: {
      sample_rate: SAMPLE_RATE,
      frame_ms: FRAME_MS,
      frame_samples: FRAME_SAMPLES,
      format: "Int16 mono PCM",
      frame_formula: "Each segment is ms / 20 identical frames. A frame is 320 Int16 samples; sample k (0..319) is +q when k % 80 < 40, else -q. q = round(amplitude * 32767) is given per segment as an integer; use it, do not recompute it. The frame's RMS on the [-1, 1] scale is q / 32768.",
    },
    gate: {
      mode: "open_mic",
      max_pending_ms: MAX_PENDING_MS,
      max_turn_ms: MAX_TURN_MS,
      config: "Per scenario: the [gate] table of config/apparatus.toml (what /config and ready.gate send), with the scenario's overrides.",
    },
    replay: [
      "Frames are numbered from 0 in input order. Before pushing frame i, apply every step with before_frame == i in listed order: 'transcript' calls setTranscript(text), 'stop' calls stopAll(). After the last frame, apply steps with before_frame == input.frames.",
      "isModelSpeaking() while frame i is processed returns true when from_ms <= i * 20 < to_ms for some model_speaking interval. It is a pure function of the frame index; the vectors do not model playback stopping on bargeIn.",
      "Record every event in emission order. 'at' is the number of frames pushed when the event fired (for a step, the frames pushed before it). 't_ms' is the gate clock then (at * 20).",
      "Audio events carry the input frame index instead of samples. Consecutive audio events whose frame indices are consecutive merge into one entry: first_frame is the first index, frames the count, and at / t_ms are those of the first event of the run.",
      "voice_ms is the gate's voice time in ms (raw VAD frames * 20). words is max(energy-burst estimate, transcript word count).",
    ],
    scenarios,
  };
}

// JSON with every flat object or array of scalars on one line, so a scenario
// reads top to bottom and a diff shows the event that moved.
function isFlat(v: unknown): boolean {
  if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object");
  if (v && typeof v === "object") return Object.values(v).every((x) => x === null || typeof x !== "object");
  return true;
}

function oneLine(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(oneLine).join(", ")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${oneLine(x)}`).join(", ")}}`;
  }
  return JSON.stringify(v);
}

function format(v: unknown, indent: string): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const line = oneLine(v);
  if (isFlat(v) && (!Array.isArray(v) || line.length <= 100)) return line;
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => inner + format(x, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${format(x, inner)}`).join(",\n")}\n${indent}}`;
}

export function renderVectors(): string {
  return format(buildVectors(), "") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(VECTORS_PATH, renderVectors());
  console.log(`wrote ${VECTORS_PATH}`);
}
