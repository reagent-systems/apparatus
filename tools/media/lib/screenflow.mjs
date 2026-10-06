// The screen story both screen scenes share: the agent ran the orders job
// (report.csv is in its task folder), the user opens the Screen, takes
// Control, moves the real X pointer into the terminal, clicks, types one
// command through the page and reads the table, then releases the desktop.

import { parkPointer, turnOff } from "./browser.mjs";
import { LINES, askForJob, speakResult } from "./day.mjs";
import { openTerminal, showScreen, terminalBox, typeUnderControl, videoPoint } from "./screen.mjs";
import fs from "node:fs";
import path from "node:path";
import { log, run, sleep } from "./util.mjs";
import { grab } from "./xdesktop.mjs";

/** The table the agent wrote, read as a person reads a CSV. No shifted keys: under Control a shifted key reaches the VM unshifted. */
export const COMMAND = "column -ts, report.csv";

/** Before the screen: the spoken request and its finished job, the agent off, and the terminal opened where the report is. */
export async function seedOrders(app, desk) {
  const job = await askForJob(app, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob });
  await speakResult(app, job);
  await turnOff(app);
  await seedTerminal(app, desk);
}

/** The terminal opened on the VM in ~/reports, once the orders job wrote report.csv there. */
export async function seedTerminal(app, desk) {
  const reports = path.join(app.stack.home, "reports");
  if (!fs.existsSync(path.join(reports, "report.csv"))) throw new Error(`the orders job wrote no ${reports}/report.csv`);
  await openTerminal(desk, app.stack.home, reports);
}

/** The pane's crop (CSS px): its header, the frame and the Control bar. */
export async function paneClip(page) {
  const pane = await page.locator('[data-slot="resizable-panel"]').last().boundingBox();
  const bar = await page.getByRole("button", { name: /^(Control|Release)$/ }).first().boundingBox();
  return { x: Math.ceil(pane.x) + 1, y: 0, width: Math.floor(pane.width) - 1, height: Math.round(bar.y + bar.height + 14) };
}

export async function openScreen(app, name) {
  const got = await showScreen(app, name);
  await parkPointer(app.page);
  return got;
}

/** X pixels where the pointer rests (right of and below the terminal, kept on a small screen) and where the click lands in it. */
export async function restPoint(desk) {
  const term = await terminalBox(desk);
  const w = desk.width ?? Infinity;
  const h = desk.height ?? Infinity;
  return { x: Math.min(term.x + term.w + 200, w - 60), y: Math.min(term.y + term.h + 110, h - 40) };
}

/** The same two points in the page, through the letterboxed video. */
export async function pointerPath(page, desk) {
  const term = await terminalBox(desk);
  const rest = await restPoint(desk);
  return { from: await videoPoint(page, rest.x, rest.y), to: await videoPoint(page, term.x + term.w - 140, term.y + term.h - 60) };
}

/**
 * Move the page's pointer from `from` to `to` over `ms` of wall time, one
 * eased step every `stepMs` (the client sends at most one move per 16.7 ms,
 * the latest), so the X pointer the stream shows moves in every captured frame.
 * Resolves with [start, end] Date.now() times.
 */
