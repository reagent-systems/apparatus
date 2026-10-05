// A handoff in the thread: the reason, Done and Cancel. A click on the card
// opens the pane in Screen; Enter and Backspace answer a focused card.
// Ended: one chip.

import { Check, Clock, Monitor, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HandoffCard as HandoffCardModel } from "@/feed/reducer";
import { foldsIntoRequest } from "@/lib/status";
import { cn } from "@/lib/utils";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { useServer } from "@/state/server";
import { Chip } from "./Chip";
import { clockTime } from "./format";

const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

export function HandoffCard({ card }: { card: HandoffCardModel }) {
  const { send } = useServer();
  const [feed, dispatch] = useFeed();
  const { setPaneMode, setPaneOpen } = useSelection();
  const active = card.outcome === null;
  const job = feed.jobs[card.jobId];
  const request = job !== undefined && job.request.length > 0 && foldsIntoRequest(job, feed) ? job.request : null;

  const openScreen = (): void => {
    setPaneMode("screen");
    setPaneOpen(true);
  };
  const done = (): void => {
    send({ type: C2S.HANDOFF_DONE, handoff_id: card.handoffId });
    dispatch({ kind: "handoffClosed" });
  };
  const cancel = (): void => {
    send({ type: C2S.HANDOFF_CANCEL, handoff_id: card.handoffId });
    dispatch({ kind: "handoffClosed" });
  };

  let chip = null;
  if (card.outcome === "done") chip = <Chip icon={<Check {...ICON} className="text-status-ok" />}>Done</Chip>;
  else if (card.outcome === "cancel") chip = <Chip icon={<X {...ICON} />}>Cancelled</Chip>;
  else if (card.outcome === "timeout") chip = <Chip icon={<Clock {...ICON} />}>Timed out</Chip>;

  return (
    <article
      data-kind="handoff"
      data-state={card.outcome ?? "active"}
      data-needs-you={active || undefined}
      data-job-id={card.jobId}
      tabIndex={0}
      onClick={active ? openScreen : undefined}
      onKeyDown={(e) => {
        if (!active || e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          done();
        } else if (e.key === "Backspace") {
          e.preventDefault();
          cancel();
        }
      }}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-xl border bg-card px-4 py-3 transition-[border-color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active && "cursor-pointer border-l-2 border-l-status-wait flat:border-l-transparent",
      )}
    >
      <div className="flex items-center gap-2">
        <Monitor {...ICON} className={cn("shrink-0", active ? "text-status-wait" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 text-sm break-words">{card.reason}</span>
        <time
          dateTime={new Date(card.at).toISOString()}
          className="shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity md:opacity-0 md:group-hover:opacity-100"
        >
          {clockTime(card.at)}
        </time>
      </div>
      {request ? <p className="pl-6 text-[13px] leading-[18px] break-words text-muted-foreground">{request}</p> : null}
      {active ? (
        <div className="flex gap-2 pt-1 max-md:flex-col">
          <Button
            className="h-9 max-md:w-full"
            onClick={(e) => {
              e.stopPropagation();
              done();
            }}
          >
            Done
          </Button>
          <Button
            variant="outline"
            className="h-9 max-md:w-full"
            onClick={(e) => {
              e.stopPropagation();
              cancel();
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        chip
      )}
    </article>
  );
}
