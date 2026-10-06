// The VM screen on a real X desktop. A scene that shows the screen calls
// withScreen; it throws, and the asset is not made, unless decoded video
// frames reach the page's <video> from agentd's x11grab stream.
//
// The desktop: Xvfb at 16:9 (1280 x 720 for the still, 960 x 540 for the
// GIF, which then shows the X screen at 1:1 in the pane), so the stream fills
// the pane's frame; a warm root colour, an xclock and an xterm in JetBrains
// Mono, paper on ink, opened in ~/reports once the agent has written
// report.csv there (the terminal's home is agentd's home, as on the VM). It
// is a bare X session, not the VM image's XFCE desktop. Nothing is typed or
// written into the terminal by the harness: what it shows, the user typed
// under Control through the page's own input path (typeUnderControl).

import fs from "node:fs";
import path from "node:path";
import { grab, startDesktop } from "./xdesktop.mjs";
import { withApp } from "./scene.mjs";
import { log, run, sleep } from "./util.mjs";

/** A plain prompt: no user or host name. */
const PS1 = "$ ";
/** The X screen; agentd streams and maps input at this size (AGENTD_STREAM_WIDTH, AGENTD_STREAM_HEIGHT). */
export const SCREEN = { width: 1280, height: 720 };
const PAPER = "#fbfaf7";
const INK = "#211d19";
/** DESIGN.md's --border colour: no window manager draws a frame, so each window draws a 1 px one. */
const EDGE = "#c9c2b6";

/** Open the terminal in `cwd` with `home` as its HOME, sized and placed for the screen's width. */
export async function openTerminal(desk, home, cwd) {
  const k = desk.width / 1280;
  // `desk.termCursor` false: each prompt hides the text cursor (DECTCEM), so no frame shows one.
  const ps1 = desk.termCursor === false ? `\\[\\e[?25l\\]${PS1}` : PS1;
  const shell = ["env", "-i", `HOME=${home}`, "PATH=/usr/local/bin:/usr/bin:/bin", "TERM=xterm-256color", `PS1=${ps1}`, "bash", "--norc", "--noprofile", "-i"];
  const q = (a) => `'${a}'`;
  // `desk.termFontPx` overrides the scaled size: at small sizes the font's advance grows, and a
  // 640 px screen needs a size smaller than the scale gives for the terminal to clear the clock.
  const xterm = ["-fa", "JetBrains Mono", "-fs", String(desk.termFontPx ?? Math.round(26 * k)), "-bg", PAPER, "-fg", INK, "-cr", INK, "-b", String(Math.round(22 * k)), "-bw", "1", "-bd", EDGE];
  const geometry = `36x9+${Math.round(90 * k)}+${Math.round(90 * k)}`;
  await desk.open(["xterm", ...xterm, "-T", "terminal", "-geometry", geometry, "-e", "sh", "-c", `cd ${q(cwd)} && exec ${shell.map(q).join(" ")}`]);
  const fonts = await run("sh", ["-c", "fc-match 'JetBrains Mono'"], { env: desk.env });
  if (!/JetBrains/i.test(fonts)) throw new Error(`the terminal font is not JetBrains Mono: ${fonts.trim()}`);
}

/**
 * A second window, so the desktop reads as used: an analogue xclock in the same paper and ink,
 * clear of the terminal, its second hand ticking; `seconds` false draws the hour and minute
 * hands only (xclock's default minute update). Resolves with the xclock process.
 */
export async function openClock(desk, { seconds = true } = {}) {
  const k = desk.width / 1280;
  const d = Math.round(250 * k);
  return desk.open(["xclock", "-analog", ...(seconds ? ["-update", "1"] : []), "-bg", PAPER, "-fg", INK, "-hd", INK, "-hl", INK, "-bw", "1", "-bd", EDGE, "-padding", String(Math.round(16 * k)), "-geometry", `${d}x${d}+${desk.width - d - Math.round(40 * k)}+${Math.round(90 * k)}`]);
}

/** Wait until the page's screen video has decoded frames; resolve with its size. */
export async function waitForFrames(page, timeoutMs = 30_000) {
  return page
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        if (!v || v.videoWidth === 0) return false;
        const q = v.getVideoPlaybackQuality?.();
        return q && q.totalVideoFrames > 2 ? { w: v.videoWidth, h: v.videoHeight, frames: q.totalVideoFrames } : false;
      },
      null,
      { timeout: timeoutMs, polling: 250 },
    )
    .then((h) => h.jsonValue());
}

/** Where a point of the X screen lands in the page: the video is letterboxed (object-contain). */
export async function videoPoint(page, x, y) {
  const video = page.locator("video").first();
  const box = await video.boundingBox();
  const [vw, vh] = await video.evaluate((v) => [v.videoWidth, v.videoHeight]);
  const k = Math.min(box.width / vw, box.height / vh);
  return { x: box.x + (box.width - vw * k) / 2 + x * k, y: box.y + (box.height - vh * k) / 2 + y * k };
}

