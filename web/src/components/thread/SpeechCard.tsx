// A user bubble or agent prose. Interim text sits at opacity-70 until final.
// Typed text is the same card as a spoken one. The time shows on hover on
// the desktop; on a phone only job, approval and handoff cards keep theirs.

import { renderMarkdown } from "@/markdown";
import type { TranscriptCard } from "@/feed/reducer";
import { cn } from "@/lib/utils";
import { clockTime } from "./format";

export function SpeechCard({ card }: { card: TranscriptCard }) {
  const state = card.final ? "final" : "interim";
  const time = (
    <time
      dateTime={new Date(card.at).toISOString()}
      className="shrink-0 pb-2.5 text-xs text-muted-foreground tabular-nums transition-opacity max-md:hidden md:opacity-0 md:group-hover:opacity-100"
    >
      {clockTime(card.at)}
    </time>
  );
  if (card.role === "user") {
    return (
      <div className="group flex max-w-[80%] items-end gap-2 self-end">
        {time}
        <div
          data-kind="speech"
          data-role="user"
          data-state={state}
          className={cn(
            "rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-[1.55] break-words whitespace-pre-wrap transition-opacity",
            !card.final && "opacity-70",
          )}
        >
          {card.text}
        </div>
      </div>
    );
  }
  return (
    <div className="group flex max-w-[92%] items-end gap-2 self-start">
      <div
        data-kind="speech"
        data-role="agent"
        data-state={state}
        className={cn(
          "show-output min-w-0 text-[15px] leading-[1.55] break-words transition-opacity [&>:last-child]:mb-0",
          !card.final && "opacity-70",
        )}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(card.text) }}
      />
      {time}
    </div>
  );
}
