// phone-<n>-<screen>.png (+ -dark): a morning on the phone, 17 screens at
// 390 x 844 and 3x, the phone holding the voice session for the whole tour.
// sheet-light.png and sheet-dark.png: the screens in order, 6 to a row.
//
// Each theme runs the whole morning on its own fresh stack (a real X desktop
// for the VM screen, the session server in demo mode, agentd in xdo mode), so
// a passing state (listening, a job at work, speaking) is shot as it happens
// and no theme switch runs in the middle of the story. The client is the web
// build with the shell seam set to platform "android", as the Capacitor shell
// sets it, so the rail footer reads "Android".
//
// The morning, in shot order:
//   1  empty      a fresh thread, the agent off, the 128 px orb
//   2  listening  a tap on the orb; what the model heard fills in above it
//   3  working    "On it." and the orders job, held mid-run (JobHold)
//   4  done       the job's table, report.csv and its say line, spoken
//   17 borders-on the same frame with Borders on (shot here, numbered last)
//   5  receipt    the pane as a bottom sheet on the job's Receipt
//   6  steps      the Steps tab
//   7  artifacts  the Artifacts tab
//   8  approval   "Send Dana this week's orders": Approve and Deny, stacked
//   9  approved   after Approve: the chip, the job back at work (held at 60 %);
//                 the user asks to hear when it is sent, the agent says it will
//   10 handoff    "Get the export from the reports site": the locked Screen
//                 sheet with the reason, the VM stream of the site's sign-in
//                 page, Done and Cancel; the page closes after Done
//   11 screen     the Screen from the top bar (shot after 15 and the
//                 comparison's result): Control, a
//                 command typed through the page, Release
//   12 jobs       the Jobs view: a second approval waits, the comparison runs
//                 (held), the morning's jobs are done
//   13 menu       the rail as a sheet
//   14 settings   the settings popover from the rail footer
//   15 credits    the Credits view
//   16 speaking   a follow-up question about the result: the agent starts a
//                 job (the voice prompt sends follow-ups to start_job) and
//                 speaks its say line; shot mid-line
//
// The phone's window is fixed at 844 px, so a thread frame cannot pick its
// height to start on a whole row (fitHeightToRow); the lines of 9 and 16 are
// sized so the end of the thread starts on one. The terminal hides its text
// cursor (desk.termCursor).

import fs from "node:fs";
import path from "node:path";
import { JobHold, assertNoEndButton, orb, parkPointer, primeSwitch, tapOrb, threadToEnd } from "../lib/browser.mjs";
import { PALETTE } from "../lib/compose.mjs";
import { LINES, freshTurn, speakResult } from "../lib/day.mjs";
import { LiveStandIn, speakMs } from "../lib/live.mjs";
import { terminalBox, waitForFrames, withScreen } from "../lib/screen.mjs";
import { COMMAND, pointerAt, pointerPath, seedTerminal } from "../lib/screenflow.mjs";
import { grab } from "../lib/xdesktop.mjs";
import { openSignIn } from "../lib/signin.mjs";
import { log, mkdirp, run, sleep } from "../lib/util.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
/** One long spoken segment a turn: the listening still is shot while the gate is still open. */
const SPEECH = [[600, 6600]];
/** What the model heard arrives over the first 1.6 s of the turn. */
const HEARD = 1600;
/** The X desktop at the still's size; the phone shows it at 16:9 across the sheet. */
const SCREEN = { width: 1280, height: 720 };

const TOUR = {
  againAsk: "Send Dana the table again, but let me approve it first.",
  againAck: "I will draft it and check with you first.",
  againJob: "Send Dana the table again, but let me approve it first",
  handoffWait: "Sign in to the reports site on your computer.",
  sentAsk: "Thanks. Tell me when it is sent.",
  sentAck: "I will.",
  // Two lines on the phone: with them, the end of the thread starts on the comparison's say line.
  revenueAck: "I will add up this week's revenue for each region.",
};

