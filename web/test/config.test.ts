import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GATE, DEFAULT_LIVE, mergeGate, mergeLive, FRAME_SAMPLES } from "../src/config.ts";

test("defaults equal config/apparatus.toml [gate]", () => {
  assert.deepEqual(DEFAULT_GATE, {
    vad_energy_threshold: 0.015,
    vad_hangover_ms: 240,
    min_speech_ms: 300,
    silence_complete_ms: 500,
    silence_incomplete_ms: 2500,
    bargein_min_voice_ms: 300,
    bargein_min_words: 2,
    bargein_stop_ms: 200,
    speaker_check: false,
    speaker_match_threshold: 0.75,
  });
  assert.equal(DEFAULT_LIVE.idle_close_seconds, 120);
  assert.equal(FRAME_SAMPLES, 320);
});

test("the server table overrides, bad fields fall back", () => {
  const g = mergeGate({ min_speech_ms: 250, speaker_check: true, vad_hangover_ms: "oops", unknown: 1 });
  assert.equal(g.min_speech_ms, 250);
  assert.equal(g.speaker_check, true);
  assert.equal(g.vad_hangover_ms, 240);
  assert.equal("unknown" in g, false);
  assert.deepEqual(mergeGate(undefined), DEFAULT_GATE);
  assert.deepEqual(mergeGate(null), DEFAULT_GATE);
  assert.equal(mergeLive({ idle_close_seconds: 30 }).idle_close_seconds, 30);
  assert.equal(mergeLive({}).idle_close_seconds, 120);
});
