import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampToFrame,
  eventFromKey,
  eventFromPointer,
  MoveLimiter,
  normalizeToFrame,
  stopsDefault,
  wheelDelta,
  type InputEvent,
} from "../src/vm/input.ts";

test("normalizeToFrame: a wide video in a tall box has bars top and bottom", () => {
  // 1280x800 video inside a 400x1000 element: picture is 400x250 at top 375
  const rect = { left: 10, top: 20, width: 400, height: 1000 };
  assert.deepEqual(normalizeToFrame(10, 20 + 375, rect, 1280, 800), { x: 0, y: 0 });
  assert.deepEqual(normalizeToFrame(10 + 200, 20 + 375 + 125, rect, 1280, 800), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizeToFrame(10 + 400, 20 + 625, rect, 1280, 800), { x: 1, y: 1 });
  assert.equal(normalizeToFrame(10 + 200, 20 + 100, rect, 1280, 800), null);
  assert.equal(normalizeToFrame(10 + 200, 20 + 900, rect, 1280, 800), null);
});

test("normalizeToFrame: a tall video in a wide box has bars left and right", () => {
  // 800x1280 video inside a 1000x400 element: picture is 250x400 at left 375
  const rect = { left: 0, top: 0, width: 1000, height: 400 };
  assert.deepEqual(normalizeToFrame(375, 0, rect, 800, 1280), { x: 0, y: 0 });
  assert.deepEqual(normalizeToFrame(500, 200, rect, 800, 1280), { x: 0.5, y: 0.5 });
  assert.equal(normalizeToFrame(100, 200, rect, 800, 1280), null);
  assert.equal(normalizeToFrame(900, 200, rect, 800, 1280), null);
  assert.equal(normalizeToFrame(-1, 200, rect, 800, 1280), null);
});

test("clampToFrame lands outside points on the edge", () => {
  const rect = { left: 0, top: 0, width: 1000, height: 400 };
  assert.deepEqual(clampToFrame(100, 200, rect, 800, 1280), { x: 0, y: 0.5 });
  assert.deepEqual(clampToFrame(900, 500, rect, 800, 1280), { x: 1, y: 1 });
  assert.deepEqual(clampToFrame(500, 200, rect, 800, 1280), { x: 0.5, y: 0.5 });
  assert.equal(clampToFrame(1, 1, { left: 0, top: 0, width: 0, height: 0 }, 0, 0), null);
});

test("eventFromPointer builds every pointer kind", () => {
  const p = { x: 0.25, y: 0.75 };
  assert.deepEqual(eventFromPointer("mouse.move", p), { kind: "mouse.move", x: 0.25, y: 0.75 });
  assert.deepEqual(eventFromPointer("mouse.down", p, { button: 2 }), { kind: "mouse.down", x: 0.25, y: 0.75, button: 2 });
  assert.deepEqual(eventFromPointer("mouse.up", p), { kind: "mouse.up", x: 0.25, y: 0.75, button: 0 });
  assert.deepEqual(eventFromPointer("wheel", p, { dx: 3, dy: -120 }), { kind: "wheel", x: 0.25, y: 0.75, dx: 3, dy: -120 });
  assert.deepEqual(eventFromPointer("touch", p, { phase: "start" }), { kind: "touch", x: 0.25, y: 0.75, key: "start" });
  assert.deepEqual(eventFromPointer("touch", p, { phase: "end" }), { kind: "touch", x: 0.25, y: 0.75, key: "end" });
  assert.deepEqual(eventFromPointer("touch", p), { kind: "touch", x: 0.25, y: 0.75, key: "move" });
});

test("eventFromKey carries key and code for both kinds", () => {
  assert.deepEqual(eventFromKey("key.down", { key: "a", code: "KeyA" }), { kind: "key.down", key: "a", code: "KeyA" });
  assert.deepEqual(eventFromKey("key.up", { key: "Shift", code: "ShiftLeft" }), { kind: "key.up", key: "Shift", code: "ShiftLeft" });
});

