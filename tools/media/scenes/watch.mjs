// watch.gif and watch-dark.gif: the Wear OS app itself, rendered over time by
// Paparazzi (wear/MediaWatchTest.kt): no call (breathing), a tap starts the
// call, listening, speaking, working, a tap hangs up, breathing again. The
// GIF ends on the frame before the breathing frame closest to the first, so
// the loop has no cut and no blend. No text and no buttons: the app has none.
// The round screen sits on the README's page colour (light, and dark for
// GitHub's dark mode) through an antialiased mask, so every frame is opaque,
// the edge is smooth, and only what changes is rewritten. The moving dots
// change most of the disc in every frame, so bayer dither or a smaller
// palette saves little (a bayer encode came out larger).

import fs from "node:fs";
import path from "node:path";
import { PALETTE } from "../lib/compose.mjs";
import { encodeChecked } from "../lib/gifscene.mjs";
import { mkdirp } from "../lib/util.mjs";
import { renderWatchCall, roundOn, trimToLoop } from "../lib/wear.mjs";

/** MediaWatchTest.CALL: the hang-up. */
const HANG_UP_MS = 3500;

export default {
  name: "watch",
  kind: "gif",
  makes: "watch.gif, watch-dark.gif: the Wear OS screen through a voice session (Paparazzi, needs the Android SDK and Gradle)",
  async run(ctx) {
    const frames = await renderWatchCall(path.join(ctx.work, "watch"));
    // The loop ends between 4 and 5 s, on the breathing frame closest to frame 0.
    const loop = await trimToLoop(frames, HANG_UP_MS + 500, 5000);
    const made = [];
    for (const theme of ["light", "dark"]) {
      const dir = mkdirp(path.join(ctx.work, "watch", `on-${theme}`));
      for (let k = 0; k < loop.count; k++) {
        const f = `frame-${String(k).padStart(4, "0")}.png`;
        await roundOn(path.join(frames.dir, f), path.join(dir, f), PALETTE[theme].hex);
      }
      const out = path.join(ctx.out, theme === "dark" ? "watch-dark.gif" : "watch.gif");
      made.push({ ...(await encodeChecked({ input: path.join(dir, "frame-%04d.png"), fps: frames.fps, out, width: null })), loopRmse: loop.rmse });
      if (!ctx.keepFrames) fs.rmSync(dir, { recursive: true, force: true });
    }
    return made;
  },
};
