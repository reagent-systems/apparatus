// The screen story both screen scenes share: the agent ran the orders job
// (report.csv is in its task folder), the user opens the Screen, takes
// Control, moves the real X pointer into the terminal, clicks, types one
// command through the page and reads the table, then releases the desktop.

import { parkPointer, turnOff } from "./browser.mjs";
import { LINES, askForJob, speakResult } from "./day.mjs";
import { openTerminal, showScreen, terminalBox, typeUnderControl, videoPoint } from "./screen.mjs";
import fs from "node:fs";
import path from "node:path";
import { run, sleep } from "./util.mjs";
import { grab } from "./xdesktop.mjs";

/** The table the agent wrote, read as a person reads a CSV. No shifted keys: under Control a shifted key reaches the VM unshifted. */
export const COMMAND = "column -ts, report.csv";

/** Before the screen: the spoken request and its finished job, the agent off, and the terminal opened where the report is. */
export async function seedOrders(app, desk) {
  const job = await askForJob(app, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob });
  await speakResult(app, job);
  await turnOff(app);
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

/** X pixels where the pointer rests (right of and below the terminal) and where the click lands in it. */
export async function restPoint(desk) {
  const term = await terminalBox(desk);
  return { x: term.x + term.w + 200, y: term.y + term.h + 110 };
}

/** The same two points in the page, through the letterboxed video. */
export async function pointerPath(page, desk) {
  const term = await terminalBox(desk);
  const rest = await restPoint(desk);
  return { from: await videoPoint(page, rest.x, rest.y), to: await videoPoint(page, term.x + term.w - 140, term.y + term.h - 60) };
}

/** Control, the pointer into the terminal, a click, the command, the table. `beat` paces it for a GIF. */
export async function takeControlAndType(app, desk, { beat = 1 } = {}) {
  const { page } = app;
  const control = page.getByRole("button", { name: "Control", exact: true }).first();
  await control.hover();
  await sleep(300 * beat);
  await control.click();
  await sleep(700 * beat);
  const term = await terminalBox(desk);
  const { from, to } = await pointerPath(page, desk);
  await page.mouse.move(from.x, from.y);
  await sleep(200 * beat);
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await sleep(250 * beat);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(300 * beat);
  const before = path.join(app.work, "x-before-typing.png");
  await grab(desk.display, before);
  await typeUnderControl(page, COMMAND, { delay: 40 });
  await sleep(900 * beat);
  // Evidence straight from the X server that the keys landed: the terminal
  // must have changed. A run where they did not fails rather than ship it.
  const after = path.join(app.work, "x-after-typing.png");
  await grab(desk.display, after);
  const box = `${term.w}x${term.h}+${term.x}+${term.y}`;
  const changed = await run("compare", ["-metric", "AE", "-fuzz", "10%", "(", before, "-crop", box, ")", "(", after, "-crop", box, ")", "null:"]).catch((e) => String(e.message).trim().split("\n").pop());
  const px = Number.parseFloat(String(changed).replace(/^.*\s/, ""));
  if (!(px > 2000)) throw new Error(`the typed command did not reach the VM terminal (${changed} pixels changed)`);
}

/** Clear the terminal under Control, so the loop's end matches its start. */
export async function clearTerminal(app) {
  await typeUnderControl(app.page, "clear", { delay: 60 });
}

export async function release(app) {
  const { page } = app;
  const btn = page.getByRole("button", { name: "Release", exact: true }).first();
  await btn.hover();
  await sleep(250);
  await btn.click();
  await parkPointer(page);
}
