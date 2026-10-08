import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatePayload,
  descriptionPayload,
  encodeInput,
  normalizePointer,
  offerCollision,
  parseSignal,
  pictureBox,
} from "../src/vm/input.ts";

test("pictureBox letterboxes a 16:10 frame inside a wide element", () => {
  const box = pictureBox({ left: 0, top: 0, width: 2000, height: 800 }, 1280, 800);
  assert.deepEqual(box, { left: 360, top: 0, width: 1280, height: 800 });
  assert.equal(pictureBox({ left: 0, top: 0, width: 0, height: 10 }, 1280, 800), null);
});

test("normalizePointer maps the picture to 0..1 and rejects the bars", () => {
  const rect = { left: 100, top: 50, width: 2000, height: 800 };
  assert.deepEqual(normalizePointer(rect, 1280, 800, 100 + 360, 50), { x: 0, y: 0 });
  assert.deepEqual(normalizePointer(rect, 1280, 800, 100 + 360 + 640, 50 + 400), { x: 0.5, y: 0.5 });
  assert.equal(normalizePointer(rect, 1280, 800, 100 + 10, 50 + 10), null);
  // no frame size yet: the element box is the frame
  assert.deepEqual(normalizePointer({ left: 0, top: 0, width: 200, height: 100 }, 0, 0, 100, 50), { x: 0.5, y: 0.5 });
});

test("encodeInput writes the data-channel shape", () => {
  assert.equal(encodeInput({ kind: "mouse.down", x: 0.25, y: 0.5, button: 2 }), '{"kind":"mouse.down","x":0.25,"y":0.5,"button":2}');
  assert.equal(encodeInput({ kind: "touch", x: 0, y: 1, key: "start" }), '{"kind":"touch","x":0,"y":1,"key":"start"}');
  assert.equal(encodeInput({ kind: "key.down", key: "a", code: "KeyA" }), '{"kind":"key.down","key":"a","code":"KeyA"}');
});

test("offerCollision follows the polite-peer rule", () => {
  assert.equal(offerCollision("offer", false, "stable"), false);
  assert.equal(offerCollision("offer", true, "stable"), true);
  assert.equal(offerCollision("offer", false, "have-local-offer"), true);
  assert.equal(offerCollision("answer", true, "have-local-offer"), false);
});

test("parseSignal reads descriptions and candidates and rejects the rest", () => {
  assert.deepEqual(parseSignal({ description: { type: "offer", sdp: "v=0" } }), { kind: "description", type: "offer", sdp: "v=0" });
  assert.deepEqual(parseSignal({ candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } }), {
    kind: "candidate",
    candidate: "candidate:1",
    sdpMid: "0",
    sdpMLineIndex: 0,
  });
  assert.deepEqual(parseSignal({ candidate: { candidate: "c" } }), { kind: "candidate", candidate: "c", sdpMid: null, sdpMLineIndex: null });
  assert.equal(parseSignal({ description: { type: "offer" } }), null);
  assert.equal(parseSignal({ candidate: {} }), null);
  assert.equal(parseSignal(null), null);
  assert.equal(parseSignal("x"), null);
});

test("payload builders match PROTOCOL.md", () => {
  assert.deepEqual(descriptionPayload({ type: "answer", sdp: "v=0" }), { description: { type: "answer", sdp: "v=0" } });
  assert.deepEqual(candidatePayload({ candidate: "c", sdpMid: "0", sdpMLineIndex: 1 }), {
    candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: 1 },
  });
  assert.deepEqual(candidatePayload({ candidate: "c" }), { candidate: { candidate: "c", sdpMid: null, sdpMLineIndex: null } });
});