const SHOTS = ["empty", "listening", "working", "done", "receipt", "steps", "artifacts", "approval", "approved", "handoff", "screen", "jobs", "menu", "settings", "credits", "speaking", "borders-on"];

function fileFor(out, n, theme) {
  return path.join(out, `phone-${n}-${SHOTS[n - 1]}${theme === "dark" ? "-dark" : ""}.png`);
}

/** No keyboard ring, no hover, fonts in, then the whole page at 3x. */
async function save(app, n, theme, { park = true } = {}) {
  const { page } = app;
  await page.evaluate(() => document.activeElement?.blur?.());
  if (park) await parkPointer(page);
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  const toasts = await page.locator('[data-sonner-toast], [role="status"][data-state="open"]').count();
  if (toasts) throw new Error(`phone-${n}: a toast shows`);
  const file = fileFor(app.out, n, theme);
  mkdirp(path.dirname(file));
  await page.screenshot({ path: file, animations: "allow" });
  log(`saved ${file}`);
  return file;
}

const job = (page, text) => page.locator('[data-kind="job"]').filter({ hasText: text }).first();

async function waitHeard(page, text) {
  await page.waitForFunction((t) => document.querySelector('[data-kind="composer"]')?.textContent?.includes(t), text, { timeout: 15_000 });
}

/** Wait until a job card's live activity shows `text` (a job held mid-run). */
async function activityShows(page, request, text) {
  await page.waitForFunction(
    ({ request, text }) => {
      const c = [...document.querySelectorAll('[data-kind="job"]')].find((el) => el.textContent.includes(request));
      return !!c && c.getAttribute("data-state") !== "done" && c.textContent.includes(text);
    },
    { request, text },
    { timeout: 20_000 },
  );
}

async function jobDone(page, request) {
  await page.waitForFunction(
    (request) => [...document.querySelectorAll('[data-kind="job"][data-state="done"]')].some((el) => el.textContent.includes(request)),
    request,
    { timeout: 30_000 },
  );
}

/**
 * The thread at its end, then nudged up by at most the empty space under its
 * last card, so no line of text is cut by the thread's top edge. At the end
 * of the thread a phone shows whatever row the height lands on; this picks
 * the nearest scroll where that row is whole, with nothing cut at the bottom.
 */
async function settleTop(page) {
  await threadToEnd(page);
  const moved = await page.evaluate(() => {
    const vp = document.querySelector('[data-kind="thread"] [data-radix-scroll-area-viewport]');
    if (!vp) return null;
    const box = vp.getBoundingClientRect();
    const col = vp.querySelector(".max-w-\\[760px\\]") ?? vp.firstElementChild;
    const last = col?.lastElementChild?.getBoundingClientRect();
    const slack = last ? Math.floor(box.bottom - last.bottom - 8) : 0;
    const lines = [];
    const walk = document.createTreeWalker(vp, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.height > 0) lines.push([q.top, q.bottom]);
    }
    const cut = (s) => lines.some(([t, b]) => t + s < box.top - 1 && b + s > box.top + 1);
    for (let s = 0; s <= slack; s++) {
      if (!cut(s)) {
        vp.scrollTop -= s;
        return { s, slack };
      }
    }
    return { s: -1, slack };
  });
  await sleep(400);
  return moved;
}

/** The Screen sheet from the top bar, with decoded frames; one more try (close, open) when none arrive. */
async function openScreenSheet(page) {
  for (let i = 0; ; i++) {
    await page.locator('header button[aria-label="Screen"]').first().click();
    try {
      return await waitForFrames(page, 20_000);
    } catch (e) {
      if (i > 0) throw e;
      log("phone-11: no frames yet; the sheet is closed and opened again");
      await closeAll(page);
      await sleep(1500);
    }
  }
}

/**
 * Type as a person types on a phone keyboard: each key down, held, up, and a
 * pause before the next. agentd runs one xdotool process per input event and
 * does not wait for one before the next, so keys sent 40 ms apart at times
 * reach the VM out of order or as control characters (a letter as Ctrl+letter,
 * a shifted key unshifted); a key every 180 ms lands as typed.
 */
