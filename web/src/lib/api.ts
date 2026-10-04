// GET helpers for the server's HTTP routes, with the bearer auth from the bridge.

export async function apiGet<T>(origin: string, auth: string, path: string): Promise<T> {
  const res = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export type AuditEntry = { t: number; kind: string } & Record<string, unknown>;
export type AuditResponse = { entries: AuditEntry[] };
export type CreditsResponse = { balance: number; state: "ok" | "low" | "out"; history: Array<Record<string, unknown>> };
