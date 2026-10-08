// A 16 px ring, stroke 2, in `--primary`: the arc is the percent, or a 90°
// arc turning at 1.2 s while the percent is unknown (DESIGN.md 4).

import { cn } from "@/lib/utils";

export type ProgressRingProps = {
  /** 0..100, or null while unknown. */
  percent: number | null;
  className?: string;
};

const SIZE = 16;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function ProgressRing({ percent, className }: ProgressRingProps) {
  const known = percent !== null && Number.isFinite(percent);
  const p = known ? Math.max(0, Math.min(100, percent)) : 25;
  const dash = (p / 100) * C;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? p : undefined}
      data-percent={known ? p : "null"}
      className={cn("shrink-0 text-primary", !known && "animate-spin [animation-duration:1.2s]", className)}
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={STROKE} />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${C - dash}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        className={cn(known && "transition-[stroke-dasharray] duration-300")}
      />
    </svg>
  );
}
