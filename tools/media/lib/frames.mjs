// Frame-sequence edits for the GIFs: holds, cuts and fades in time. Each one
// reorders, repeats, drops or blends whole real frames; nothing draws inside
// a frame. A sequence is `dir/frame-NNNNN.png`.

import fs from "node:fs";
import path from "node:path";
import { mkdirp, run } from "./util.mjs";

export const frameName = (dir, k, prefix = "frame-", digits = 5) => path.join(dir, `${prefix}${String(k).padStart(digits, "0")}.png`);

export function countFrames(dir, prefix = "frame-", digits = 5) {
  let n = 0;
  while (fs.existsSync(frameName(dir, n, prefix, digits))) n++;
  return n;
}

/** The current frames as a list of paths. */
export function listFrames(dir, prefix = "frame-", digits = 5) {
  return Array.from({ length: countFrames(dir, prefix, digits) }, (_, k) => frameName(dir, k, prefix, digits));
}

/**
 * Write `list` (paths, repeats allowed) as the new sequence of `dir`. The
 * sources are copied to a staging folder first, so a list may name the
 * sequence's own frames in any order.
 */
export function resequence(dir, list, prefix = "frame-", digits = 5) {
  const stage = mkdirp(path.join(dir, `.stage-${process.pid}`));
  list.forEach((src, k) => fs.copyFileSync(src, frameName(stage, k, prefix, digits)));
  for (const f of listFrames(dir, prefix, digits)) fs.rmSync(f);
  list.forEach((_, k) => fs.renameSync(frameName(stage, k, prefix, digits), frameName(dir, k, prefix, digits)));
  fs.rmSync(stage, { recursive: true, force: true });
  return list.length;
}

let blendSeq = 0;
/** `pct` % of `b` over `a`, written as an opaque PNG in `dir`. */
export async function blend(dir, a, b, pct) {
  const out = path.join(mkdirp(path.join(dir, ".blend")), `b-${process.pid}-${blendSeq++}.png`);
  await run("convert", [a, b, "-compose", "blend", "-define", `compose:args=${pct}`, "-composite", "-alpha", "off", "-depth", "8", `PNG24:${out}`]);
  return out;
}

/** A plain frame of `bg` the size of `like`. */
export async function plainFrame(dir, like, bg) {
  const [w, h] = (await run("identify", ["-format", "%w %h", like])).trim().split(" ");
  const out = path.join(mkdirp(path.join(dir, ".blend")), `plain-${process.pid}-${blendSeq++}.png`);
  await run("convert", ["-size", `${w}x${h}`, `xc:${bg}`, `PNG24:${out}`]);
  return out;
}

/**
 * The frames between two layouts: `a` fades out to the page colour over `n`
 * frames, one plain frame, then the page fades into `b` over `n` frames.
 * Two layouts never show at once.
 */
export async function fadeThroughFrames(dir, a, b, bg, n = 4) {
  const plain = await plainFrame(dir, a, bg);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await blend(dir, a, plain, Math.round((i / (n + 1)) * 100)));
  out.push(plain);
  for (let i = 1; i <= n; i++) out.push(await blend(dir, plain, b, Math.round((i / (n + 1)) * 100)));
  return out;
}

/** Remove the staging files the edits above leave. */
export function cleanBlends(dir) {
  fs.rmSync(path.join(dir, ".blend"), { recursive: true, force: true });
}

/** RMSE (0 to 1) between two frames, optionally over `crop` (WxH+X+Y). */
export async function rmse(a, b, crop = null) {
  const args = crop ? ["-extract", crop, a, b] : [a, b];
  const out = await run("sh", ["-c", `compare -metric RMSE ${args.map((x) => `'${x}'`).join(" ")} null: 2>&1 || true`]);
  return Number.parseFloat(/\(([\d.e-]+)\)/.exec(out)?.[1] ?? "1");
}
