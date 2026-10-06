// Shared tail of every GIF scene: stop the recorder at the marks, encode, clean up.

import fs from "node:fs";
import path from "node:path";
import { cleanBlends, fadeThroughFrames, listFrames, resequence } from "./frames.mjs";
import { crossfadeLoop, encodeGif } from "./gif.mjs";
import { Recorder } from "./record.mjs";
import { log, run } from "./util.mjs";

/** GIF budget from the brief: at most 4 MB a GIF, at most 1200 px wide. */
export const GIF_MAX_BYTES = 4 * 1024 * 1024;
export const GIF_MAX_WIDTH = 1200;

/** Screencast at 1x; screenshots when the scene wants the context's scale factor (> 1) or a `clip` (CSS px). */
export async function record(app, ctx, { fps = 12, clip = null } = {}) {
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
 * - `fadeThrough`: the end fades through the page colour into frame 0.
 * Frames are kept with --keep-frames.
 * A GIF over budget is reported, not hidden: the scene fails.
 */
export async function finish(rec, ctx, file, { width = GIF_MAX_WIDTH, crop = null, cssCrop = null, dither = "sierra2_4a", bayerScale = 5, loopFade = 0, fadeThrough = 0, posterMs = 0, posterFade = 0, endHoldMs = 0, cuts = [], padTo = 0, padTop = 0 } = {}) {
  const frames = await rec.stop({ from: "start", to: "end" });
  if (padTo > 0) await padFrames(rec.dir, Math.round(padTo * frames.scale));
  if (padTop > 0) await padFramesTop(rec.dir, Math.round(padTop * frames.scale));
  frames.count = await editTime(rec.dir, frames, { cuts, endHoldMs, posterMs, posterFade, fadeThrough });
  if (cssCrop) {
    const k = frames.scale;
    crop = { x: Math.round(cssCrop.x * k), y: Math.round(cssCrop.y * k), w: Math.round(cssCrop.w * k), h: Math.round(cssCrop.h * k) };
  }
  if (loopFade > 0) await crossfadeLoop(rec.dir, { n: loopFade });
  const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, file), width, crop, dither, bayerScale, raw: frames.raw });
  dropFrames(rec, ctx);
  return gif;
}

/** The time edits of `finish` on a stopped recording's frames. Returns the new count. */
export async function editTime(dir, frames, { cuts = [], endHoldMs = 0, posterMs = 0, posterFade = 0, fadeThrough = 0 } = {}) {
  let list = listFrames(dir);
  const step = 1000 / frames.fps;
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
  if (posterMs > 0) {
    const head = Array(Math.round(posterMs / step)).fill(last);
    if (posterFade > 0) head.push(...(await fadeThroughFrames(dir, last, list[0], bg, posterFade)));
    list = [...head, ...list];
  }
  if (fadeThrough > 0) list.push(...(await fadeThroughFrames(dir, list[list.length - 1], list[0], bg, fadeThrough)));
  const n = resequence(dir, list);
  cleanBlends(dir);
  return n;
}

export async function encodeChecked({ input, fps, out, width, crop = null, dither = "sierra2_4a", bayerScale = 5, raw = null, alpha = false }) {
  const gif = await encodeGif({ input, fps, out, width: Math.min(width ?? GIF_MAX_WIDTH, GIF_MAX_WIDTH), crop, dither, bayerScale, alpha });
  const secs = (gif.frames / gif.fps).toFixed(1);
  log(`${path.basename(out)}: ${gif.width}x${gif.height}, ${gif.frames} frames at ${gif.fps} fps (${secs} s), ${gif.bytes} bytes${raw ? ` (${raw} screencast frames)` : ""}`);
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
