// "Today", else the date, centered between the days.

import { sameDay, shortDate } from "@/lib/status";

export function DayDivider({ at, now }: { at: number; now: number }) {
  return (
    <div
      data-kind="day"
      className="text-center text-xs tracking-[0.08em] text-muted-foreground uppercase tabular-nums"
    >
      {sameDay(at, now) ? "Today" : shortDate(at)}
    </div>
  );
}
