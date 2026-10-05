// The keyboard table of DESIGN.md 2 on the window. The matcher is pure
// (`shortcuts.ts`); this hook adds the DOM rule: an open overlay keeps its
// keys, except the palette's. Voice has no global key: Enter and Space on
// the focused orb toggle it, and Esc only closes overlays.

import { useEffect, useRef } from "react";
import { isMac } from "./use-platform.ts";
import { NEEDS_YOU_SELECTOR, shortcutFor, type Shortcut } from "./shortcuts.ts";

export type ShortcutHandlers = {
  onShortcut: (shortcut: Shortcut, event: KeyboardEvent) => void;
};

const OVERLAY_OPEN = '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"], [role="listbox"][data-state="open"]';

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_OPEN) !== null;
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const mac = isMac();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const shortcut = shortcutFor(e, mac);
      if (!shortcut) return;
      if (overlayOpen() && shortcut !== "palette") return;
      e.preventDefault();
      ref.current.onShortcut(shortcut, e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
