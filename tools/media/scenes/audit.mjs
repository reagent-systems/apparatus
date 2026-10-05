// audit.png: the Audit view after the day's work.
import { view } from "../lib/scene.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "audit",
  makes: "audit.png (+ -dark): the audit log of the day",
  seed: { approve: true },
  async prepare(app) {
    await view(app, "audit");
  },
});
