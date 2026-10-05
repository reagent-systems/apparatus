// The orb: a button over the thinking-orbs canvas. The mapping from the voice
// state to the animation is `src/orb-state.ts`. The 20 px inline orb is
// `OrbMini.tsx`.
//
// A filled disc with the 64 px preset pinned to its dark theme, so the dots
// are always light on a dark disc. The box is fixed and the canvas is scaled
// inside it, so the layout never moves with the transform (DESIGN.md 3).

import { ThinkingOrb } from "thinking-orbs";
import { orbRender, type OrbState } from "@/orb-state";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

export type { OrbState } from "@/orb-state";

export type OrbSize = 48 | 56 | 128;

export type OrbProps = {
  state: OrbState;
  /** This device holds the voice session. */
  held: boolean;
  /** A Live session is open. */
  live: boolean;
  onClick: () => void;
  /** 48 in the composer, 56 in the phone composer, 128 as the empty thread. */
  size?: OrbSize;
  className?: string;
};

const BOX: Record<OrbSize, string> = {
  48: "size-12",
  56: "size-14",
  128: "size-32",
};

const SCALE: Record<OrbSize, string> = {
  48: "scale-75",
  56: "scale-[.875]",
  128: "scale-200",
};

export function Orb({ state, held, live, onClick, size = 48, className }: OrbProps) {
  const reducedMotion = useReducedMotion();
  const render = orbRender({ state, held, live, reducedMotion });
  return (
    <button
      type="button"
      aria-label="Talk"
      data-state={state}
      data-held={held}
      data-live={live}
      data-size={size}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-orb-disc transition-opacity outline-none select-none",
        "dark:ring-1 dark:ring-orb-ring",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        BOX[size],
        render.dimmed && "opacity-40",
        className,
      )}
    >
      <ThinkingOrb
        state={render.animation}
        size={64}
        theme="dark"
        speed={render.speed}
        paused={render.paused}
        aria-hidden="true"
        className={SCALE[size]}
      />
    </button>
  );
}
