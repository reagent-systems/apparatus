import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyLatch } from "../src/live/reply-latch.ts";

test("audio plays until an interrupt, then stays silent until the reply ends", () => {
  const l = new ReplyLatch();
  assert.equal(l.audio(), true);
  l.interrupt();
  assert.equal(l.muted, true);
  assert.equal(l.audio(), false);
  assert.equal(l.audio(), false);
  l.end();
  assert.equal(l.muted, false);
  assert.equal(l.audio(), true);
});

test("an interrupt with no reply arriving mutes nothing", () => {
  const l = new ReplyLatch();
  l.interrupt();
  assert.equal(l.muted, false);
  assert.equal(l.audio(), true);
});

test("an interrupt after the reply ended does not mute the next reply", () => {
  const l = new ReplyLatch();
  l.audio();
  l.end();
  l.interrupt();
  assert.equal(l.audio(), true);
});
