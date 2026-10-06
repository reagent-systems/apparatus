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

/** MediaWatchTest.FPS: the rate Paparazzi renders the call at (50, a 2 cs GIF delay). */
export function watchFps() {
  const m = /const val FPS = (\d+)/.exec(fs.readFileSync(path.join(MEDIA, "wear", "MediaWatchTest.kt"), "utf8"));
  if (!m) throw new Error("wear/MediaWatchTest.kt declares no FPS");
  return Number(m[1]);
}

/**
 * Render the call and split it into frames. Resolves with
 * { dir, pattern, count, fps, size }; frame k is at k / fps seconds. The rate
 * is the test's own (watchFps), so the two never drift; each APNG frame must
 * last 1 / fps s.
 */
export async function renderWatchCall(work) {
  const fps = watchFps();
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
  const apngDelays = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=duration_time", "-of", "csv=p=0", path.join(videos, apng)])).trim().split("\n").map(Number);
  const off = apngDelays.filter((d) => Math.abs(d - 1 / fps) > 1e-4).length;
  if (off > 0) throw new Error(`the APNG's frames are not 1/${fps} s each: ${off} of ${apngDelays.length} differ`);
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
 * The loop's end: the GIF keeps frames 0 to k - 1, for the k in (`fromMs`,
 * `toMs`] (after the hang-up, in the breathing tail) whose frame before it
 * leads into frame 0 most like one normal step. A normal step is the median
 * RMSE between neighbouring frames of the tail; the seam is the RMSE from
 * frame k - 1 back to frame 0. The earliest k whose seam is at most
 * `accept` steps wins, so the tail is no longer than it needs; failing that,
 * the k with the smallest seam. Frames from k on are deleted.
 * Returns { count, rmse, seam, step, ratio }: `rmse` is frame k against frame 0.
 */
export async function trimToLoop(frames, fromMs, toMs = Infinity, { accept = 1.2 } = {}) {
  const name = (k) => path.join(frames.dir, `frame-${String(k).padStart(4, "0")}.png`);
  const cmp = async (a, b) => {
    const out = await run("sh", ["-c", `compare -metric RMSE '${name(a)}' '${name(b)}' null: 2>&1 || true`]);
    return Number.parseFloat(/\(([\d.e-]+)\)/.exec(out)?.[1] ?? "1");
  };
  const first = Math.round((fromMs / 1000) * frames.fps);
  const last = Math.min(frames.count - 1, Math.round((toMs / 1000) * frames.fps));
  if (last <= first) throw new Error(`trimToLoop: no frames between ${fromMs} and ${toMs} ms`);
  const ks = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  // Eight ImageMagick processes at a time.
  const all = async (fn) => {
    const out = [];
    for (let i = 0; i < ks.length; i += 8) out.push(...(await Promise.all(ks.slice(i, i + 8).map(fn))));
    return out;
  };
  const neighbour = await all((k) => cmp(k - 1, k));
  const step = [...neighbour].sort((a, b) => a - b)[Math.floor(neighbour.length / 2)];
  const seams = await all((k) => cmp(k - 1, 0));
  let pick = ks.findIndex((_, i) => seams[i] <= accept * step);
  if (pick < 0) pick = seams.indexOf(Math.min(...seams));
  const k = ks[pick];
  const rmse = await cmp(k, 0);
  for (let j = k; j < frames.count; j++) fs.rmSync(name(j));
  log(`wear: loop of ${k} frames (${(k / frames.fps).toFixed(2)} s); seam ${seams[pick].toFixed(4)} = ${(seams[pick] / step).toFixed(2)}x a normal step of ${step.toFixed(4)}; frame ${k} vs frame 0 ${rmse.toFixed(4)}`);
  return { count: k, rmse, seam: seams[pick], step, ratio: seams[pick] / step };
}

/** A round frame on a page colour: the circle of the screen, `bg` outside it, with a soft edge. Opaque. */
export async function roundOn(input, output, bg) {
  const size = Number((await run("identify", ["-format", "%w", input])).trim());
  const mask = await circleMask(size, path.dirname(output));
  await run("convert", ["-size", `${size}x${size}`, `xc:${bg}`, input, mask, "-composite", "-alpha", "off", `PNG24:${output}`]);
  return output;
}
