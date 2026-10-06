// The desktop GIFs show the thread column only: the rail collapsed (Cmd+B,
// a returning user's layout), the pane closed, and a crop of the column
// around the composer, so the text reads at README width.

/** 1024 px is the narrowest desktop layout; 1.2x makes an 840 px crop about 1000 px wide. */
export const COLUMN_GIF = { viewport: { width: 1024, height: 764 }, deviceScaleFactor: 1.2 };
/** apparatus.rail "1": the rail collapsed to its icons. */
export const RAIL_COLLAPSED = { "apparatus.rail": "1" };

/** The column's crop in CSS px: `width` around the composer's centre, under the 40 px header, over the 24 px status bar. */
export async function columnClip(page, { width = 840, top = 40, bottom = 24 } = {}) {
  const b = await page.locator('[data-kind="composer"]').first().boundingBox();
  if (!b) throw new Error("no composer on the page");
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(vp.width - width, Math.round(b.x + b.width / 2 - width / 2)));
  return { x, y: top, width, height: vp.height - top - bottom };
}
