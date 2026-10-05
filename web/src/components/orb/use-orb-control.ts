// The orb's one gesture on the voice context (DESIGN.md 3). The pure rules
// are `composer/orb-gesture.ts`; this hook adds the DOM and the timer.
//
//   tap (< HOLD_MS)   claim the voice session, interrupt, close or open
//   hold (>= HOLD_MS) `pressTalk` when the timer fires; release ends the turn
//
// Pointer capture keeps a hold through a drag. Pointer cancel, lost capture,
// blur and unmount release without a tap. Enter on the focused orb taps;
// Space taps when short and holds when long. Both mark the event handled,
// so the shell's own Space hold skips it.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { HOLD_MS, endPress, startPress, tapAction, type Press } from "@/composer/orb-gesture";
import { useVoice, type VoiceValue } from "@/state/voice";

export type OrbHandlers = {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onBlur: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
};

export type OrbControl = {
  /** A hold is on, from this orb, the other orb or Space: the forced turn is open. */
  pressed: boolean;
  handlers: OrbHandlers;
};

function runTap(voice: VoiceValue): void {
  switch (tapAction(voice)) {
    case "claim":
    case "open":
      voice.start();
      return;
    case "interrupt":
      voice.interrupt();
      return;
    case "close":
      voice.end();
      return;
  }
}

export function useOrbControl(): OrbControl {
  const voice = useVoice();
  // The tap reads the voice state at release, not at the render that bound the handlers.
  const latest = useRef(voice);
  latest.current = voice;
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const [pressed, setPressed] = useState(false);

  const begin = useCallback(() => {
    if (press.current) return;
    press.current = startPress(performance.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      holding.current = true;
      setPressed(true);
      latest.current.pressTalk();
    }, HOLD_MS);
  }, []);

  /** `tap: false` releases without a tap: a cancel, a lost capture, a blur. */
  const finish = useCallback((tap: boolean) => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (holding.current) {
      holding.current = false;
      setPressed(false);
      latest.current.releaseTalk();
      return;
    }
    // A press past HOLD_MS whose timer has not fired yet is a hold too: no tap.
    if (tap && endPress(p, performance.now()) === "tap") runTap(latest.current);
  }, []);

  useEffect(() => {
    const cancel = (): void => finish(false);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [finish]);

  const handlers: OrbHandlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      begin();
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(false),
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat && !press.current) runTap(latest.current);
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) begin();
      }
    },
    onKeyUp: (e) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        finish(true);
      }
    },
    onBlur: () => finish(false),
    onContextMenu: (e) => e.preventDefault(),
  };

  return { pressed: pressed || voice.pressing, handlers };
}
