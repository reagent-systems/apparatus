import { test } from "node:test";
import assert from "node:assert/strict";
import { onStep, releasesVoice, toggleAction } from "../src/composer/orb-toggle.ts";

test("a switch that reads off turns on, with or without the voice session", () => {
  assert.equal(toggleAction({ holdsVoice: true, on: false }), "on");
  assert.equal(toggleAction({ holdsVoice: false, on: false }), "on");
});

test("a switch that reads on turns off, also while its claim is in flight", () => {
  assert.equal(toggleAction({ holdsVoice: true, on: true }), "off");
  assert.equal(toggleAction({ holdsVoice: false, on: true }), "off");
});

test("two taps return the switch to where it was", () => {
  for (const holdsVoice of [false, true]) {
    for (const on of [false, true]) {
      const first = toggleAction({ holdsVoice, on });
      const second = toggleAction({ holdsVoice, on: first === "on" });
      assert.equal(second === "on", on);
    }
  }
});

test("on claims the voice session first when this device does not hold it", () => {
  assert.equal(onStep({ holdsVoice: false }), "claim");
  assert.equal(onStep({ holdsVoice: true }), "open");
});

test("hang-up gives back a held voice session or a claim in flight, nothing else", () => {
  assert.equal(releasesVoice({ holdsVoice: true, claimPending: false }), true);
  assert.equal(releasesVoice({ holdsVoice: false, claimPending: true }), true);
  assert.equal(releasesVoice({ holdsVoice: false, claimPending: false }), false);
});
