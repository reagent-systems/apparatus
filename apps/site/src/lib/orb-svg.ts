// The orb's static frame as an SVG file, drawn at build time by @apparatus/orb's
// own painter: the frame reduced motion shows, in either ink. pages/orb/[file].ts
// writes each one under /orb with a hash of its bytes in the name, so vercel.json
// caches it for a year and the hero, the state sheet and the closing orb share
// one download per state and theme. Build time only: this module uses node:crypto.

import { createHash } from "node:crypto";
import { REDUCED_MOTION_T, drawOrb, orbGeometry, type OrbAnimation, type OrbContext } from "@apparatus/orb/paint";

export const ORB_ANIMATIONS: OrbAnimation[] = ["breathing", "listening", "composing", "working"];
export type Ink = "light" | "dark";

/** A 2D context that writes SVG: arcs become circles, lines become paths. */
function frame(animation: OrbAnimation, dark: boolean): string {
  const out: string[] = [];
  let arcs: string[] = [];
  let line = "";
  const n = (v: number) => +v.toFixed(2);
  // The painter's colours are rgba() with long alphas; 2 places are enough.
  const colour = (c: unknown) => String(c).replace(/\d*\.\d{3,}/g, (m) => String(+(+m).toFixed(2)));
  const ctx: OrbContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    setTransform: () => undefined,
    clearRect: () => undefined,
    beginPath: () => {
      arcs = [];
      line = "";
    },
    arc: (x: number, y: number, r: number) => {
      arcs.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"`);
    },
    moveTo: (x: number, y: number) => {
      line += `M${n(x)} ${n(y)}`;
    },
    lineTo: (x: number, y: number) => {
      line += `L${n(x)} ${n(y)}`;
    },
    fill: () => {
      for (const a of arcs) out.push(`${a} fill="${colour(ctx.fillStyle)}"/>`);
    },
    stroke: () => {
      if (line) out.push(`<path d="${line}" stroke="${colour(ctx.strokeStyle)}" stroke-width="${n(ctx.lineWidth)}" fill="none"/>`);
    },
  } as OrbContext;
  drawOrb(ctx, orbGeometry(animation, 64), REDUCED_MOTION_T, dark, 1);
  return out.join("");
}

const files = new Map<string, { path: string; svg: string }>();

/** The frame's SVG and its hashed path, e.g. /orb/listening-light.1a2b3c4d5e.svg. */
export function orbSvg(animation: OrbAnimation, ink: Ink): { path: string; svg: string } {
  const key = `${animation}-${ink}`;
  let file = files.get(key);
  if (!file) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${frame(animation, ink === "dark")}</svg>`;
    const hash = createHash("sha256").update(svg).digest("hex").slice(0, 10);
    file = { path: `/orb/${key}.${hash}.svg`, svg };
    files.set(key, file);
  }
  return file;
}
