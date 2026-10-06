// orb.gif and orb-dark.gif: a square close-up centred on the phone
// composer's orb (56 px at 3x) through one exchange: idle (the agent off), a
// tap, listening while the composer shows what the model heard ("Check the
// orders.") above the orb, the short answer, working while the job runs,
// speaking its result, a tap, idle. Borders off, so the composer draws no
// line around the orb. The composer is docked to the bottom of the window,
// so the square runs past the window's bottom edge: that strip is the page
// colour, added as composition.
//
// The loop starts and ends on idle. Both themes run the same script; the
// loop for each is the span of real frames, from a frame in the opening idle
// to the frame before one in the closing idle that matches it, and the two
// spans have the same length, so the GIFs have equal frame counts.

import fs from "node:fs";
import path from "node:path";
import { orb, parkPointer, primeSwitch, tapOrb } from "../lib/browser.mjs";
import { GIF_WPS, LINES, speakResult } from "../lib/day.mjs";
import { listFrames, resequence, rmse } from "../lib/frames.mjs";
import { encodeChecked, pageColour, record } from "../lib/gifscene.mjs";
import { withApp } from "../lib/scene.mjs";
import { log, run, sleep } from "../lib/util.mjs";

/** CSS px: the square's side; the heard line fits above the orb with a margin. */
const SIDE = 150;
const FPS = 15;
const ORB_GIF = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true };
/** A short request: the turn opens 0.25 s after the tap and lasts 1.6 s. */
const ORB_MIC = [[250, 1850]];
/** The agent speaks the result a little faster than the other GIFs, so the speaking state lasts about 2 s. */
const RESULT_WPS = 5.5;

async function shoot(ctx, theme) {
  return withApp(ctx, { name: `orb-${theme}`, device: ORB_GIF, theme, borders: "off", mic: ORB_MIC, paceJobsMs: 400 }, async (app) => {
    const { page, live } = app;
    await primeSwitch(app);
    const b = await orb(page).boundingBox();
    const vp = page.viewportSize();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const top = Math.round(cy - SIDE / 2);
    const height = Math.min(SIDE, vp.height - top);
    const clip = { x: Math.round(cx - SIDE / 2), y: top, width: SIDE, height };
    const rec = await record(app, ctx, { fps: FPS, clip });
    await sleep(300);
    rec.mark("start");
    await sleep(1500); // idle: the agent is off, the orb breathes slowly
    await tapOrb(app);
    await parkPointer(page);
    await live.user(LINES.orbAsk, { ms: 900 });
    const { job_id } = await live.agent(LINES.orbAck, { tool: { name: "start_job", args: { request: LINES.orbJob } }, ms: 700 });
    await speakResult(app, job_id, { wps: RESULT_WPS });
    await tapOrb(app); // off: idle
    await parkPointer(page);
    await sleep(2200);
    rec.mark("end");
    const frames = await rec.stop({ from: "start", to: "end" });
    // The strip under the window's bottom edge, in the page colour.
    const side = Math.round(SIDE * frames.scale);
    const bg = await pageColour(rec.dir);
    await run("sh", ["-c", `mogrify -background '${bg}' -gravity north -extent ${side}x${side} '${rec.dir}'/frame-*.png`]);
    log(`orb-${theme}: ${frames.count} frames, ${b.width} px orb, ${SIDE - height} px of page added below`);
    return { theme, dir: rec.dir, rec, fps: frames.fps };
  });
}

/** For each loop length, the best start in the opening idle and its seam error against the closing idle. */
async function seams(dir, fps) {
  const list = listFrames(dir);
  const starts = Math.round(0.6 * fps);
  const tail = Math.round(1.9 * fps);
  const best = new Map();
  for (let s = 0; s < starts; s++) {
    for (let e = list.length - tail; e < list.length; e++) {
      const err = await rmse(list[e], list[s]);
      const n = e - s;
      if (!best.has(n) || err < best.get(n).err) best.set(n, { s, err });
    }
  }
  return { list, best };
}

export default {
  name: "orb",
  kind: "gif",
  makes: "orb.gif, orb-dark.gif: the orb close: idle, listening with the heard line, working, speaking, idle",
  async run(ctx) {
    const shots = [await shoot(ctx, "light"), await shoot(ctx, "dark")];
    const found = [];
    for (const s of shots) found.push(await seams(s.dir, s.fps));
    // One loop length for both: the smallest worst seam.
    let pick = null;
    for (const [n, a] of found[0].best) {
      const b = found[1].best.get(n);
      if (!b) continue;
      const worst = Math.max(a.err, b.err);
      if (!pick || worst < pick.worst) pick = { n, worst, starts: [a.s, b.s], errs: [a.err, b.err] };
    }
    if (!pick) throw new Error("orb: the two recordings share no loop length");
    log(`orb: loop of ${pick.n} frames (${(pick.n / FPS).toFixed(2)} s), seam RMSE light ${pick.errs[0].toFixed(4)}, dark ${pick.errs[1].toFixed(4)}`);
    const made = [];
    for (const [i, s] of shots.entries()) {
      const start = pick.starts[i];
      resequence(s.dir, found[i].list.slice(start, start + pick.n));
      const out = path.join(ctx.out, s.theme === "dark" ? "orb-dark.gif" : "orb.gif");
      made.push({ ...(await encodeChecked({ input: path.join(s.dir, "frame-%05d.png"), fps: s.fps, out, width: null, dither: "bayer", bayerScale: 3 })), seamRmse: pick.errs[i] });
      if (!ctx.keepFrames) fs.rmSync(s.dir, { recursive: true, force: true });
    }
    return made;
  },
};
