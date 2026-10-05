// Shared tail of every GIF scene: stop the recorder at the marks, encode, clean up.

import fs from "node:fs";
import path from "node:path";
import { encodeGif } from "./gif.mjs";
import { Recorder } from "./record.mjs";
import { log } from "./util.mjs";

export async function record(app, ctx, { fps = 12 } = {}) {
  const rec = new Recorder(app.page, path.join(app.work, "frames"), { fps });
  await rec.start();
  return rec;
}

/** `crop` and `width` as in encodeGif; frames are kept with --keep-frames. */
export async function finish(rec, ctx, file, { width = 1200, crop = null, dither = "sierra2_4a" } = {}) {
  const frames = await rec.stop({ from: "start", to: "end" });
  const gif = await encodeGif({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, file), width, crop, dither });
  log(`${file}: ${gif.width}x${gif.height}, ${gif.frames} frames at ${gif.fps} fps, ${gif.bytes} bytes (${frames.raw} screencast frames)`);
  if (!ctx.keepFrames) fs.rmSync(rec.dir, { recursive: true, force: true });
  return gif;
}
