// Talk: press and hold. Pointer capture keeps the hold through a drag; a
// held Space talks while the focus is outside a text field, the VM video
// and any other control (the focused Talk button itself counts as outside).
// Hidden in Open mic mode by the composer.
//
// The shell's keyboard hook also holds Space (for Open mic, where this button
// is not mounted). This button listens in the capture phase and marks the
// event handled, so the hook, which skips handled events, never presses twice
// and the button shows its pressed state.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { talkTarget } from "@/hooks/shortcuts";
import { cn } from "@/lib/utils";
import { useVoice } from "@/state/voice";

const TALK = "talk";

// The same two selectors as `hooks/use-shortcuts.ts`: a target this button
// declines is one the hook declines too, so a Space never talks unseen.
const CONTROL =
  'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="switch"], [role="tab"], [role="radio"], summary, [cmdk-root]';

const OVERLAY_OPEN =
  '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"], [role="listbox"][data-state="open"]';

function spaceBelongsToTarget(target: EventTarget | null): boolean {
  if (document.querySelector(OVERLAY_OPEN)) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(`[data-talk="${TALK}"]`)) return false;
  return talkTarget(target.tagName, target.isContentEditable, target.closest(CONTROL) !== null) !== "free";
}

export function TalkButton({ className }: { className?: string }) {
  const { pressTalk, releaseTalk } = useVoice();
  const [down, setDown] = useState(false);
  const held = useRef(false);

  const press = useCallback(() => {
    if (held.current) return;
    held.current = true;
    setDown(true);
    pressTalk();
  }, [pressTalk]);
  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    setDown(false);
    releaseTalk();
  }, [releaseTalk]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (spaceBelongsToTarget(e.target)) return;
      e.preventDefault();
      if (!e.repeat) press();
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      release();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", release);
      release();
    };
  }, [press, release]);

  return (
    <Button
      size="sm"
      data-talk={TALK}
      aria-pressed={down}
      className={cn("h-9 px-4 touch-none select-none transition-transform duration-150", down && "scale-[.97]", className)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) press();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter") release();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      Talk
    </Button>
  );
}
