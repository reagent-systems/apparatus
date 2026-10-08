// One glyph per job state, 16 px, no words (DESIGN.md 5). `running` is the
// 20 px orb drawn into the same 16 px slot, so a title never shifts when a
// spinner replaces an icon.

import type { ReactNode } from "react";
import { CircleCheck, CircleMinus, CircleX, Clock, Hand, MousePointerClick, Pause } from "lucide-react";
import { OrbMini } from "@/components/orb/OrbMini";
import type { Glyph } from "@/lib/status";
import { cn } from "@/lib/utils";

export type StatusGlyphProps = {
  glyph: Glyph;
  className?: string;
};

const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

export function StatusGlyph({ glyph, className }: StatusGlyphProps) {
  let inner: ReactNode;
  switch (glyph.kind) {
    case "running":
      inner = <OrbMini state="working" className="scale-[.8]" />;
      break;
    case "queued":
      inner = <Clock {...ICON} className="text-muted-foreground" />;
      break;
    case "paused":
      inner = <Pause {...ICON} className="text-muted-foreground" />;
      break;
    case "approval":
      inner = <Hand {...ICON} className="text-status-wait" />;
      break;
    case "handoff":
      inner = <MousePointerClick {...ICON} className="text-status-wait" />;
      break;
    case "done":
      inner = <CircleCheck {...ICON} className="text-status-ok" />;
      break;
    case "failed":
      inner = <CircleX {...ICON} className="text-destructive" />;
      break;
    case "cancelled":
      inner = <CircleMinus {...ICON} className="text-muted-foreground" />;
      break;
  }
  return (
    <span
      data-glyph={glyph.kind}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center overflow-visible", className)}
    >
      {inner}
    </span>
  );
}
