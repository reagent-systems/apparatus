// The Jobs view (DESIGN.md 5): filter chips with counts, then the jobs in
// bucket order (Needs you, Failed, Running, Done), each group split by a
// Today / Earlier sub-divider. The chips show at zero; an empty group does
// not render.

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow } from "@/hooks/use-now";
import { BUCKET_LABEL, DAY_LABEL, FILTER_LABEL, JOB_FILTERS, groupJobs, isJobFilter, jobCounts, type JobFilter } from "@/lib/jobs-list";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { JobRow } from "./JobRow";

const GROUP_LABEL = "text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase";

export function JobsView() {
  const [feed] = useFeed();
  const now = useNow();
  const phone = useBreakpoint() === "phone";
  const [filter, setFilter] = useState<JobFilter>("all");
  const counts = jobCounts(feed);
  const groups = groupJobs(feed, filter, now);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div data-slot="jobs" data-filter={filter} className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-6 pt-6 pb-6", phone ? "px-4" : "px-6")}>
        <ToggleGroup
          type="single"
          spacing={2}
          value={filter}
          onValueChange={(v) => {
            if (isJobFilter(v)) setFilter(v);
          }}
          className="flex-wrap"
        >
          {JOB_FILTERS.map((f) => (
            <ToggleGroupItem
              key={f}
              value={f}
              data-filter={f}
              className="h-8 gap-1.5 rounded-full border px-3 text-[13px] font-normal hover:bg-muted hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            >
              {FILTER_LABEL[f]}
              <span className="tabular-nums opacity-70">{counts[f]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {groups.map((group) => (
          <section key={group.bucket} data-bucket={group.bucket} aria-label={BUCKET_LABEL[group.bucket]} className="flex flex-col gap-2">
            <h2 className={GROUP_LABEL}>{BUCKET_LABEL[group.bucket]}</h2>
            {group.sections.map((section) => (
              <div key={section.day} data-day={section.day} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-3 py-1">
                  <span className="text-xs text-muted-foreground">{DAY_LABEL[section.day]}</span>
                  <span aria-hidden className="flex-1 border-t" />
                </div>
                {section.jobs.map((job) => (
                  <JobRow key={job.jobId} jobId={job.jobId} />
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}
