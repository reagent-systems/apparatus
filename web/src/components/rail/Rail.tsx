// The rail (DESIGN.md 2): a 40 px drag strip with the product mark, five
// nav rows, the NEEDS YOU / RUNNING / RECENT job groups and the footer.
// Desktop: shadcn `Sidebar collapsible="icon"` at 248 px, 56 px when
// collapsed. Tablet: the icon rail, fixed. Phone: the same column inside
// the left sheet that `AppShell` opens from the top bar.

import { PanelLeft } from "lucide-react";
import { OrbMini } from "@/components/orb/OrbMini";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useSelection } from "@/state/selection";
import { RailFooter } from "./RailFooter";
import { RailGroups } from "./RailJobRow";
import { RailNav } from "./RailNav";
import { ICON, RailContext, useRail } from "./rail-context";

/** The 40 px drag strip. Collapsed, the mark alone: the thread header holds the toggle then. */
function RailStrip({ onToggle }: { onToggle: (() => void) | null }) {
  const { collapsed } = useRail();
  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 px-3 [.tauri-mac_&]:pl-[76px]",
        collapsed && "justify-center px-0 [.tauri-mac_&]:pl-0",
      )}
    >
      <OrbMini state="idle" paused className="shrink-0" />
      {collapsed ? null : <span className="flex-1 truncate text-sm font-medium">apparatus</span>}
      {onToggle && !collapsed ? (
        <Button variant="ghost" size="icon-sm" aria-label="Rail" onClick={onToggle}>
          <PanelLeft {...ICON} />
        </Button>
      ) : null}
    </div>
  );
}

function RailBody({ onToggle }: { onToggle: (() => void) | null }) {
  return (
    <>
      <SidebarHeader className="gap-0 p-0">
        <RailStrip onToggle={onToggle} />
      </SidebarHeader>
      <SidebarContent className="gap-0 px-2 pb-2">
        <RailNav />
        <RailGroups />
      </SidebarContent>
      <SidebarFooter className="p-0">
        <RailFooter />
      </SidebarFooter>
    </>
  );
}

/** The rail column inside the shadcn Sidebar; reads the collapsed state from it. */
function RailSidebar({ statusBar }: { statusBar: boolean }) {
  const { state, toggleSidebar } = useSidebar();
  const breakpoint = useBreakpoint();
  const collapsed = state === "collapsed";
  return (
    <RailContext.Provider value={{ collapsed, sheet: false, close: () => undefined }}>
      <Sidebar
        collapsible="icon"
        className={cn("border-r border-sidebar-border", statusBar && "h-[calc(100svh-1.5rem)]")}
      >
        <RailBody onToggle={breakpoint === "desktop" ? toggleSidebar : null} />
      </Sidebar>
    </RailContext.Provider>
  );
}

export function Rail() {
  const breakpoint = useBreakpoint();
  const { statusBar, setRailOpen } = useSelection();
  if (breakpoint === "phone") {
    return (
      <RailContext.Provider value={{ collapsed: false, sheet: true, close: () => setRailOpen(false) }}>
        <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
          <RailBody onToggle={() => setRailOpen(false)} />
        </div>
      </RailContext.Provider>
    );
  }
  return <RailSidebar statusBar={breakpoint === "desktop" && statusBar} />;
}
