// A one-word chip with a glyph: the answered state of a card.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Chip({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1 rounded-full bg-muted px-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
