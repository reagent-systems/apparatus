// The thinking-orbs canvas, drawn at its real size. `ThinkingOrb` renders
// only at its preset size (64 or 20 CSS px), so a 48, 56 or 128 px orb was a
// CSS-scaled bitmap: grey dots at 48, soft dashes at 128. This canvas keeps
// the library's preset, frames, painter and depth ink (`orb-paint.ts`) and
// sizes its backing store from `size` × DPR (capped at 2).
//
// The library's behaviour, kept: `paused` holds the current frame, reduced
// motion draws the static frame at raw t = 0.6, the loop stops off-screen
// and while the tab is hidden. One clock drives every orb (`orb-clock.ts`).
// The ink comes from `theme` on the first frame, never from the OS.

import { useEffect, useMemo, useRef, type CanvasHTMLAttributes, type CSSProperties } from "react";
import { orbClock } from "./orb-clock.ts";
import { REDUCED_MOTION_T, drawOrb, orbGeometry, orbScale, orbTime, type OrbAnimation, type OrbPreset } from "./orb-paint.ts";
import { useReducedMotion } from "./use-reduced-motion.ts";

export type OrbCanvasProps = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "style"> & {
  state: OrbAnimation;
  /** The library preset to draw: 64 for the orb, 20 inline. */
  preset: OrbPreset;
  /** The displayed size in CSS px. */
  size: number;
  /** The page: light draws black ink, dark draws white ink. */
  theme: "light" | "dark";
  /** Multiplier on the preset's baked speed. */
  speed?: number;
  /** Hold the current frame. */
  paused?: boolean;
  /** Radius multiplier for every dot, as `ThinkingOrb`'s `dotSize`. */
  dotSize?: number;
  style?: CSSProperties;
};

export function OrbCanvas({
  state,
  preset,
  size,
  theme,
  speed = 1,
  paused = false,
  dotSize = 1,
  style,
  ...rest
}: OrbCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lastT = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const dark = theme === "dark";
  const geometry = useMemo(() => orbGeometry(state, preset, dotSize), [state, preset, dotSize]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { pixels, scale } = orbScale(size, preset, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let alive = true;
    const draw = (t: number) => {
      if (!alive) return;
      lastT.current = t;
      drawOrb(ctx, geometry, t, dark, scale);
    };
    const at = (nowMs: number) => orbTime(nowMs, geometry.speed, speed);

    if (reduced) {
      draw(REDUCED_MOTION_T);
      return () => {
        alive = false;
      };
    }
    if (paused) {
      draw(lastT.current ?? at(performance.now()));
      return () => {
        alive = false;
      };
    }

    draw(at(performance.now()));
    let unsubscribe: (() => void) | null = null;
    const start = () => {
      if (!unsubscribe) unsubscribe = orbClock.subscribe((nowMs) => draw(at(nowMs)));
    };
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
    };

    let visible = true;
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            visible = entries[entries.length - 1]?.isIntersecting ?? visible;
            if (visible && document.visibilityState !== "hidden") start();
            else stop();
          })
        : null;
    io?.observe(canvas);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!io) start();

    return () => {
      alive = false;
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [geometry, preset, size, dark, speed, paused, reduced]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block", ...style }} {...rest} />;
}
