// GIF encoding: ffmpeg two-pass palette. Pass 1 builds one palette from every
// pixel of every frame (stats_mode=full), so a small state colour such as the
// green done check keeps its own entry; pass 2 maps with a low-noise dither
// and rewrites only the changed rectangle of each frame (diff_mode=rectangle).

import fs from "node:fs";
import path from "node:path";
import { run } from "./util.mjs";

/**
 * `input` is an image pattern (frame-%05d.png) at `fps`. `width` scales with
 * Lanczos when the frames are wider. `crop` is {x, y, w, h} in frame pixels.
 * `dither` is "sierra2_4a" or "bayer". `alpha` keeps transparency (the round
 * watch frames). Loops forever.
 *
 * Chromium's screenshots come as RGB or RGBA PNGs within one recording, and a
 * crossfade writes RGBA: every frame is converted to one pixel format, with
 * the filter graph kept as built (-reinit_filter 0), because paletteuse fails
 * when the graph is rebuilt for a new input format mid-stream.
 */
export async function encodeGif({ input, fps, out, width = null, crop = null, dither = "sierra2_4a", maxColors = 256, alpha = false, statsMode = "full" }) {
  const filters = [`format=${alpha ? "rgba" : "rgb24"}`];
  if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  if (width) filters.push(`scale='min(${width},iw)':-2:flags=lanczos`);
  // Even sides: paletteuse with diff_mode=rectangle crashed (SIGSEGV) on an odd-width input.
  filters.push("crop=trunc(iw/2)*2:trunc(ih/2)*2");
  const base = filters.join(",");
  const palette = `${out}.palette.png`;
  const head = ["-hide_banner", "-loglevel", "error", "-y", "-reinit_filter", "0", "-framerate", String(fps), "-i", input];
  await run("ffmpeg", [...head, "-vf", `${base},palettegen=stats_mode=${statsMode}:max_colors=${maxColors}${alpha ? "" : ":reserve_transparent=0"}`, palette]);
  const use = dither === "bayer" ? "paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" : `paletteuse=dither=${dither}:diff_mode=rectangle`;
  await run("ffmpeg", [...head, "-i", palette, "-lavfi", `[0:v]${base}[x];[x][1:v]${use}`, "-loop", "0", out]);
  fs.rmSync(palette, { force: true });
  return gifInfo(out);
}

export async function gifInfo(file) {
  const out = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,r_frame_rate", "-of", "json", file]);
  const s = JSON.parse(out).streams[0];
  const [a, b] = s.r_frame_rate.split("/").map(Number);
  return { file, bytes: fs.statSync(file).size, width: s.width, height: s.height, frames: Number(s.nb_read_frames), fps: b ? a / b : a };
}

/**
 * A seamless loop for a sequence `dir/<prefix>NNNNN.png` (`digits` wide):
 * the last `n` frames fade into the first `n`, which are then dropped, so the
 * GIF's last frame leads straight into its first. Pixels are only blended
 * between two real frames. Returns the new frame count.
 */
export async function crossfadeLoop(dir, { prefix = "frame-", digits = 5, n = 6 } = {}) {
  const name = (k) => path.join(dir, `${prefix}${String(k).padStart(digits, "0")}.png`);
  let count = 0;
  while (fs.existsSync(name(count))) count++;
  if (count < 3 * n) return count;
  for (let i = 0; i < n; i++) {
    const tail = name(count - n + i);
    const pct = Math.round(((i + 1) / (n + 1)) * 100);
    // `blend` P: P % of the source (the head frame) over the tail frame.
    await run("convert", [tail, name(i), "-compose", "blend", "-define", `compose:args=${pct}`, "-composite", "-depth", "8", `PNG32:${tail}`]);
  }
  for (let k = n; k < count; k++) fs.renameSync(name(k), name(k - n));
  for (let k = count - n; k < count; k++) fs.rmSync(name(k), { force: true });
  return count - n;
}

/**
 * Close a loop through the page colour: after the last frame of
 * `dir/<prefix>NNNNN.png`, `n` frames fade it out to `bg`, then `n` frames
 * fade `bg` into the first frame, which follows as the loop restarts. Two
 * different layouts never show at once, and frame 0 stays the poster.
 * Returns the new frame count.
 */
export async function fadeThroughLoop(dir, bg, { prefix = "frame-", digits = 5, n = 4 } = {}) {
  const name = (k) => path.join(dir, `${prefix}${String(k).padStart(digits, "0")}.png`);
  let count = 0;
  while (fs.existsSync(name(count))) count++;
  const last = name(count - 1);
  const [w, h] = (await run("identify", ["-format", "%w %h", name(0)])).trim().split(" ");
  const plain = path.join(dir, "bg.png");
  await run("convert", ["-size", `${w}x${h}`, `xc:${bg}`, plain]);
  let k = count;
  for (let i = 1; i <= n; i++) {
    const pct = Math.round((i / (n + 1)) * 100);
    await run("convert", [last, plain, "-compose", "blend", "-define", `compose:args=${pct}`, "-composite", "-depth", "8", `PNG24:${name(k++)}`]);
  }
  await run("convert", [plain, `PNG24:${name(k++)}`]);
  for (let i = 1; i <= n; i++) {
    const pct = Math.round((i / (n + 1)) * 100);
    await run("convert", [plain, name(0), "-compose", "blend", "-define", `compose:args=${pct}`, "-composite", "-depth", "8", `PNG24:${name(k++)}`]);
  }
  fs.rmSync(plain);
  return k;
}
