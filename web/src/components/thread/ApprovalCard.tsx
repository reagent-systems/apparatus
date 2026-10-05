// An approval in the thread: the action, then the literal details in mono,
// Approve and Deny. When the job has shown nothing yet its card folds into
// this one, which then carries the request as its title. Enter and
// Backspace answer a focused card. Answered: the amber bar goes and the
// buttons become one chip.

import { Check, Hand, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalCard as ApprovalCardModel } from "@/feed/reducer";
import { foldsIntoRequest } from "@/lib/status";
import { cn } from "@/lib/utils";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useServer } from "@/state/server";
import { Chip } from "./Chip";
import { clockTime } from "./format";

const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

export function ApprovalCard({ card }: { card: ApprovalCardModel }) {
  const { send } = useServer();
  const [feed] = useFeed();
  const job = card.jobId ? feed.jobs[card.jobId] : undefined;
  // Folded: the job's own card is not shown, so this card carries its request.
  const folded = job !== undefined && job.request.length > 0 && foldsIntoRequest(job, feed);
  const title = folded ? job.request : card.action;
  const literal = folded ? [card.action, card.details].filter((t) => t.length > 0).join("\n") : card.details;
  const pending = card.approved === null;
  const answer = (approved: boolean): void => {
    send({ type: C2S.APPROVAL_ANSWER, approval_id: card.approvalId, approved });
  };
  return (
    <article
      data-kind="approval"
      data-state={pending ? "pending" : card.approved ? "approved" : "denied"}
      data-needs-you={pending || undefined}
      data-job-id={card.jobId}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!pending || e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          answer(true);
        } else if (e.key === "Backspace") {
          e.preventDefault();
          answer(false);
        }
      }}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-xl border bg-card px-4 py-3 transition-[border-color,opacity] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        pending && "border-l-2 border-l-status-wait",
        card.approved === false && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <Hand {...ICON} className={cn("shrink-0", pending ? "text-status-wait" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <time
          dateTime={new Date(card.at).toISOString()}
          className="shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity md:opacity-0 md:group-hover:opacity-100"
        >
          {clockTime(card.at)}
        </time>
      </div>
      {literal.length > 0 ? (
        <p className="font-mono text-sm break-all whitespace-pre-wrap text-muted-foreground">{literal}</p>
      ) : null}
      {pending ? (
        <div className="flex gap-2 pt-1 max-md:flex-col">
          <Button className="h-9 max-md:w-full" onClick={() => answer(true)}>
            Approve
          </Button>
          <Button variant="outline" className="h-9 max-md:w-full" onClick={() => answer(false)}>
            Deny
          </Button>
        </div>
      ) : card.approved ? (
        <Chip icon={<Check {...ICON} className="text-status-ok" />}>Approved</Chip>
      ) : (
        <Chip icon={<X {...ICON} />}>Denied</Chip>
      )}
    </article>
  );
}
