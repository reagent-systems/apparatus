import { test } from "node:test";
import assert from "node:assert/strict";
import { Negotiation } from "../src/vm/negotiation.ts";
import { parseSignal } from "../src/vm/input.ts";

const offer = parseSignal({ description: { type: "offer", sdp: "v=0 offer" } });
const answer = parseSignal({ description: { type: "answer", sdp: "v=0 answer" } });
const cand = (n: number) => parseSignal({ candidate: { candidate: `candidate:${n}`, sdpMid: "0", sdpMLineIndex: 0 } });

test("candidates before the remote description are queued and handed back once, in order", () => {
  const n = new Negotiation();
  assert.deepEqual(n.decide(cand(1), "stable"), { action: "queue", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } });
  assert.equal(n.decide(cand(2), "stable").action, "queue");
  assert.equal(n.queuedCount, 2);
  assert.deepEqual(n.decide(offer, "stable"), { action: "describe", type: "offer", sdp: "v=0 offer", rollback: false, answer: true });
  const held = n.described();
  assert.deepEqual(
    held.map((c) => c.candidate),
    ["candidate:1", "candidate:2"],
  );
  assert.deepEqual(n.described(), []);
  assert.equal(n.remoteDescribed, true);
  assert.deepEqual(n.decide(cand(3), "stable"), { action: "candidate", candidate: { candidate: "candidate:3", sdpMid: "0", sdpMLineIndex: 0 } });
});

test("an offer while our own offer is out rolls it back; a duplicate offer is ignored", () => {
  const n = new Negotiation();
  assert.deepEqual(n.decide(offer, "have-local-offer"), { action: "describe", type: "offer", sdp: "v=0 offer", rollback: true, answer: true });
  assert.deepEqual(n.decide(offer, "have-remote-offer"), { action: "ignore", reason: "duplicate-offer" });
});

test("an answer applies only to our own pending offer", () => {
  const n = new Negotiation();
  assert.deepEqual(n.decide(answer, "stable"), { action: "ignore", reason: "stale-answer" });
  assert.deepEqual(n.decide(answer, "have-local-offer"), { action: "describe", type: "answer", sdp: "v=0 answer", rollback: false, answer: false });
});

test("unknown payloads and a closed connection are ignored; reset forgets the queue", () => {
  const n = new Negotiation();
  assert.deepEqual(n.decide(null, "stable"), { action: "ignore", reason: "unknown" });
  assert.deepEqual(n.decide(parseSignal({ description: { type: "pranswer", sdp: "x" } }), "stable"), { action: "ignore", reason: "unknown" });
  assert.deepEqual(n.decide(offer, "closed"), { action: "ignore", reason: "closed" });
  n.decide(cand(1), "stable");
  n.described();
  n.reset();
  assert.equal(n.remoteDescribed, false);
  assert.equal(n.queuedCount, 0);
  assert.equal(n.decide(cand(2), "stable").action, "queue");
});
