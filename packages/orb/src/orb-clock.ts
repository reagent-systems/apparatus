// One animation frame loop for every orb on the page. Each running orb
// subscribes; every tick reads `performance.now()` once, as `ThinkingOrb`
// reads it, and hands all of them that same `now`, so orbs at the same
// state and speed draw the same frame. The loop stops when nobody
// listens. Tested in `test/orb-clock.test.ts`.

export type OrbTick = (nowMs: number) => void;

export type FrameScheduler = {
  now: () => number;
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type OrbClock = {
  /** Run `tick` on every frame until the returned function is called. */
  subscribe: (tick: OrbTick) => () => void;
  /** The number of subscribed orbs. */
  size: () => number;
};

export function createOrbClock(scheduler: FrameScheduler): OrbClock {
  const ticks = new Set<OrbTick>();
  let handle = 0;
  let inTick = false;

  const loop = () => {
    handle = 0;
    inTick = true;
    const nowMs = scheduler.now();
    try {
      for (const tick of [...ticks]) tick(nowMs);
    } finally {
      inTick = false;
      if (ticks.size > 0) handle = scheduler.request(loop);
    }
  };

  return {
    subscribe(tick) {
      ticks.add(tick);
      if (handle === 0 && !inTick) handle = scheduler.request(loop);
      return () => {
        ticks.delete(tick);
        if (ticks.size === 0 && handle !== 0) {
          scheduler.cancel(handle);
          handle = 0;
        }
      };
    },
    size: () => ticks.size,
  };
}

const browserScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(() => callback()),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** The page's one clock. */
export const orbClock = createOrbClock(browserScheduler);
