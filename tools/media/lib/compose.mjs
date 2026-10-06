// The compositor: a plain HTML page rendered by Playwright. It lays out real
// captures (PNG files, inlined as data URIs) on a backdrop and in device
// frames. It never draws inside a capture.

import fs from "node:fs";
import { chromium } from "playwright-core";
import { CHROMIUM, log } from "./util.mjs";

/** The DESIGN.md palette, as the compositor uses it. */
export const PALETTE = {
  light: { hex: "#fbfaf7", page: "oklch(0.985 0.004 85)", sidebar: "oklch(0.965 0.005 85)", border: "oklch(0.90 0.008 80)", ink: "oklch(0.20 0.010 60)", shadow: "oklch(0.20 0.010 60 / 22%)" },
  dark: { hex: "#161311", page: "oklch(0.19 0.006 60)", sidebar: "oklch(0.165 0.006 60)", border: "oklch(1 0 0 / 10%)", ink: "oklch(0.95 0.005 85)", shadow: "oklch(0 0 0 / 55%)" },
};

export function dataUri(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

/** Render `html` at `width` x `height` CSS px and `scale`; `transparent` keeps the alpha. */
export async function renderHtml(html, out, { width, height, scale = 2, transparent = false }) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--hide-scrollbars"] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode()));
    });
    await page.screenshot({ path: out, omitBackground: transparent });
  } finally {
    await browser.close();
  }
  log(`saved ${out}`);
  return out;
}
