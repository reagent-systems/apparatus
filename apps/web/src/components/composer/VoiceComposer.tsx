// The one elevated object: the orb centred in the box and, centred above it,
// what the model heard of the current user turn. Voice only: no text field,
// no buttons. The line arrives at opacity-70, goes solid once final, and
// clears when the agent starts its reply or FINAL_MS after the final line
// lands in the thread as the user card. Nothing shows while nobody speaks:
// the box then holds the orb alone. The composer is docked to the bottom, so
// the box grows upward and the orb never moves when the line comes or goes.

import { useEffect, useRef, useState } from "react";
import { Orb, type OrbState } from "@/components/orb/Orb";
import { useOrbControl } from "@/components/orb/use-orb-control";
import type { FeedState } from "@/feed/reducer";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useVoice } from "@/state/voice";

export type VoiceComposerProps = {
  orbState: OrbState;
  className?: string;
};

/** How long a final line stays above the orb once its card is in the thread. */
const FINAL_MS = 600;

type Heard = { id: string; text: string; final: boolean };

/** The open user transcript, or the final one that just closed it. */
function heardLine(feed: FeedState, lastOpen: string | null): Heard | null {
  const open = feed.openTranscript ? feed.cards.find((c) => c.id === feed.openTranscript) : undefined;
  if (open?.kind === "transcript" && open.role === "user" && !open.final) return { id: open.id, text: open.text, final: false };
  const last = feed.cards[feed.cards.length - 1];
  if (last?.kind === "transcript" && last.role === "user" && last.final && last.id === lastOpen) {
    return { id: last.id, text: last.text, final: true };
  }
  return null;
}

export function VoiceComposer({ orbState, className }: VoiceComposerProps) {
  const voice = useVoice();
  const [feed] = useFeed();
  const orb = useOrbControl();
  const phone = useBreakpoint() === "phone";
  const lastOpen = useRef<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  let line = voice.holdsVoice && !voice.speaking ? heardLine(feed, lastOpen.current) : null;
  if (line && line.final && line.id === dismissed) line = null;
  if (line && !line.final) lastOpen.current = line.id;

  const finalId = line?.final ? line.id : null;
  useEffect(() => {
    if (finalId === null) return;
    const timer = setTimeout(() => setDismissed(finalId), FINAL_MS);
    return () => clearTimeout(timer);
  }, [finalId]);

  return (
    <div
      data-kind="composer"
      data-state={orbState}
      className={cn("mx-auto flex w-full max-w-[760px] flex-col items-center gap-2 rounded-2xl border bg-card p-3 shadow-composer", className)}
    >
      {line && line.text.trim().length > 0 ? (
        // At most 2 lines (3 on a phone), the newest in view: the overflow leaves at the top.
        <div className={cn("flex w-full min-w-0 flex-col justify-end overflow-hidden", phone ? "max-h-18" : "max-h-12")}>
          <p
            data-slot="heard"
            data-state={line.final ? "final" : "interim"}
            aria-live="polite"
            className={cn(
              "text-center text-[15px] leading-6 text-balance break-words transition-opacity duration-150",
              !line.final && "opacity-70",
            )}
          >
            {line.text}
          </p>
        </div>
      ) : null}
      <Orb state={orbState} held={!voice.otherHoldsVoice} live={voice.liveOpen} control={orb} size={phone ? 56 : 48} />
    </div>
  );
}
