// watch-strip.png: the Wear OS app's states side by side, round, from the
// same Paparazzi render as watch.gif: no call, listening, speaking, working.
// Nothing but the screens on a transparent strip.

import path from "node:path";
import { run } from "../lib/util.mjs";
import { frameAt, renderWatchCall, roundMask } from "../lib/wear.mjs";

/** Mid-points of the states in MediaWatchTest.CALL. */
const AT = [400, 1250, 2150, 3050];
const GAP = 48;

export default {
  name: "watch-strip",
  kind: "still",
  makes: "watch-strip.png: no call, listening, speaking, working, round",
  async run(ctx) {
    const work = path.join(ctx.work, "watch-strip");
    const frames = await renderWatchCall(work);
    const rounds = [];
    for (const [i, ms] of AT.entries()) rounds.push(await roundMask(frameAt(frames, ms), path.join(work, `round-${i}.png`)));
    const out = path.join(ctx.out, "watch-strip.png");
    const args = [];
    rounds.forEach((r, i) => {
      if (i > 0) args.push("(", "-size", `${GAP}x1`, "xc:none", ")");
      args.push(r);
    });
    await run("convert", ["-background", "none", ...args, "-gravity", "center", "+append", "+repage", out]);
    return [out];
  },
};
