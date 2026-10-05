// One row of the Jobs view (DESIGN.md 5): 56 px, a 28 px circle holding the
// glyph, the request, a 13 px muted subtitle, the relative time. A blocked
// row adds a 36 px action row, Approve + Deny or Done + Cancel, always
// visible. A click on the row opens the job in the pane. The selection tint
// covers the whole row, the action row included.

import { Button } from "@/components/ui/button";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { useNow } from "@/hooks/use-now";
import { blockerOf, jobSubtitle, jobTime } from "@/lib/jobs-list";
import { bucketOf, glyphOf, relativeTime } from "@/lib/status";
import { cn } from "@/lib/utils";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { useServer } from "@/state/server";

export function JobRow({ jobId }: { jobId: string }) {
  const [feed, dispatch] = useFeed();
  const { send } = useServer();
  const { selectedJobId, selectJob } = useSelection();
  const now = useNow();
  const job = feed.jobs[jobId];
  if (!job) return null;

  const bucket = bucketOf(job, feed);
  const blocker = blockerOf(feed, jobId);
  const subtitle = jobSubtitle(job, bucket, blocker);
  const time = jobTime(job);
  const selected = selectedJobId === jobId;

  const approve = (approved: boolean): void => {
    if (blocker?.kind !== "approval") return;
    send({ type: C2S.APPROVAL_ANSWER, approval_id: blocker.approvalId, approved });
  };
  const endHandoff = (done: boolean): void => {
    if (blocker?.kind !== "handoff") return;
    send({ type: done ? C2S.HANDOFF_DONE : C2S.HANDOFF_CANCEL, handoff_id: blocker.handoffId });
    dispatch({ kind: "handoffClosed" });
  };

  return (
    <div
      data-slot="job-row"
      data-job-id={jobId}
      data-bucket={bucket}
      data-state={job.status}
      data-selected={selected || undefined}
      className={cn("rounded-lg transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]", selected && "bg-accent/60")}
    >
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? "true" : undefined}
        onClick={() => selectJob(jobId)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectJob(jobId);
          }
        }}
        className={cn(
          "flex h-14 cursor-pointer items-center gap-3 rounded-lg px-2 outline-none transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:ring-2 focus-visible:ring-ring/40",
          !selected && "hover:bg-muted/60",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <StatusGlyph glyph={glyphOf(job, feed)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{job.request || jobId}</span>
          {subtitle ? <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{subtitle}</span> : null}
        </span>
        {time !== null ? (
          <time dateTime={new Date(time).toISOString()} className="shrink-0 self-start pt-2.5 text-xs text-muted-foreground tabular-nums">
            {relativeTime(time, now)}
          </time>
        ) : null}
      </div>
      {blocker ? (
        <div data-slot="job-actions" className="flex h-9 items-center gap-2 pl-12">
          {blocker.kind === "approval" ? (
            <>
              <Button size="sm" onClick={() => approve(true)}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => approve(false)}>
                Deny
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => endHandoff(true)}>
                Done
              </Button>
              <Button size="sm" variant="outline" onClick={() => endHandoff(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