export async function glide(page, from, to, ms, { stepMs = 17 } = {}) {
  const t0 = Date.now();
  // On the clock, not a step count: each move goes where the eased path is at that moment.
  for (;;) {
    const p = Math.min(1, (Date.now() - t0) / ms);
    const e = 0.5 - Math.cos(Math.PI * p) / 2;
    const t = Date.now();
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    if (p >= 1) break;
    const wait = t + stepMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  return [t0, Date.now()];
}

/**
 * Control, the pointer into the terminal, a click, the command, the table. `beat` paces it for a GIF.
 * `glideMs` > 0 moves the pointer in timed steps over that long (glide) and
 * notes the span in `app.glides` (Date.now() pairs); 0 moves it in 14 quick steps.
 * `settleMs` is the wait between the Control click and the first move;
 * `glideStepMs` the wall ms between a glide's moves; `keyHoldMs` holds the click and each typed key (typeUnderControl).
 */
export async function takeControlAndType(app, desk, { beat = 1, glideMs = 0, settleMs = null, glideStepMs = 17, keyHoldMs = 0 } = {}) {
  const { page } = app;
  const control = page.getByRole("button", { name: "Control", exact: true }).first();
  await control.hover();
  await sleep(300 * beat);
  await control.click();
  // Input is on once the client focuses the video (ScreenFrame: control held and the input channel open).
  await page.waitForFunction(() => document.activeElement?.tagName === "VIDEO", null, { timeout: 15_000 }).catch(() => {
    throw new Error("Control: the client never turned input on (the video took no focus)");
  });
  // `settleMs`: how long the user looks at the ring before moving (default 0.7 s a beat).
  await sleep(settleMs ?? 700 * beat);
  const term = await terminalBox(desk);
  const { from, to } = await pointerPath(page, desk);
  await page.mouse.move(from.x, from.y);
  await sleep(200 * beat);
  if (glideMs > 0) {
    (app.glides ??= []).push(await glide(page, from, to, glideMs, { stepMs: glideStepMs }));
    await pointerAt(desk, { x: term.x + term.w - 140, y: term.y + term.h - 60 });
  } else await page.mouse.move(to.x, to.y, { steps: 14 });
  await sleep(250 * beat);
  await page.mouse.down();
  // `keyHoldMs` holds the click as long as a key: a down and up sent back to back can race in agentd.
  if (keyHoldMs > 0) await sleep(keyHoldMs);
  await page.mouse.up();
  await sleep(300 * beat);
  const before = path.join(app.work, "x-before-typing.png");
  await grab(desk.display, before);
  const typed = Date.now();
  await typeUnderControl(page, COMMAND, keyHoldMs > 0 ? { delay: 45, holdMs: keyHoldMs } : { delay: 40 });
  await sleep(900 * beat);
  // Evidence straight from the X server that the keys landed: the terminal
  // must have changed. A run where they did not fails rather than ship it.
  // A busy VM can take a few seconds to work through its input, so this
  // looks again for up to 8 s after the last key.
  const after = path.join(app.work, "x-after-typing.png");
  const box = `${term.w}x${term.h}+${term.x}+${term.y}`;
  const changedPx = async () => {
    await grab(desk.display, after);
    // compare prints the count on stderr and exits 1 when the images differ, 0 when they match.
    const out = await run("sh", ["-c", `compare -metric AE -fuzz 10% \\( '${before}' -crop ${box} \\) \\( '${after}' -crop ${box} \\) null: 2>&1 || true`]);
    return Number.parseFloat(out.trim().split(/\s+/)[0]) || 0;
  };
  const t0 = Date.now();
  let px = await changedPx();
  while (!(px > 2000) && Date.now() - t0 < 8000) {
    await sleep(200);
    px = await changedPx();
  }
  if (!(px > 2000)) throw new Error(`the typed command did not reach the VM terminal (${px} pixels changed ${Date.now() - typed} ms after the first key)`);
  if (Date.now() - t0 > 300) log(`screen: the typed command landed in the VM terminal ${Date.now() - typed} ms after the first key`);
}

/** Wait until the X pointer is within 3 px of `want` (X pixels); throws after `timeoutMs`: the moves did not land. */
export async function pointerAt(desk, want, timeoutMs = 3000) {
  const t0 = Date.now();
  let at = null;
  while (Date.now() - t0 < timeoutMs) {
    const out = await run("xdotool", ["getmouselocation", "--shell"], { env: desk.env });
    const v = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
    at = { x: Number(v.X), y: Number(v.Y) };
    if (Math.abs(at.x - want.x) <= 3 && Math.abs(at.y - want.y) <= 3) return at;
    await sleep(50);
  }
  throw new Error(`the X pointer is at ${at.x},${at.y}, not ${want.x},${want.y}: the page's moves did not reach the VM`);
}

/** Clear the terminal under Control, so the loop's end matches its start. */
export async function clearTerminal(app, { holdMs = 0 } = {}) {
  await typeUnderControl(app.page, "clear", { delay: 60, holdMs });
}

export async function release(app) {
  const { page } = app;
  const btn = page.getByRole("button", { name: "Release", exact: true }).first();
  await btn.hover();
  await sleep(250);
  await btn.click();
  await parkPointer(page);
}
