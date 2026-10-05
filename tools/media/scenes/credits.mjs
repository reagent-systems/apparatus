// credits.png: the Credits view: balance and history after the day's work.
import { view } from "../lib/scene.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "credits",
  makes: "credits.png (+ -dark): balance and history",
  seed: { approve: true },
  async prepare(app) {
    await view(app, "credits");
  },
});
