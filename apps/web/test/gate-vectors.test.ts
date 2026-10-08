import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderVectors, VECTORS_PATH } from "../scripts/gate-vectors.ts";

// The watch ports replay packages/gate-vectors/gate-vectors.json. When the web gate
// changes, the file must change with it: run `npm run gate-vectors`.
test("packages/gate-vectors/gate-vectors.json equals the web gate's output", () => {
  const committed = readFileSync(VECTORS_PATH, "utf8");
  assert.equal(renderVectors(), committed, "gate vectors drifted from apps/web/src/gate: run `npm run gate-vectors -w apps/web`");
});
