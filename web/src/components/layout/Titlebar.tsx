// The strip over the thread column. Desktop and tablet: 40 px, a Tauri drag
// region, the rail toggle at the left while the rail is collapsed and the
// pane toggle at the right. Phone: 48 px under the safe area, `PanelLeft`
// opens the rail sheet and `Monitor` opens the Screen; icons at 20 px.
// Under a Tauri window on macOS the shell marks <html> with `.tauri-mac`
// and the rail strip takes the 76 px overlay inset.

import { useEffect } from "react";
import { Monitor, PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { hasOverlayTitlebar } from "@/hooks/use-platform";
import { useSelection } from "@/state/selection";

const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;
const PHONE_ICON = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;

function RailToggle() {
  const { state, toggleSidebar } = useSidebar();
  if (state !== "collapsed") return null;
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Rail" onClick={toggleSidebar}>
      <PanelLeft {...ICON} />
    </Button>
  );
}

export function Titlebar() {
  const breakpoint = useBreakpoint();
  const { paneOpen, setPaneOpen, paneLocked, setRailOpen, setView } = useSelection();

  useEffect(() => {
    if (hasOverlayTitlebar()) document.documentElement.classList.add("tauri-mac");
  }, []);

  if (breakpoint === "phone") {
    return (
      <header className="flex shrink-0 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex h-12 items-center justify-between px-2">
          <Button variant="ghost" size="icon" aria-label="Rail" onClick={() => setRailOpen(true)}>
            <PanelLeft {...PHONE_ICON} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Screen" onClick={() => setView("screen")}>
            <Monitor {...PHONE_ICON} />
          </Button>
        </div>
      </header>
    );
  }

  return (
    <header data-tauri-drag-region className="flex h-10 shrink-0 items-center justify-between px-2">
      <div className="flex items-center">{breakpoint === "desktop" ? <RailToggle /> : null}</div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Pane"
        aria-pressed={paneOpen}
        disabled={paneLocked && paneOpen}
        onClick={() => setPaneOpen(!paneOpen)}
      >
        <PanelRight {...ICON} />
      </Button>
    </header>
  );
}
