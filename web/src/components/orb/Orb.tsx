// The orb: a button over the thinking-orbs canvas. The mapping from the voice
// state to the animation is `src/orb-state.ts`.

import { useSyncExternalStore } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { orbRender, type OrbState } from "@/orb-state";
import { cn } from "@/lib/utils";

export type { OrbState } from "@/orb-state";

export type OrbProps = {
  state: OrbState;
  /** This device holds the voice session. */
  held: boolean;
  /** A Live session is open. */
  live: boolean;
  onClick: () => void;
};

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED).matches;
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

export function Orb({ state, held, live, onClick }: OrbProps) {
  const reducedMotion = useReducedMotion();
  const render = orbRender({ state, held, live, reducedMotion });
  return (
    <button
      type="button"
      aria-label="Talk"
      data-state={state}
      data-held={held}
      data-live={live}
      onClick={onClick}
      className={cn(
        // The sketches draw a dark sphere with light dots: a filled disc with the
        // 64 px preset pinned to its dark theme. Scaled 2x on a phone and 1.5x on
        // a desktop inside a fixed box, so the layout never moves with the transform.
        "flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-950 shadow-md transition-opacity outline-none select-none lg:size-24",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        render.dimmed && "opacity-40",
      )}
    >
      <ThinkingOrb
        state={render.animation}
        size={64}
        theme="dark"
        speed={render.speed}
        paused={render.paused}
        aria-hidden="true"
        className="scale-200 lg:scale-150"
      />
    </button>
  );
}

/** The inline orb for a job row: the 20 px preset, `working` while the job runs. */
export function OrbMini({ state }: { state: OrbState }) {
  const reducedMotion = useReducedMotion();
  const render = orbRender({ state, held: true, live: true, reducedMotion });
  return (
    <ThinkingOrb
      state={render.animation}
      size={20}
      theme="auto"
      speed={render.speed}
      paused={render.paused}
      aria-hidden="true"
      className="inline-block shrink-0 align-middle"
    />
  );
}
