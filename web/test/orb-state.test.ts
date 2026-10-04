import { test } from "node:test";
import assert from "node:assert/strict";
import { ANIMATION, NORMAL_SPEED, SLOW_SPEED, orbRender, type OrbState } from "../src/orb-state.ts";

const live = { held: true, live: true } as const;

test("every voice state maps to its thinking-orbs animation", () => {
  const expected: Record<OrbState, string> = {
    idle: "breathing",
    connecting: "connecting",
    listening: "listening",
    speaking: "composing",
    working: "working",
  };
  for (const state of Object.keys(expected) as OrbState[]) {
    assert.equal(ANIMATION[state], expected[state]);
    const r = orbRender({ state, ...live });
    assert.equal(r.animation, expected[state]);
    assert.equal(r.speed, NORMAL_SPEED);
    assert.equal(r.paused, false);
    assert.equal(r.dimmed, false);
  }
});

test("another device holds the voice session: paused and dimmed", () => {
  const r = orbRender({ state: "listening", held: false, live: false });
  assert.equal(r.animation, "listening");
  assert.equal(r.paused, true);
  assert.equal(r.dimmed, true);
});

test("idle-closed breathes slowly", () => {
  for (const state of ["idle", "listening", "speaking"] as OrbState[]) {
    const r = orbRender({ state, held: true, live: false });
    assert.equal(r.animation, "breathing");
    assert.equal(r.speed, SLOW_SPEED);
    assert.equal(r.paused, false);
    assert.equal(r.dimmed, false);
  }
});

test("connecting and working show through a closed Live session", () => {
  assert.equal(orbRender({ state: "connecting", held: true, live: false }).animation, "connecting");
  const working = orbRender({ state: "working", held: true, live: false });
  assert.equal(working.animation, "working");
  assert.equal(working.speed, NORMAL_SPEED);
});

test("reduced motion pauses the orb without dimming it", () => {
  const r = orbRender({ state: "speaking", ...live, reducedMotion: true });
  assert.equal(r.animation, "composing");
  assert.equal(r.paused, true);
  assert.equal(r.dimmed, false);
});
