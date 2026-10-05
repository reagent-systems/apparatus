// Quick's activity card: the last 3 progress lines behind a dot, the live
// line behind the working orb. Once the job ends it folds to "N steps".

import { useState } from "react";
import { ChevronRight, Dot } from "lucide-react";
import { OrbMini } from "@/components/orb/OrbMini";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type ActivitySlabProps = {
  history: string[];
  /** The live progress line while the job runs. */
  live: string;
  running: boolean;
};

const ROW = "flex items-start gap-2 py-0.5 text-[13px] leading-[18px]";

function Row({ text }: { text: string }) {
  return (
    <div className={ROW}>
      <Dot size={14} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

export function ActivitySlab({ history, live, running }: ActivitySlabProps) {
  const [open, setOpen] = useState(false);
  if (running) {
    const past = live.length > 0 && history[history.length - 1] === live ? history.slice(0, -1) : history;
    const rows = past.slice(-3);
    if (rows.length === 0 && live.length === 0) return null;
    return (
      <div data-slot="activity" data-activity="running" className="mx-4 mb-3 rounded-lg bg-muted/60 px-3 py-2">
        {rows.map((text, i) => (
          <Row key={`${i}-${text}`} text={text} />
        ))}
        {live.length > 0 ? (
          <div className={ROW}>
            <OrbMini state="working" className="mt-[-1px] size-[18px]" />
            <span className="min-w-0 break-words">{live}</span>
          </div>
        ) : null}
      </div>
    );
  }
  if (history.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="activity" data-activity="ended" className="mx-4 mb-3 rounded-lg bg-muted/60 px-3 py-2">
      <CollapsibleTrigger
        className={`${ROW} w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&[data-state=open]_svg]:rotate-90`}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-muted-foreground transition-transform duration-150"
        />
        <span className="tabular-nums">{history.length === 1 ? "1 step" : `${history.length} steps`}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {history.map((text, i) => (
          <Row key={`${i}-${text}`} text={text} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
