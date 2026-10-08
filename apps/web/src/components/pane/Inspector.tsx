// The pane (DESIGN.md 2): a 40 px header with the Output / Screen toggle and
// an X, then the body. Output shows the selected job's inspector, or the
// latest `show` with no job selected. Screen shows the VM frame, in handoff
// mode while a handoff runs; the handoff locks the pane in Screen, and while
// it does the Output item and the X are gone, not disabled.

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScreenFrame } from "@/components/vm/ScreenFrame";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { JobInspector } from "./JobInspector";
import { ShowOutput } from "./ShowOutput";

export function Inspector() {
  const [feed] = useFeed();
  const { paneMode, setPaneMode, setPaneOpen, paneLocked, selectedJobId } = useSelection();
  const job = selectedJobId ? feed.jobs[selectedJobId] : undefined;
  const handoffId = feed.handoff?.handoffId ?? null;

  let body;
  if (paneMode === "screen") {
    body = (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ScreenFrame mode={handoffId ? "handoff" : "watch"} handoffId={handoffId} />
      </div>
    );
  } else if (job) {
    body = <JobInspector key={job.jobId} jobId={job.jobId} />;
  } else {
    body = (
      <ScrollArea className="min-h-0 flex-1">
        <ShowOutput markdown={feed.show} />
      </ScrollArea>
    );
  }

  return (
    <section data-slot="inspector" data-mode={paneMode} data-locked={paneLocked || undefined} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        {paneLocked ? (
          <span className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-[13px] font-medium text-accent-foreground">Screen</span>
        ) : (
          <ToggleGroup
            type="single"
            size="sm"
            value={paneMode}
            onValueChange={(v) => {
              if (v === "output" || v === "screen") setPaneMode(v);
            }}
          >
            <ToggleGroupItem value="output" className="h-7 text-[13px]">
              Output
            </ToggleGroupItem>
            <ToggleGroupItem value="screen" className="h-7 text-[13px]">
              Screen
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {paneLocked ? null : (
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setPaneOpen(false)}>
            <X size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        )}
      </div>
      {body}
    </section>
  );
}
