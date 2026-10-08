// The count chip on a nav row (Cowork's pill): `h-5 min-w-5 rounded-full
// bg-accent text-accent-foreground text-[11px] tabular-nums`. Nothing at zero.

import { cn } from "@/lib/utils";

export type CountChipProps = {
  count: number;
  /** On a selected row the accent fill would vanish into the row's own. */
  onSelected?: boolean;
  className?: string;
};

export function CountChip({ count, onSelected = false, className }: CountChipProps) {
  if (count <= 0) return null;
  return (
    <span
      data-count={count}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-medium text-accent-foreground tabular-nums",
        onSelected ? "bg-background" : "bg-accent",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
