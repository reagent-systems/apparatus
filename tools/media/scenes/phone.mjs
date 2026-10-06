// phone.gif: the voice-to-job story at 390 px, in the hero's phone bezel, on
// the README's page colour, at 50 fps on page time like the desktop GIFs
// (lib/vtime.mjs). The first frames are the poster: the second of the
// finished thread after the story's end, recorded, then a fade through the
// page colour into the empty thread; the tap, the request, the job and its
// steps, and the result, which runs straight on into the poster, so the loop
// has no cut. Every frame is opaque, so the encoder rewrites only what changed.

import fs from "node:fs";
import path from "node:path";
import { heardShownAt, listenCut, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { GIF_HEARD_MS, GIF_MIC_HOLD, GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { PALETTE } from "../lib/compose.mjs";
import { dropFrames, editTime, encodeChecked, record, tailCount } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { log, run } from "../lib/util.mjs";

/** 390 x 844 at 1.2x: about 470 px wide with the bezel, shown at about 300 px. */
const PHONE_GIF = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.2, hasTouch: true };
const FPS = 50;

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
    return withApp(ctx, { name: "phone", device: PHONE_GIF, mic: GIF_MIC_HOLD, paceJobsMs: 600, vtime: FPS }, async (app) => {
      const { page, live, clock } = app;
      const sleep = (ms) => clock.sleep(ms);
      await primeSwitch(app);
      const rec = await record(app, ctx, { fps: FPS });
      await sleep(600);
      // The story opens 0.3 s before the tap: the idle orb, then the switch.
      rec.marks.start = clock.now() - 300;
      const tapAt = clock.now();
      const heard = heardShownAt(page);
      await tapOrb(app, { big: true });
      await live.user(LINES.ordersAsk, { ms: GIF_HEARD_MS });
      const heardAt = await heard;
      // On page time the wait for the first heard words is the app's own (under 1 s): kept whole
      // unless, with the 0.3 s before the tap, it passes 1.5 s.
      const cuts = listenCut(tapAt, heardAt);
      log(`phone: heard words ${heardAt - tapAt} ms after the tap; ${cuts.length ? `cut ${cuts[0][1] - cuts[0][0]} ms` : "no cut"}`);
      const { job_id } = await live.agent(LINES.ordersAck, { tool: { name: "start_job", args: { request: LINES.ordersJob } }, ms: 850 });
      await speakResult(app, job_id, { wps: GIF_WPS });
      await sleep(1000);
      rec.mark("end");
      // The poster: the next second of the finished thread, real frames.
      await sleep(1000);
      rec.mark("tail");
      const end = rec.marks.end;
      const frames = await rec.stop({ from: "start", to: "tail" });
      // The fade through the page colour: 17 + 1 + 17 frames, 0.7 s at 50 fps, a dissolve and not a blink.
      frames.count = await editTime(rec.dir, frames, { posterTail: tailCount(frames, end), posterFade: 17, cuts });
      for (let k = 0; k < frames.count; k++) await bezel(path.join(rec.dir, `frame-${String(k).padStart(5, "0")}.png`), frames.scale, PALETTE.light.hex);
      const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, "phone.gif"), width: null, dither: "bayer" });
      dropFrames(rec, ctx);
      if (!fs.existsSync(gif.file)) throw new Error("phone.gif was not written");
      return [gif];
    });
  },
};
