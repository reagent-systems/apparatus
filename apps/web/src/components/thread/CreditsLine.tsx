// No card: one centered line with the coin and the number. Amber at low,
// red at out.

import { Coins } from "lucide-react";
import type { CreditsCard } from "@/feed/reducer";
import { cn } from "@/lib/utils";

export function CreditsLine({ card }: { card: CreditsCard }) {
  return (
    <div
      data-kind="credits"
      data-state={card.state}
      className={cn(
        "flex items-center justify-center gap-1 text-xs text-muted-foreground tabular-nums",
        card.state === "low" && "text-status-wait",
        card.state === "out" && "text-destructive",
      )}
    >
      <Coins size={16} strokeWidth={1.5} aria-hidden="true" />
      <span>{card.balance}</span>
    </div>
  );
}
