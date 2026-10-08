import { test } from "node:test";
import assert from "node:assert/strict";
import { BargeInRule } from "../src/gate/bargein.ts";
import { DEFAULT_GATE } from "../src/config.ts";

const rule = new BargeInRule({
  minVoiceMs: DEFAULT_GATE.bargein_min_voice_ms,
  minWords: DEFAULT_GATE.bargein_min_words,
});

test("both limits met, inclusive", () => {
  assert.equal(rule.allows(300, 2), true);
  assert.equal(rule.allows(1000, 5), true);
});

test("voice time one frame short", () => {
  assert.equal(rule.allows(280, 2), false);
  assert.equal(rule.allows(299, 2), false);
});

test("one word short", () => {
  assert.equal(rule.allows(300, 1), false);
  assert.equal(rule.allows(2000, 0), false);
});

test("neither met", () => {
  assert.equal(rule.allows(0, 0), false);
  assert.equal(rule.allows(100, 1), false);
});

test("zero limits allow anything", () => {
  const open = new BargeInRule({ minVoiceMs: 0, minWords: 0 });
  assert.equal(open.allows(0, 0), true);
});
