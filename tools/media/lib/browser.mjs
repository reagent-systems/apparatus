// Chromium for captures: the fake microphone plays a WAV the scene made, the
// Live socket is answered by the stand-in, and the page is the real web client
// served by the session server.

import { chromium } from "playwright-core";
import { CHROMIUM, USER_ID, ZONE, sleep } from "./util.mjs";
import { LiveStandIn } from "./live.mjs";
import { PageTime, WALL, installPageTime } from "./vtime.mjs";

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  // Desktop GIFs: the 1024 px desktop layout drawn at 1200 px, so the text
  // is 17 % larger in the GIF than a 1200 px window at 1x would draw it.
  gif: { viewport: { width: 1024, height: 680 }, deviceScaleFactor: 1200 / 1024 },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  // CDP screencasts a mobile-emulated page at 1x whatever its scale factor,
  // so the phone GIFs use a 390 px window at 2x with touch, not isMobile.
  // The client picks its phone layout from the width (useBreakpoint).
  phoneGif: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true },
  // The orb close-up: the phone layout at 3x, so the 56 px orb draws at 168 px.
  orbGif: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true },
};

export async function launch({ micWav }) {
  return chromium.launch({
    executablePath: CHROMIUM,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${micWav}`,
      "--autoplay-policy=no-user-gesture-required",
      "--hide-scrollbars",
      "--font-render-hinting=none",
    ],
  });
}

/**
 * A page on the real client. `theme` is light or dark, `borders` off (the
 * client's default) or on,
 * `prefs` more of the client's own keys (the pane width, the rail); all go
 * into the client's storage before the first paint, as a returning user's
 * choices would.
 * `vtime` (a frame rate) installs page time (lib/vtime.mjs) before the app
 * loads: `app.vt` then pauses and steps the page's clocks, and `app.clock`
 * is the clock the stand-in and the waits here use (the wall without it).
 */
export async function openApp(browser, stack, { device = "desktop", theme = "light", borders = "off", prefs = {}, noise = [], paceJobsMs = 0, hold = null, platform = null, vtime = 0 } = {}) {
  const preset = DEVICES[device] ?? device;
  const ctx = await browser.newContext({
    ...preset,
    colorScheme: theme,
    reducedMotion: "no-preference",
    permissions: ["microphone"],
    timezoneId: ZONE,
  });
  await ctx.addInitScript(
    ({ theme, borders, prefs, userId }) => {
      try {
        // Once per tab: later loads keep what the client itself stored.
        if (sessionStorage.getItem("media.seeded")) return;
        localStorage.setItem("apparatus.auth", userId);
        localStorage.setItem("apparatus.theme", theme);
        // Borderless is the default and is never stored; "on" is the opt-in.
        if (borders === "on") localStorage.setItem("apparatus.borders", "on");
        else localStorage.removeItem("apparatus.borders");
        for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
        sessionStorage.setItem("media.seeded", "1");
      } catch {
        // storage blocked: the defaults apply
      }
    },
    { theme, borders, prefs, userId: USER_ID },
  );
  // Overlay scrollbars stay hidden in captures, as --hide-scrollbars hides the
  // native ones: the thread's ScrollArea shows its thumb for 600 ms after each
  // scroll to a new card, which would flash in the GIFs. Nothing else changes.
  await ctx.addInitScript(() => {
    const css = '[data-slot="scroll-area-scrollbar"]{visibility:hidden !important}';
    const add = () => {
      const s = document.createElement("style");
      s.dataset.media = "scrollbars";
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  });
  if (platform) await shellBridge(ctx, platform);
  let vt = null;
  if (vtime) {
    await installPageTime(ctx);
    vt = new PageTime(null, { fps: vtime, log: (...a) => console.log("[media]", ...a) });
  }
  const live = new LiveStandIn({ log: (...a) => console.log("[media]", ...a) });
  if (vt) live.clock = vt;
  await live.install(ctx);
  // `pacer.notBefore` (a Date.now() time, page time with `vtime`) lets a scene hold the next job event a moment longer.
  const pacer = { gapMs: paceJobsMs, notBefore: 0 };
  if (vt) await gateServerEvents(ctx, vt, pacer, hold);
  else if (paceJobsMs > 0 || hold) await paceJobEvents(ctx, pacer, hold);
  const page = await ctx.newPage();
  if (vt) vt.page = page;
  // Console noise is collected and reported; a capture with errors is suspect.
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => noise.push(`pageerror: ${e.message}`));
  await page.goto(`${stack.origin}/`, { waitUntil: "networkidle" });
  await page.locator('[data-kind="composer"]').first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('[data-kind="composer"]')?.getAttribute("data-state") !== "connecting", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  return { ctx, page, live, device, theme, borders, pacer, vt, clock: vt ?? WALL };
}

/**
 * The shell seam (apps/web/src/bridge.ts): a native shell replaces dist/bridge.js
 * with a module that sets `window.apparatusBridge`. The Tauri shell's reports
 * platform "desktop"; its keychain calls need Tauri, so this one keeps the
 * web bridge's storage. The client then sends `hello.device` "desktop" and
 * labels the device "Desktop", as in the desktop app.
 */
async function shellBridge(ctx, platform) {
  const body = `"use strict";(function(){var s=null;try{s=localStorage}catch(e){}
window.apparatusBridge={platform:${JSON.stringify(platform)},secureStore:{
get:async function(k){try{return s?s.getItem(k):null}catch(e){return null}},
set:async function(k,v){try{s&&s.setItem(k,v)}catch(e){}},
delete:async function(k){try{s&&s.removeItem(k)}catch(e){}}}};})();`;
  await ctx.route(/\/bridge\.js$/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body }));
}

/**
 * A job hold for stills that show a job mid-run. The demo model ends a job in
 * about a second; a real one takes minutes. `JobHold` names a request; the
 * page gets that job's events in order until one reports `percent` or more,
 * and the rest wait at the browser until `release()`. Nothing is added,
 * dropped or rewritten; other jobs pass unchanged.
 */
export class JobHold {
  constructor(request, { percent = 40 } = {}) {
    this.request = request;
    this.percent = percent;
    this.released = false;
    this.waiters = [];
  }

  release() {
    this.released = true;
    for (const w of this.waiters.splice(0)) w();
  }

  whenReleased() {
    return this.released ? Promise.resolve() : new Promise((r) => this.waiters.push(r));
  }
}

/**
 * The demo model answers at once, so a demo job ends in about a second; a
 * real model takes seconds per step. For GIFs the session socket is passed
 * through unchanged except that job.progress and job.done reach the page at
 * least `pacer.gapMs` apart, and not before `pacer.notBefore`, in their
 * original order, so each step can be read.
 * `hold` (a JobHold, or a list of them) keeps those jobs mid-run. Nothing is added, dropped or
 * rewritten.
 */
async function paceJobEvents(ctx, pacer, hold) {
  // `hold` is one JobHold or a list of them, each for its own request.
  const holds = hold ? [].concat(hold) : [];
  await ctx.routeWebSocket(/\/ws\/client/, (ws) => {
    const server = ws.connectToServer();
    let chain = Promise.resolve();
    let lastJob = 0;
    const held = new Map(); // job id -> the JobHold whose request it matches
    const holding = new Set(); // job ids past their hold point
    server.onMessage((m) => {
      let msg = {};
      try {
        msg = JSON.parse(String(m));
      } catch {
        // not JSON: pass it on as is
      }
      const type = msg.type ?? "";
      const job = msg.job_id ?? null;
      if (type === "job.started") {
        const h = holds.find((x) => String(msg.request ?? "") === x.request);
        if (h) held.set(job, h);
      }
      const isJob = type === "job.progress" || type === "job.done";
      const h = held.get(job) ?? null;
      const wait = h && isJob && holding.has(job) && !h.released;
      if (h && isJob && type === "job.progress" && (msg.percent ?? -1) >= h.percent) holding.add(job);
      const send = async () => {
        if (pacer.gapMs > 0 && isJob) {
          const w = Math.max(lastJob + pacer.gapMs, pacer.notBefore) - Date.now();
          if (w > 0) await sleep(w);
          lastJob = Date.now();
        }
        ws.send(m);
      };
      if (wait) {
        // This job's chain waits for the release; the others go on.
        void h.whenReleased().then(() => (chain = chain.then(send)));
        return;
      }
      chain = chain.then(send);
    });
    ws.onMessage((m) => server.send(m));
    ws.onClose((code, reason) => server.close({ code, reason }));
    server.onClose((code, reason) => ws.close({ code, reason }));
  });
}

/**
 * `paceJobEvents` on page time, for a page with `vtime`: every message from
 * the session server waits at the browser until page time reaches its turn,
 * so the page sees it at a page time, not at whatever wall time a slow
 * capture has reached. A message is due when it arrives (page time stands
 * still between steps, so it passes at once then); job.progress and job.done
 * are due at least `pacer.gapMs` of page time apart and not before
 * `pacer.notBefore`; order is kept. `hold` keeps those jobs mid-run, as
 * there. Nothing is added, dropped or rewritten.
 */
async function gateServerEvents(ctx, clock, pacer, hold) {
  const holds = hold ? [].concat(hold) : [];
  await ctx.routeWebSocket(/\/ws\/client/, (ws) => {
    const server = ws.connectToServer();
    const queue = []; // { m, due } in arrival order; due never decreases
    let lastDue = -Infinity;
    let lastJob = -Infinity;
    let timer = null;
    let open = true;
    const held = new Map(); // job id -> the JobHold whose request it matches
    const holding = new Set(); // job ids past their hold point
    const pump = (t = clock.now()) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!open) return;
      while (queue.length && queue[0].due <= t) ws.send(queue.shift().m);
      // Stepped, the next step releases them (beforeStep); free, a wall timer does.
      if (queue.length) timer = setTimeout(() => pump(), clock.stepped ? 50 : Math.max(1, queue[0].due - clock.now()));
    };
    clock.beforeStep.add(pump);
    const enqueue = (m, isJob) => {
      let due = Math.max(clock.now(), lastDue);
      if (isJob && pacer.gapMs > 0) {
        due = Math.max(due, lastJob + pacer.gapMs, pacer.notBefore);
        lastJob = due;
      }
      lastDue = due;
      queue.push({ m, due });
      pump();
    };
    server.onMessage((m) => {
      let msg = {};
      try {
        msg = JSON.parse(String(m));
      } catch {
        // not JSON: pass it on as is
      }
      const type = msg.type ?? "";
      const job = msg.job_id ?? null;
      if (type === "job.started") {
        const h = holds.find((x) => String(msg.request ?? "") === x.request);
        if (h) held.set(job, h);
      }
      const isJob = type === "job.progress" || type === "job.done";
      const h = held.get(job) ?? null;
      const wait = h && isJob && holding.has(job) && !h.released;
      if (h && isJob && type === "job.progress" && (msg.percent ?? -1) >= h.percent) holding.add(job);
      if (wait) {
        void h.whenReleased().then(() => enqueue(m, isJob));
        return;
      }
      enqueue(m, isJob);
    });
    ws.onMessage((m) => server.send(m));
    const done = () => {
      open = false;
      clock.beforeStep.delete(pump);
      if (timer) clearTimeout(timer);
    };
    ws.onClose((code, reason) => {
      done();
      server.close({ code, reason });
    });
    server.onClose((code, reason) => {
      done();
      ws.close({ code, reason });
    });
  });
}

/** The composer's orb: the agent's on-switch (role switch, accessible name "Agent"). */
export function orb(page) {
  return page.locator('[data-kind="composer"] [role="switch"][aria-label="Agent"]').first();
}

async function switchReads(page, on, timeout = 10_000) {
  await page.waitForFunction(
    (want) => document.querySelector('[data-kind="composer"] [role="switch"][aria-label="Agent"]')?.getAttribute("aria-checked") === want,
    String(on),
    { timeout },
  );
}

/** Tap the orb once, as a user would: on turns off, off turns on. */
export async function tapOrb(app, { big = false } = {}) {
  const was = (await orb(app.page).getAttribute("aria-checked")) === "true";
  // `big`: the 128 px orb of the empty thread, the same switch as the composer's.
  if (big) {
    const all = app.page.locator('[role="switch"][aria-label="Agent"]');
    let best = null;
    for (let i = 0; i < (await all.count()); i++) {
      const b = await all.nth(i).boundingBox();
      if (b && (!best || b.width > best.w)) best = { i, w: b.width };
    }
    if (!best || best.w < 100) throw new Error("no 128 px orb on the page: the thread is not empty");
    await all.nth(best.i).click();
  } else await orb(app.page).click();
  await (app.clock ?? WALL).until(switchReads(app.page, !was));
  if (!was) await app.live.connected();
  return !was;
}

/** Turn the agent on (a tap when it reads off). Opens the microphone, so the mic file plays from its start. */
export async function turnOn(app) {
  if ((await orb(app.page).getAttribute("aria-checked")) !== "true") await tapOrb(app);
}

/** Turn the agent off (a tap when it reads on). */
export async function turnOff(app) {
  if ((await orb(app.page).getAttribute("aria-checked")) === "true") await tapOrb(app);
}

/**
 * Scroll every scroller to its end, as the thread does on a new card, with
 * the pointer parked off every scroller, then wait until the scroll areas
 * have hidden their scrollbars again (they show while hovered or scrolled).
 */
export async function toEnd(page) {
  await parkPointer(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-radix-scroll-area-viewport]")) el.scrollTop = el.scrollHeight;
  });
  await page
    .waitForFunction(() => ![...document.querySelectorAll("[data-slot=\"scroll-area-scrollbar\"]")].some((b) => b.getAttribute("data-state") === "visible"), null, { timeout: 4000 })
    .catch(() => {});
  await sleep(300);
}

/** Scroll every scroller to its top: a list read from its newest entry and its filter chips. */
export async function toTop(page) {
  await parkPointer(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-radix-scroll-area-viewport]")) el.scrollTop = 0;
  });
  await sleep(700);
}

/** Park the pointer off the page so no hover state shows. */
export async function parkPointer(page) {
  // The thread header strip: no hover state lives there.
  const vp = page.viewportSize();
  await page.mouse.move(Math.round(vp.width * 0.55), 12);
}

export async function waitIdle(page, ms = 600) {
  await page.evaluate(() => document.fonts.ready);
  await sleep(ms);
}

/**
 * Scroll the thread so a card's top (16 px under the viewport's top) starts
 * the frame, as near the top of the day as the thread allows without the
 * end-of-thread button: the client shows it once the end is more than 240 px
 * away (AWAY_PX in ScrollToEnd.tsx), and it would sit over the cards.
 */
export async function scrollToCardTop(page, away = 230) {
  await page.evaluate((away) => {
    const vp = document.querySelector('[data-kind="composer"]')?.closest("[data-radix-scroll-area-viewport]") ?? [...document.querySelectorAll("[data-radix-scroll-area-viewport]")].find((v) => v.querySelector('[data-kind="speech"], [data-kind="job"]'));
    if (!vp) return;
    const max = vp.scrollHeight - vp.clientHeight;
    const base = vp.getBoundingClientRect().top - vp.scrollTop;
    const tops = [...vp.querySelectorAll('[data-kind="speech"], [data-kind="job"], [data-kind="approval"], [data-kind="handoff"]')]
      .map((el) => el.closest(".flex.w-full.flex-col")?.getBoundingClientRect().top ?? el.getBoundingClientRect().top)
      .map((t) => t - base - 16)
      .filter((t) => t >= 0 && max - t <= away)
      .sort((a, b) => a - b);
    vp.scrollTop = tops.length ? tops[0] : max;
  }, away);
  await parkPointer(page);
  await sleep(700);
}

/** The end-of-thread button must not be in a still. */
export async function assertNoEndButton(page, what) {
  if (await page.locator('button[aria-label="End"]:visible').count()) throw new Error(`${what}: the end-of-thread button shows`);
}


/**
 * One tap on and one tap off before a recording. On a fresh load the client
 * reads the voice session as held by another device (the server omits
 * `voice_holder` when nobody holds it and the client takes the missing field
 * for a holder; tools/media/README.md lists it), so the orb shows paused and
 * dimmed until the first tap. After one on-off cycle it shows the agent off.
 * Later turns start from the first gate turn after this.
 */
export async function primeSwitch(app) {
  const clock = app.clock ?? WALL;
  await tapOrb(app);
  await turnOff(app);
  await clock.sleep(400);
  app.live.turnCursor = Date.now();
  await parkPointer(app.page);
  await clock.sleep(800);
}

/** The thread's own scroller only (not the pane or the rail), to its end, as the thread does on a new card. */
export async function threadToEnd(page) {
  await parkPointer(page);
  await page.evaluate(() => {
    const vp = document.querySelector('[data-kind="thread"] [data-radix-scroll-area-viewport]');
    if (vp) vp.scrollTop = vp.scrollHeight;
  });
  await sleep(500);
}

/**
 * The window height in [min, max] that, with the thread at its end, starts a
 * row `pad` CSS px under the clear edge (the thread's top, or the bottom of
 * `clear`, an element over the thread such as the phone's top bar) while the
 * row before it ends at or above that edge, so no card is cut there. At the
 * end of the thread a taller window moves every row down by the same amount
 * (the composer sits outside the thread's scroller). Resolves with the height.
 */
export async function fitHeightToRow(page, { min, max, pad = 8, clear = null }) {
  const width = page.viewportSize().width;
  await page.setViewportSize({ width, height: min });
  await sleep(600);
  await threadToEnd(page);
  const { rows, edge } = await page.evaluate((clear) => {
    const vp = document.querySelector('[data-kind="thread"] [data-radix-scroll-area-viewport]');
    const col = vp?.querySelector(".max-w-\\[760px\\]");
    if (!vp || !col) return { rows: [], edge: 0 };
    const bar = clear ? [...document.querySelectorAll(clear)].find((e) => e.getBoundingClientRect().height > 0) : null;
    const edge = bar ? bar.getBoundingClientRect().bottom : vp.getBoundingClientRect().top;
    return { rows: [...col.children].map((c) => [c.getBoundingClientRect().top, c.getBoundingClientRect().bottom]), edge };
  }, clear);
  const grow = [];
  for (let i = 1; i < rows.length; i++) {
    const d = Math.round(edge + pad - rows[i][0]);
    if (d >= 0 && d <= max - min && rows[i - 1][1] + d <= edge) grow.push(d);
  }
  grow.sort((a, b) => a - b);
  const height = min + (grow[0] ?? 0);
  if (height !== min) {
    await page.setViewportSize({ width, height });
    await sleep(600);
    await threadToEnd(page);
  }
  return height;
}

/**
 * Resolves with the page's Date.now() at the moment the composer first shows
 * a heard line: page time on a page with `vtime` (the step that drew it),
 * the wall otherwise. A mutation observer in the page notes the time, so a
 * slow poll from here does not move it.
 */
export async function heardShownAt(page, timeout = 20_000) {
  await page.evaluate(() => {
    window.__mediaHeardAt = null;
    const shows = () => (document.querySelector('[data-kind="composer"] [data-slot="heard"]')?.textContent ?? "").trim().length > 0;
    const note = () => {
      if (window.__mediaHeardAt === null && shows()) {
        window.__mediaHeardAt = Date.now();
        obs.disconnect();
      }
    };
    const obs = new MutationObserver(note);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    note();
  });
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const at = await page.evaluate(() => window.__mediaHeardAt);
    if (at !== null) return at;
    await sleep(30);
  }
  throw new Error("the composer showed no heard line");
}

/**
 * The cut that shortens the wait between the tap and the first heard words
 * to `keepMs` (the idle orb before the tap counts as `preMs`): whole frames
 * of the listening orb before the words arrive are dropped, `guardMs` before
 * them, so the words still appear on a running orb. Returns [] when the
 * wait is short enough.
 */
export function listenCut(tapAt, heardAt, { preMs = 300, keepMs = 1500, guardMs = 500 } = {}) {
  const over = preMs + (heardAt - tapAt) - keepMs;
  if (over <= 0) return [];
  return [[heardAt - guardMs - over, heardAt - guardMs]];
}
