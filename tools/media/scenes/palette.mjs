// palette.png: the command palette (Cmd/Ctrl+K) over the thread.
import { sleep } from "../lib/util.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "palette",
  makes: "palette.png (+ -dark): the command palette over the thread",
  async before(app) {
    await app.page.keyboard.press("Control+k");
    await sleep(500);
    return {};
  },
});
