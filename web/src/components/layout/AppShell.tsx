// The frame of DESIGN.md 2.
//   desktop (>= 1024): rail | thread column | pane, in a ResizablePanelGroup
//                      (the pane width persists), the status bar beneath
//   tablet (768..1023): the 56 px icon rail; the pane as a right sheet at 60vw
//   phone (< 768):      the thread column under a 48 px top bar; the rail as a
//                       left sheet at 280 px; the pane as a full-height
//                       bottom sheet, locked while a handoff runs
// The composer docks under the column at the thread's width; the PiP floats
// bottom-right over the column, above the composer, on the desktop only.

import { useRef, type CSSProperties, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useSelection } from "@/state/selection";
import { panePercent, panePixels } from "@/state/selection-codec";
import { Titlebar } from "./Titlebar";

export type AppShellProps = {
  rail: ReactNode;
  main: ReactNode;
  pane: ReactNode;
  composer: ReactNode;
  statusBar: ReactNode;
  pip: ReactNode;
};

const RAIL_WIDTHS = { "--sidebar-width": "248px", "--sidebar-width-icon": "56px" } as CSSProperties;

/** The thread column: the view, the PiP over it, the composer under it. */
function Column({ main, composer, pip, phone }: { main: ReactNode; composer: ReactNode; pip: ReactNode; phone: boolean }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Titlebar />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {main}
        {pip ? <div className="pointer-events-none absolute right-6 bottom-3 z-10 [&>*]:pointer-events-auto">{pip}</div> : null}
      </div>
      <div className={cn("mx-auto w-full max-w-[760px]", phone ? "px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "px-6 pb-3")}>
        {composer}
      </div>
    </div>
  );
}

function PaneSheet({ side, className, children }: { side: "right" | "bottom"; className: string; children: ReactNode }) {
  const { paneOpen, setPaneOpen, paneLocked } = useSelection();
  return (
    <Sheet
      open={paneOpen}
      // On tablet the pane sits beside the thread: a handoff must not lock the rail or
      // the approvals behind an overlay. The phone sheet is the whole screen anyway.
      modal={side === "bottom"}
      onOpenChange={(open) => {
        if (!open) setPaneOpen(false);
      }}
    >
      <SheetContent
        side={side}
        data-locked={paneLocked}
        className={cn("gap-0 p-0", className)}
        showCloseButton={false}
        aria-describedby={undefined}
        tabIndex={-1}
        onOpenAutoFocus={(e) => {
          // Focus the sheet itself: a ring on the first toggle reads as a selection.
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (paneLocked) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          // Locked by a handoff, or the non-modal tablet pane: outside clicks reach the app.
          if (paneLocked || side === "right") e.preventDefault();
        }}
      >
        <SheetTitle className="sr-only">Pane</SheetTitle>
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function AppShell({ rail, main, pane, composer, statusBar, pip }: AppShellProps) {
  const breakpoint = useBreakpoint();
  const { railCollapsed, setRailCollapsed, railOpen, setRailOpen, paneOpen, paneWidth, setPaneWidth, loaded } = useSelection();
  const group = useRef<HTMLDivElement | null>(null);

  if (breakpoint === "phone") {
    return (
      <div className="flex h-full flex-col">
        <Column main={main} composer={composer} pip={null} phone />
        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetContent side="left" className="w-[280px] gap-0 p-0 sm:max-w-none" showCloseButton={false} aria-describedby={undefined}>
            <SheetTitle className="sr-only">Rail</SheetTitle>
            {rail}
          </SheetContent>
        </Sheet>
        <PaneSheet side="bottom" className="h-full pt-[env(safe-area-inset-top)]">
          {pane}
        </PaneSheet>
      </div>
    );
  }

  if (breakpoint === "tablet") {
    return (
      <SidebarProvider open={false} onOpenChange={() => undefined} style={RAIL_WIDTHS} className="h-full min-h-0">
        {rail}
        <Column main={main} composer={composer} pip={null} phone={false} />
        <PaneSheet side="right" className="w-[60vw] sm:max-w-none">
          {pane}
        </PaneSheet>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider
      open={!railCollapsed}
      onOpenChange={(open) => setRailCollapsed(!open)}
      style={RAIL_WIDTHS}
      className="h-full min-h-0 flex-col"
    >
      <div className="flex min-h-0 flex-1">
        {rail}
        <ResizablePanelGroup
          key={loaded ? "stored" : "default"}
          elementRef={group}
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
          onLayoutChanged={(layout) => {
            // The layout is percent of the group; the stored width is percent of the window.
            const share = layout.pane;
            const groupWidth = group.current?.getBoundingClientRect().width ?? 0;
            if (typeof share !== "number" || share <= 0 || groupWidth <= 0) return;
            const next = panePercent((share / 100) * groupWidth, window.innerWidth);
            if (next !== paneWidth) setPaneWidth(next);
          }}
        >
          <ResizablePanel id="main" minSize={400}>
            <Column main={main} composer={composer} pip={pip} phone={false} />
          </ResizablePanel>
          {paneOpen ? (
            <>
              <ResizableHandle className="transition-colors duration-150 hover:bg-ring/40" />
              <ResizablePanel id="pane" defaultSize={panePixels(paneWidth, window.innerWidth)} minSize={360} maxSize={640} className="min-w-[360px] max-w-[640px]">
                <div className="flex h-full min-h-0 flex-col border-l">{pane}</div>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
      {statusBar}
    </SidebarProvider>
  );
}
