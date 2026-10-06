// The Wear OS app rendered by Paparazzi. A scratch copy of clients/wearos
// (and clients/shared, which its tests read) gets the Paparazzi plugin and
// tools/media/wear/MediaWatchTest.kt; `gradle recordPaparazziDebug` renders
// the app's real Screen over time into an APNG, and ffmpeg splits it into
// PNG frames. The repo's clients/wearos is never written.

import fs from "node:fs";
import path from "node:path";
import { MEDIA, REPO, log, mkdirp, run } from "./util.mjs";

const PAPARAZZI = "1.3.5";
const SKIP = new Set(["build", ".gradle", ".kotlin", "local.properties"]);

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
}

function patch(file, find, insert) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(insert.trim())) return;
  if (!src.includes(find)) throw new Error(`${file}: no "${find}" to patch after`);
  fs.writeFileSync(file, src.replace(find, `${find}\n${insert}`));
}

/** Prepare the scratch project under `work`; returns its folder. */
export function prepareWear(work) {
  const root = mkdirp(path.join(work, "wear"));
  const proj = path.join(root, "wearos");
  fs.rmSync(path.join(proj, "app", "src"), { recursive: true, force: true });
  copyTree(path.join(REPO, "clients", "wearos"), proj);
  copyTree(path.join(REPO, "clients", "shared"), path.join(root, "shared"));
  patch(path.join(proj, "build.gradle.kts"), "plugins {", `    id("app.cash.paparazzi") version "${PAPARAZZI}" apply false`);
  patch(path.join(proj, "app", "build.gradle.kts"), "plugins {", `    id("app.cash.paparazzi")`);
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "/opt/android-sdk";
  if (!fs.existsSync(sdk)) throw new Error(`no Android SDK at ${sdk}: set ANDROID_HOME`);
  fs.writeFileSync(path.join(proj, "local.properties"), `sdk.dir=${sdk}\n`);
  const testDir = mkdirp(path.join(proj, "app", "src", "test", "java", "systems", "reagent", "apparatus", "wear", "ui"));
  fs.copyFileSync(path.join(MEDIA, "wear", "MediaWatchTest.kt"), path.join(testDir, "MediaWatchTest.kt"));
  return proj;
}

/**
 * Render the call and split it into frames. Resolves with
 * { dir, pattern, count, fps, size }; frame k is at k / fps seconds.
 */
export async function renderWatchCall(work, { fps = 15 } = {}) {
  const proj = prepareWear(work);
  log(`wear: rendering with Paparazzi in ${proj} (the first run compiles the app, a few minutes)`);
  const gradleLog = path.join(work, "wear", "gradle.log");
  try {
    const out = await run("gradle", ["-p", proj, "--console=plain", ":app:recordPaparazziDebug", "--tests", "*MediaWatchTest*"], { env: { GRADLE_OPTS: "-Xmx2g" } });
    fs.writeFileSync(gradleLog, out);
  } catch (e) {
    fs.writeFileSync(gradleLog, String(e.message));
    throw new Error(`Paparazzi failed (log: ${gradleLog})`);
  }
  const videos = path.join(proj, "app", "src", "test", "snapshots", "videos");
  const apng = fs.readdirSync(videos).find((f) => f.includes("MediaWatchTest") && f.endsWith(".png"));
  if (!apng) throw new Error(`Paparazzi wrote no APNG in ${videos}`);
  const dir = mkdirp(path.join(work, "wear", "frames"));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "apng", "-i", path.join(videos, apng), "-vsync", "0", path.join(dir, "raw-%04d.png")]);
  const raws = fs.readdirSync(dir).filter((f) => f.startsWith("raw-")).sort();
  if (raws.length < 2) throw new Error(`the APNG held ${raws.length} frames`);
  // The first frame only starts the clock (MediaWatchTest.call): drop it.
  fs.rmSync(path.join(dir, raws[0]));
  raws.slice(1).forEach((f, i) => fs.renameSync(path.join(dir, f), path.join(dir, `frame-${String(i).padStart(4, "0")}.png`)));
  const size = (await run("identify", ["-format", "%wx%h", path.join(dir, "frame-0000.png")])).trim();
  log(`wear: ${raws.length - 1} frames of ${size} at ${fps} fps`);
  // MediaWatchTest.heldElsewhere: working while another device holds the voice session.
  const images = path.join(proj, "app", "src", "test", "snapshots", "images");
  const held = fs.existsSync(images) ? fs.readdirSync(images).find((f) => f.includes("media-held-elsewhere")) : null;
  if (!held) throw new Error(`Paparazzi wrote no held-elsewhere snapshot in ${images}`);
  const heldElsewhere = path.join(work, "wear", "held-elsewhere.png");
  fs.copyFileSync(path.join(images, held), heldElsewhere);
  return { dir, pattern: path.join(dir, "frame-%04d.png"), count: raws.length - 1, fps, size, heldElsewhere };
}

