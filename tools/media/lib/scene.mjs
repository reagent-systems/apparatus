// What every scene shares: a fresh stack, a browser whose fake microphone
// plays this scene's WAV, the app on the chosen device, and clean shutdown.

import fs from "node:fs";
import path from "node:path";
import { micWav } from "./audio.mjs";
import { launch, openApp, waitIdle } from "./browser.mjs";
import { startStack } from "./stack.mjs";
import { MIC_SEGMENTS } from "./day.mjs";
import { log, mkdirp, run, sleep } from "./util.mjs";

/**
 * Run `fn(app, extra)` against a fresh server and agentd.
 * `mic` is a list of [startMs, endMs] speech segments, timed from the moment
 * the microphone opens (the orb tap); empty means a silent microphone.
 */
export async function withApp(ctx, { name, device = "desktop", theme = "light", borders = "off", prefs = {}, mic = MIC_SEGMENTS, desktop = "fake", display = null, screen = null, paceJobsMs = 0, hold = null, platform = null }, fn) {
  const work = mkdirp(path.join(ctx.work, name));
  const wav = await micWav(path.join(work, "mic.wav"), { segments: mic });
  const stack = await startStack({ work: path.join(work, "stack"), webDist: ctx.webDist, desktop, display, screen });
  log(`${name}: server ${stack.origin}, agentd pid ${stack.agentd.pid}`);
  let browser = null;
  const noise = [];
  try {
    browser = await launch({ micWav: wav });
    const app = await openApp(browser, stack, { device, theme, borders, prefs, noise, paceJobsMs, hold, platform });
    app.stack = stack;
    app.work = work;
    return await fn(app, { browser, stack, work, noise });
  } finally {
    if (noise.length) {
      fs.writeFileSync(path.join(work, "console.txt"), noise.join("\n") + "\n");
      log(`${name}: ${noise.length} console warnings or errors (see ${path.join(work, "console.txt")})`);
    }
    hold?.release();
    await browser?.close().catch(() => {});
    await stack.stop();
  }
}

/** A PNG of the page, or of `clip` (CSS pixels), at the context's scale factor. */
export async function shot(app, file, { clip = null, locator = null } = {}) {
  await waitIdle(app.page, 400);
  mkdirp(path.dirname(file));
  if (locator) await locator.screenshot({ path: file, animations: "allow" });
  else await app.page.screenshot({ path: file, clip: clip ?? undefined, animations: "allow" });
  log(`saved ${file}`);
  return file;
}

/** Pick a command palette row by its label, as a user would. */
export async function palette(app, label) {
  const { page } = app;
  await page.keyboard.press("Control+k");
  const item = page.getByRole("option", { name: label, exact: true }).first();
  await item.waitFor({ state: "visible", timeout: 5000 });
  await item.click();
  await sleep(400);
}

export async function setTheme(app, theme) {
  await palette(app, theme === "dark" ? "Dark" : "Light");
  app.theme = theme;
  await sleep(300);
}

/** Desktop view keys: Cmd/Ctrl+1..5. */
export async function view(app, name) {
  const n = { thread: 1, jobs: 2, screen: 3, audit: 4, credits: 5 }[name];
  await app.page.keyboard.press(`Control+${n}`);
  await sleep(600);
}

/** Output file name for a theme variant: light keeps the base name. */
export function variant(out, base, theme, ext = "png") {
  return path.join(out, theme === "dark" ? `${base}-dark.${ext}` : `${base}.${ext}`);
}

/** Open the pane on a finished job's Receipt, from the job card's Output button. */
export async function openReceipt(app, { request = null } = {}) {
  const { page } = app;
  let card = page.locator('[data-kind="job"][data-state="done"]');
  if (request) card = card.filter({ hasText: request });
  await card.first().scrollIntoViewIfNeeded();
  await card.first().locator('button[aria-label="Output"]').click();
  await sleep(500);
  const tab = page.getByRole("tab", { name: "Receipt" }).first();
  await tab.waitFor({ state: "visible", timeout: 5000 });
  await tab.click();
  // The selected card carries a 2 s highlight ring (DESIGN.md 5): let it go.
  await sleep(2300);
}

/** A clip around `locator` with `pad` CSS pixels of the page around it (`padY` above and below, if given). */
export async function clipAround(locator, pad = 24, padY = pad) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("nothing to clip: the element is not visible");
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - padY), width: b.width + 2 * pad, height: b.height + 2 * padY };
}

/**
 * Grow a still by `px` image pixels above and below (and `pxX` left and
 * right) with the colour of its top-left pixel (the page background): more
 * air around a tight clip, without the neighbouring cards' text. Composition
 * only; the capture is not touched.
 */
export async function padWithPage(file, px, pxX = 0) {
  const [w, h, bg] = (await run("convert", [file, "-format", "%w %h %[pixel:p{0,0}]", "info:"])).trim().split(" ");
  await run("convert", [file, "-background", bg, "-gravity", "center", "-extent", `${Number(w) + 2 * pxX}x${Number(h) + 2 * px}`, file]);
  return file;
}

/** The settings popover in the rail footer (on a phone, inside the rail sheet). */
export async function openSettings(app) {
  const { page } = app;
  if (typeof app.device === "string" && app.device.startsWith("phone")) {
    await page.locator('button[aria-label="Rail"]:visible').first().click();
    await sleep(500);
  }
  await page.locator('button[aria-label="Settings"]:visible').first().click();
  await sleep(500);
}