/** The terminal window's frame on the X screen (X pixels). */
export async function terminalBox(desk) {
  const out = await run("xdotool", ["search", "--name", "^terminal$", "getwindowgeometry", "--shell"], { env: desk.env });
  const v = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
  return { x: Number(v.X), y: Number(v.Y), w: Number(v.WIDTH), h: Number(v.HEIGHT) };
}

/**
 * Type as the user, with this device holding Control: the page's own key events, sent on to the VM by agentd.
 * `holdMs` > 0 holds each key down that long, as a hand does, instead of sending its down and up back to back.
 */
export async function typeUnderControl(page, text, { delay = 45, enter = true, holdMs = 0 } = {}) {
  if (holdMs > 0) {
    for (const ch of text) {
      await page.keyboard.down(ch);
      await sleep(holdMs);
      await page.keyboard.up(ch);
      await sleep(delay);
    }
    if (enter) {
      await page.keyboard.down("Enter");
      await sleep(holdMs);
      await page.keyboard.up("Enter");
    }
    return;
  }
  await page.keyboard.type(text, { delay });
  if (enter) await page.keyboard.press("Enter");
}

/**
 * `opts.screen` is the X screen's size (default SCREEN). `opts.clockSeconds` false opens the
 * clock without a second hand; `desk.clock` is the xclock process.
 */
export async function withScreen(ctx, opts, fn) {
  const work = path.join(ctx.work, opts.name, "x");
  fs.rmSync(work, { recursive: true, force: true });
  const screen = opts.screen ?? SCREEN;
  const desk = await startDesktop({ work, width: screen.width, height: screen.height, apps: [] });
  desk.width = screen.width;
  desk.height = screen.height;
  try {
    // The X pointer rests in the bottom-right corner, where its arrow falls
    // off the screen, until a scene moves it on purpose.
    await run("xdotool", ["mousemove", String(screen.width - 1), String(screen.height - 1)], { env: desk.env });
    desk.clock = await openClock(desk, { seconds: opts.clockSeconds ?? true });
    await grab(desk.display, path.join(work, "x-root.png"));
    return await withApp(ctx, { ...opts, desktop: "xdo", display: desk.display, screen }, async (app, extra) => fn(app, { ...extra, desk }));
  } finally {
    await desk.stop();
  }
}

/** Open the Screen in the pane and wait for real frames; throws when none arrive. */
export async function showScreen(app, name) {
  await app.page.keyboard.press("Control+3");
  const got = await waitForFrames(app.page);
  log(`${name}: the VM screen streams ${got.w}x${got.h}, ${got.frames} frames decoded`);
  await sleep(800);
  return got;
}

/**
 * A video decoder can show a frame with a grey cast and block artefacts while
 * it waits for a key frame. Such frames are dropped: each one is replaced by
 * the last good frame before it, a hold of real frames. A frame is bad when
 * the mean colour of `region` (frame pixels, a patch of the X root window no
 * window covers; or a list of such patches) is more than `tolerance` off its
 * median across all frames, in any patch. Returns the indices it replaced.
 */
export async function dropDecodeGlitches(dir, region, { tolerance = 6 } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  const regions = [].concat(region);
  const means = []; // per frame, per patch: [r, g, b]
  for (const f of files) {
    const per = [];
    for (const r of regions) {
      const out = await run("convert", [path.join(dir, f), "-crop", `${r.w}x${r.h}+${r.x}+${r.y}`, "+repage", "-resize", "1x1!", "-format", "%[fx:int(255*r)] %[fx:int(255*g)] %[fx:int(255*b)]", "info:"]);
      per.push(out.trim().split(" ").map(Number));
    }
    means.push(per);
  }
  const medians = regions.map((_, i) => [0, 1, 2].map((c) => means.map((m) => m[i][c]).sort((a, b) => a - b)[Math.floor(means.length / 2)]));
  const median = medians[0];
  const bad = means.map((per) => per.some((m, i) => Math.max(...m.map((v, c) => Math.abs(v - medians[i][c]))) > tolerance));
  const replaced = [];
  for (let k = 0; k < files.length; k++) {
    if (!bad[k]) continue;
    let j = k - 1;
    while (j >= 0 && bad[j]) j--;
    if (j < 0) {
      j = k + 1;
      while (j < files.length && bad[j]) j++;
    }
    if (j >= files.length) throw new Error("every screen frame shows a decode glitch");
    fs.copyFileSync(path.join(dir, files[j]), path.join(dir, files[k]));
    replaced.push(k);
  }
  log(`screen: root colour median ${median.join(",")}; ${replaced.length} frames with a decode glitch dropped${replaced.length ? ` (${replaced.join(", ")})` : ""}`);
  return replaced;
}
