// Shared tail of every GIF scene: stop the recorder at the marks, encode, clean up.

import fs from "node:fs";
import path from "node:path";
import { cleanBlends, fadeThroughFrames, listFrames, resequence } from "./frames.mjs";
import { crossfadeLoop, encodeGif } from "./gif.mjs";
import { PageTimeRecorder, Recorder } from "./record.mjs";
import { log, run } from "./util.mjs";

/** GIF budget from the brief: at most 8 MB a GIF, at most 1200 px wide. */
export const GIF_MAX_BYTES = 8 * 1024 * 1024;
export const GIF_MAX_WIDTH = 1200;

/**
 * On page time when the app has it (`withApp({ vtime })`): one frame per step
 * of the page's clock, at `fps`. Otherwise in wall time: screencast at 1x;
 * screenshots when the scene wants the context's scale factor (> 1) or a
 * `clip` (CSS px).
 */
export async function record(app, ctx, { fps = 12, clip = null } = {}) {
  if (app.vt) {
    app.vt.setFps(fps);
    const rec = new PageTimeRecorder(app.page, app.vt, path.join(app.work, "frames"), { clip });
    await rec.start();
    return rec;
  }
  const dpr = await app.page.evaluate(() => window.devicePixelRatio);
  const rec = new Recorder(app.page, path.join(app.work, "frames"), { fps, clip, via: dpr > 1 ? "screenshot" : "screencast" });
  await rec.start();
  return rec;
}

/**
 * `crop` (frame pixels) or `cssCrop` (CSS pixels) and `width` as in encodeGif; `loopFade` frames of
 * crossfade make the loop seamless. Edits in time, all of whole real frames:
 * - `cuts`: [fromMs, toMs] pairs (Date.now() times) whose frames are dropped,
 *   such as the half-repainted frames of a theme switch: a cut, not a blend.
 * - `endHoldMs`: the last frame held that long.
 * - `posterMs`: the GIF opens on the story's last frame, held that long, so
 *   the loop's end leads into a start that shows the same frame;
 *   `posterFade` frames then fade it through the page colour into the
 *   story's first frame, so a full thread never snaps to an empty one.
 * - `posterTail` (a mark after "end"): the poster is the real frames
 *   recorded from "end" to that mark, not a held frame, so the loop's end
 *   runs straight on into them; `posterFade` as above.
 * - `fadeThrough`: the end fades through the page colour into frame 0.
 * Frames are kept with --keep-frames.
 * A GIF over budget is reported, not hidden: the scene fails.
 */
export async function finish(rec, ctx, file, { width = GIF_MAX_WIDTH, crop = null, cssCrop = null, dither = "sierra2_4a", bayerScale = 5, maxColors = 256, loopFade = 0, fadeThrough = 0, posterMs = 0, posterFade = 0, posterTail = null, endHoldMs = 0, cuts = [], padTo = 0, padTop = 0 } = {}) {
  const end = rec.marks.end;
  const frames = await rec.stop({ from: "start", to: posterTail ?? "end" });
  const tail = posterTail ? tailCount(frames, end) : 0;
  if (padTo > 0) await padFrames(rec.dir, Math.round(padTo * frames.scale));
  if (padTop > 0) await padFramesTop(rec.dir, Math.round(padTop * frames.scale));
  frames.count = await editTime(rec.dir, frames, { cuts, endHoldMs, posterMs, posterFade, posterTail: tail, fadeThrough });
  if (cssCrop) {
    const k = frames.scale;
    crop = { x: Math.round(cssCrop.x * k), y: Math.round(cssCrop.y * k), w: Math.round(cssCrop.w * k), h: Math.round(cssCrop.h * k) };
  }
  if (loopFade > 0) await crossfadeLoop(rec.dir, { n: loopFade });
  const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, file), width, crop, dither, bayerScale, maxColors, raw: frames.raw });
  dropFrames(rec, ctx);
  return gif;
}

/** How many frames of a page-time recording lie after `end` (a page time): the poster tail. */
export function tailCount(frames, end) {
  if (!frames.times) throw new Error("posterTail needs a page-time recording");
  const n = frames.times.filter((t) => t > end).length;
  if (n < 1) throw new Error("posterTail: no frames after the end mark");
  return n;
}

/**
 * The time edits of `finish` on a stopped recording's frames. Returns the new count.
 * `posterTail` is a frame count: the last that many frames (real frames after
 * the story's end) move to the head as the poster.
 */
