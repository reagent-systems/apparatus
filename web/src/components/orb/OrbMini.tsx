// The inline orb: the 20 px preset in the ink opposite the page, from the
// resolved app theme like the big orb. Job rows and card headers show
// `working` while the job runs; the product mark in the rail shows
// `breathing`, paused.

import { ThinkingOrb } from "thinking-orbs";
import { useTheme } from "@/components/theme/ThemeProvider";
import { orbRender, type OrbState } from "@/orb-state";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

export type OrbMiniProps = {
  state: OrbState;
  /** Freeze the frame (the product mark). */
  paused?: boolean;
  className?: string;
};

export function OrbMini({ state, paused = false, className }: OrbMiniProps) {
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const render = orbRender({ state, held: true, live: true, reducedMotion });
  return (
    <ThinkingOrb
      state={render.animation}
      size={20}
      theme={resolved}
      speed={render.speed}
      paused={paused || render.paused}
      aria-hidden="true"
      data-state={state}
      className={cn("inline-block size-5 shrink-0 align-middle", className)}
    />
  );
}
