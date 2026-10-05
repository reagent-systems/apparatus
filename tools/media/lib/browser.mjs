// Chromium for captures: the fake microphone plays a WAV the scene made, the
// Live socket is answered by the stand-in, and the page is the real web client
// served by the session server.

import { chromium } from "playwright-core";
import { CHROMIUM, sleep } from "./util.mjs";
import { LiveStandIn } from "./live.mjs";

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  gif: { viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  phoneGif: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
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
 * A page on the real client. `theme` is light or dark, `borders` on or off;
 * both go into the client's own storage keys before the first paint, as a
 * returning user's choice would.
 */
export async function openApp(browser, stack, { device = "desktop", theme = "light", borders = "on", noise = [], paceJobsMs = 0 } = {}) {
  const preset = DEVICES[device] ?? device;
  const ctx = await browser.newContext({
    ...preset,
    colorScheme: theme,
    reducedMotion: "no-preference",
    permissions: ["microphone"],
  });
  await ctx.addInitScript(
    ({ theme, borders }) => {
      try {
        localStorage.setItem("apparatus.auth", "dev");
        localStorage.setItem("apparatus.theme", theme);
        if (borders === "off") localStorage.setItem("apparatus.borders", "off");
        else localStorage.removeItem("apparatus.borders");
      } catch {
        // storage blocked: the defaults apply
      }
    },
    { theme, borders },
  );
  const live = new LiveStandIn({ log: (...a) => console.log("[media]", ...a) });
  await live.install(ctx);
  if (paceJobsMs > 0) await paceJobEvents(ctx, paceJobsMs);
  const page = await ctx.newPage();
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
  return { ctx, page, live, device, theme, borders };
}

/**
 * The demo model answers at once, so a demo job ends in about a second; a
 * real model takes seconds per step. For GIFs the session socket is passed
 * through unchanged except that job.progress and job.done reach the page at
 * least `gapMs` apart, in their original order, so each step can be read.
 * Nothing is added, dropped or rewritten.
 */
async function paceJobEvents(ctx, gapMs) {
  await ctx.routeWebSocket(/\/ws\/client/, (ws) => {
    const server = ws.connectToServer();
    let chain = Promise.resolve();
    let lastJob = 0;
    server.onMessage((m) => {
      let type = "";
      try {
        type = JSON.parse(String(m)).type ?? "";
      } catch {
        // not JSON: pass it on as is
      }
      chain = chain.then(async () => {
        if (type === "job.progress" || type === "job.done") {
          const wait = lastJob + gapMs - Date.now();
          if (wait > 0) await sleep(wait);
          lastJob = Date.now();
        }
        ws.send(m);
      });
    });
    ws.onMessage((m) => server.send(m));
    ws.onClose((code, reason) => server.close({ code, reason }));
    server.onClose((code, reason) => ws.close({ code, reason }));
  });
}

/** The composer's orb (the one voice control). */
export function orb(page) {
  return page.locator('[data-kind="composer"] button[aria-label="Talk"]').first();
}

/** Tap the orb: claim the voice session and open the Live session. */
export async function tapOrb(app) {
  await orb(app.page).click();
  await app.live.connected();
}

/** Scroll every scroller to its end, as the thread does on a new card. */
export async function toEnd(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-radix-scroll-area-viewport]")) el.scrollTop = el.scrollHeight;
  });
  await sleep(300);
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