async function typeSlowly(page, text) {
  for (const ch of text) {
    await page.keyboard.down(ch);
    await sleep(70);
    await page.keyboard.up(ch);
    await sleep(110);
  }
  await page.keyboard.down("Enter");
  await sleep(70);
  await page.keyboard.up("Enter");
}

/** Pixels of the terminal that differ between two X grabs (0 when none). */
async function terminalChange(desk, a, b) {
  const t = await terminalBox(desk);
  const box = `${t.w}x${t.h}+${t.x}+${t.y}`;
  const out = await run("compare", ["-metric", "AE", "-fuzz", "10%", "(", a, "-crop", box, ")", "(", b, "-crop", box, ")", "null:"])
    .then(() => "0")
    .catch((e) => String(e.message).trim().split("\n").pop());
  return Number.parseFloat(String(out).replace(/^.*\s/, "")) || 0;
}

/**
 * Control, once the server grants it (Release shows); the pointer into the
 * terminal, a tap, the command typed through the page. The X server is read
 * until the terminal changes; nothing is typed twice.
 */
async function controlAndType(app, desk) {
  const { page } = app;
  const bar = page.locator('[data-slot="screen-bar"]');
  await bar.getByRole("button", { name: "Control", exact: true }).click();
  await bar.getByRole("button", { name: "Release", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await sleep(800);
  const { from, to } = await pointerPath(page, desk);
  await page.mouse.move(from.x, from.y);
  await sleep(200);
  // Few moves: agentd runs one xdotool process per input event, and a long
  // queue of moves holds back the keys that follow by many seconds.
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await sleep(300);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(500);
  // The keys go through the video's own key handlers, so the video must hold the focus, as a tap on it gives.
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "none");
  if (focused !== "VIDEO") {
    log(`phone-11: the focus is on ${focused} after the tap; the video takes it`);
    await page.locator("video").first().focus();
  }
  const before = path.join(app.work, "x-before-typing.png");
  await grab(desk.display, before);
  await typeSlowly(page, COMMAND);
  const after = path.join(app.work, "x-after-typing.png");
  const landed = async (n) => {
    for (let i = 0; i < n; i++) {
      await sleep(500);
      await grab(desk.display, after);
      if ((await terminalChange(desk, before, after)) > 2000) return true;
    }
    return false;
  };
  if (await landed(40)) return;
  throw new Error("the typed command did not reach the VM terminal");
}

/**
 * How far a frame of the stream is from the X screen: the video's part of
 * `still` (a saved screenshot), or the video element as it shows now, and an
 * X grab, both scaled to 128 x 72; the pixels more than 3 % apart. A clean
 * frame reads under 100 (the clock's hands, the pointer); one with stale
 * codec blocks or a grey cast reads in the thousands.
 */
async function streamDiff(app, desk, still = null, fuzz = "3%") {
  const shown = path.join(app.work, "stream-shown.png");
  const real = path.join(app.work, "stream-x.png");
  const video = app.page.locator("video").first();
  if (still) {
    const b = await video.boundingBox();
    const k = PHONE.deviceScaleFactor;
    const crop = `${Math.round(b.width * k)}x${Math.round(b.height * k)}+${Math.round(b.x * k)}+${Math.round(b.y * k)}`;
    await run("convert", [still, "-crop", crop, "+repage", shown]);
  } else await video.screenshot({ path: shown });
  await grab(desk.display, real);
  const out = await run("compare", ["-metric", "AE", "-fuzz", fuzz, "(", shown, "-resize", "128x72!", ")", "(", real, "-resize", "128x72!", ")", "null:"])
    .then(() => "0")
    .catch((e) => String(e.message).trim().split("\n").pop());
  return Number.parseFloat(String(out).replace(/^.*\s/, "")) || 0;
}

/**
 * aiortc's VP8 encoder starts over on a key frame whenever its target
 * bitrate moves, and the first frames after that are coarse (a grey cast,
 * blocks of the frame before) until it refines them. Wait up to `ms` for the
 * shown frame to match the X screen, then up to 8 s more for the faint tints
 * a flat page keeps a while (1.5 % apart, under 150 px). Resolves with
 * whether the frame matches.
 */
async function streamSettles(app, desk, name, ms = 20_000) {
  const until = Date.now() + ms;
  let diff = Infinity;
  for (;;) {
    diff = await streamDiff(app, desk);
    if (diff < 300 || Date.now() > until) break;
    await sleep(1000);
  }
  let fine = Infinity;
  if (diff < 300) {
    const refine = Date.now() + 8000;
    for (;;) {
      fine = await streamDiff(app, desk, null, "1.5%");
      if (fine < 150 || Date.now() > refine) break;
      await sleep(1000);
    }
  }
  log(`${name}: the stream is ${diff} px (of 9216) from the X screen, ${fine} px at 1.5 %`);
  return diff < 300;
}

/** A still of the VM screen whose video part matches the X screen; a still caught on a coarse frame is taken again. */
async function saveScreen(app, desk, n, theme) {
  for (let i = 0; i < 8; i++) {
    if (!(await streamSettles(app, desk, `phone-${n}`))) break;
    const file = await save(app, n, theme, { park: false });
    const diff = await streamDiff(app, desk, file);
    log(`phone-${n}: the still's video is ${diff} px from the X screen`);
    if (diff < 300) return file;
    await sleep(1500);
  }
  throw new Error(`phone-${n}: the stream shows stale blocks in every still`);
}

async function orbState(page) {
  return orb(page).getAttribute("data-state");
}

/** The rail sheet from the top bar. */
async function openRail(page) {
  await page.locator('header button[aria-label="Rail"]').first().click();
  await page.locator('[data-slot="sheet-content"][data-side="left"], [data-slot="sheet-content"]').first().waitFor({ state: "visible" });
  await sleep(700);
}

/** A rail nav row; the sheet closes on the way. */
async function railTo(page, label) {
  await openRail(page);
  await page.locator('[data-slot="sheet-content"] button').filter({ hasText: new RegExp(`^${label}`) }).first().click();
  await sleep(900);
  if (await page.locator('[data-slot="sheet-content"]:visible').count()) {
    await page.keyboard.press("Escape");
    await sleep(600);
  }
}

/** Settings from the rail footer, inside the rail sheet. */
async function openSettings(page) {
  await openRail(page);
  await page.locator('[data-slot="sheet-content"] button[aria-label="Settings"]').first().click();
  await page.locator('[data-slot="popover-content"]').first().waitFor({ state: "visible" });
  await sleep(600);
}

async function closeAll(page) {
  for (let i = 0; i < 3 && (await page.locator('[data-slot="popover-content"]:visible, [data-slot="sheet-content"]:visible').count()); i++) {
    await page.keyboard.press("Escape");
    await sleep(500);
  }
}

async function setBorders(page, on) {
  await openSettings(page);
  const sw = page.getByRole("switch", { name: "Borders" }).first();
  if (((await sw.getAttribute("aria-checked")) === "true") !== on) await sw.click();
  await sleep(300);
  await closeAll(page);
  const shown = await page.evaluate(() => document.documentElement.getAttribute("data-borders"));
  if ((shown !== "off") !== on) throw new Error(`Borders did not turn ${on ? "on" : "off"} (data-borders=${shown})`);
}

/** The pane sheet on a job's tab, from the card's own button. */
async function openJob(page, request, tab) {
  await job(page, request).scrollIntoViewIfNeeded();
  await job(page, request).locator('[role="button"]').first().click();
  await sleep(800);
  await page.getByRole("tab", { name: tab }).first().click();
  await sleep(600);
}

/** A spoken request that starts a job: a fresh switch-on, the heard line, the short answer and start_job in one turn. */
async function ask(app, { ask, ack, request }) {
  await freshTurn(app);
  await app.live.user(ask, { ms: HEARD });
  return (await app.live.agent(ack, { tool: { name: "start_job", args: { request } } })).job_id;
}

async function morning(ctx, theme) {
  const holdA = new JobHold(LINES.ordersJob, { percent: 50 });
  const holdDana = new JobHold(LINES.danaJob, { percent: 60 });
  const holdCompare = new JobHold(LINES.compareJob, { percent: 60 });
  const holds = [holdA, holdDana, holdCompare];
  return withScreen(
    ctx,
    { name: `phone-tour-${theme}`, device: PHONE, theme, mic: SPEECH, micMs: 300_000, hold: holds, platform: "android", screen: SCREEN },
    async (app, { desk }) => {
      const { page, live } = app;
      app.out = ctx.out;
      const made = [];
      const shoot = async (n, opts) => made.push(await save(app, n, theme, opts));

      // 1 empty: a fresh thread, the agent off.
      await page.locator('[role="switch"][aria-label="Agent"]').first().waitFor({ state: "visible" });
      await sleep(1200);
      const dim = await page.evaluate(() => {
        const sw = [...document.querySelectorAll('[role="switch"][aria-label="Agent"]')];
        return sw.map((el) => getComputedStyle(el).opacity + "/" + (el.closest("[class*='opacity-40']") ? "dim" : ""));
      });
      log(`phone-tour-${theme}: the orbs on a fresh load read ${JSON.stringify(dim)}`);
      // A fresh load dims and pauses the orb until the first tap (README, known
      // defects): one tap on and one off first, the state of any returning user.
      await primeSwitch(app);
      await shoot(1);

      // 2 listening: a tap on the 128 px orb, the request heard.
      await tapOrb(app, { big: true });
      await live.hear(LINES.ordersAsk, { ms: HEARD });
      await waitHeard(page, "into a table");
      await sleep(500);
      if ((await orbState(page)) !== "listening") throw new Error(`phone-2: the orb reads ${await orbState(page)}, not listening`);
      await shoot(2);

      // 3 working: "On it." and the job, held at its second step.
      await live.endTurn();
      const a = (await live.agent(LINES.ordersAck, { tool: { name: "start_job", args: { request: LINES.ordersJob } } })).job_id;
      await activityShows(page, LINES.ordersJob, "Grouping by region");
      await sleep(900);
      log(`phone-3 top: ${JSON.stringify(await settleTop(page))}`);
      await assertNoEndButton(page, "phone-3");
      await shoot(3);

      // 4 done: the job ends, the agent speaks its say line.
      holdA.release();
      await speakResult(app, a);
      await jobDone(page, LINES.ordersJob);
      await sleep(900);
      log(`phone-4 top: ${JSON.stringify(await settleTop(page))}`);
      await assertNoEndButton(page, "phone-4");
      await shoot(4);

      // 17 borders-on: the same frame, Borders on (the opt-in), then off again.
      await setBorders(page, true);
      log(`phone-17 top: ${JSON.stringify(await settleTop(page))}`);
      await shoot(17);
      await setBorders(page, false);
      await threadToEnd(page);

      // The terminal opens on the VM in ~/reports, where the job wrote report.csv.
      desk.termCursor = false;
      await seedTerminal(app, desk);

      // 5, 6, 7: the pane as a bottom sheet on the job.
      await openJob(page, LINES.ordersJob, "Receipt");
      await shoot(5);
      await page.getByRole("tab", { name: "Steps" }).first().click();
      await sleep(600);
      await shoot(6);
      await page.getByRole("tab", { name: "Artifacts" }).first().click();
      await sleep(600);
      await shoot(7);
      await closeAll(page);

      // 8 approval: a job that needs you, the card last above the orb.
      const dana = await ask(app, { ask: LINES.danaAsk, ack: LINES.danaAck, request: LINES.danaJob });
      await live.event(/^<event>approval: /);
      await page.locator('[data-kind="approval"]').last().waitFor({ state: "visible" });
      await sleep(900);
      log(`phone-8 top: ${JSON.stringify(await settleTop(page))}`);
      await assertNoEndButton(page, "phone-8");
      await shoot(8);

      // 9 approved: the chip, the job back at work, held at its third step.
      await page.locator('[data-kind="approval"]').last().getByRole("button", { name: "Approve", exact: true }).click();
      await activityShows(page, LINES.danaJob, "Writing report.csv");
      await freshTurn(app);
      await live.user(TOUR.sentAsk, { ms: HEARD });
      await live.agent(TOUR.sentAck);
      await sleep(900);
      log(`phone-9 top: ${JSON.stringify(await settleTop(page))}`);
      await assertNoEndButton(page, "phone-9");
      await shoot(9);
      holdDana.release();
      await speakResult(app, dana);
      await jobDone(page, LINES.danaJob);

      // 10 handoff: the job asks you to sign in; the locked sheet opens on the
      // Screen, where the site's sign-in page is open (saveScreen waits for
      // the stream to match the X screen).
      const site = await openSignIn(desk, app.work);
      const exp = await ask(app, { ask: LINES.exportAsk, ack: LINES.exportAck, request: LINES.exportJob });
      await live.event(/^<event>handoff: /);
      await waitForFrames(page);
      await live.agent(TOUR.handoffWait);
      await sleep(1500);
      await parkPointer(page);
      made.push(await saveScreen(app, desk, 10, theme));
      await page.locator('[data-slot="screen-bar"]').getByRole("button", { name: "Done", exact: true }).click();
      await site.close();
      await speakResult(app, exp);
      await jobDone(page, LINES.exportJob);

      // Done leaves the sheet on the Screen; the user closes it.
      await closeAll(page);

      // 12 jobs: a second approval waits, the comparison runs.
      await ask(app, { ask: TOUR.againAsk, ack: TOUR.againAck, request: TOUR.againJob });
      await live.event(/^<event>approval: /);
      const compare = await ask(app, { ask: LINES.compareAsk, ack: LINES.compareAck, request: LINES.compareJob });
      await activityShows(page, LINES.compareJob, "Comparing the two weeks");
      await sleep(600);
      await railTo(page, "Jobs");
      await shoot(12);

      // 13 menu, 14 settings.
      await openRail(page);
      await shoot(13);
      await page.locator('[data-slot="sheet-content"] button[aria-label="Settings"]').first().click();
      await page.locator('[data-slot="popover-content"]').first().waitFor({ state: "visible" });
      await sleep(600);
      await shoot(14);
      await closeAll(page);

      // 15 credits.
      await railTo(page, "Credits");
      await shoot(15);

      // The comparison ends; back on the thread.
      await railTo(page, "Thread");
      holdCompare.release();
      await speakResult(app, compare);

      // 11 screen (shot here, numbered in story order; the comparison has
      // ended first, as the voice session closes after 2 idle minutes and a
      // slow Screen would outlast it): the Screen from the top bar, Control,
      // a command typed through the page, Release. A fresh stream starts on
      // a key frame; the handoff's stream, kept open after Done, kept faint
      // blocks of the closed sign-in page for as long as we waited.
      // At times no key of the first try reaches the VM (the X server shows
      // the terminal unchanged), and at times the stream keeps stale blocks;
      // either way the user releases, closes the sheet and opens the Screen
      // again. The command is typed once.
      let typed = false;
      for (let attempt = 1; ; attempt++) {
        await openScreenSheet(page);
        await page.waitForFunction(() => document.querySelector('[data-slot="screen-frame"]')?.getAttribute("data-status") === "live", null, { timeout: 20_000 });
        await sleep(1500);
        let failed = null;
        try {
          if (!typed) {
            await controlAndType(app, desk);
            typed = true;
          } else {
            const bar = page.locator('[data-slot="screen-bar"]');
            await bar.getByRole("button", { name: "Control", exact: true }).click();
            await bar.getByRole("button", { name: "Release", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
          }
          // The X pointer goes back to the screen's bottom-right corner, where its arrow falls off the frame.
          const v = await page.locator("video").first().boundingBox();
          await page.mouse.move(v.x + v.width - 1, v.y + v.height - 1);
          await pointerAt(desk, { x: Math.round(((v.width - 1) / v.width) * SCREEN.width), y: Math.round(((v.height - 1) / v.height) * SCREEN.height) }, 15_000);
          await sleep(1500);
          made.push(await saveScreen(app, desk, 11, theme));
        } catch (e) {
          failed = e;
        }
        if (!failed) break;
        if (attempt >= 3) throw failed;
        log(`${failed.message}; the Screen opens again`);
        if (!typed) {
          // Keys can still be on their way: the command is typed again only if the terminal never changed.
          await sleep(15_000);
          const now = path.join(app.work, "x-retry.png");
          await grab(desk.display, now);
          if ((await terminalChange(desk, path.join(app.work, "x-before-typing.png"), now)) > 2000) {
            typed = true;
            log("phone-11: the keys landed late");
          }
        }
        const release = page.locator('[data-slot="screen-bar"]').getByRole("button", { name: "Release", exact: true });
        if (await release.count()) await release.click();
        await sleep(500);
        await closeAll(page);
        await sleep(1500);
      }
      await page.locator('[data-slot="screen-bar"]').getByRole("button", { name: "Release", exact: true }).click();
      await sleep(500);
      await closeAll(page);

      // 16 speaking: a follow-up question about the result.
      const rev = await ask(app, { ask: LINES.revenueAsk, ack: TOUR.revenueAck, request: LINES.revenueJob });
      const said = LiveStandIn.sayOf(await live.event(new RegExp(`^<event>job\\.done ${rev}:`), { timeout: 60_000 }));
      // A slow line (1.6 words a second) leaves about 2.5 s between "this week." and the line's last words for the still.
      const speaking = live.agent(said, { ms: speakMs(said, 1.6) });
      await page.waitForFunction(() => document.querySelector('[data-kind="composer"] [role="switch"][aria-label="Agent"]')?.getAttribute("data-state") === "speaking", null, { timeout: 10_000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-kind="speech"]')].some((el) => el.textContent.includes("this week.") && el.textContent.includes("North brought in")), null, { timeout: 10_000 });
      log(`phone-16 top: ${JSON.stringify(await settleTop(page))}`);
      if ((await orbState(page)) !== "speaking") throw new Error(`phone-16: the orb reads ${await orbState(page)}, not speaking`);
      await shoot(16);
      const after = await page.locator('[data-kind="speech"]').last().textContent();
      if (after.includes("$1,050.")) throw new Error("phone-16: the spoken line was complete by the time of the still");
      await speaking;
      return made;
    },
  );
}

/** The screens in order, 360 px wide each, 6 to a row, on the page colour, no labels. */
async function contactSheet(files, out, theme) {
  const bg = PALETTE[theme].hex;
  await run("montage", [...files, "-resize", "360x", "-tile", "6x", "-geometry", "+24+24", "-background", bg, "-alpha", "off", out]);
  await run("convert", [out, "-bordercolor", bg, "-border", "24", "-alpha", "off", "-strip", out]);
  log(`saved ${out}`);
  return out;
}

export default {
  name: "phone-tour",
  kind: "still",
  optIn: true,
  makes: "phone-1-empty … phone-17-borders-on (+ -dark): a morning on the phone at 390 x 844, 3x; sheet-light.png, sheet-dark.png (opt-in; needs Xvfb, xterm, xdotool, ffmpeg)",
  async run(ctx) {
    const made = [];
    for (const theme of ctx.themes) {
      made.push(...(await morning(ctx, theme)));
      const files = SHOTS.map((_, i) => fileFor(ctx.out, i + 1, theme));
      if (files.every((f) => fs.existsSync(f))) made.push(await contactSheet(files, path.join(ctx.out, `sheet-${theme}.png`), theme));
    }
    return made;
  },
};
