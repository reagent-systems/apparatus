// Makes public/og.png, the 1200 × 630 Open Graph image: the listening orb's
// static frame, the name and the one-liner on the left; the hero composite's
// desktop and phone on the right, its shadow faded into the paper at every
// edge. Light only.
// Chromium draws it, so the type is Inter itself. Needs playwright-core (a
// dependency of tools/media, installed at the root) and a Chromium binary:
//
//   SITE_CHROMIUM=/opt/pw-browsers/chromium npm run og -w apparatus-site

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { orbSvg } from "../src/lib/orb-svg.ts";

const site = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const inter = pathToFileURL(require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).href;
const hero = pathToFileURL(resolve(site, "../../docs/media/hero-light.png")).href;
const orb = orbSvg("listening", "light").svg;

// hero-light.png is 3270 × 1464: the desktop window and the phone fill x 88 to 2640.
const CROP_X = 40;
const CROP_W = 2640;
const BOX_W = 740;
const scale = BOX_W / CROP_W;
const boxH = Math.round(1464 * scale);

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url("${inter}") format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: 1200px; height: 630px; background: #fbfaf7; overflow: hidden; }
body { font-family: Inter, sans-serif; color: #1d1b18; font-feature-settings: "cv11", "ss01"; position: relative; }
.left { position: absolute; left: 64px; top: 0; bottom: 0; width: 340px; display: flex; flex-direction: column; justify-content: center; }
.orb { width: 200px; height: 200px; margin-left: -12px; }
.orb svg { width: 100%; height: 100%; display: block; }
h1 { margin: 20px 0 0; font-size: 40px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1; }
p { margin: 12px 0 0; font-size: 28px; line-height: 1.25; color: #6f6860; letter-spacing: -0.01em; }
.shot { position: absolute; right: 40px; top: ${Math.round((630 - boxH) / 2)}px; width: ${BOX_W}px; height: ${boxH}px; overflow: hidden;
  mask-image: linear-gradient(to bottom, transparent, #000 5%, #000 93%, transparent), linear-gradient(to right, transparent, #000 2%, #000 98%, transparent);
  mask-composite: intersect; }
.shot img { position: absolute; left: ${-Math.round(CROP_X * scale)}px; top: 0; width: ${Math.round(3270 * scale)}px; }
</style>
<div class="left"><div class="orb">${orb}</div><h1>apparatus</h1><p>A voice agent with its own cloud computer</p></div>
<div class="shot"><img src="${hero}" alt=""></div>`;

const work = mkdtempSync(join(tmpdir(), "site-og-"));
const page = join(work, "og.html");
writeFileSync(page, html);
const browser = await chromium.launch({ executablePath: process.env.SITE_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(page).href);
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await tab.screenshot({ path: join(site, "public/og.png") });
  console.log("public/og.png: 1200 × 630");
} finally {
  await browser.close();
  rmSync(work, { recursive: true });
}
