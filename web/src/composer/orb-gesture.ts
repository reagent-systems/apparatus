// Pure: the orb's one gesture (DESIGN.md 3). A press shorter than HOLD_MS
// is a tap; a press of HOLD_MS or longer is a hold, a forced turn for as
// long as it lasts. A hold never also yields a tap. No DOM, no timers;
// `components/orb/use-orb-control.ts` binds it. Tested in
// `test/orb-gesture.test.ts`.

export const HOLD_MS = 350;

export type TapAction = "claim" | "interrupt" | "close" | "open";

export type VoiceFacts = {
  /** This device holds the voice session. */
  holdsVoice: boolean;
  /** A Live session is open. */
  liveOpen: boolean;
  /** The agent's audio is playing. */
  speaking: boolean;
};

/**
 * What a tap does, first match wins: claim the voice session, interrupt the
 * agent, close the Live session, open it.
 */
export function tapAction({ holdsVoice, liveOpen, speaking }: VoiceFacts): TapAction {
  if (!holdsVoice) return "claim";
  if (speaking) return "interrupt";
  if (liveOpen) return "close";
  return "open";
}

export type Press = { readonly at: number };

export type PressEnd = "tap" | "hold-end";

export function startPress(now: number): Press {
  return { at: now };
}

/** True once the press has lasted HOLD_MS. */
export function isHold(press: Press, now: number): boolean {
  return now - press.at >= HOLD_MS;
}

export function endPress(press: Press, now: number): PressEnd {
  return isHold(press, now) ? "hold-end" : "tap";
}
