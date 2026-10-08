// The orb renderer: thinking-orbs drawn at its real size on a canvas. apps/web
// wraps it in the voice switch (`src/components/orb/Orb.tsx`). apps/site uses only
// `./paint` and `./clock`, from a plain script, with no React on the page.
export { OrbCanvas, type OrbCanvasProps } from "./OrbCanvas.tsx";
export * from "./orb-paint.ts";
export { createOrbClock, orbClock, type FrameScheduler, type OrbClock, type OrbTick } from "./orb-clock.ts";
export { useReducedMotion } from "./use-reduced-motion.ts";
