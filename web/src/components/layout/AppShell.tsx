// The responsive frame from the sketches.
//   desktop (>= 1024): sidebar | pane | feed column
//   tablet (768..1023): pane | feed column
//   phone (< 768): the feed column; the pane opens as a full-screen sheet

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { Breakpoint } from "@/hooks/use-breakpoint";

export type AppShellProps = {
  breakpoint: Breakpoint;
  sidebar: ReactNode;
  pane: ReactNode;
  feed: ReactNode;
  /** Phone only: the pane shows full screen while true. */
  sheetOpen: boolean;
  /** Phone only: a handoff is active, so only Done and Cancel close the sheet. */
  sheetLocked: boolean;
  onSheetClose: () => void;
};

export function AppShell({ breakpoint, sidebar, pane, feed, sheetOpen, sheetLocked, onSheetClose }: AppShellProps) {
  if (breakpoint === "phone") {
    return (
      <div className="flex h-full flex-col">
        {feed}
        <Sheet
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open) onSheetClose();
          }}
        >
          <SheetContent side="bottom" className="h-full gap-0 p-0" showCloseButton={!sheetLocked}>
            <SheetTitle className="sr-only">the pane</SheetTitle>
            <div className="flex h-full flex-col p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">{pane}</div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }
  if (breakpoint === "tablet") {
    return (
      <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] gap-3 p-3">
        {pane}
        <div className="flex min-h-0 flex-col rounded-xl border bg-card/40">{feed}</div>
      </div>
    );
  }
  return (
    <SidebarProvider className="min-h-0 h-full">
      <div className="grid h-full w-full grid-cols-[16rem_minmax(0,1fr)_minmax(320px,24rem)]">
        {sidebar}
        <div className="flex min-h-0 flex-col p-3">{pane}</div>
        <div className="flex min-h-0 flex-col border-l">{feed}</div>
      </div>
    </SidebarProvider>
  );
}
