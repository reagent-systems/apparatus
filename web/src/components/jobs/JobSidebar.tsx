// The left column: running jobs, recent jobs, then Audit and Credits.

import { Fragment } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import type { JobEntry } from "@/feed/reducer";

export type SidebarSelection = { kind: "live" } | { kind: "job"; jobId: string } | { kind: "audit" } | { kind: "credits" };

export type JobSidebarProps = {
  running: JobEntry[];
  recent: JobEntry[];
  selected: SidebarSelection;
  onSelect: (selection: SidebarSelection) => void;
};

function JobGroup({ jobs, selected, onSelect }: { jobs: JobEntry[]; selected: SidebarSelection; onSelect: (s: SidebarSelection) => void }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {jobs.map((job) => (
            <SidebarMenuItem key={job.jobId}>
              <SidebarMenuButton
                isActive={selected.kind === "job" && selected.jobId === job.jobId}
                onClick={() => onSelect({ kind: "job", jobId: job.jobId })}
              >
                <span className="truncate">{job.request || job.jobId}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function JobSidebar({ running, recent, selected, onSelect }: JobSidebarProps) {
  const groups = [running, recent].filter((g) => g.length > 0);
  return (
    <Sidebar collapsible="none" className="h-full border-r">
      <SidebarContent>
        {groups.map((jobs, i) => (
          <Fragment key={i}>
            {i > 0 ? <Separator /> : null}
            <JobGroup jobs={jobs} selected={selected} onSelect={onSelect} />
          </Fragment>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <Separator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={selected.kind === "audit"} onClick={() => onSelect({ kind: "audit" })}>
              Audit
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={selected.kind === "credits"} onClick={() => onSelect({ kind: "credits" })}>
              Credits
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
