// The keyboard table of DESIGN.md 2 on the window. The matcher is pure
// (`shortcuts.ts`); this hook adds the DOM rules: an open overlay keeps its
// keys, the VM video keeps Escape for the desktop, and the Space hold talks
// only with focus outside a text field, the video and any control.

import { useEffect, useRef } from "react";
import { isMac } from "./use-platform.ts";
import { NEEDS_YOU_SELECTOR, shortcutFor, talkTarget, type Shortcut } from "./shortcuts.ts";

export type ShortcutHandlers = {
  onShortcut: (shortcut: Shortcut, event: KeyboardEvent) => void;
  onTalkDown: () => void;
  onTalkUp: () => void;
};

const OVERLAY_OPEN = '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"], [role="listbox"][data-state="open"]';

const CONTROL = 'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="switch"], [role="tab"], [role="radio"], summary, [cmdk-root]';

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_OPEN) !== null;
}

function elementOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const held = useRef(false);

  useEffect(() => {
    const mac = isMac();
    const release = (): void => {
      if (!held.current) return;
      held.current = false;
      ref.current.onTalkUp();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const el = elementOf(e.target);
      if (e.key === " " || e.code === "Space") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const kind = talkTarget(el?.tagName ?? null, !!el?.isContentEditable, !!el?.closest(CONTROL));
        if (kind !== "free" || overlayOpen()) return;
        e.preventDefault();
        if (e.repeat || held.current) return;
        held.current = true;
        ref.current.onTalkDown();
        return;
      }
      const shortcut = shortcutFor(e, mac);
      if (!shortcut) return;
      if (shortcut === "stop") {
        if (overlayOpen() || el?.tagName === "VIDEO") return;
      } else if (overlayOpen() && shortcut !== "palette") {
        return;
      }
      e.preventDefault();
      ref.current.onShortcut(shortcut, e);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === " " || e.code === "Space") release();
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
