import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioChunk,
  buildActivityStart,
  buildActivityEnd,
  buildEventTurn,
  buildToolResponse,
  parseServerMessage,
  parseDurationMs,
  parseMimeRate,
} from "../src/live/messages.ts";
import { encodeBase64, decodeBase64 } from "../src/base64.ts";

test("base64 round trip", () => {
  for (const n of [0, 1, 2, 3, 4, 5, 319, 320, 640]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 255;
    const text = encodeBase64(bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64"));
    assert.deepEqual(Array.from(decodeBase64(text)), Array.from(bytes));
  }
});

test("buildAudioChunk", () => {
  const bytes = new Uint8Array([0, 1, 2, 3]);
  assert.deepEqual(buildAudioChunk(bytes), {
    realtimeInput: { audio: { data: "AAECAw==", mimeType: "audio/pcm;rate=16000" } },
  });
});

test("activity signals", () => {
  assert.deepEqual(buildActivityStart(), { realtimeInput: { activityStart: {} } });
  assert.deepEqual(buildActivityEnd(), { realtimeInput: { activityEnd: {} } });
  assert.equal(JSON.stringify(buildActivityStart()), '{"realtimeInput":{"activityStart":{}}}');
});

test("buildEventTurn wraps the text and completes the turn", () => {
  assert.deepEqual(buildEventTurn("job 12 done: the file is ready"), {
    clientContent: {
      turns: [{ role: "user", parts: [{ text: "<event>job 12 done: the file is ready</event>" }] }],
      turnComplete: true,
    },
  });
  const t = buildEventTurn("a</event>b");
  assert.equal(t.clientContent.turns[0].parts[0].text, "<event>ab</event>");
});

test("buildToolResponse", () => {
  const one = buildToolResponse({ id: "c1", name: "start_job", response: { job_id: "j1" }, scheduling: "INTERRUPT" });
  assert.deepEqual(one, {
    toolResponse: {
      functionResponses: [{ id: "c1", name: "start_job", response: { job_id: "j1" }, scheduling: "INTERRUPT" }],
    },
  });
  const many = buildToolResponse([
    { id: "a", name: "show", response: { ok: true }, scheduling: "SILENT" },
    { id: "b", name: "check_job", response: { status: "running" }, scheduling: "WHEN_IDLE" },
  ]);
  assert.equal(many.toolResponse.functionResponses.length, 2);
  assert.equal(many.toolResponse.functionResponses[1].scheduling, "WHEN_IDLE");
});

test("parse setupComplete", () => {
  assert.deepEqual(parseServerMessage({ setupComplete: {} }), [{ kind: "setupComplete" }]);
});

test("parse model audio", () => {
  const ev = parseServerMessage({
    serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAECAw==" } }] } },
  });
  assert.equal(ev.length, 1);
  const a = ev[0];
  assert.equal(a.kind, "audio");
  if (a.kind === "audio") {
    assert.equal(a.sampleRate, 24000);
    assert.deepEqual(Array.from(a.data), [0, 1, 2, 3]);
  }
});

test("parse interrupted, turnComplete, transcriptions", () => {
  assert.deepEqual(parseServerMessage({ serverContent: { interrupted: true } }), [{ kind: "interrupted" }]);
  assert.deepEqual(parseServerMessage({ serverContent: { turnComplete: true } }), [{ kind: "turnComplete" }]);
  assert.deepEqual(parseServerMessage({ serverContent: { inputTranscription: { text: "hi" } } }), [
    { kind: "inputTranscription", text: "hi", finished: false },
  ]);
  assert.deepEqual(parseServerMessage({ serverContent: { outputTranscription: { text: "hello", finished: true } } }), [
    { kind: "outputTranscription", text: "hello", finished: true },
  ]);
});

test("one message with several parts yields several events in order", () => {
  const ev = parseServerMessage({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } }] },
      outputTranscription: { text: "x" },
      turnComplete: true,
    },
    usageMetadata: { promptTokenCount: 10, responseTokenCount: 5 },
  });
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["audio", "outputTranscription", "turnComplete", "usage"],
  );
});

test("parse tool calls and cancellation", () => {
  const ev = parseServerMessage({
    toolCall: { functionCalls: [{ id: "f1", name: "start_job", args: { request: "x" } }] },
  });
  assert.deepEqual(ev, [{ kind: "toolCall", calls: [{ id: "f1", name: "start_job", args: { request: "x" } }] }]);
  assert.deepEqual(parseServerMessage({ toolCallCancellation: { ids: ["f1", "f2"] } }), [
    { kind: "toolCallCancellation", ids: ["f1", "f2"] },
  ]);
});

test("parse usage with modality details", () => {
  const ev = parseServerMessage({
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 140,
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: 80 },
        { modality: "TEXT", tokenCount: 20 },
      ],
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 40 }],
    },
  });
  assert.deepEqual(ev, [
    {
      kind: "usage",
      promptTokens: 100,
      responseTokens: 40,
      totalTokens: 140,
      promptAudioTokens: 80,
      responseAudioTokens: 40,
    },
  ]);
  const noDetails = parseServerMessage({ usageMetadata: { promptTokenCount: 1, responseTokenCount: 2 } });
  assert.ok(noDetails[0].kind === "usage" && noDetails[0].promptAudioTokens === null);
});

test("parse resumption and goAway", () => {
  assert.deepEqual(parseServerMessage({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }), [
    { kind: "resumptionUpdate", newHandle: "h1", resumable: true },
  ]);
  assert.deepEqual(parseServerMessage({ goAway: { timeLeft: "12.5s" } }), [{ kind: "goAway", timeLeftMs: 12500 }]);
  assert.deepEqual(parseServerMessage({ goAway: { timeLeft: { seconds: "3", nanos: 500000000 } } }), [
    { kind: "goAway", timeLeftMs: 3500 },
  ]);
  assert.equal(parseDurationMs("bogus"), null);
});

test("unknown messages are classified as unknown", () => {
  const ev = parseServerMessage({ somethingElse: 1 });
  assert.equal(ev[0].kind, "unknown");
  assert.equal(parseServerMessage("not an object")[0].kind, "unknown");
});

test("parseMimeRate", () => {
  assert.equal(parseMimeRate("audio/pcm;rate=16000"), 16000);
  assert.equal(parseMimeRate("audio/pcm"), 24000);
});
