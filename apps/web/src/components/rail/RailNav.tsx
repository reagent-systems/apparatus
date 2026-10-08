// The five nav rows: Thread, Jobs (count chip), Screen (holder dot), Audit,
// Credits (balance). `h-8 px-2 rounded-[6px] text-sm`, the selected row on
// `bg-sidebar-accent` with no border. The selected row follows the column
// view; Screen is selected only where it is its own surface (the tablet and
// phone sheet). Collapsed: the icon with its chip or dot at the corner, and
// the Credits balance as a dot.

import type { ComponentType, ReactNode } from "react";
import { Coins, ListChecks, MessageSquare, Monitor, ScrollText } from "lucide-react";
import { CountChip } from "@/components/status/CountChip";
import { bucketOf } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useScreenStore } from "@/state/screen";
import { useSelection, type View } from "@/state/selection";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { ICON, useRail } from "./rail-context";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }>;

export function NavRow({
  icon: Icon,
  label,
  selected,
  cue = false,
  trailing,
  onClick,
}: {
  icon: IconType;
  label: string;
  selected: boolean;
  /** The surface shows in the pane: the icon takes the accent ink, no fill. */
  cue?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  const { collapsed } = useRail();
  return (
    <button
      type="button"
      aria-label={collapsed ? label : undefined}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex h-8 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-sm outline-none transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
        collapsed && "mx-auto w-10 justify-center px-0",
      )}
    >
      <Icon {...ICON} className={cue && !selected ? "text-sidebar-accent-foreground" : undefined} />
      {collapsed ? null : <span className="flex-1 truncate text-left">{label}</span>}
      {trailing ? (
        <span className={cn("flex shrink-0 items-center", collapsed && "absolute -top-0.5 -right-0.5 scale-75")}>{trailing}</span>
      ) : null}
    </button>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 rounded-full", className)} />;
}

export function RailNav() {
  const [feed] = useFeed();
  const { view, setView, paneOpen, paneMode } = useSelection();
  const screen = useScreenStore();
  const credits = feed.credits;
  const { close, collapsed } = useRail();
  const desktop = useBreakpoint() === "desktop";

  let needsYou = 0;
  let running = 0;
  for (const job of Object.values(feed.jobs)) {
    const bucket = bucketOf(job, feed);
    if (bucket === "needs_you") needsYou += 1;
    else if (bucket === "running") running += 1;
  }

  const handoff = feed.handoff !== null;
  const screenShown = paneOpen && paneMode === "screen";
  const go = (v: View) => () => {
    setView(v);
    close();
  };
  const current = (v: View): boolean => (v === "screen" ? screenShown && !desktop : v === view && !(screenShown && !desktop));

  let screenDot: ReactNode = null;
  if (screen.controlledByMe) screenDot = <Dot className="bg-primary" />;
  else if (handoff) screenDot = <Dot className="bg-status-wait" />;
  else if (screen.status !== "closed") screenDot = <Dot className="bg-muted-foreground" />;

  return (
    <nav className="flex flex-col gap-0.5 pt-1">
      <NavRow icon={MessageSquare} label="Thread" selected={current("thread")} onClick={go("thread")} />
      <NavRow
        icon={ListChecks}
        label="Jobs"
        selected={current("jobs")}
        trailing={<CountChip count={needsYou + running} onSelected={current("jobs")} />}
        onClick={go("jobs")}
      />
      <NavRow
        icon={Monitor}
        label="Screen"
        selected={current("screen")}
        cue={screenShown && desktop}
        trailing={screenDot}
        onClick={go("screen")}
      />
      <NavRow icon={ScrollText} label="Audit" selected={current("audit")} onClick={go("audit")} />
      <NavRow
        icon={Coins}
        label="Credits"
        selected={current("credits")}
        trailing={
          credits === null ? null : collapsed ? (
            credits.state === "ok" ? null : (
              <Dot className={credits.state === "low" ? "bg-status-wait" : "bg-destructive"} />
            )
          ) : (
            <span
              className={cn(
                "text-xs tabular-nums",
                credits.state === "low" && "text-status-wait",
                credits.state === "out" && "text-destructive",
                credits.state === "ok" && "text-muted-foreground",
              )}
            >
              {credits.balance}
            </span>
          )
        }
        onClick={go("credits")}
      />
    </nav>
  );
}
