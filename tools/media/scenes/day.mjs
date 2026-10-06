// Every web still from one day on one server, so the clock on every card
// reads the same. Three devices are open on the same account at once: the
// desktop app, a phone (390 px at 3x) and a tablet (820 px). The desktop holds
// the voice session for most of the day, so the phone and the tablet show its
// cards and a dimmed, paused orb.
//
// The day, in thread order:
//   A  "Pull this week's orders by region into a table": done, its table,
//      report.csv, and the agent speaks its say line.
//   C  "Compare this week's orders with last week's": held mid-run at 60 %
//      (JobHold): three activity rows and the progress ring.
//   B  "Send Dana this week's orders, but let me approve it first": its
//      approval waits, the last card in the thread.
//   Then the user starts the next request on the desktop ("Which region grew
//   the most since last week?"). While the orb listens and the composer shows
//   what the model heard, the stills of that moment are shot: the hero's
//   desktop (1024 px, the pane closed), thread, borders-on, tablet,
//   phone-thread. The agent has not answered the approval event yet: the
//   user talks first.
//   G  the growth question: the agent answers and starts it; it is held
//      mid-run too.
//   The phone takes the voice session and listens to "Which region brought
//   in the most revenue?" over G at work (phone-listening). The agent answers
//   it with R; R ends, G is let go and ends, the phone turns the agent off.
//   The desktop: approval-card, jobs (the pane on A's Receipt), palette,
//   audit, credits. The phone: the sheet on A's Receipt (phone-sheet).
//   E  "Get the export from the reports site. I'll do the login": a handoff,
//      asked on the phone; handoff-card is shot last on the desktop.
//
// hero-light.png and hero-dark.png set three devices side by side on a plain
// backdrop, with gutters, nothing over another: the desktop window
// listening, the phone on A's Receipt (phone-sheet), and the Wear OS app
// (Paparazzi) listening in a round case. The compositor only places real
// captures. borders-split.png sets borders-on.png and thread.png (the same
// frame) side by side with a gutter.

import fs from "node:fs";
import path from "node:path";
import {
  JobHold,
  assertNoEndButton,
  fitHeightToRow,
  launch,
  openApp,
  orb,
  parkPointer,
  tapOrb,
  threadToEnd,
  toTop,
  turnOff,
} from "../lib/browser.mjs";
import { micWav } from "../lib/audio.mjs";
import { PALETTE, dataUri, renderHtml } from "../lib/compose.mjs";
import { LINES, askForJob, freshTurn, speakResult } from "../lib/day.mjs";
import { clipAround, padWithPage } from "../lib/scene.mjs";
import { startStack } from "../lib/stack.mjs";
import { log, mkdirp, run, sleep } from "../lib/util.mjs";
import { frameAt, renderWatchCall } from "../lib/wear.mjs";

/** One long spoken segment: a held listening turn needs the microphone to keep hearing speech while the stills are shot. */
const SPEECH = [[600, 55_600]];
/** What the model heard arrives over the first 1.6 s of the turn. */
const HEARD = 1600;

