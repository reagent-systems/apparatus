// A job row in the rail (DESIGN.md 5): `h-9 px-2 rounded-[6px] text-sm
// gap-2`, the glyph in a fixed 16 px slot, the request truncated, the
// percent while running or the relative time at the right. `RailGroups`
// lists them under NEEDS YOU, RUNNING and RECENT; an empty group is absent,
// and the collapsed rail shows none.

import { StatusGlyph } from "@/components/status/StatusGlyph";
import { useNow } from "@/hooks/use-now";
import { bucketOf, glyphOf, relativeTime, type Bucket } from "@/lib/status";
import { cn } from "@/lib/utils";
import { recentJobs, runningJobs, type JobEntry } from "@/feed/reducer";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { RailGroupLabel, useRail } from "./rail-context";

const RECENT_LIMIT = 20;

function jobTime(job: JobEntry): number | null {
  return job.endedAt ?? job.startedAt;
}

export function RailJobRow({ jobId }: { jobId: string }) {
  const [feed] = useFeed();
  const { selectedJobId, selectJob } = useSelection();
  const { close } = useRail();
  const now = useNow();
  const job = feed.jobs[jobId];
  if (!job) return null;
  const bucket = bucketOf(job, feed);
  const time = jobTime(job);
  let meta = "";
  if (bucket === "running") meta = job.percent === null ? "" : `${Math.round(job.percent)}%`;
  else if (time !== null) meta = relativeTime(time, now);
  const selected = selectedJobId === jobId;
  return (
    <button
      type="button"
      data-job={jobId}
      data-bucket={bucket}
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        selectJob(jobId);
        close();
      }}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-sm outline-none transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        selected ? "bg-sidebar-accent/50 text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/40",
      )}
    >
      <StatusGlyph glyph={glyphOf(job, feed)} />
      <span className="flex-1 truncate text-left">{job.request || jobId}</span>
      {meta ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span> : null}
    </button>
  );
}

function Group({ label, jobs }: { label: string; jobs: JobEntry[] }) {
  if (jobs.length === 0) return null;
  return (
    <section aria-label={label}>
      <RailGroupLabel>{label}</RailGroupLabel>
      <div className="flex flex-col gap-0.5">
        {jobs.map((job) => (
          <RailJobRow key={job.jobId} jobId={job.jobId} />
        ))}
      </div>
    </section>
  );
}

export function RailGroups() {
  const [feed] = useFeed();
  const { collapsed } = useRail();
  if (collapsed) return null;
  const active = runningJobs(feed);
  const ended = recentJobs(feed);
  const of = (jobs: JobEntry[], bucket: Bucket): JobEntry[] => jobs.filter((j) => bucketOf(j, feed) === bucket);
  // Oldest first: the one that waited longest is at the top.
  const needsYou = [...of(active, "needs_you"), ...of(ended, "needs_you")].reverse();
  const running = of(active, "running");
  const recent = [...of(ended, "done"), ...of(ended, "failed"), ...of(active, "done"), ...of(active, "failed")]
    .sort((a, b) => (jobTime(b) ?? 0) - (jobTime(a) ?? 0))
    .slice(0, RECENT_LIMIT);
  return (
    <div className="flex flex-col">
      <Group label="Needs you" jobs={needsYou} />
      <Group label="Running" jobs={running} />
      <Group label="Recent" jobs={recent} />
    </div>
  );
}
