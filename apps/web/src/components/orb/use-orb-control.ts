// The orb's tap on the voice context: the agent's on-switch (DESIGN.md 3).
// The rules are `composer/orb-toggle.ts`, run by the controller's `toggle`,
// which reads the switch at the tap, not at the render that bound it.
//
// The orb is a native <button>, so one click handler takes a mouse click, a
// touch, Enter (on key down) and Space (on key up) on the focused orb. A
// repeated Enter while the key stays down does not toggle again.

import type { KeyboardEvent } from "react";
import { useVoice } from "@/state/voice";

export type OrbHandlers = {
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
};

export type OrbControl = {
  /** The switch reads on. */
  on: boolean;
  handlers: OrbHandlers;
};

export function useOrbControl(): OrbControl {
  const { on, toggle } = useVoice();
  return {
    on,
    handlers: {
      onClick: toggle,
      onKeyDown: (e) => {
        if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
      },
      onContextMenu: (e) => e.preventDefault(),
    },
  };
}
