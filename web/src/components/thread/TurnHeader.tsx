// The first agent card after a user card: the inline orb, a hairline and the
// finish time (Quick's logo + rule + meta). `working` while any job runs on
// the newest header; older headers hold a still frame.

import { OrbMini } from "@/components/orb/OrbMini";
import { clockTime } from "./format";

export type TurnHeaderProps = {
  /** The finish time of the turn's last card. */
  at: number;
  working: boolean;
  /** An older turn: the orb holds its frame. */
  still?: boolean;
};

export function TurnHeader({ at, working, still = false }: TurnHeaderProps) {
  return (
    <div data-kind="turn" data-state={working ? "working" : "idle"} className="group flex items-center gap-3">
      <OrbMini state={working ? "working" : "idle"} paused={still} />
      <div className="flex-1 border-t" />
      <time
        dateTime={new Date(at).toISOString()}
        className="text-xs text-muted-foreground tabular-nums transition-opacity md:opacity-0 md:group-hover:opacity-100"
      >
        {clockTime(at)}
      </time>
    </div>
  );
}
