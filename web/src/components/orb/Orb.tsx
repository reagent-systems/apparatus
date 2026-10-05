// The orb: a button over the thinking-orbs canvas, and the only voice
// control. The mapping from the voice state to the animation is
// `src/orb-state.ts`; the gesture is `use-orb-control.ts`. The 20 px inline
// orb is `OrbMini.tsx`.
//
// A filled disc with the 64 px preset pinned to its dark theme, so the dots
// are always light on a dark disc. The box is fixed and the canvas is scaled
// inside it, so the layout never moves with the transform (DESIGN.md 3).

import { ThinkingOrb } from "thinking-orbs";
import { orbRender, type OrbState } from "@/orb-state";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";
import type { OrbControl } from "./use-orb-control";

export type { OrbState } from "@/orb-state";

export type OrbSize = 48 | 56 | 128;

export type OrbProps = {
  state: OrbState;
  /** This device holds the voice session. */
  held: boolean;
  /** A Live session is open. */
  live: boolean;
  /** Tap and hold, from `useOrbControl`. */
  control: OrbControl;
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

export function Orb({ state, held, live, control, size = 48, className }: OrbProps) {
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
      data-pressed={control.pressed || undefined}
      aria-pressed={live}
      {...control.handlers}
      className={cn(
        "flex shrink-0 touch-none items-center justify-center overflow-hidden rounded-full bg-orb-disc outline-none select-none [-webkit-touch-callout:none]",
        "transition-[opacity,transform,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "dark:ring-1 dark:ring-orb-ring",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        BOX[size],
        render.dimmed && "opacity-40",
        control.pressed && "scale-[.97] ring-2 ring-primary ring-offset-2 ring-offset-background dark:ring-2 dark:ring-primary flat:not-focus-visible:ring-transparent",
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
