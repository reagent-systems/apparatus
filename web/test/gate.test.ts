import { test } from "node:test";
import assert from "node:assert/strict";
import { Gate, InputMode, type GateEvent } from "../src/gate/gate.ts";
import { DEFAULT_GATE } from "../src/config.ts";
import { silence, loud, frame } from "./helpers.ts";
import type { SpeakerCheck } from "../src/gate/speaker.ts";

function setup(opts: { modelSpeaking?: () => boolean; mode?: "push_to_talk" | "open_mic"; speakerCheck?: SpeakerCheck } = {}) {
  const events: GateEvent[] = [];
  const gate = new Gate({
    config: DEFAULT_GATE,
    isModelSpeaking: opts.modelSpeaking,
    mode: opts.mode,
    speakerCheck: opts.speakerCheck,
  });
  gate.subscribe((e) => events.push(e));
  let pushed = 0;
  const push = (ms: number, make: () => Int16Array) => {
    for (let t = 0; t < ms; t += 20) {
      gate.pushFrame(make());
      pushed += 1;
    }
  };
  const pushedFrames = () => pushed;
  const kinds = () => events.map((e) => e.kind).filter((k) => k !== "audio");
  return { gate, events, push, kinds, pushedFrames };
}

test("a 150 ms burst is dropped as too_short", () => {
  const { push, events, kinds } = setup();
  push(150, loud);
  push(600, silence);
  assert.deepEqual(kinds(), ["drop"]);
  const drop = events[0];
  assert.equal(drop.kind, "drop");
  if (drop.kind === "drop") {
    assert.equal(drop.reason, "too_short");
    assert.ok(drop.voiceMs < DEFAULT_GATE.min_speech_ms);
  }
  assert.equal(events.filter((e) => e.kind === "audio").length, 0);
});

test("a 400 ms burst starts speech and flushes the buffered frames", () => {
  const { gate, push, events, kinds } = setup();
  push(400, loud);
  assert.deepEqual(kinds(), ["speechStart"]);
  assert.equal(gate.state, "speaking");
  // every frame since the first voiced one reaches the session
  assert.equal(events.filter((e) => e.kind === "audio").length, 20);
  const start = events.find((e) => e.kind === "speechStart");
  assert.ok(start && start.kind === "speechStart" && start.forced === false);
});

test("a complete sentence ends after the short silence limit", () => {
  const { gate, push, kinds, events } = setup();
  push(400, loud);
  gate.setTranscript("Book a flight to Paris.");
  push(500, silence);
  assert.deepEqual(kinds(), ["speechStart", "speechEnd"]);
  const end = events[events.length - 1];
  assert.ok(end.kind === "speechEnd" && end.reason === "complete");
  assert.equal(gate.state, "idle");
});

test("an unfinished sentence keeps the turn open through 1 s of silence", () => {
  const { gate, push, kinds } = setup();
  push(400, loud);
  gate.setTranscript("I want to book a flight to");
  push(1000, silence);
  assert.deepEqual(kinds(), ["speechStart"]);
  assert.equal(gate.state, "speaking");
  push(1500, silence);
  assert.deepEqual(kinds(), ["speechStart", "speechEnd"]);
});

test("while the model speaks, a 200 ms burst does not barge in", () => {
  const { push, kinds } = setup({ modelSpeaking: () => true });
  push(200, loud);
  push(600, silence);
  assert.deepEqual(kinds(), ["drop"]);
});

test("while the model speaks, a 400 ms single burst is rejected (1 word)", () => {
  const { push, kinds, events } = setup({ modelSpeaking: () => true });
  push(400, loud);
  push(600, silence);
  assert.deepEqual(kinds(), ["drop"]);
  const d = events[0];
  assert.ok(d.kind === "drop" && d.reason === "bargein_rejected");
});

