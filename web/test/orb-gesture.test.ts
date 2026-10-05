import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLD_MS, endPress, isHold, startPress, tapAction } from "../src/composer/orb-gesture.ts";

test("HOLD_MS is 350", () => {
  assert.equal(HOLD_MS, 350);
});

test("a tap without the voice session claims it, whatever else is true", () => {
  for (const liveOpen of [false, true]) {
    for (const speaking of [false, true]) {
      assert.equal(tapAction({ holdsVoice: false, liveOpen, speaking }), "claim");
    }
  }
});

test("a tap while the agent speaks interrupts", () => {
  assert.equal(tapAction({ holdsVoice: true, liveOpen: true, speaking: true }), "interrupt");
  // Playback can outlive the session by a few frames: still an interrupt, not an open.
  assert.equal(tapAction({ holdsVoice: true, liveOpen: false, speaking: true }), "interrupt");
});

test("a tap on an open, quiet session closes it", () => {
  assert.equal(tapAction({ holdsVoice: true, liveOpen: true, speaking: false }), "close");
});

test("a tap on a closed session opens it", () => {
  assert.equal(tapAction({ holdsVoice: true, liveOpen: false, speaking: false }), "open");
});

test("the threshold: HOLD_MS - 1 is a tap, HOLD_MS is a hold", () => {
  const p = startPress(1000);
  assert.equal(isHold(p, 1000), false);
  assert.equal(isHold(p, 1000 + HOLD_MS - 1), false);
  assert.equal(isHold(p, 1000 + HOLD_MS), true);
  assert.equal(endPress(p, 1000), "tap");
  assert.equal(endPress(p, 1000 + HOLD_MS - 1), "tap");
  assert.equal(endPress(p, 1000 + HOLD_MS), "hold-end");
  assert.equal(endPress(p, 1000 + HOLD_MS + 5000), "hold-end");
});

test("a hold never yields a tap", () => {
  const p = startPress(0);
  for (let t = 0; t <= 2000; t += 10) {
    if (isHold(p, t)) assert.equal(endPress(p, t), "hold-end", `at ${t} ms`);
    else assert.equal(endPress(p, t), "tap", `at ${t} ms`);
  }
  // Once a hold, always a hold: time only moves forward.
  let seenHold = false;
  for (let t = 0; t <= 2000; t += 7) {
    if (isHold(p, t)) seenHold = true;
    else assert.equal(seenHold, false, `tap after a hold at ${t} ms`);
  }
});
