// What every scene shares: a fresh stack, a browser whose fake microphone
// plays this scene's WAV, the app on the chosen device, and clean shutdown.

import fs from "node:fs";
import path from "node:path";
import { micWav } from "./audio.mjs";
import { launch, openApp, waitIdle } from "./browser.mjs";
import { startStack } from "./stack.mjs";
import { log, mkdirp, sleep } from "./util.mjs";

/**
 * Run `fn(app, extra)` against a fresh server and agentd.
 * `mic` is a list of [startMs, endMs] speech segments, timed from the moment
 * the microphone opens (the orb tap); empty means a silent microphone.
 * `pages` > 1 opens more pages on the same stack (extra.more).
 */
export async function withApp(ctx, { name, device = "desktop", theme = "light", borders = "on", mic = [], desktop = "fake", display = null, paceJobsMs = 0 }, fn) {
  const work = mkdirp(path.join(ctx.work, name));
  const wav = await micWav(path.join(work, "mic.wav"), { segments: mic });
  const stack = await startStack({ work: path.join(work, "stack"), webDist: ctx.webDist, desktop, display });
  log(`${name}: server ${stack.origin}, agentd pid ${stack.agentd.pid}`);
  let browser = null;
  const noise = [];
  try {
    browser = await launch({ micWav: wav });
    const app = await openApp(browser, stack, { device, theme, borders, noise, paceJobsMs });
    app.stack = stack;
    app.work = work;
    return await fn(app, { browser, stack, work, noise });
  } finally {
    if (noise.length) {
      fs.writeFileSync(path.join(work, "console.txt"), noise.join("\n") + "\n");
      log(`${name}: ${noise.length} console warnings or errors (see ${path.join(work, "console.txt")})`);
    }
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
  await sleep(500);
}

/** A clip around `locator` with `pad` CSS pixels of the page around it. */
export async function clipAround(locator, pad = 24) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("nothing to clip: the element is not visible");
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad };
}

/** The settings popover in the rail footer (on a phone, inside the rail sheet). */
export async function openSettings(app) {
  const { page } = app;
  if (app.device.startsWith("phone")) {
    await page.locator('button[aria-label="Rail"]:visible').first().click();
    await sleep(500);
  }
  await page.locator('button[aria-label="Settings"]:visible').first().click();
  await sleep(500);
}
