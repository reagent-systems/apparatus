// The on-switch on the VoiceController, with the browser's audio, fetch and
// WebSocket replaced by fakes. No microphone or speaker runs here.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GATE, DEFAULT_LIVE } from "../src/config.ts";
import type { C2SMessage } from "../src/protocol.ts";
import { VoiceController } from "../src/voice.ts";

type Track = { stopped: boolean; stop: () => void };

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { reason: string; code: number }) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: async () => undefined };
  createGain() {
    return { connect: () => undefined };
  }
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  async resume() {}
  async close() {}
}

class FakeWorkletNode {
  port: { onmessage: unknown } = { onmessage: null };
  disconnect(): void {}
}

/** Each getUserMedia call waits here until the test resolves or rejects it. */
let mic: { resolve: () => void; reject: (err: Error) => void; tracks: Track[] }[] = [];
/** Each POST /token waits here. */
let tokens: { resolve: () => void; reject: (err: Error) => void }[] = [];

function install(): void {
  const g = globalThis as Record<string, unknown>;
  g.WebSocket = FakeSocket;
  g.AudioContext = FakeAudioContext;
  g.AudioWorkletNode = FakeWorkletNode;
  g.fetch = () =>
    new Promise((resolve, reject) => {
      tokens.push({
        resolve: () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: "t", model: "m", setup: { setup: {} }, expires_at: "", resumption_handle: null }),
          }),
        reject,
      });
    });
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((resolve, reject) => {
          const track: Track = {
            stopped: false,
            stop() {
              this.stopped = true;
            },
          };
          mic.push({ resolve: () => resolve({ getTracks: () => [track] }), reject, tracks: [track] });
        }),
    },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function make(liveOverrides: Partial<typeof DEFAULT_LIVE> = {}) {
  const sent: C2SMessage[] = [];
  const v = new VoiceController({
    serverOrigin: "http://server",
    auth: "a",
    gateConfig: DEFAULT_GATE,
    liveConfig: { ...DEFAULT_LIVE, ...liveOverrides },
    send: (msg) => {
      sent.push(msg);
      return true;
    },
    onTranscript: () => undefined,
    storage: null,
  });
  const types = (): string[] => sent.map((m) => m.type);
  return { v, sent, types };
}

beforeEach(() => {
  mic = [];
  tokens = [];
  FakeSocket.all = [];
  install();
});

test("on without the voice session claims it, and opens Live and the microphone on the grant", async () => {
  const { v, types } = make();
  v.syncHolder("other", "me");
  assert.equal(v.otherHoldsVoice, true);
  v.toggle();
  assert.equal(v.on, true);
  assert.deepEqual(types(), ["voice.claim"]);
  assert.equal(v.liveOpen, false);
  assert.equal(mic.length, 0);
  v.granted();
  assert.equal(v.holdsVoice, true);
  assert.equal(v.liveOpen, true);
  assert.equal(mic.length, 1);
  v.end();
});

test("on with the voice session opens Live and the microphone at once", () => {
  const { v, types } = make();
  v.syncHolder("me", "me");
  v.toggle();
  assert.equal(v.on, true);
  assert.equal(v.liveOpen, true);
  assert.equal(mic.length, 1);
  assert.deepEqual(types(), []);
  v.end();
});

test("off hangs up: Live closed, microphone released, voice session given back", async () => {
  const { v, types } = make();
  v.syncHolder("me", "me");
  v.toggle();
  tokens[0].resolve();
  await tick();
  assert.equal(FakeSocket.all.length, 1);
  mic[0].resolve();
  await tick();
  assert.equal(v.capture.running, true);
  v.toggle();
  assert.equal(v.on, false);
  assert.equal(v.liveOpen, false);
  assert.equal(v.capture.running, false);
  assert.equal(mic[0].tracks[0].stopped, true);
  assert.deepEqual(types(), ["live.closed", "voice.release"]);
  assert.equal(v.holdsVoice, false);
  assert.equal(v.voiceHolder, null);
  assert.equal(v.otherHoldsVoice, false);
});

test("off while the microphone is still opening releases it when it arrives", async () => {
  const { v } = make();
  v.syncHolder("me", "me");
  v.toggle();
  v.toggle();
  mic[0].resolve();
  await tick();
  assert.equal(mic[0].tracks[0].stopped, true);
  assert.equal(v.capture.running, false);
});

