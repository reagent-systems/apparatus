import type { APIRoute, GetStaticPaths } from "astro";
import { ORB_ANIMATIONS, orbSvg, type Ink } from "../../lib/orb-svg.ts";

// One file per orb state and ink: /orb/<animation>-<ink>.<hash>.svg.
export const getStaticPaths: GetStaticPaths = () =>
  ORB_ANIMATIONS.flatMap((animation) =>
    (["light", "dark"] as Ink[]).map((ink) => {
      const { path, svg } = orbSvg(animation, ink);
      return { params: { file: path.slice("/orb/".length) }, props: { svg } };
    }),
  );

export const GET: APIRoute = ({ props }) =>
  new Response(props.svg as string, { headers: { "Content-Type": "image/svg+xml" } });