test("while the model speaks, a 400 ms burst with 2 estimated words barges in", () => {
  const { gate, push, kinds, events, pushedFrames } = setup({ modelSpeaking: () => true });
  push(160, loud);
  push(60, silence); // dip inside the hangover: splits the burst, keeps the segment
  push(200, loud);
  assert.deepEqual(kinds(), ["bargeIn", "speechStart"]);
  const b = events.find((e) => e.kind === "bargeIn");
  assert.ok(b && b.kind === "bargeIn" && b.words >= 2 && b.voiceMs >= DEFAULT_GATE.bargein_min_voice_ms);
  assert.equal(gate.state, "speaking");
  // every frame of the candidate reaches the session, after speechStart
  const idxStart = events.findIndex((e) => e.kind === "speechStart");
  assert.equal(events.slice(idxStart + 1).filter((e) => e.kind === "audio").length, pushedFrames());
  assert.equal(events.slice(0, idxStart).filter((e) => e.kind === "audio").length, 0);
});

test("while the model speaks, a 400 ms burst with a 2-word transcript barges in", () => {
  const { gate, push, kinds } = setup({ modelSpeaking: () => true });
  gate.setTranscript("");
  push(280, loud);
  gate.setTranscript("stop that");
  push(120, loud);
  assert.deepEqual(kinds(), ["bargeIn", "speechStart"]);
});

test("push to talk forces the turn open past every filter and ends on release", () => {
  const { gate, push, kinds, events } = setup({ modelSpeaking: () => true, mode: InputMode.PUSH_TO_TALK });
  push(400, loud);
  assert.deepEqual(kinds(), []); // no automatic start in push_to_talk
  gate.pressTalk();
  assert.deepEqual(kinds(), ["bargeIn", "speechStart"]);
  push(100, silence);
  assert.equal(events.filter((e) => e.kind === "audio").length, 5);
  push(3000, silence);
  assert.equal(gate.state, "speaking");
  gate.releaseTalk();
  const end = events[events.length - 1];
  assert.ok(end.kind === "speechEnd" && end.reason === "manual_release");
  assert.equal(gate.state, "idle");
});

test("stop ends an open turn", () => {
  const { gate, push, events } = setup();
  push(400, loud);
  gate.stopAll();
  const end = events[events.length - 1];
  assert.ok(end.kind === "speechEnd" && end.reason === "manual_stop");
  assert.equal(gate.state, "idle");
});

test("speaker mismatch drops the segment until silence", () => {
  const reject: SpeakerCheck = { enabled: true, matches: () => false };
  const { gate, push, kinds } = setup({ speakerCheck: reject });
  push(600, loud);
  assert.deepEqual(kinds(), ["drop"]);
  assert.equal(gate.state, "rejected");
  push(400, silence);
  assert.equal(gate.state, "idle");
});

test("float frames are accepted", () => {
  const { gate } = setup();
  const f = new Float32Array(320).fill(0.2);
  for (let i = 0; i < 20; i++) gate.pushFrame(f);
  assert.equal(gate.state, "speaking");
});

test("the decision log records reasons and never audio", () => {
  const { gate, push } = setup();
  push(150, loud);
  push(600, silence);
  push(400, loud);
  gate.setTranscript("Hi.");
  push(600, silence);
  const log = gate.log();
  const decisions = log.map((e) => e.decision);
  assert.deepEqual(decisions, ["drop", "speech_start", "speech_end"]);
  assert.ok(log[0].reason.startsWith("too_short"));
  for (const e of log) {
    assert.deepEqual(Object.keys(e).sort(), ["decision", "reason", "t"]);
    assert.equal(typeof e.t, "number");
  }
});

test("the log is a ring buffer", () => {
  const gate = new Gate({ config: DEFAULT_GATE, logCapacity: 3 });
  for (let i = 0; i < 5; i++) {
    for (let t = 0; t < 150; t += 20) gate.pushFrame(loud());
    for (let t = 0; t < 600; t += 20) gate.pushFrame(silence());
  }
  const log = gate.log();
  assert.equal(log.length, 3);
  assert.ok(log[0].t < log[1].t && log[1].t < log[2].t);
});

test("medium energy under the threshold is silence", () => {
  const { gate, push } = setup();
  push(1000, () => frame(0.01));
  assert.equal(gate.state, "idle");
});
