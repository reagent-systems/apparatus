// The orb's drawing, no React and no DOM: thinking-orbs' own engine
// (`resolvePreset`, `MODE_FRAMES`, `paintFrame`) drawn into a context scaled
// to the real size. `ThinkingOrb` sizes its backing store from its preset
// (64 or 20) × DPR, so any CSS scale on it resamples a bitmap. Here the
// vectors are drawn at the displayed size instead. Tested in
// `test/orb-paint.test.ts` of this package.

import { scaleRadii, type ModeFrame, type ModeOpts } from "thinking-orbs";
import { MODE_FRAMES, paintFrame, resolvePreset } from "thinking-orbs/engine";

/** The thinking-orbs animations the orb draws. apps/web maps the voice state onto them (`src/orb-state.ts`). */
export type OrbAnimation = "breathing" | "connecting" | "listening" | "composing" | "working";

/** The library's tuned presets this app draws: 64 for the orb, 20 inline. */
export type OrbPreset = 64 | 20;

/** The library draws reduced motion as the static frame at this raw t. */
export const REDUCED_MOTION_T = 0.6;

/** The library caps the backing store at DPR 2. */
export const MAX_DPR = 2;

export type OrbGeometry = {
  preset: OrbPreset;
  /** The preset's baked speed. */
  speed: number;
  opts: ModeOpts;
  frame: ModeFrame;
};

/** The preset for one state, with `dotSize` applied the way `ThinkingOrb` applies it. */
export function orbGeometry(state: OrbAnimation, preset: OrbPreset, dotSize = 1): OrbGeometry {
  const { mode, speed, opts } = resolvePreset(state, preset);
  return {
    preset,
    speed,
    opts: dotSize !== 1 ? scaleRadii(opts, Math.max(0.1, dotSize)) : opts,
    frame: MODE_FRAMES[mode],
  };
}

/**
 * Animation time from the shared clock, as `ThinkingOrb` maps it: every
 * orb reads the same `now`, so two orbs at the same state and speed match.
 */
export function orbTime(nowMs: number, presetSpeed: number, speed: number): number {
  return (nowMs / 1000) * presetSpeed * speed;
}

export type OrbScale = {
  /** Backing store width and height in device pixels. */
  pixels: number;
  /** Context scale from preset units to device pixels. */
  scale: number;
};

/** The backing store for `size` CSS px, and the scale that draws the preset into it. */
export function orbScale(size: number, preset: OrbPreset, devicePixelRatio: number): OrbScale {
  const dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
  return { pixels: Math.round(size * dpr), scale: (size / preset) * dpr };
}

/** The 2D context calls the painter makes. */
export type OrbContext = Pick<
  CanvasRenderingContext2D,
  "setTransform" | "clearRect" | "beginPath" | "arc" | "fill" | "moveTo" | "lineTo" | "stroke"
> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  lineWidth: number;
};

/** Clear and draw one frame at `t` in preset units, scaled by `scale`. */
export function drawOrb(ctx: OrbContext, geometry: OrbGeometry, t: number, dark: boolean, scale: number): void {
  const { preset, opts, frame } = geometry;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, preset, preset);
  paintFrame(ctx as CanvasRenderingContext2D, frame(preset, t, opts), dark);
}
