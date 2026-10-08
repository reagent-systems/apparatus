import type { APIRoute } from "astro";
import { markDots } from "../lib/mark.ts";

// The mark in black ink, white when the browser chrome is dark.
export const GET: APIRoute = () => {
  const circles = markDots()
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill-opacity="${d.o}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>g{fill:#1d1b18}@media (prefers-color-scheme:dark){g{fill:#f3f1ec}}</style><g>${circles}</g></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
};
