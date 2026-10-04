import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EnrollmentStore,
  EmbeddingSpeakerCheck,
  NoSpeakerCheck,
  StubEmbedder,
  ConsentRequired,
  enrollSpeaker,
  cosine,
} from "../src/gate/speaker.ts";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function tone(freq: number, amp: number, n = 16000): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / 16000) * amp * 32767);
  return out;
}

test("enrollment throws without consent and writes nothing", () => {
  const storage = new MemoryStorage();
  const store = new EnrollmentStore(storage);
  assert.throws(() => enrollSpeaker(tone(200, 0.3), false, { embedder: new StubEmbedder(), store }), ConsentRequired);
  assert.equal(storage.map.size, 0);
  assert.throws(() => store.save({ version: 1, dims: 1, embedding: [1], enrolled_at: "" }, false), ConsentRequired);
});

test("enrollment with consent stores an embedding, not audio, on the given storage only", () => {
  const storage = new MemoryStorage();
  const store = new EnrollmentStore(storage);
  const samples = tone(200, 0.3);
  const profile = enrollSpeaker(samples, true, { embedder: new StubEmbedder(), store });
  assert.equal(storage.map.size, 1);
  const stored = store.load();
  assert.ok(stored);
  assert.equal(stored.dims, 4);
  assert.equal(stored.embedding.length, 4);
  assert.ok(stored.embedding.length < samples.length);
  assert.deepEqual(stored.embedding, profile.embedding);
  store.clear();
  assert.equal(store.load(), null);
});

test("NoSpeakerCheck always matches and is off", () => {
  const c = new NoSpeakerCheck();
  assert.equal(c.enabled, false);
  assert.equal(c.matches(), true);
});

test("EmbeddingSpeakerCheck compares against the profile", () => {
  const embedder = new StubEmbedder();
  const enrolled = tone(200, 0.3);
  const store = new EnrollmentStore(new MemoryStorage());
  const profile = enrollSpeaker(enrolled, true, { embedder, store });
  const check = new EmbeddingSpeakerCheck({ embedder, profile, threshold: 0.999 });
  assert.equal(check.enabled, true);
  assert.equal(check.matches(tone(200, 0.3)), true);
  assert.equal(check.matches(tone(3000, 0.05)), false);
  const empty = new EmbeddingSpeakerCheck({ embedder, profile: null, threshold: 0.75 });
  assert.equal(empty.ready, false);
  assert.equal(empty.matches(tone(3000, 0.05)), true);
});

test("cosine", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});