/** The frame at `ms` into the call. */
export function frameAt(frames, ms) {
  const k = Math.min(frames.count - 1, Math.round((ms / 1000) * frames.fps));
  return path.join(frames.dir, `frame-${String(k).padStart(4, "0")}.png`);
}

/**
 * An antialiased round mask the size of a `size` px square frame: the circle
 * drawn at 4x and scaled down, so its edge has soft steps, not a 1-bit stair.
 * Cached per size in `dir`.
 */
async function circleMask(size, dir) {
  const file = path.join(dir, `mask-${size}.png`);
  if (fs.existsSync(file)) return file;
  const big = size * 4;
  const r = big / 2;
  await run("convert", ["-size", `${big}x${big}`, "xc:black", "-fill", "white", "-draw", `circle ${r - 0.5},${r - 0.5} ${r - 0.5},2`, "-resize", `${size}x${size}`, "-colorspace", "gray", file]);
  return file;
}

/** Cut the round screen out of a square frame: transparent outside the circle, with a soft edge. */
export async function roundMask(input, output) {
  const size = Number((await run("identify", ["-format", "%w", input])).trim());
  const mask = await circleMask(size, path.dirname(output));
  await run("convert", [input, mask, "-alpha", "off", "-compose", "CopyOpacity", "-composite", output]);
  return output;
}

/**
 * The loop's last frame: the frame after `fromMs` (the hang-up) whose pixels
 * are closest to frame 0, up to `toMs`, so the GIF ends on the breathing
 * phase it starts on.
 * Frames after it are deleted. Returns { count, rmse }.
 */
export async function trimToLoop(frames, fromMs, toMs = Infinity) {
  const name = (k) => path.join(frames.dir, `frame-${String(k).padStart(4, "0")}.png`);
  let best = { k: frames.count - 1, rmse: Infinity };
  const last = Math.min(frames.count - 1, Math.round((toMs / 1000) * frames.fps));
  for (let k = Math.round((fromMs / 1000) * frames.fps); k <= last; k++) {
    const out = await run("sh", ["-c", `compare -metric RMSE '${name(k)}' '${name(0)}' null: 2>&1 || true`]);
    const rmse = Number.parseFloat(/\(([\d.e-]+)\)/.exec(out)?.[1] ?? "1");
    if (rmse < best.rmse) best = { k, rmse };
  }
  // The best frame equals frame 0 closely; the GIF ends on the frame before it.
  for (let k = best.k; k < frames.count; k++) fs.rmSync(name(k));
  return { count: best.k, rmse: best.rmse };
}

/** A round frame on a page colour: the circle of the screen, `bg` outside it, with a soft edge. Opaque. */
export async function roundOn(input, output, bg) {
  const size = Number((await run("identify", ["-format", "%w", input])).trim());
  const mask = await circleMask(size, path.dirname(output));
  await run("convert", ["-size", `${size}x${size}`, `xc:${bg}`, input, mask, "-composite", "-alpha", "off", `PNG24:${output}`]);
  return output;
}
