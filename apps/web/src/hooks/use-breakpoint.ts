// Breakpoints from the sketches: phone < 768, tablet 768..1023, desktop >= 1024.

import { useSyncExternalStore } from "react";

export const BREAKPOINTS = { tablet: 768, desktop: 1024 } as const;

export type Breakpoint = "phone" | "tablet" | "desktop";

export function currentBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "phone";
}

/** `hello.device` sends `tablet` for a phone platform at tablet width or more. */
export function isTabletWidth(): boolean {
  return window.innerWidth >= BREAKPOINTS.tablet;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, () => currentBreakpoint(window.innerWidth));
}
