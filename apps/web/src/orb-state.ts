// Pure: the orb's render decision from the voice state. No DOM, no React;
// `Orb.tsx` passes the result to thinking-orbs. Tested in `test/orb-state.test.ts`.

import type { OrbAnimation } from "@apparatus/orb";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "working";

/** The thinking-orbs animations the orb uses; `@apparatus/orb` owns the list. */
export type { OrbAnimation };

export type OrbInput = {
  state: OrbState;
  /** No other device holds the voice session: this device holds it, or nobody does. */
  held: boolean;
  /** A Live session is open. */
  live: boolean;
  /** The viewer asked for reduced motion. */
  reducedMotion?: boolean;
};

export type OrbRender = {
  animation: OrbAnimation;
  /** Multiplier on the preset's baked speed. */
  speed: number;
  paused: boolean;
  /** Another device holds the voice session. */
  dimmed: boolean;
};

export const ANIMATION: Record<OrbState, OrbAnimation> = {
  idle: "breathing",
  connecting: "connecting",
  listening: "listening",
  speaking: "composing",
  working: "working",
};

export const NORMAL_SPEED = 1;
/** Idle-closed: the Live session is shut and the microphone is off. */
export const SLOW_SPEED = 0.5;

/**
 * Precedence: `connecting` (the server socket is down) shows as is; while
 * another device holds the voice session the orb is paused and dimmed; a running job
 * shows `working` even while the Live session is closed; otherwise a closed
 * Live session breathes slowly.
 */
export function orbRender({ state, held, live, reducedMotion = false }: OrbInput): OrbRender {
  let animation = ANIMATION[state];
  let speed = NORMAL_SPEED;
  if (state !== "connecting" && state !== "working" && held && !live) {
    animation = "breathing";
    speed = SLOW_SPEED;
  }
  return { animation, speed, paused: !held || reducedMotion, dimmed: !held };
}
