// One job in the pane (DESIGN.md 5): a header with the glyph, the request
// and the start time, then three tabs. Receipt: the say line, the full show
// markdown and the artifact paths. Steps: every progress line with a 2 px bar
// beneath; a job that waits on you ends on an amber row with the action or
// the reason. Artifacts: the paths alone. Until the user picks a tab, the tab
// follows the job: Steps while it runs, Receipt once it ends.

import { useEffect, useRef, useState } from "react";
import { Check, Dot, Hand, MousePointerClick } from "lucide-react";
import { OrbMini } from "@/components/orb/OrbMini";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isJobActive, type FeedState, type JobEntry } from "@/feed/reducer";
import { useNow } from "@/hooks/use-now";
import { bucketOf, glyphOf, sameDay, shortDate } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { ShowOutput } from "./ShowOutput";

type Tab = "receipt" | "steps" | "artifacts";

const COPIED_MS = 1500;

function startLabel(ms: number, now: number): string {
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay(ms, now) ? time : `${shortDate(ms)} ${time}`;
}

/** The artifact paths in mono; a click copies one and shows a check for 1.5 s. */
function PathList({ paths }: { paths: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  if (paths.length === 0) return null;
  const copy = (path: string): void => {
    if (!navigator.clipboard) return;
    void navigator.clipboard
      .writeText(path)
      .then(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        setCopied(path);
        timer.current = setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => undefined);
  };
  return (
    <ul data-slot="paths" className="flex flex-col gap-0.5">
      {paths.map((path) => (
        <li key={path}>
          <button
            type="button"
            data-path={path}
            data-copied={copied === path || undefined}
            onClick={() => copy(path)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-[13px] leading-5 transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="min-w-0 flex-1 break-all">{path}</span>
            <span className="flex size-4 shrink-0 items-center justify-center">
              {copied === path ? <Check size={14} strokeWidth={1.5} aria-hidden className="text-status-ok" /> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const ROW = "flex items-start gap-2 py-0.5 text-[13px] leading-[18px]";

/** What the job waits on: the open approval's action or the open handoff's reason. */
function waitingOn(job: JobEntry, feed: FeedState): { kind: "approval" | "handoff"; text: string } | null {
  if (bucketOf(job, feed) !== "needs_you") return null;
  const approval = Object.values(feed.approvals).find((a) => a.jobId === job.jobId && a.approved === null);
  if (approval) return { kind: "approval", text: approval.action };
  const handoff = Object.values(feed.handoffs).find((h) => h.jobId === job.jobId && h.outcome === null);
  if (handoff) return { kind: "handoff", text: handoff.reason };
  return { kind: "approval", text: job.progress };
}

function Steps({ job, feed }: { job: JobEntry; feed: FeedState }) {
  const running = isJobActive(job.status);
  const wait = waitingOn(job, feed);
  const live = wait === null && running && job.progress.length > 0 ? job.progress : null;
  const last = job.progressHistory[job.progressHistory.length - 1];
  const past = live !== null && last === live ? job.progressHistory.slice(0, -1) : job.progressHistory;
  const known = job.percent !== null && Number.isFinite(job.percent);
  // Unknown progress on a live or waiting job draws the track alone: a full bar would read as finished.
  const width = running || wait !== null ? (known ? Math.max(0, Math.min(100, job.percent ?? 0)) : 0) : 100;
  const WaitIcon = wait?.kind === "handoff" ? MousePointerClick : Hand;
  return (
    <div data-slot="steps" data-waiting={wait !== null || undefined} className="flex flex-col gap-3">
      <div className="flex flex-col">
        {past.map((text, i) => (
          <div key={`${i}-${text}`} className={ROW}>
            <Dot size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">{text}</span>
          </div>
        ))}
        {wait !== null && wait.text.length > 0 ? (
          <div data-slot="step-wait" className={ROW}>
            <WaitIcon size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-status-wait" />
            <span className="min-w-0 break-words">{wait.text}</span>
          </div>
        ) : null}
        {live !== null ? (
          <div className={ROW}>
            <OrbMini state="working" className="mt-[-1px] size-[18px]" />
            <span className="min-w-0 break-words">{live}</span>
          </div>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={running && known ? width : undefined}
        className="h-0.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
            job.status === "failed"
              ? "bg-destructive"
              : wait !== null
                ? "bg-status-wait"
                : running
                  ? "bg-primary"
                  : "bg-muted-foreground/40",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function JobInspector({ jobId }: { jobId: string }) {
  const [feed] = useFeed();
  const now = useNow();
  const [picked, setPicked] = useState<Tab | null>(null);
  const job = feed.jobs[jobId];
  if (!job) return null;

  const running = isJobActive(job.status);
  const tab: Tab = picked ?? (running ? "steps" : "receipt");
  const trigger = "h-7 flex-none px-3 text-[13px] font-medium";

  return (
    <div data-slot="job-inspector" data-job-id={jobId} data-state={job.status} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 pt-4 pb-3">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <StatusGlyph glyph={glyphOf(job, feed)} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.request || jobId}</span>
        {job.startedAt !== null ? (
          <time dateTime={new Date(job.startedAt).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {startLabel(job.startedAt, now)}
          </time>
        ) : null}
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v === "receipt" || v === "steps" || v === "artifacts") setPicked(v);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 px-6 pb-3">
          <TabsList className="h-8">
            <TabsTrigger value="receipt" className={trigger}>
              Receipt
            </TabsTrigger>
            <TabsTrigger value="steps" className={trigger}>
              Steps
            </TabsTrigger>
            <TabsTrigger value="artifacts" className={trigger}>
              Artifacts
            </TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="receipt" className="flex flex-col gap-4 px-6 pb-6">
            {job.say.length > 0 ? <p className="text-[15px] leading-6 break-words">{job.say}</p> : null}
            {job.show ? <ShowOutput markdown={job.show} className="p-0" /> : null}
            <PathList paths={job.artifacts} />
          </TabsContent>
          <TabsContent value="steps" className="px-6 pb-6">
            <Steps job={job} feed={feed} />
          </TabsContent>
          <TabsContent value="artifacts" className="px-6 pb-6">
            <PathList paths={job.artifacts} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
