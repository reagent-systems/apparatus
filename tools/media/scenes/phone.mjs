// phone.gif: the voice-to-job story at 390 px, in the hero's phone bezel, on
// the README's page colour. The first frame is the poster: the finished
// thread, held 1 s; then the empty thread, the tap, the request, the job and
// its steps, and the result, which ends on the poster frame, so the loop has
// no cut. Every frame is opaque, so the encoder rewrites only what changed.

import fs from "node:fs";
import path from "node:path";
import { parkPointer, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { GIF_HEARD_MS, GIF_MIC, GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { PALETTE } from "../lib/compose.mjs";
import { dropFrames, encodeChecked, posterHold, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { run, sleep } from "../lib/util.mjs";

/** 390 x 844 at 1.2x: about 470 px wide with the bezel, shown at about 300 px. */
const PHONE_GIF = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.2, hasTouch: true };

/** The hero's bezel around each frame: 10 px of near-black, 48 px outer corners, the page colour outside. */
async function bezel(file, scale, backdrop) {
  const pad = Math.round(10 * scale);
  const inner = Math.round(38 * scale);
  const outer = inner + pad;
  const [w, h] = (await run("identify", ["-format", "%w %h", file])).trim().split(" ").map(Number);
  const W = w + 2 * pad;
  const H = h + 2 * pad;
  await run("convert", [
    "-size", `${W}x${H}`, "xc:none",
    "-fill", "#0d0d0c", "-draw", `roundrectangle 0,0 ${W - 1},${H - 1} ${outer},${outer}`,
    "(", file, "(", "-size", `${w}x${h}`, "xc:none", "-fill", "white", "-draw", `roundrectangle 0,0 ${w - 1},${h - 1} ${inner},${inner}`, ")", "-compose", "CopyOpacity", "-composite", ")",
    "-geometry", `+${pad}+${pad}`, "-compose", "over", "-composite",
    "-background", backdrop, "-flatten", `PNG24:${file}`,
  ]);
}

export default {
  name: "phone",
  kind: "gif",
  makes: "phone.gif: tap, speak, job, result at 390 px, in a phone bezel",
  async run(ctx) {
    return withApp(ctx, { name: "phone", device: PHONE_GIF, mic: GIF_MIC, paceJobsMs: 600 }, async (app) => {
      const { page, live } = app;
      await primeSwitch(app);
      const rec = await record(app, ctx, { fps: 10 });
      await sleep(1200);
      await tapOrb(app, { big: true });
      rec.marks.start = (await live.activity("activityStart", live.turnCursor, 20_000)).at - 900;
      await live.user(LINES.ordersAsk, { ms: GIF_HEARD_MS });
      const { job_id } = await live.agent(LINES.ordersAck, { tool: { name: "start_job", args: { request: LINES.ordersJob } }, ms: 850 });
      await speakResult(app, job_id, { wps: GIF_WPS });
      await sleep(1000);
      rec.mark("end");
      const frames = await rec.stop({ from: "start", to: "end" });
      frames.count = posterHold(rec.dir, frames.count, frames.fps);
      for (let k = 0; k < frames.count; k++) await bezel(path.join(rec.dir, `frame-${String(k).padStart(5, "0")}.png`), frames.scale, PALETTE.light.hex);
      const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, "phone.gif"), width: null, dither: "bayer" });
      dropFrames(rec, ctx);
      if (!fs.existsSync(gif.file)) throw new Error("phone.gif was not written");
      return [gif];
    });
  },
};
