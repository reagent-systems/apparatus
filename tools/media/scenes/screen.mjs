// screen.png: the VM screen in the pane, streamed from a real X desktop
// (Xvfb, openbox, xterm, xclock) through agentd's x11grab and WebRTC. Opt-in:
// it runs only when named, and fails rather than show a frame that did not stream.

import { parkPointer } from "../lib/browser.mjs";
import { seedDay } from "../lib/day.mjs";
import { setTheme, shot, variant } from "../lib/scene.mjs";
import { withScreen } from "../lib/screen.mjs";

export default {
  name: "screen",
  kind: "still",
  optIn: true,
  makes: "screen.png (+ -dark): the VM screen streaming in the pane (needs Xvfb, openbox, xdotool, ffmpeg)",
  async run(ctx) {
    return withScreen(ctx, { name: "screen", device: "desktop" }, async (app) => {
      await seedDay(app);
      await app.page.keyboard.press("Control+3");
      const made = [];
      for (const theme of ctx.themes) {
        if (theme !== app.theme) await setTheme(app, theme);
        await parkPointer(app.page);
        made.push(await shot(app, variant(ctx.out, "screen", theme)));
      }
      return made;
    });
  },
};
