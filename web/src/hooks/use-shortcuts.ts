// The keyboard table of DESIGN.md 2 on the window. The matcher is pure
// (`shortcuts.ts`); this hook adds the DOM rules: an open overlay keeps its
// keys, the VM video keeps Space and Escape for the desktop, and a key the
// focused orb already handled is skipped. Space held for HOLD_MS anywhere
// else is the orb's hold; a shorter Space does nothing.

import { useEffect, useRef } from "react";
import { HOLD_MS } from "../composer/orb-gesture.ts";
import { isMac } from "./use-platform.ts";
import { NEEDS_YOU_SELECTOR, shortcutFor, talkTarget, type Shortcut } from "./shortcuts.ts";

export type ShortcutHandlers = {
  onShortcut: (shortcut: Shortcut, event: KeyboardEvent) => void;
  onTalkDown: () => void;
  onTalkUp: () => void;
};

const OVERLAY_OPEN = '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"], [role="listbox"][data-state="open"]';

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_OPEN) !== null;
}

function elementOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  // A Space press this hook owns: down, and whether the hold has begun.
  const space = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean } | null>(null);

  useEffect(() => {
    const mac = isMac();
    const release = (): void => {
      const press = space.current;
      if (!press) return;
      space.current = null;
      if (press.timer !== null) clearTimeout(press.timer);
      if (press.held) ref.current.onTalkUp();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const el = elementOf(e.target);
      if (e.key === " " || e.code === "Space") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (talkTarget(el?.tagName ?? null) !== "free" || overlayOpen()) return;
        e.preventDefault();
        if (e.repeat || space.current) return;
        const press: { timer: ReturnType<typeof setTimeout> | null; held: boolean } = { timer: null, held: false };
        press.timer = setTimeout(() => {
          press.timer = null;
          press.held = true;
          ref.current.onTalkDown();
        }, HOLD_MS);
        space.current = press;
        return;
      }
      const shortcut = shortcutFor(e, mac);
      if (!shortcut) return;
      if (shortcut === "interrupt") {
        if (overlayOpen() || el?.tagName === "VIDEO") return;
      } else if (overlayOpen() && shortcut !== "palette") {
        return;
      }
      e.preventDefault();
      ref.current.onShortcut(shortcut, e);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!(e.key === " " || e.code === "Space") || !space.current) return;
      // A focused button activates on the Space key up; this Space was a hold.
      e.preventDefault();
      release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);
}

/** Focus the oldest card that needs you, once the thread has rendered. */
export function focusNeedsYou(): boolean {
  const card = document.querySelector<HTMLElement>(NEEDS_YOU_SELECTOR);
  if (!card) return false;
  if (!card.hasAttribute("tabindex")) card.tabIndex = -1;
  card.scrollIntoView({ block: "center" });
  card.focus({ preventScroll: true });
  return true;
}
