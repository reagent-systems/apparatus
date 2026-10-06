// The VM screen on a real X desktop. A scene that shows the screen calls
// withScreen; it throws, and the asset is not made, unless decoded video
// frames reach the page's <video> from agentd's x11grab stream.
//
// The desktop: Xvfb at 1280 x 720 (16:9, so the stream fills the pane's
// frame), a warm root colour and one xterm in JetBrains Mono, paper on ink,
// opened in ~/reports once the agent has written report.csv there (the
// terminal's home is agentd's home, as on the VM). Nothing is typed or
// written into it by the harness: what the terminal shows, the user typed
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
/** DESIGN.md's paper and ink; a 1 px border in its --border colour (no window manager draws one). */
const XTERM = ["-fa", "JetBrains Mono", "-fs", "21", "-bg", "#fbfaf7", "-fg", "#211d19", "-cr", "#211d19", "-b", "22", "-bw", "1", "-bd", "#c9c2b6"];
/** The terminal's place on the X screen (columns x rows + X pixels). */
export const TERM_GEOMETRY = "40x9+150+120";

/** Open the terminal in `cwd` with `home` as its HOME. */
export async function openTerminal(desk, home, cwd) {
  const shell = ["env", "-i", `HOME=${home}`, "PATH=/usr/local/bin:/usr/bin:/bin", "TERM=xterm-256color", `PS1=${PS1}`, "bash", "--norc", "--noprofile", "-i"];
  const q = (a) => `'${a}'`;
  await desk.open(["xterm", ...XTERM, "-T", "terminal", "-geometry", TERM_GEOMETRY, "-e", "sh", "-c", `cd ${q(cwd)} && exec ${shell.map(q).join(" ")}`]);
  const fonts = await run("sh", ["-c", "fc-match 'JetBrains Mono'"], { env: desk.env });
  if (!/JetBrains/i.test(fonts)) throw new Error(`the terminal font is not JetBrains Mono: ${fonts.trim()}`);
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

/** Type as the user, with this device holding Control: the page's own key events, sent on to the VM by agentd. */
export async function typeUnderControl(page, text, { delay = 45, enter = true } = {}) {
  await page.keyboard.type(text, { delay });
  if (enter) await page.keyboard.press("Enter");
}

export async function withScreen(ctx, opts, fn) {
  const work = path.join(ctx.work, opts.name, "x");
  fs.rmSync(work, { recursive: true, force: true });
  const desk = await startDesktop({ work, width: SCREEN.width, height: SCREEN.height, apps: [] });
  try {
    // The X pointer rests in the bottom-right corner, where its arrow falls
    // off the screen, until a scene moves it on purpose.
    await run("xdotool", ["mousemove", String(SCREEN.width - 1), String(SCREEN.height - 1)], { env: desk.env });
    await grab(desk.display, path.join(work, "x-root.png"));
    return await withApp(ctx, { ...opts, desktop: "xdo", display: desk.display, screen: SCREEN }, async (app, extra) => fn(app, { ...extra, desk }));
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
