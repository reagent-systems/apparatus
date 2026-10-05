// approval-card.png: a close-up of the approval card in the thread.
import { clipAround } from "../lib/scene.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "approval-card",
  makes: "approval-card.png (+ -dark): the pending approval card, close",
  async before(app) {
    return { clip: await clipAround(app.page.locator('[data-kind="approval"]').last(), 32) };
  },
});