export async function editTime(dir, frames, { cuts = [], endHoldMs = 0, posterMs = 0, posterFade = 0, posterTail = 0, fadeThrough = 0 } = {}) {
  let list = listFrames(dir);
  const step = 1000 / frames.fps;
  // The tail is set aside first, so a cut never shifts what counts as the tail.
  const tail = posterTail > 0 ? list.splice(list.length - posterTail) : [];
  if (cuts.length) {
    const drop = new Set();
    for (const [a, b] of cuts) {
      for (let k = Math.floor((a - frames.start) / step); k <= Math.ceil((b - frames.start) / step); k++) drop.add(k);
    }
    list = list.filter((_, k) => !drop.has(k));
    log(`cut ${drop.size} frames`);
  }
  const last = list[list.length - 1];
  if (endHoldMs > 0) list.push(...Array(Math.round(endHoldMs / step)).fill(last));
  const bg = posterFade > 0 || fadeThrough > 0 ? await pageColour(dir) : null;
  if (tail.length) {
    const head = [...tail];
    if (posterFade > 0) head.push(...(await fadeThroughFrames(dir, tail[tail.length - 1], list[0], bg, posterFade)));
    list = [...head, ...list];
  } else if (posterMs > 0) {
    const head = Array(Math.round(posterMs / step)).fill(last);
    if (posterFade > 0) head.push(...(await fadeThroughFrames(dir, last, list[0], bg, posterFade)));
    list = [...head, ...list];
  }
  if (fadeThrough > 0) list.push(...(await fadeThroughFrames(dir, list[list.length - 1], list[0], bg, fadeThrough)));
  const n = resequence(dir, list);
  cleanBlends(dir);
  return n;
}

/**
 * Encode and check the budget. A rate that is not a whole number of
 * centiseconds a frame (12 or 15 fps, the wall-time scenes) is encoded as
 * before and logged as such; any other rate must hold exactly (lib/gif.mjs).
 */
export async function encodeChecked({ input, fps, out, width, crop = null, dither = "sierra2_4a", bayerScale = 5, maxColors = 256, raw = null, alpha = false }) {
  const legacyRate = !Number.isInteger(100 / fps);
  const gif = await encodeGif({ input, fps, out, width: Math.min(width ?? GIF_MAX_WIDTH, GIF_MAX_WIDTH), crop, dither, bayerScale, maxColors, alpha, legacyRate });
  const secs = (gif.frames / gif.fps).toFixed(1);
  const delay = gif.delayCs ? `, every delay ${gif.delayCs} cs` : legacyRate ? ", uneven delays (a wall-time rate)" : "";
  log(`${path.basename(out)}: ${gif.width}x${gif.height}, ${gif.frames} frames at ${gif.fps} fps (${secs} s)${delay}, ${gif.bytes} bytes${raw ? ` (${raw} captured frames)` : ""}`);
  if (gif.bytes > GIF_MAX_BYTES) throw new Error(`${path.basename(out)} is ${gif.bytes} bytes, over the ${GIF_MAX_BYTES} budget`);
  return { ...gif, seconds: Number(secs) };
}

/** Shift frame-NNNNN.png up by `n` and fill the head with copies of the last frame. */
export function posterHold(dir, count, n) {
  const name = (k) => path.join(dir, `frame-${String(k).padStart(5, "0")}.png`);
  for (let k = count - 1; k >= 0; k--) fs.renameSync(name(k), name(k + n));
  for (let k = 0; k < n; k++) fs.copyFileSync(name(count + n - 1), name(k));
  return count + n;
}

export function dropFrames(rec, ctx) {
  if (!ctx.keepFrames) fs.rmSync(rec.dir, { recursive: true, force: true });
}

/**
 * Grow each frame-NNNNN.png downward to `side` x `side` px with the colour of
 * its top-left pixel (the page): composition for a crop the viewport's edge
 * cut short. Nothing inside the capture changes.
 */
async function padFrames(dir, side) {
  const first = path.join(dir, "frame-00000.png");
  const bg = (await run("convert", [first, "-format", "%[pixel:p{0,0}]", "info:"])).trim();
  await run("sh", ["-c", `mogrify -background '${bg}' -gravity north -extent ${side}x${side} '${dir}'/frame-*.png`]);
}

/** The page colour: the top-left pixel of the first frame. */
export async function pageColour(dir) {
  return (await run("convert", [path.join(dir, "frame-00000.png"), "-format", "%[pixel:p{0,0}]", "info:"])).trim();
}

/** Grow each frame-NNNNN.png upward by `px` with the page colour: headroom above a thread that scrolls. */
async function padFramesTop(dir, px) {
  const bg = await pageColour(dir);
  await run("sh", ["-c", `mogrify -background '${bg}' -gravity north -splice 0x${px} '${dir}'/frame-*.png`]);
}
