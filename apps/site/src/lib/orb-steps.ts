// The orb states the page shows, in the order a call goes through them. No
// DOM here: the components read it at build time and lib/orb.ts in the page.
import type { OrbAnimation } from "@apparatus/orb/paint";

export type OrbStateName = "off" | "listening" | "working" | "speaking";

// The app's own mapping (apps/web/src/orb-state.ts): off breathes at half speed, speaking draws `composing`.
export const ORB_STEPS: { name: OrbStateName; label: string; animation: OrbAnimation; speed: number }[] = [
  { name: "off", label: "Off", animation: "breathing", speed: 0.5 },
  { name: "listening", label: "Listening", animation: "listening", speed: 1 },
  { name: "working", label: "Working", animation: "working", speed: 1 },
  { name: "speaking", label: "Speaking", animation: "composing", speed: 1 },
];

export const orbStep = (name: OrbStateName) => ORB_STEPS.find((s) => s.name === name)!;
