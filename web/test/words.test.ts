import { test } from "node:test";
import assert from "node:assert/strict";
import { EnergyBurstWordEstimator, TranscriptWordCounter, countWords } from "../src/gate/words.ts";

function feed(est: EnergyBurstWordEstimator, pattern: Array<[boolean, number]>): void {
  for (const [voiced, ms] of pattern) {
    for (let t = 0; t < ms; t += 20) est.push(voiced, 20);
  }
}

test("one continuous burst is one word", () => {
  const est = new EnergyBurstWordEstimator();
  feed(est, [[true, 400]]);
  assert.equal(est.count(), 1);
});

test("two bursts split by a dip are two words", () => {
  const est = new EnergyBurstWordEstimator();
  feed(est, [[true, 150], [false, 60], [true, 190]]);
  assert.equal(est.count(), 2);
});

test("a dip shorter than minDipMs stays inside the word", () => {
  const est = new EnergyBurstWordEstimator({ minDipMs: 80 });
  feed(est, [[true, 150], [false, 40], [true, 150]]);
  assert.equal(est.count(), 1);
});

test("a burst shorter than minBurstMs is not a word", () => {
  const est = new EnergyBurstWordEstimator({ minBurstMs: 60 });
  feed(est, [[true, 20], [false, 100], [true, 100]]);
  assert.equal(est.count(), 1);
});

test("reset clears the count", () => {
  const est = new EnergyBurstWordEstimator();
  feed(est, [[true, 200]]);
  est.reset();
  assert.equal(est.count(), 0);
});

test("transcript word counter", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  stop   that "), 2);
  assert.equal(countWords("wait, no."), 2);
  assert.equal(countWords("- -- ..."), 0);
  const c = new TranscriptWordCounter();
  c.setText("book a flight to Paris");
  assert.equal(c.count(), 5);
  c.reset();
  assert.equal(c.count(), 0);
});
