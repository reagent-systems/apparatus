// Pure: the keyboard table of DESIGN.md 2 as a matcher. Voice has no global
// key: the orb is a focusable switch. No DOM; `use-shortcuts.ts` binds it to
// the window. Tested in `test/shortcuts.test.ts`.

import type { View } from "../state/selection-codec.ts";

export type Shortcut = "palette" | "rail" | "pane" | "needsYou" | "control" | `view:${View}`;

export type KeyLike = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Cmd/Ctrl+1 … 5 in the order of the rail. */
export const VIEW_ORDER: readonly View[] = ["thread", "jobs", "screen", "audit", "credits"];

const DIGITS: Record<string, View> = Object.fromEntries(VIEW_ORDER.map((v, i) => [`Digit${i + 1}`, v]));

/** The modifier is Cmd on a Mac and Ctrl elsewhere; the other one is never it. */
function modifier(e: KeyLike, mac: boolean): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * The shortcut a key event names, or null. Letters match on `code` so a Mac
 * Alt+J (which types ∆) and a non-Latin layout still work; `key` is the
 * fallback when `code` is absent.
 */
export function shortcutFor(e: KeyLike, mac: boolean): Shortcut | null {
  const mod = modifier(e, mac);
  const code = e.code ?? codeFromKey(e.key);
  if (e.altKey && !mod && !e.shiftKey && code === "KeyJ") return "needsYou";
  if (!mod || e.altKey) return null;
  if (e.shiftKey) return code === "KeyC" ? "control" : null;
  switch (code) {
    case "KeyK":
      return "palette";
    case "KeyB":
      return "rail";
    case "KeyJ":
      return "pane";
    default: {
      const view = DIGITS[code];
      return view ? `view:${view}` : null;
    }
  }
}

function codeFromKey(key: string): string {
  if (/^[1-5]$/.test(key)) return `Digit${key}`;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  return key;
}

/**
 * The oldest card that needs you is the first match in document order:
 * the thread owner marks cards with `data-kind` and `data-state`.
 */
export const NEEDS_YOU_SELECTOR =
  '[data-kind="approval"][data-state="pending"], [data-kind="handoff"]:is([data-state="pending"], [data-state="active"], [data-state="open"])';

/** The Kbd label for the modifier key. */
export function modLabel(mac: boolean): string {
  return mac ? "⌘" : "Ctrl";
}

/** `⌘K` on a Mac, `Ctrl+K` elsewhere; `⌘⇧C` / `Ctrl+Shift+C`; `⌥J` / `Alt+J`. */
export function keyLabel(parts: { mod?: boolean; shift?: boolean; alt?: boolean; key: string }, mac: boolean): string {
  const out: string[] = [];
  if (parts.mod) out.push(modLabel(mac));
  if (parts.alt) out.push(mac ? "⌥" : "Alt");
  if (parts.shift) out.push(mac ? "⇧" : "Shift");
  out.push(parts.key);
  return mac ? out.join("") : out.join("+");
}
