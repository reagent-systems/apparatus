import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditDays,
  auditFields,
  auditKinds,
  auditLine,
  creditDelta,
  creditHistory,
  parseAudit,
  parseCredits,
  signedDelta,
  type AuditEntry,
} from "../src/lib/api.ts";

const NOW = new Date(2026, 9, 4, 15, 0, 0).getTime();
const sec = (ms: number): number => ms / 1000;
const TODAY_9 = sec(new Date(2026, 9, 4, 9, 0, 0).getTime());
const TODAY_10 = sec(new Date(2026, 9, 4, 10, 0, 0).getTime());
const OCT_2 = sec(new Date(2026, 9, 2, 12, 0, 0).getTime());

test("parseAudit keeps rows with a numeric t and a string kind", () => {
  const rows = parseAudit({
    entries: [
      { t: 1, kind: "job.start", job_id: "j" },
      { t: "1", kind: "x" },
      { t: 2 },
      { t: Number.NaN, kind: "x" },
      null,
      [1, 2],
      { t: 3, kind: "tool" },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["job.start", "tool"],
  );
  assert.deepEqual(parseAudit(null), []);
  assert.deepEqual(parseAudit({ entries: "x" }), []);
});

test("the rest of a row is the fields after t and kind", () => {
  const e: AuditEntry = { t: 1, kind: "tool", name: "shell", ok: true };
  assert.deepEqual(auditFields(e), { name: "shell", ok: true });
  assert.equal(auditLine(e), '{"name":"shell","ok":true}');
  assert.equal(auditLine({ t: 1, kind: "x" }), "");
});

test("the filter offers the kinds in the data, sorted and unique", () => {
  const rows: AuditEntry[] = [
    { t: 1, kind: "tool" },
    { t: 2, kind: "approval" },
    { t: 3, kind: "tool" },
  ];
  assert.deepEqual(auditKinds(rows), ["approval", "tool"]);
  assert.deepEqual(auditKinds([]), []);
});

test("audit days run newest first with Today and the short date", () => {
  const rows: AuditEntry[] = [
    { t: OCT_2, kind: "grant" },
    { t: TODAY_9, kind: "tool" },
    { t: TODAY_10, kind: "approval" },
  ];
  const days = auditDays(rows, null, NOW);
  assert.deepEqual(
    days.map((d) => d.label),
    ["Today", "2 Oct"],
  );
  assert.deepEqual(
    days[0].entries.map((e) => e.kind),
    ["approval", "tool"],
  );
  const tools = auditDays(rows, "tool", NOW);
  assert.equal(tools.length, 1);
  assert.deepEqual(
    tools[0].entries.map((e) => e.t),
    [TODAY_9],
  );
  assert.deepEqual(auditDays([], null, NOW), []);
});

test("only grants and charges move the balance", () => {
  assert.equal(creditDelta({ t: 1, kind: "grant", amount: 500 }), 500);
  assert.equal(creditDelta({ t: 1, kind: "charge", amount: 12 }), -12);
  assert.equal(creditDelta({ t: 1, kind: "hold", amount: 50 }), null);
  assert.equal(creditDelta({ t: 1, kind: "settle", used: 10 }), null);
  assert.equal(creditDelta({ t: 1, kind: "charge", amount: 0 }), null);
  assert.equal(creditDelta({ t: 1, kind: "charge" }), null);
});

test("the credits history is the moving rows, newest first", () => {
  const rows = creditHistory([
    { t: 1, kind: "grant", amount: 500 },
    { t: 3, kind: "charge", amount: 7 },
    { t: 2, kind: "hold", job_id: "j", amount: 50 },
    { t: 4, kind: "settle", job_id: "j", used: 7 },
    "junk",
    { kind: "charge", amount: 1 },
  ]);
  assert.deepEqual(rows, [
    { t: 3, delta: -7 },
    { t: 1, delta: 500 },
  ]);
  assert.equal(signedDelta(500), "+500");
  assert.equal(signedDelta(-7), "−7");
});

test("parseCredits reads the body or refuses it", () => {
  assert.deepEqual(parseCredits({ balance: 40, state: "low", history: [] }), { balance: 40, state: "low", history: [] });
  assert.deepEqual(parseCredits({ balance: 40, state: "weird" }), { balance: 40, state: "ok", history: [] });
  assert.equal(parseCredits({ state: "ok" }), null);
  assert.equal(parseCredits("x"), null);
});
