// Shared tail of every GIF scene: stop the recorder at the marks, encode, clean up.

import fs from "node:fs";
import path from "node:path";
import { crossfadeLoop, encodeGif, fadeThroughLoop } from "./gif.mjs";
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
 * crossfade make the loop seamless. `posterMs` opens the GIF on the story's
 * last real frame, held that long: the first frame reads as a poster and the
 * loop's end leads into a start that shows the same frame.
 * Frames are kept with --keep-frames.
 * A GIF over budget is reported, not hidden: the scene fails.
 */
export async function finish(rec, ctx, file, { width = GIF_MAX_WIDTH, crop = null, cssCrop = null, dither = "sierra2_4a", loopFade = 0, fadeThrough = 0, posterMs = 0, padTo = 0, padTop = 0 } = {}) {
  const frames = await rec.stop({ from: "start", to: "end" });
  if (padTo > 0) await padFrames(rec.dir, Math.round(padTo * frames.scale));
  if (padTop > 0) await padFramesTop(rec.dir, Math.round(padTop * frames.scale));
  if (posterMs > 0) frames.count = posterHold(rec.dir, frames.count, Math.round((posterMs / 1000) * frames.fps));
  if (fadeThrough > 0) frames.count = await fadeThroughLoop(rec.dir, await pageColour(rec.dir), { n: fadeThrough });
  if (cssCrop) {
    const k = frames.scale;
    crop = { x: Math.round(cssCrop.x * k), y: Math.round(cssCrop.y * k), w: Math.round(cssCrop.w * k), h: Math.round(cssCrop.h * k) };
  }
  if (loopFade > 0) await crossfadeLoop(rec.dir, { n: loopFade });
  const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, file), width, crop, dither, raw: frames.raw });
  dropFrames(rec, ctx);
  return gif;
}

export async function encodeChecked({ input, fps, out, width, crop = null, dither = "sierra2_4a", raw = null, alpha = false }) {
  const gif = await encodeGif({ input, fps, out, width: Math.min(width ?? GIF_MAX_WIDTH, GIF_MAX_WIDTH), crop, dither, alpha });
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
