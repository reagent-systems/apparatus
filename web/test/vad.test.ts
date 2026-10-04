import { test } from "node:test";
import assert from "node:assert/strict";
import { EnergyVad, frameRms } from "../src/gate/vad.ts";
import { DEFAULT_GATE } from "../src/config.ts";
import { silence, loud, frame } from "./helpers.ts";

const make = () =>
  new EnergyVad({ threshold: DEFAULT_GATE.vad_energy_threshold, hangoverMs: DEFAULT_GATE.vad_hangover_ms });

test("silence frames are not voiced", () => {
  const vad = make();
  for (let i = 0; i < 10; i++) {
    const r = vad.process(silence());
    assert.equal(r.raw, false);
    assert.equal(r.active, false);
  }
});

test("loud frames are voiced", () => {
  const vad = make();
  const r = vad.process(loud());
  assert.equal(r.raw, true);
  assert.equal(r.active, true);
});

test("hangover keeps active for the configured ms, then drops", () => {
  const vad = make();
  vad.process(loud());
  const hangoverFrames = DEFAULT_GATE.vad_hangover_ms / 20;
  for (let i = 0; i < hangoverFrames; i++) {
    const r = vad.process(silence());
    assert.equal(r.raw, false, `frame ${i} raw`);
    assert.equal(r.active, true, `frame ${i} active`);
  }
  const after = vad.process(silence());
  assert.equal(after.active, false);
});

test("threshold boundary and float frames", () => {
  const vad = new EnergyVad({ threshold: 0.1, hangoverMs: 0 });
  assert.equal(vad.process(frame(0.05)).raw, false);
  assert.equal(vad.process(frame(0.15)).raw, true);
  const f32 = new Float32Array(320).fill(0.2);
  assert.ok(Math.abs(frameRms(f32) - 0.2) < 1e-6);
  assert.equal(vad.process(f32).raw, true);
});

test("reset clears the hangover", () => {
  const vad = make();
  vad.process(loud());
  vad.reset();
  assert.equal(vad.process(silence()).active, false);
});
