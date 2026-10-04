import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnDetector, HeuristicCompleteness } from "../src/gate/turn.ts";
import { DEFAULT_GATE } from "../src/config.ts";

const cfg = {
  silenceCompleteMs: DEFAULT_GATE.silence_complete_ms,
  silenceIncompleteMs: DEFAULT_GATE.silence_incomplete_ms,
};

function silenceFor(td: TurnDetector, ms: number): string | null {
  for (let t = 0; t < ms; t += 20) {
    const r = td.update(false, 20);
    if (r) return r;
  }
  return null;
}

test("an unfinished sentence survives 1 s of silence", () => {
  const td = new TurnDetector(cfg);
  td.start();
  td.update(true, 20);
  td.setTranscript("I want to book a flight to");
  assert.equal(silenceFor(td, 1000), null);
});

test("a finished sentence ends after 0.6 s of silence", () => {
  const td = new TurnDetector(cfg);
  td.start();
  td.update(true, 20);
  td.setTranscript("Book a flight to Paris.");
  assert.equal(silenceFor(td, 600), "complete");
  assert.ok(td.silenceMs <= 500);
});

test("an unfinished sentence ends at the long limit", () => {
  const td = new TurnDetector(cfg);
  td.start();
  td.setTranscript("I want to book a flight to");
  assert.equal(silenceFor(td, 2500), "incomplete");
});

test("voice resets the silence counter", () => {
  const td = new TurnDetector(cfg);
  td.start();
  td.setTranscript("Done.");
  assert.equal(silenceFor(td, 400), null);
  td.update(true, 20);
  assert.equal(td.silenceMs, 0);
  assert.equal(silenceFor(td, 400), null);
  assert.equal(silenceFor(td, 200), "complete");
});

test("heuristic completeness", () => {
  const m = new HeuristicCompleteness();
  assert.equal(m.isComplete("Book a flight to Paris."), true);
  assert.equal(m.isComplete("Is it raining?"), true);
  assert.equal(m.isComplete("Stop!"), true);
  assert.equal(m.isComplete("I want to book a flight to"), false);
  assert.equal(m.isComplete("Send it to John and"), false);
  assert.equal(m.isComplete("Open the"), false);
  assert.equal(m.isComplete("So um"), false);
  assert.equal(m.isComplete("Call my mother,"), false);
  assert.equal(m.isComplete("I think..."), false);
  assert.equal(m.isComplete("Book a flight to Paris"), true);
  assert.equal(m.isComplete(""), true);
});

test("a custom model selects the limit", () => {
  const never = { isComplete: () => false };
  const td = new TurnDetector(cfg, never);
  td.start();
  td.setTranscript("Done.");
  assert.equal(silenceFor(td, 2000), null);
  assert.equal(silenceFor(td, 500), "incomplete");
});
