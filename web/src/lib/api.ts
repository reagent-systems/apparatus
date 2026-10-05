// GET helpers for the server's HTTP routes, with the bearer auth from the
// bridge, and the pure shaping of GET /audit and GET /credits for the Audit
// and Credits views (DESIGN.md 7). The shaping is DOM-free; tested in
// `test/api.test.ts`.

import { sameDay, shortDate } from "./status.ts";

export async function apiGet<T>(origin: string, auth: string, path: string): Promise<T> {
  const res = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** One audit row: `t` in epoch seconds, `kind`, and the kind's own fields. */
export type AuditEntry = { t: number; kind: string } & Record<string, unknown>;
export type AuditResponse = { entries: AuditEntry[] };

/** One ledger row: `grant` and `charge` carry `amount`; `hold` and `settle` move no balance. */
export type LedgerEntry = { t: number; kind: string; amount?: number; used?: number } & Record<string, unknown>;
export type CreditsState = "ok" | "low" | "out";
export type CreditsResponse = { balance: number; state: CreditsState; history: LedgerEntry[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The rows of a GET /audit body that carry a finite `t` and a string `kind`; anything else is dropped. */
export function parseAudit(body: unknown): AuditEntry[] {
  const raw = isRecord(body) && Array.isArray(body.entries) ? body.entries : [];
  return raw.filter(
    (e): e is AuditEntry => isRecord(e) && typeof e.t === "number" && Number.isFinite(e.t) && typeof e.kind === "string",
  );
}

/** The fields after `t` and `kind`. */
export function auditFields(entry: AuditEntry): Record<string, unknown> {
  const { t: _t, kind: _kind, ...fields } = entry;
  return fields;
}

/** The one-line form of the fields; empty when the row has none. */
export function auditLine(entry: AuditEntry): string {
  const fields = auditFields(entry);
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : "";
}

/** The kinds present, sorted, for the filter. */
export function auditKinds(entries: readonly AuditEntry[]): string[] {
  return [...new Set(entries.map((e) => e.kind))].sort();
}

export type AuditDay = { key: string; label: string; entries: AuditEntry[] };

/** Newest first, split by local day; the label is "Today" or `4 Oct`. */
export function auditDays(entries: readonly AuditEntry[], kind: string | null, now: number): AuditDay[] {
  const rows = entries.filter((e) => kind === null || e.kind === kind).sort((a, b) => b.t - a.t);
  const days: AuditDay[] = [];
  for (const entry of rows) {
    const ms = entry.t * 1000;
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: sameDay(ms, now) ? "Today" : shortDate(ms), entries: [entry] });
  }
  return days;
}

/** The balance change of one ledger row: +grant, -charge, null for the rest. */
export function creditDelta(entry: LedgerEntry): number | null {
  const amount = typeof entry.amount === "number" && Number.isFinite(entry.amount) ? entry.amount : null;
  if (amount === null || amount === 0) return null;
  if (entry.kind === "grant") return amount;
  if (entry.kind === "charge") return -amount;
  return null;
}

export type CreditRow = { t: number; delta: number };

/** The rows that moved the balance, newest first. */
export function creditHistory(history: readonly unknown[]): CreditRow[] {
  const rows: CreditRow[] = [];
  for (const raw of history) {
    if (!isRecord(raw) || typeof raw.t !== "number" || typeof raw.kind !== "string") continue;
    const delta = creditDelta(raw as LedgerEntry);
    if (delta !== null) rows.push({ t: raw.t, delta });
  }
  return rows.sort((a, b) => b.t - a.t);
}

/** `+500`, `−12`: a real minus so the column lines up in mono. */
export function signedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

/** A GET /credits body, or null when it is not one. */
export function parseCredits(body: unknown): CreditsResponse | null {
  if (!isRecord(body) || typeof body.balance !== "number") return null;
  const state: CreditsState = body.state === "low" || body.state === "out" ? body.state : "ok";
  const history = Array.isArray(body.history) ? (body.history as LedgerEntry[]) : [];
  return { balance: body.balance, state, history };
}
