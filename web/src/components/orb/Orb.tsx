// The orb: the agent's on-switch, a button over the thinking-orbs canvas and
// the only voice control. The mapping from the voice state to the animation
// is `src/orb-state.ts`; the tap is `use-orb-control.ts`. The 20 px inline
// orb is `OrbMini.tsx`.
//
// No disc, no ring, no shadow: only the dots, in the ink opposite the page
// (black in light mode, white in dark), from the resolved app theme. Only
// the circle takes the pointer: `clip-path` cuts the square's corners out of
// the hit region, so the focus ring is drawn inset to stay inside it.
// `OrbCanvas` draws the 64 preset at the box's own size, so no transform
// resamples it and the layout never moves (DESIGN.md 3).

import { useTheme } from "@/components/theme/ThemeProvider";
import { orbRender, type OrbState } from "@/orb-state";
import { cn } from "@/lib/utils";
import { OrbCanvas } from "./OrbCanvas";
import { useReducedMotion } from "./use-reduced-motion";
import type { OrbControl } from "./use-orb-control";

export type { OrbState } from "@/orb-state";

export type OrbSize = 48 | 56 | 128;

export type OrbProps = {
  state: OrbState;
  /** No other device holds the voice session. */
  held: boolean;
  /** A Live session is open. */
  live: boolean;
  /** The switch and its tap, from `useOrbControl`. */
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

// The 48 px orb draws the 64 preset at 3/4, which would shrink its dots
// below a device pixel on a DPR 1 screen and grey them. Dots 4/3 larger keep
// the preset's tuned dot size in CSS px (DESIGN.md 3).
const DOT_SIZE: Record<OrbSize, number> = {
  48: 4 / 3,
  56: 1,
  128: 1,
};

export function Orb({ state, held, live, control, size = 48, className }: OrbProps) {
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const render = orbRender({ state, held, live, reducedMotion });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={control.on}
      aria-label="Agent"
      data-state={state}
      data-held={held}
      data-live={live}
      data-on={control.on}
      data-size={size}
      {...control.handlers}
      className={cn(
        "flex shrink-0 touch-manipulation items-center justify-center overflow-hidden rounded-full outline-none select-none [clip-path:circle(50%)] [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]",
        "transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[.97]",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        BOX[size],
        render.dimmed && "opacity-40",
        className,
      )}
    >
      <OrbCanvas
        state={render.animation}
        preset={64}
        size={size}
        theme={resolved}
        speed={render.speed}
        paused={render.paused}
        dotSize={DOT_SIZE[size]}
        aria-hidden="true"
      />
    </button>
  );
}