test("off while the claim is in flight releases it and drops the late grant", () => {
  const { v, types } = make();
  v.syncHolder(null, "me");
  v.toggle();
  v.toggle();
  assert.deepEqual(types(), ["voice.claim", "voice.release"]);
  v.granted();
  assert.equal(v.holdsVoice, false);
  assert.equal(v.liveOpen, false);
  assert.equal(mic.length, 0);
});

test("a Live session that closes by itself turns the switch off", async () => {
  const { v, types } = make();
  v.syncHolder("me", "me");
  v.toggle();
  tokens[0].resolve();
  await tick();
  mic[0].resolve();
  await tick();
  FakeSocket.all[0].onclose?.({ reason: "", code: 1011 });
  assert.equal(v.on, false);
  assert.equal(v.liveOpen, false);
  assert.equal(v.capture.running, false);
  assert.equal(mic[0].tracks[0].stopped, true);
  assert.deepEqual(types(), ["live.closed", "voice.release"]);
});

test("a token failure turns the switch off", async () => {
  const { v, types } = make();
  v.syncHolder("me", "me");
  v.toggle();
  tokens[0].reject(new Error("down"));
  const error = console.error;
  console.error = () => undefined;
  try {
    await tick();
  } finally {
    console.error = error;
  }
  assert.equal(v.on, false);
  assert.deepEqual(types(), ["live.closed", "voice.release"]);
});

test("a refused microphone turns the switch off", async () => {
  const { v } = make();
  v.syncHolder("me", "me");
  v.toggle();
  const error = console.error;
  console.error = () => undefined;
  try {
    mic[0].reject(new Error("NotAllowedError"));
    await tick();
    await tick();
  } finally {
    console.error = error;
  }
  assert.equal(v.on, false);
  assert.equal(v.liveOpen, false);
});

test("the idle limit turns the switch off", async () => {
  const { v } = make({ idle_close_seconds: 0.01 });
  v.syncHolder("me", "me");
  v.toggle();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(v.on, false);
  assert.equal(v.liveOpen, false);
});

test("another device taking the voice session turns the switch off without a release", () => {
  const { v, types } = make();
  v.syncHolder("me", "me");
  v.toggle();
  v.revoked("other");
  assert.equal(v.on, false);
  assert.equal(v.liveOpen, false);
  assert.equal(v.otherHoldsVoice, true);
  assert.deepEqual(types(), ["live.closed"]);
});

test("four quick taps around one round trip end with the voice session released", () => {
  const { v, types } = make();
  v.syncHolder(null, "me");
  v.toggle(); // on: claim 1
  v.toggle(); // off: release, claim 1's grant is stale
  v.toggle(); // on: claim 2
  v.granted(); // claim 1's grant, dropped
  assert.equal(v.holdsVoice, false);
  assert.equal(v.liveOpen, false);
  v.toggle(); // off: release, claim 2's grant is stale
  v.granted(); // claim 2's grant, dropped
  assert.equal(v.on, false);
  assert.equal(v.holdsVoice, false);
  assert.equal(v.liveOpen, false);
  assert.equal(mic.length, 0);
  assert.deepEqual(types(), ["voice.claim", "voice.release", "voice.claim", "voice.release"]);
});

test("off, on again before the stale grant: the second grant opens the session", () => {
  const { v, types } = make();
  v.syncHolder(null, "me");
  v.toggle();
  v.toggle();
  v.toggle();
  v.granted(); // stale
  assert.equal(v.liveOpen, false);
  v.granted(); // claim 2
  assert.equal(v.on, true);
  assert.equal(v.holdsVoice, true);
  assert.equal(v.liveOpen, true);
  assert.equal(mic.length, 1);
  assert.deepEqual(types(), ["voice.claim", "voice.release", "voice.claim"]);
  v.end();
});

test("a grant that arrives while the switch is off is given back at once", () => {
  const { v, types } = make();
  v.syncHolder(null, "me");
  v.granted();
  assert.equal(v.on, false);
  assert.equal(v.holdsVoice, false);
  assert.equal(v.liveOpen, false);
  assert.deepEqual(types(), ["voice.release"]);
});

test("a claim released before its grant leaves no device holding the voice session", () => {
  const { v } = make();
  v.syncHolder("other", "me");
  v.toggle();
  v.toggle();
  v.granted();
  assert.equal(v.otherHoldsVoice, false);
  assert.equal(v.voiceHolder, null);
});
