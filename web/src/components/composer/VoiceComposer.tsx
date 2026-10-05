// The one elevated object: the orb, the text field, the mode picker, Talk,
// Send and Stop. Typed text goes to the same voice model (`voice.sendText`).

import { useCallback, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Orb, type OrbState } from "@/components/orb/Orb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InputMode } from "@/gate/gate";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useVoice } from "@/state/voice";
import { ModePicker } from "./ModePicker";
import { TalkButton } from "./TalkButton";
import { useOrbClick } from "./use-orb-click";

export type VoiceComposerProps = {
  orbState: OrbState;
  className?: string;
};

/** 6 lines of 24 px, the `max-h-36` of the field. */
const MAX_FIELD_PX = 144;

export function VoiceComposer({ orbState, className }: VoiceComposerProps) {
  const voice = useVoice();
  const onOrb = useOrbClick();
  const phone = useBreakpoint() === "phone";
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hasText = text.trim().length > 0;

  // `field-sizing: content` grows the field where the browser has it; this
  // does the same elsewhere.
  const fit = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`;
  }, []);

  const send = useCallback(() => {
    const t = text.trim();
    if (t.length === 0) return;
    voice.sendText(t);
    setText("");
    const el = field.current;
    if (el) {
      el.value = "";
      fit(el);
      el.focus();
    }
  }, [text, voice, fit]);

  return (
    <div
      data-kind="composer"
      data-state={orbState}
      className={cn("mx-auto w-full max-w-[760px] rounded-2xl border bg-card p-3 shadow-composer", className)}
    >
      <div className="flex items-start gap-3">
        <Orb state={orbState} held={voice.holdsVoice} live={voice.liveOpen} onClick={onOrb} size={phone ? 56 : 48} />
        {/* The padding sits on the wrapper so the field's max-h-36 holds six full lines. */}
        <div
          className={cn("min-w-0 flex-1 cursor-text", phone ? "py-4" : "py-3")}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              field.current?.focus();
            }
          }}
        >
          <Textarea
            ref={field}
            value={text}
            rows={1}
            aria-label="Message"
            autoComplete="off"
            spellCheck
            onChange={(e) => {
              setText(e.target.value);
              fit(e.currentTarget);
            }}
            onKeyDown={(e) => {
              // Esc reaches the shell's keyboard hook, which stops.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className={cn(
              "min-h-6 max-h-36 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 shadow-none",
              "text-[15px] leading-6 md:text-[15px] dark:bg-transparent",
              "focus-visible:border-0 focus-visible:ring-0",
            )}
          />
        </div>
      </div>
      <div className="flex h-9 items-center justify-between gap-2">
        <ModePicker />
        <div className="flex items-center gap-2">
          {voice.inputMode === InputMode.PUSH_TO_TALK ? <TalkButton /> : null}
          {hasText ? (
            <Button size="icon" aria-label="Send" onClick={send} className="size-9 rounded-full">
              <ArrowUp strokeWidth={1.5} />
            </Button>
          ) : null}
          <Button
            variant="outline"
            data-state={voice.speaking ? "speaking" : "idle"}
            className={cn(
              "h-9 px-4 transition-colors duration-150",
              voice.speaking && "bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:bg-foreground dark:hover:bg-foreground/90",
            )}
            onClick={() => voice.stop()}
          >
            <Square strokeWidth={1.5} />
            Stop
          </Button>
        </div>
      </div>
    </div>
  );
}
