// The large pane: the latest `show` markdown or the VM screen. A toggle at
// the top switches between Screen and Output; a handoff forces Screen.

import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VmScreen } from "@/components/vm/VmScreen";
import { cn } from "@/lib/utils";
import { ShowOutput } from "./ShowOutput";

export type PaneMode = "screen" | "output";

export type PaneProps = {
  mode: PaneMode;
  onMode: (mode: PaneMode) => void;
  /** An active handoff; the screen shows in handoff mode. */
  handoffId: string | null;
  onDone: () => void;
  onCancel: () => void;
  /** The output when no `view` is given. */
  markdown: string | null;
  /** A view that replaces the output: the audit list or the credits. */
  view?: ReactNode;
  className?: string;
};

export function Pane({ mode, onMode, handoffId, onDone, onCancel, markdown, view, className }: PaneProps) {
  const screen = handoffId !== null || mode === "screen";
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card", className)}>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={screen ? "screen" : "output"}
          onValueChange={(v) => {
            if (v === "screen" || v === "output") onMode(v);
          }}
        >
          <ToggleGroupItem value="screen">Screen</ToggleGroupItem>
          <ToggleGroupItem value="output" disabled={handoffId !== null}>
            Output
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {screen ? (
        <div className="min-h-0 flex-1">
          <VmScreen mode={handoffId ? "handoff" : "watch"} handoffId={handoffId} onDone={onDone} onCancel={onCancel} />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">{view ?? <ShowOutput markdown={markdown} />}</ScrollArea>
      )}
    </section>
  );
}
