// GET /audit as a list of rows: time, kind, the rest.

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type AuditEntry, type AuditResponse } from "@/lib/api";
import { useServer } from "@/state/server";

function rest(entry: AuditEntry): string {
  const { t: _t, kind: _k, ...fields } = entry;
  const keys = Object.keys(fields);
  return keys.length ? JSON.stringify(fields) : "";
}

export function AuditView() {
  const { httpOrigin, auth } = useServer();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<AuditResponse>(httpOrigin, auth, "/audit")
      .then((res) => {
        if (live) setEntries([...res.entries].reverse());
      })
      .catch(() => {
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [httpOrigin, auth]);

  if (entries === null) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y px-4 py-2 text-sm">
      {entries.map((e, i) => (
        <li key={i} className="grid grid-cols-[auto_auto_1fr] gap-3 py-2">
          <span className="font-mono text-muted-foreground">{new Date(e.t * 1000).toLocaleString()}</span>
          <span className="font-medium">{e.kind}</span>
          <span className="truncate font-mono text-muted-foreground">{rest(e)}</span>
        </li>
      ))}
    </ul>
  );
}
