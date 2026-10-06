import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrbClock, type FrameScheduler } from "../src/components/orb/orb-clock.ts";

function fakeFrames() {
  let next = 1;
  let clock = 0;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    now: () => clock,
    request: (callback) => {
      const handle = next++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => void pending.delete(handle),
  };
  const frame = (now: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    clock = now;
    for (const callback of callbacks) callback();
  };
  return { scheduler, frame, pending };
}

test("every orb on the clock gets the same now from one frame request", () => {
  const frames = fakeFrames();
  const clock = createOrbClock(frames.scheduler);
  const seen: number[][] = [[], []];
  clock.subscribe((now) => seen[0]?.push(now));
  clock.subscribe((now) => seen[1]?.push(now));
  assert.equal(frames.pending.size, 1);
  frames.frame(100);
  frames.frame(116);
  assert.deepEqual(seen, [
    [100, 116],
    [100, 116],
  ]);
  assert.equal(frames.pending.size, 1);
});

test("the loop stops when the last orb leaves", () => {
  const frames = fakeFrames();
  const clock = createOrbClock(frames.scheduler);
  const a = clock.subscribe(() => undefined);
  const b = clock.subscribe(() => undefined);
  a();
  assert.equal(frames.pending.size, 1);
  b();
  assert.equal(frames.pending.size, 0);
  assert.equal(clock.size(), 0);
});

test("an orb that leaves during a tick stops the loop; one that joins keeps a single loop", () => {
  const frames = fakeFrames();
  const clock = createOrbClock(frames.scheduler);
  let leave = () => undefined as void;
  leave = clock.subscribe(() => leave());
  frames.frame(1);
  assert.equal(frames.pending.size, 0);

  let joined = false;
  const ticks: number[] = [];
  const first = clock.subscribe(() => {
    if (!joined) {
      joined = true;
      first();
      clock.subscribe((now) => ticks.push(now));
    }
  });
  frames.frame(2);
  assert.equal(frames.pending.size, 1);
  frames.frame(3);
  assert.deepEqual(ticks, [3]);
  assert.equal(frames.pending.size, 1);
});
