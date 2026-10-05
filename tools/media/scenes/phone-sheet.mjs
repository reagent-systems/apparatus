// phone-sheet.png: on a phone, the pane as a bottom sheet on a job's Receipt.
import { openReceipt } from "../lib/scene.mjs";
import { stillScene } from "../lib/still.mjs";

export default stillScene({
  name: "phone-sheet",
  device: "phone",
  makes: "phone-sheet.png (+ -dark): the pane as a sheet on a Receipt",
  async prepare(app) {
    await openReceipt(app);
  },
});