test("wheelDelta scales lines and pages to pixels", () => {
  assert.deepEqual(wheelDelta(1, -2, 0), { dx: 1, dy: -2 });
  assert.deepEqual(wheelDelta(1, -2, 1), { dx: 16, dy: -32 });
  assert.deepEqual(wheelDelta(0, 1, 2), { dx: 0, dy: 400 });
});

test("stopsDefault names the keys the browser acts on", () => {
  assert.equal(stopsDefault({ key: " ", code: "Space" }), true);
  assert.equal(stopsDefault({ key: "Tab", code: "Tab" }), true);
  assert.equal(stopsDefault({ key: "ArrowDown", code: "ArrowDown" }), true);
  assert.equal(stopsDefault({ key: "s", code: "KeyS", ctrlKey: true }), true);
  assert.equal(stopsDefault({ key: "a", code: "KeyA" }), false);
  assert.equal(stopsDefault({ key: "Enter", code: "Enter" }), false);
});

function clock() {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      timers.push({ at: t + ms, fn });
    },
    advance(ms: number) {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      for (const x of due) timers.splice(timers.indexOf(x), 1);
      for (const x of due) x.fn();
    },
  };
}

test("MoveLimiter sends the first move at once and the last of a burst at the window end", () => {
  const c = clock();
  const sent: InputEvent[] = [];
  const limiter = new MoveLimiter((e) => sent.push(e), { minIntervalMs: 20, now: c.now, schedule: c.schedule });
  limiter.push({ kind: "mouse.move", x: 0.1, y: 0.1 });
  assert.equal(sent.length, 1);
  c.advance(5);
  limiter.push({ kind: "mouse.move", x: 0.2, y: 0.2 });
  c.advance(5);
  limiter.push({ kind: "mouse.move", x: 0.3, y: 0.3 });
  assert.equal(sent.length, 1);
  c.advance(10);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], { kind: "mouse.move", x: 0.3, y: 0.3 });
  // the trailing send starts a new window
  limiter.push({ kind: "mouse.move", x: 0.4, y: 0.4 });
  assert.equal(sent.length, 2);
  c.advance(20);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2], { kind: "mouse.move", x: 0.4, y: 0.4 });
});

test("MoveLimiter caps the rate at one send per window", () => {
  const c = clock();
  const sent: InputEvent[] = [];
  const limiter = new MoveLimiter((e) => sent.push(e), { minIntervalMs: 1000 / 60, now: c.now, schedule: c.schedule });
  for (let i = 0; i < 1000; i++) {
    limiter.push({ kind: "mouse.move", x: i / 1000, y: 0 });
    c.advance(1);
  }
  c.advance(20);
  assert.ok(sent.length <= 62 && sent.length >= 59, `sent ${sent.length}`);
  assert.deepEqual(sent[sent.length - 1], { kind: "mouse.move", x: 0.999, y: 0 });
});

test("MoveLimiter flush sends the held move now; clear drops it", () => {
  const c = clock();
  const sent: InputEvent[] = [];
  const limiter = new MoveLimiter((e) => sent.push(e), { minIntervalMs: 20, now: c.now, schedule: c.schedule });
  limiter.push({ kind: "touch", x: 0, y: 0, key: "move" });
  limiter.push({ kind: "touch", x: 0.5, y: 0.5, key: "move" });
  limiter.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], { kind: "touch", x: 0.5, y: 0.5, key: "move" });
  // the timer finds nothing held
  c.advance(20);
  assert.equal(sent.length, 2);
  // a full window has passed: the next move goes at once, the one after is held
  limiter.push({ kind: "touch", x: 0.7, y: 0.7, key: "move" });
  assert.equal(sent.length, 3);
  limiter.push({ kind: "touch", x: 0.9, y: 0.9, key: "move" });
  limiter.clear();
  c.advance(20);
  assert.equal(sent.length, 3);
});
