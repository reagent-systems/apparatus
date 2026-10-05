// jobs.png: the Jobs view with the pane open on a finished job's Receipt.
import { openReceipt, view } from "../lib/scene.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "jobs",
  makes: "jobs.png (+ -dark): the Jobs view, the pane on a Receipt",
  seed: { approve: false },
  async prepare(app) {
    await openReceipt(app);
    await view(app, "jobs");
  },
});
