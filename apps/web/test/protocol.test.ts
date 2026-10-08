import { test } from "node:test";
import assert from "node:assert/strict";
import { C2S, S2C, parseS2C, hasVoice, encodeC2S, JOB_TERMINAL } from "../src/protocol.ts";

test("C2S type names match PROTOCOL.md", () => {
  assert.deepEqual(Object.values(C2S).sort(), [
    "approval.answer",
    "control.release",
    "control.take",
    "handoff.cancel",
    "handoff.done",
    "hello",
    "live.closed",
    "live.resumption",
    "live.usage",
    "ping",
    "push.register",
    "screen.close",
    "screen.open",
    "signal",
    "tool.call",
    "transcript",
    "voice.claim",
    "voice.release",
  ]);
});

test("S2C type names match PROTOCOL.md", () => {
  assert.deepEqual(Object.values(S2C).sort(), [
    "approval.ended",
    "approval.requested",
    "control",
    "credits",
    "error",
    "handoff.ended",
    "handoff.requested",
    "job.done",
    "job.progress",
    "job.started",
    "pong",
    "ready",
    "screen.closed",
    "screen.opened",
    "show",
    "signal",
    "tool.result",
    "transcript",
    "voice.granted",
    "voice.revoked",
  ]);
});

test("parseS2C accepts known types and rejects the rest", () => {
  const ready = parseS2C(
    JSON.stringify({ type: "ready", user_id: "u", device_id: "d", voice_holder: null, balance: 10, gate: {} }),
  );
  assert.ok(ready && ready.type === "ready" && ready.device_id === "d");
  assert.equal(parseS2C('{"type":"nope"}'), null);
  assert.equal(parseS2C("not json"), null);
  assert.equal(parseS2C(42), null);
  assert.equal(parseS2C({ no: "type" }), null);
});

test("hasVoice", () => {
  const done = parseS2C({ type: "job.done", job_id: "j", status: "done", say: "ok", voice: "job done" });
  assert.ok(done && hasVoice(done) && done.voice === "job done");
  const quiet = parseS2C({ type: "job.done", job_id: "j", status: "done", say: "ok" });
  assert.ok(quiet && !hasVoice(quiet));
});

test("encodeC2S produces a JSON object with type first", () => {
  assert.equal(encodeC2S({ type: "hello", device: "web", wants_voice: true }), '{"type":"hello","device":"web","wants_voice":true}');
  assert.equal(encodeC2S({ type: "ping" }), '{"type":"ping"}');
  assert.equal(encodeC2S({ type: "push.register", platform: "fcm", token: "t" }), '{"type":"push.register","platform":"fcm","token":"t"}');
});

test("terminal job statuses", () => {
  assert.ok(JOB_TERMINAL.has("done") && JOB_TERMINAL.has("failed") && JOB_TERMINAL.has("needs_user"));
  assert.ok(!JOB_TERMINAL.has("running"));
});