const DEVICES = {
  desk: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
/**
 * The hero's window: the narrowest desktop layout (the rail open, the pane
 * closed), so its type is as large as it can be in a three-device hero.
 */
const HERO_VIEWPORT = { width: 1024, height: 700 };
/** MediaWatchTest.CALL: listening runs from 800 to 1700 ms. */
const WATCH_LISTENING_MS = 1250;

async function save(page, file, opts = {}) {
  await page.evaluate(() => document.fonts.ready);
  await sleep(350);
  mkdirp(path.dirname(file));
  await page.screenshot({ path: file, animations: "allow", ...opts });
  log(`saved ${file}`);
  return file;
}

/** Desktop: the palette rows Light and Dark. Phone and tablet: Settings, Appearance. */
async function setTheme(app, theme) {
  const word = theme === "dark" ? "Dark" : "Light";
  const { page } = app;
  if (app.device === "desk") {
    await page.keyboard.press("Control+k");
    const item = page.getByRole("option", { name: word, exact: true }).first();
    await item.waitFor({ state: "visible", timeout: 5000 });
    await item.click();
  } else {
    if (app.device === "phone") {
      await page.locator('button[aria-label="Rail"]:visible').first().click();
      await sleep(500);
    }
    await page.locator('button[aria-label="Settings"]:visible').first().click();
    await sleep(400);
    await page.getByRole("radio", { name: word, exact: true }).first().click();
    await sleep(300);
    await page.keyboard.press("Escape");
    await sleep(300);
    if (app.device === "phone") {
      await page.keyboard.press("Escape");
      await sleep(400);
    }
  }
  app.theme = theme;
  // Esc hands the focus back to the Settings button, whose keyboard ring
  // would show; a user who taps on goes on without it.
  await page.evaluate(() => document.activeElement?.blur?.());
  await parkPointer(page);
  await sleep(500);
}

/** The palette's Borders row toggles borders on this device. */
async function toggleBorders(page) {
  await page.keyboard.press("Control+k");
  await page.getByRole("option", { name: "Borders" }).first().click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await parkPointer(page);
  await sleep(600);
}

const card = (page, kind, text) => page.locator(`[data-kind="${kind}"]`).filter({ hasText: text }).first();

async function waitHeard(page, text) {
  await page.waitForFunction((t) => document.querySelector('[data-kind="composer"]')?.textContent?.includes(t), text, { timeout: 10_000 });
}

async function listening(app) {
  if ((await orb(app.page).getAttribute("aria-checked")) !== "true") throw new Error(`${app.device}: the switch went off during the listening stills`);
  if ((await orb(app.page).getAttribute("data-state")) !== "listening") throw new Error(`${app.device}: the orb is not listening`);
}

/** Wait until a job card shows at least `rows` activity rows (a job held mid-run). */
async function jobAtWork(page, request, rows = 2) {
  await page.waitForFunction(
    ({ request, rows }) => {
      const c = [...document.querySelectorAll('[data-kind="job"]')].find((el) => el.textContent.includes(request));
      const slab = c?.querySelector('[data-slot="activity"][data-activity="running"]');
      return slab && slab.children.length >= 1 && (slab.innerText.match(/\n/g) ?? []).length + 1 >= rows;
    },
    { request, rows },
    { timeout: 8000 },
  ).catch(() => log(`day: ${request}: no activity rows seen; going on`));
}

/** The phone at its one window height, the thread at its end. */
async function phoneAt(phone, height) {
  await phone.page.setViewportSize({ width: DEVICES.phone.viewport.width, height });
  await sleep(500);
  await threadToEnd(phone.page);
}

/**
 * The hero (CSS px, rendered at 2x): three devices in a row on the page
 * colour, each with one soft shadow, 44 px gutters, nothing over another.
 * The desktop window is the largest; the phone is as tall as the window; the
 * watch (a round screen in a dark case with a crown) sits low beside the
 * phone. Dark: the bezels get a lighter rim, so the outlines read.
 */
const HERO = { pad: 44, top: 48, win: 900, gap: 44, watch: 196, ring: 14 };
function heroPage({ theme, desktop, phone, watch, deskSize, phoneAspect }) {
  const c = PALETTE[theme];
  const rim = theme === "dark" ? "oklch(0.30 0.006 60)" : c.border;
  const ring = theme === "dark" ? "0 0 0 2px oklch(0.32 0.006 60)," : "";
  const shadow = theme === "dark" ? "oklch(0 0 0 / 70%)" : c.shadow;
  const k = HERO.win / deskSize.width;
  const winH = Math.round(deskSize.height * k);
  const phoneImgH = winH - 20;
  const phoneW = Math.round(phoneImgH * phoneAspect) + 20;
  const phoneX = HERO.pad + HERO.win + HERO.gap;
  const caseD = HERO.watch + 2 * HERO.ring;
  const watchX = phoneX + phoneW + HERO.gap;
  // The watch's centre sits at 60 % of the window's height: a stagger, low beside the phone.
  const watchY = HERO.top + Math.round(winH * 0.6 - caseD / 2);
  const width = watchX + caseD + 8 + HERO.pad;
  const height = winH + 2 * HERO.top;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%}
  body{background:${c.page};position:relative;overflow:hidden}
  .win{position:absolute;left:${HERO.pad}px;top:${HERO.top}px;width:${HERO.win}px;border-radius:12px;overflow:hidden;border:1.5px solid ${rim};box-shadow:0 28px 70px -30px ${shadow}}
  .win img{display:block;width:100%}
  .phone{position:absolute;left:${phoneX}px;top:${HERO.top}px;width:${phoneW - 20}px;padding:10px;border-radius:48px;background:#0d0d0c;box-shadow:${ring}0 28px 64px -26px ${shadow}}
  .phone img{display:block;width:100%;border-radius:38px}
  .watch{position:absolute;left:${watchX}px;top:${watchY}px;width:${HERO.watch}px;height:${HERO.watch}px;padding:${HERO.ring}px;border-radius:50%;background:#1b1b1a;box-shadow:${ring}0 24px 50px -20px ${shadow},inset 0 0 0 2px #2c2c2a}
  .watch img{display:block;width:100%;height:100%;border-radius:50%}
  .crown{position:absolute;left:${watchX + caseD - 3}px;top:${watchY + caseD / 2 - 17}px;width:11px;height:34px;border-radius:4px;background:#2a2a28;box-shadow:${ring}0 6px 14px -8px ${shadow}}
  </style></head><body>
  <div class="win"><img src="${dataUri(desktop)}"></div>
  <div class="phone"><img src="${dataUri(phone)}"></div>
  <div class="crown"></div>
  <div class="watch"><img src="${dataUri(watch)}"></div>
  </body></html>`;
  return { html, width, height };
}

/**
 * Borders on (left) and off (right): two whole captures of the same frame
 * side by side, 24 CSS px of page colour between them and around them, each
 * in a hairline frame so the borderless capture keeps its edge. Opaque RGB.
 */
async function twoUp(on, off, out, theme) {
  const page = PALETTE[theme].hex;
  const line = theme === "dark" ? "#34302d" : "#ddd8cf";
  const gap = 48; // 24 CSS px at 2x
  const framed = async (src, name) => {
    const f = path.join(path.dirname(out), `.${name}-${theme}.png`);
    await run("convert", [src, "-bordercolor", line, "-border", "2", "-alpha", "off", f]);
    return f;
  };
  const a = await framed(on, "on");
  const b = await framed(off, "off");
  await run("convert", ["-background", page, a, "(", "-size", `${gap}x1`, `xc:${page}`, ")", b, "-gravity", "center", "+append",
    "-bordercolor", page, "-border", String(gap), "-alpha", "off", "-strip", "-define", "png:color-type=2", out]);
  fs.rmSync(a);
  fs.rmSync(b);
  log(`saved ${out}`);
  return out;
}

/** Grow every file to the largest width and height among them, the capture centred on its page colour: one canvas for the close cards. */
async function sameCanvas(files) {
  const sizes = [];
  for (const f of files) sizes.push((await run("identify", ["-format", "%w %h", f])).trim().split(" ").map(Number));
  const W = Math.max(...sizes.map((s) => s[0]));
  const H = Math.max(...sizes.map((s) => s[1]));
  for (const f of files) {
    const bg = (await run("convert", [f, "-format", "%[pixel:p{0,0}]", "info:"])).trim();
    await run("convert", [f, "-background", bg, "-gravity", "center", "-extent", `${W}x${H}`, "-alpha", "off", f]);
  }
  log(`day: ${files.map((f) => path.basename(f)).join(", ")} on one ${W} x ${H} canvas`);
}

export default {
  name: "day",
  kind: "still",
  makes:
    "hero-light.png, hero-dark.png, thread, borders-on, borders-split, tablet, phone-thread, phone-sheet, phone-listening, jobs, approval-card, palette, audit, credits, handoff-card (each + -dark)",
  async run(ctx) {
    const work = mkdirp(path.join(ctx.work, "day"));
    const parts = mkdirp(path.join(work, "parts"));
    const out = (base, theme) => path.join(ctx.out, theme === "dark" ? `${base}-dark.png` : `${base}.png`);
    const made = [];
    // The watch first: Paparazzi needs no server, and a failure here should
    // not cost a whole day. The hero shows it listening: in a voice session.
    const call = await renderWatchCall(path.join(work, "watch"));
    const watch = path.join(parts, "watch-listening.png");
    fs.copyFileSync(frameAt(call, WATCH_LISTENING_MS), watch);

    const wav = await micWav(path.join(work, "mic.wav"), { segments: SPEECH, totalMs: 70_000 });
    const stack = await startStack({ work: path.join(work, "stack"), webDist: ctx.webDist });
    const browser = await launch({ micWav: wav });
    const noise = [];
    const holdC = new JobHold(LINES.compareJob, { percent: 60 });
    const holdG = new JobHold(LINES.growthJob, { percent: 60 });
    const holds = [holdC, holdG];
    try {
      const open = async (device, opts = {}) => {
        const app = await openApp(browser, stack, { device: DEVICES[device], noise, hold: holds, ...opts });
        app.device = device;
        app.stack = stack;
        return app;
      };
      const desk = await open("desk", { platform: "desktop" });
      const phone = await open("phone");
      const tablet = await open("tablet");
      const dp = desk.page;
      const pp = phone.page;

      // A, done; C, held mid-run; B, its approval waiting.
      const a = await askForJob(desk, { ask: LINES.ordersAsk, ack: LINES.ordersAck, request: LINES.ordersJob, heardMs: HEARD });
      await speakResult(desk, a);
      await askForJob(desk, { ask: LINES.compareAsk, ack: LINES.compareAck, request: LINES.compareJob, heardMs: HEARD });
      await askForJob(desk, { ask: LINES.danaAsk, ack: LINES.danaAck, request: LINES.danaJob, heardMs: HEARD });
      await desk.live.event(/^<event>approval: /);
      await sleep(800);

      // The next request: the user speaks before the agent answers the
      // approval event. The orb listens; the stills of this moment.
      await freshTurn(desk);
      await desk.live.hear(LINES.growthAsk, { ms: HEARD });
      await waitHeard(dp, "since last week");
      await sleep(600);

      // The hero's window: 1024 px, the pane closed, the thread at its end.
      await dp.setViewportSize(HERO_VIEWPORT);
      const heroH = await fitHeightToRow(dp, { min: HERO_VIEWPORT.height, max: 780 });
      const heroSize = { width: HERO_VIEWPORT.width, height: heroH };
      log(`day: hero window ${HERO_VIEWPORT.width} x ${heroH}`);
      const heroDesk = {};
      for (const theme of ["dark", "light"]) {
        if (theme !== desk.theme) await setTheme(desk, theme);
        await threadToEnd(dp);
        await assertNoEndButton(dp, "hero desktop");
        await listening(desk);
        heroDesk[theme] = await save(dp, path.join(parts, `hero-desktop-${theme}.png`));
      }
      await dp.setViewportSize(DEVICES.desk.viewport);
      await sleep(400);

      // thread (borderless, the default), borders-on: the same window height and scroll, a row boundary at the top.
      const threadH = await fitHeightToRow(dp, { min: 800, max: 900 });
      log(`day: thread window 1280 x ${threadH}`);
      const pair = {};
      for (const theme of ["light", "dark"]) {
        if (theme !== desk.theme) await setTheme(desk, theme);
        await threadToEnd(dp);
        await assertNoEndButton(dp, "thread");
        await listening(desk);
        pair[theme] = { off: await save(dp, out("thread", theme)) };
        await toggleBorders(dp);
        await threadToEnd(dp);
        await listening(desk);
        pair[theme].on = await save(dp, out("borders-on", theme));
        await toggleBorders(dp);
        made.push(pair[theme].off, pair[theme].on, await twoUp(pair[theme].on, pair[theme].off, out("borders-split", theme), theme));
      }

      // The tablet and the phone: the approval card last, above a dimmed orb.
      await fitHeightToRow(tablet.page, { min: 1180, max: 1240 });
      for (const theme of ["light", "dark"]) {
        if (theme !== tablet.theme) await setTheme(tablet, theme);
        await threadToEnd(tablet.page);
        await assertNoEndButton(tablet.page, "tablet");
        made.push(await save(tablet.page, out("tablet", theme)));
      }
      // One window height for every phone still, so the gallery row is even.
      const phoneH = await fitHeightToRow(pp, { min: 780, max: 920 });
      log(`day: phone window 390 x ${phoneH}`);
      for (const theme of ["light", "dark"]) {
        if (theme !== phone.theme) await setTheme(phone, theme);
        await threadToEnd(pp);
        await assertNoEndButton(pp, "phone thread");
        made.push(await save(pp, out("phone-thread", theme)));
      }

      // G: the turn ends, the agent answers it with a job, held mid-run.
      await listening(desk);
      await desk.live.endTurn();
      const g = (await desk.live.agent(LINES.growthAck, { tool: { name: "start_job", args: { request: LINES.growthJob } } })).job_id;
      await jobAtWork(pp, LINES.growthJob);
      await sleep(1200);

      // The phone takes the voice session and listens over G at work.
      await tapOrb(phone);
      await phone.live.hear(LINES.revenueAsk, { ms: HEARD });
      await waitHeard(pp, "most revenue");
      await sleep(600);
      for (const theme of ["light", "dark"]) {
        if (theme !== phone.theme) await setTheme(phone, theme);
        await phoneAt(phone, phoneH);
        await assertNoEndButton(pp, "phone listening");
        await listening(phone);
        made.push(await save(pp, out("phone-listening", theme)));
      }
      await setTheme(phone, "light");
      await phone.live.endTurn();
      const r = (await phone.live.agent(LINES.revenueAck, { tool: { name: "start_job", args: { request: LINES.revenueJob } } })).job_id;
      await speakResult(phone, r);
      holdG.release();
      await speakResult(phone, g);
      await turnOff(phone);
      await sleep(800);

      // Desktop stills with the agent off.
      for (const theme of ["light", "dark"]) {
        if (theme !== desk.theme) await setTheme(desk, theme);
        // The approval card, close.
        await threadToEnd(dp);
        const approval = dp.locator('[data-kind="approval"]').last();
        await approval.scrollIntoViewIfNeeded();
        await parkPointer(dp);
        await sleep(400);
        const f = await save(dp, out("approval-card", theme), { clip: await clipAround(approval, 32, 8) });
        await padWithPage(f, 48);
        made.push(f);
        // Jobs, the pane on A's Receipt.
        await dp.keyboard.press("Control+2");
        await sleep(600);
        await dp.locator('[data-job-id]').filter({ hasText: LINES.ordersJob }).first().locator('[role="button"]').first().click();
        await dp.getByRole("tab", { name: "Receipt" }).first().click();
        await toTop(dp);
        made.push(await save(dp, out("jobs", theme)));
        await dp.keyboard.press("Control+j");
        await dp.keyboard.press("Control+1");
        await sleep(600);
        // The palette over the whole window.
        await threadToEnd(dp);
        await dp.keyboard.press("Control+k");
        await dp.locator('[data-slot="dialog-content"]').first().waitFor({ state: "visible" });
        await sleep(600);
        made.push(await save(dp, out("palette", theme)));
        await dp.keyboard.press("Escape");
        await sleep(400);
        // Audit: the newest entries; Credits: the balance and its history.
        await dp.keyboard.press("Control+4");
        await sleep(900);
        await toTop(dp);
        made.push(await save(dp, out("audit", theme)));
        await dp.keyboard.press("Control+5");
        await sleep(900);
        await toTop(dp);
        made.push(await save(dp, out("credits", theme)));
        await dp.keyboard.press("Control+1");
        await sleep(600);
      }
      await setTheme(desk, "light");

      // Phone: the sheet on A's Receipt, at the same window height.
      await phoneAt(phone, phoneH);
      for (const theme of ["light", "dark"]) {
        if (theme !== phone.theme) await setTheme(phone, theme);
        await card(pp, "job", LINES.ordersJob).scrollIntoViewIfNeeded();
        await card(pp, "job", LINES.ordersJob).locator('[role="button"]').first().click();
        await sleep(700);
        await pp.getByRole("tab", { name: "Receipt" }).first().click();
        await sleep(500);
        await parkPointer(pp);
        made.push(await save(pp, out("phone-sheet", theme)));
        await pp.keyboard.press("Escape");
        await sleep(600);
      }
      await setTheme(phone, "light");

      // E on the phone: a handoff.
      await tapOrb(phone);
      await phone.live.hear(LINES.exportAsk, { ms: HEARD });
      await waitHeard(pp, "the login");
      await phone.live.endTurn();
      await phone.live.agent(LINES.exportAck, { tool: { name: "start_job", args: { request: LINES.exportJob } } });
      await phone.live.event(/^<event>handoff: /);
      await phone.live.agent(LINES.exportWait);
      await sleep(800);

      // The handoff card, close, on the desktop.
      for (const theme of ["light", "dark"]) {
        if (theme !== desk.theme) await setTheme(desk, theme);
        await threadToEnd(dp);
        const handoff = dp.locator('[data-kind="handoff"]').last();
        await handoff.scrollIntoViewIfNeeded();
        await parkPointer(dp);
        await sleep(400);
        const f = await save(dp, out("handoff-card", theme), { clip: await clipAround(handoff, 32, 8) });
        await padWithPage(f, 48);
        made.push(f);
        // The two close cards share one canvas, so the gallery row keeps one type size and height.
        await sameCanvas([out("approval-card", theme), f]);
      }
      for (const theme of ["light", "dark"]) {
        const phoneShot = out("phone-sheet", theme);
        const [pw, ph] = (await run("identify", ["-format", "%w %h", phoneShot])).trim().split(" ").map(Number);
        const hero = heroPage({ theme, desktop: heroDesk[theme], phone: phoneShot, watch, deskSize: heroSize, phoneAspect: pw / ph });
        made.push(await renderHtml(hero.html, path.join(ctx.out, `hero-${theme}.png`), { width: hero.width, height: hero.height, scale: 2 }));
      }
      return made;
    } finally {
      if (noise.length) {
        fs.writeFileSync(path.join(work, "console.txt"), noise.join("\n") + "\n");
        log(`day: ${noise.length} console warnings or errors (see ${path.join(work, "console.txt")})`);
      }
      for (const h of holds) h.release();
      await browser.close().catch(() => {});
      await stack.stop();
    }
  },
};
