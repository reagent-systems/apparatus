// A still scene: seed the day on a fresh stack, bring the page to the state
// the asset shows, and shoot it once per theme (dark switches through the
// command palette, as a user would).

import { parkPointer, toEnd } from "./browser.mjs";
import { seedDay } from "./day.mjs";
import { setTheme, shot, variant, withApp } from "./scene.mjs";

/**
 * `prepare(app)` runs once after seeding; `before(app, theme)` runs before
 * each shot (after the theme switch) and may return { clip } or { locator }.
 */
export function stillScene({ name, file = name, makes, device = "desktop", borders = "on", seed = {}, prepare = null, before = null, themes = null }) {
  return {
    name,
    kind: "still",
    makes,
    async run(ctx) {
      return withApp(ctx, { name, device, borders }, async (app) => {
        if (seed !== false) await seedDay(app, seed);
        if (prepare) await prepare(app);
        const made = [];
        for (const theme of themes ?? ctx.themes) {
          if (theme !== app.theme) await setTheme(app, theme);
          await toEnd(app.page);
          await parkPointer(app.page);
          const opts = (before && (await before(app, theme))) || {};
          made.push(await shot(app, variant(ctx.out, file, theme), opts));
        }
        return made;
      });
    },
  };
}
