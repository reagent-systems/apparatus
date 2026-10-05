// One job: the glyph in a fixed 20 px slot, the request, the ring or the
// elapsed time; then the activity slab, the say line, the show markdown
// under a mask with the pane opener, and the artifact chips.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProgressRing } from "@/components/status/ProgressRing";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { Button } from "@/components/ui/button";
import { isJobActive, type FeedState } from "@/feed/reducer";
import { bucketOf, elapsedTime, glyphOf } from "@/lib/status";
import { renderMarkdown } from "@/markdown";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { ActivitySlab } from "./ActivitySlab";
import { basename, clockTime } from "./format";

export type JobCardProps = {
  jobId: string;
  at: number;
  /** The 2 s ring after a selection elsewhere. */
  highlighted?: boolean;
};

/**
 * The show markdown at `max-h-40`. The fade mask goes on only when the
 * content runs past the box, so a short output is never faded.
 */
function ShowPreview({ markdown, onOpen }: { markdown: string; onOpen: (e?: MouseEvent) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [markdown]);
  return (
    <div className="relative px-4 pb-3">
      <div
        ref={box}
        data-slot="show"
        data-clipped={clipped || undefined}
        className={cn(
          "show-output max-h-40 overflow-hidden pr-8 text-[15px] leading-[1.55] [&>:first-child]:mt-0",
          // Headings at prose size: the card title stays the largest line.
          "[&_h1]:mt-0 [&_h1]:text-[15px] [&_h2]:mt-0 [&_h2]:text-[15px] [&_h3]:mt-0 [&_h3]:text-[15px] [&_h4]:mt-0 [&_h4]:text-[15px]",
          clipped && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
        )}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Output"
        onClick={onOpen}
        className="absolute top-0 right-3 text-muted-foreground"
      >
        <ArrowUpRight strokeWidth={1.5} />
      </Button>
    </div>
  );
}

function jobState(feed: FeedState, jobId: string): string {
  return feed.jobs[jobId]?.status ?? "running";
}

export function JobCard({ jobId, at, highlighted = false }: JobCardProps) {
  const [feed] = useFeed();
  const { selectedJobId, selectJob } = useSelection();
  const job = feed.jobs[jobId];
  if (!job) return null;

  const running = isJobActive(job.status);
  // A job that waits on an approval or a handoff does not spin: the amber glyph says it.
  const working = running && bucketOf(job, feed) === "running";
  const glyph = glyphOf(job, feed);
  const elapsed = job.endedAt !== null && job.startedAt !== null ? elapsedTime(Math.max(1000, job.endedAt - job.startedAt)) : null;
  const selected = selectedJobId === jobId;

  // `selectJob` opens the pane in Output (a handoff's lock keeps it on Screen).
  const open = (e?: MouseEvent | KeyboardEvent): void => {
    e?.stopPropagation();
    selectJob(jobId);
  };

  return (
    <article
      data-kind="job"
      data-state={jobState(feed, jobId)}
      data-job-id={jobId}
      data-selected={selected || undefined}
      className={cn(
        "group w-full rounded-xl border bg-card transition-[box-shadow,opacity,border-color] duration-200",
        job.status === "failed" && "border-destructive/40",
        job.status === "cancelled" && "opacity-70",
        highlighted && "ring-2 ring-ring/40",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(e);
          }
        }}
        className="flex cursor-pointer items-center gap-3 rounded-t-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <StatusGlyph glyph={glyph} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.request}</span>
        <time
          dateTime={new Date(at).toISOString()}
          className={cn(
            "shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity md:opacity-0 md:group-hover:opacity-100",
            elapsed !== null && "max-md:hidden",
          )}
        >
          {clockTime(at)}
        </time>
        {running ? (
          working ? <ProgressRing percent={job.percent} /> : null
        ) : elapsed !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{elapsed}</span>
        ) : null}
      </div>

      <ActivitySlab history={job.progressHistory} live={job.progress} running={running} />

      {job.say.length > 0 ? <p className="px-4 pb-3 text-[15px] leading-[1.55] break-words">{job.say}</p> : null}

      {job.show ? <ShowPreview markdown={job.show} onOpen={open} /> : null}

      {job.artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {job.artifacts.map((path) => (
            <button
              key={path}
              type="button"
              data-path={path}
              onClick={open}
              className="cursor-pointer rounded-md bg-muted px-2 py-1 font-mono text-xs transition-colors duration-150 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {basename(path)}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
