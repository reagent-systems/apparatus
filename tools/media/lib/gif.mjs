// GIF encoding: ffmpeg two-pass palette. Pass 1 builds a palette weighted to
// what changes (stats_mode=diff); pass 2 maps with a low-noise dither and
// rewrites only the changed rectangle of each frame (diff_mode=rectangle).

import fs from "node:fs";
import { run } from "./util.mjs";

/**
 * `input` is an image pattern (frame-%05d.png) at `fps`. `width` scales with
 * Lanczos when the frames are wider. `crop` is {x, y, w, h} in frame pixels.
 * `dither` is "sierra2_4a" or "bayer". Loops forever.
 */
export async function encodeGif({ input, fps, out, width = null, crop = null, dither = "sierra2_4a", maxColors = 256 }) {
  const filters = [];
  if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  if (width) filters.push(`scale='min(${width},iw)':-2:flags=lanczos`);
  const base = filters.length ? filters.join(",") + "," : "";
  const palette = `${out}.palette.png`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps), "-i", input, "-vf", `${base}palettegen=stats_mode=diff:max_colors=${maxColors}`, palette]);
  const use = dither === "bayer" ? "paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" : `paletteuse=dither=${dither}:diff_mode=rectangle`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps), "-i", input, "-i", palette, "-lavfi", `${base.replace(/,$/, "")}${base ? "[x];[x][1:v]" : "[0:v][1:v]"}${use}`, "-loop", "0", out]);
  fs.rmSync(palette, { force: true });
  return gifInfo(out);
}

export async function gifInfo(file) {
  const out = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,r_frame_rate", "-of", "json", file]);
  const s = JSON.parse(out).streams[0];
  const [a, b] = s.r_frame_rate.split("/").map(Number);
  return { file, bytes: fs.statSync(file).size, width: s.width, height: s.height, frames: Number(s.nb_read_frames), fps: b ? a / b : a };
}
