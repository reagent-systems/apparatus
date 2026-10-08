// Pure: the orb is the agent's on-switch (DESIGN.md 3), like the watches'
// call. A tap, a click, or Enter or Space on the focused orb toggles it. No
// hold, no tap-to-interrupt: talking over the agent interrupts it through
// the gate's barge-in rule. No DOM, no timers; `voice.ts` runs the steps and
// `components/orb/use-orb-control.ts` binds the tap. Tested in
// `test/orb-toggle.test.ts`.

export type ToggleAction = "on" | "off";

/**
 * What a tap does. A switch that reads off turns on; one that reads on
 * turns off, also while its claim is still in flight. Whether this device
 * holds the voice session changes the steps of "on" (`onStep`), never the
 * action.
 */
export function toggleAction({ on }: { holdsVoice: boolean; on: boolean }): ToggleAction {
  return on ? "off" : "on";
}

/**
 * The next step of a switch that is on: a device without the voice session
 * claims it and opens on `voice.granted`; a device that holds it opens the
 * Live session and the microphone.
 */
export function onStep({ holdsVoice }: { holdsVoice: boolean }): "claim" | "open" {
  return holdsVoice ? "open" : "claim";
}

/** Whether hang-up sends `voice.release`: this device holds the voice session or has a claim in flight. */
export function releasesVoice({ holdsVoice, claimPending }: { holdsVoice: boolean; claimPending: boolean }): boolean {
  return holdsVoice || claimPending;
}
