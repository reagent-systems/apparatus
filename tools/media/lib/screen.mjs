// The VM screen on a real X desktop. A scene that shows the screen calls
// withScreen; it throws, and the asset is not made, unless decoded video
// frames reach the page's <video> from agentd's x11grab stream.

import path from "node:path";
import { grab, startDesktop } from "./xdesktop.mjs";
import { withApp } from "./scene.mjs";
import { log, sleep } from "./util.mjs";

export const DESKTOP_APPS = [
  ["xterm", "-geometry", "86x22+70+70", "-fa", "DejaVu Sans Mono", "-fs", "12", "-bg", "#1e1e1e", "-fg", "#e8e6e3", "-e", "sh", "-c", "cd /tmp && printf 'agent@vm:~$ ls\\n' && ls / && printf '\\nagent@vm:~$ ' && exec sh"],
  ["xclock", "-geometry", "180x180+1040+70", "-update", "1"],
];

/** Wait until the page's screen video has decoded frames; resolve with its size. */
export async function waitForFrames(page, timeoutMs = 30_000) {
  return page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      if (!v || v.videoWidth === 0) return false;
      const q = v.getVideoPlaybackQuality?.();
      return q && q.totalVideoFrames > 2 ? { w: v.videoWidth, h: v.videoHeight, frames: q.totalVideoFrames } : false;
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  ).then((h) => h.jsonValue());
}

export async function withScreen(ctx, opts, fn) {
  const work = path.join(ctx.work, opts.name, "x");
  const desk = await startDesktop({ work, apps: DESKTOP_APPS });
  try {
    await grab(desk.display, path.join(work, "x-root.png"));
    return await withApp(ctx, { ...opts, desktop: "xdo", display: desk.display }, async (app, extra) => {
      await app.page.keyboard.press("Control+3");
      const got = await waitForFrames(app.page);
      log(`${opts.name}: the VM screen streams ${got.w}x${got.h}, ${got.frames} frames decoded`);
      await sleep(800);
      return fn(app, { ...extra, desk, frames: got });
    });
  } finally {
    await desk.stop();
  }
}
