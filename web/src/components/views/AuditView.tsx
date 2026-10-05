// GET /audit as a table (DESIGN.md 7): day group rows, then one row per
// entry with the time, the kind as a Badge and the other fields on one mono
// line; no header row. A click expands the entry's JSON. One chip per kind
// the server returned filters the rows; no chip selected shows them all, so
// the filter needs no word of its own. On a phone the table scrolls sideways.

import { Fragment, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea, flatEdgeFade } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow } from "@/hooks/use-now";
import { apiGet, auditDays, auditKinds, auditLine, parseAudit, type AuditEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useServer } from "@/state/server";

function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Entry({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const toggle = (): void => setOpen((o) => !o);
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <tbody data-slot="audit-entry" data-kind={entry.kind}>
        <TableRow
          tabIndex={0}
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          className="cursor-pointer outline-none focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
        >
          <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{clock(entry.t)}</TableCell>
          <TableCell>
            <Badge variant="secondary" className="font-mono font-normal">
              {entry.kind}
            </Badge>
          </TableCell>
          <TableCell className="truncate font-mono text-[13px] text-muted-foreground">{auditLine(entry)}</TableCell>
        </TableRow>
        <CollapsibleContent asChild>
          <tr className="border-b">
            <td colSpan={3} className="p-2 pt-0">
              <pre className="overflow-x-auto rounded-md bg-muted flat:bg-transparent px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap break-all">
                {JSON.stringify(entry, null, 2)}
              </pre>
            </td>
          </tr>
        </CollapsibleContent>
      </tbody>
    </Collapsible>
  );
}

export function AuditView() {
  const { httpOrigin, auth, ready } = useServer();
  const now = useNow();
  const phone = useBreakpoint() === "phone";
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [kind, setKind] = useState<string | null>(null);

  // Read again on every `ready`: a reconnect may have missed rows.
  useEffect(() => {
    let live = true;
    apiGet<unknown>(httpOrigin, auth, "/audit")
      .then((body) => {
        if (live) setEntries(parseAudit(body));
      })
      .catch(() => {
        if (live) setEntries((prev) => prev ?? []);
      });
    return () => {
      live = false;
    };
  }, [httpOrigin, auth, ready]);

  const kinds = auditKinds(entries ?? []);
  const shown = kind !== null && kinds.includes(kind) ? kind : null;
  const days = auditDays(entries ?? [], shown, now);

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName={flatEdgeFade}>
      <div data-slot="audit" className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-4 pt-6 pb-6", phone ? "px-4" : "px-6")}>
        {kinds.length > 0 ? (
          <ToggleGroup
            type="single"
            spacing={2}
            aria-label="Kind"
            value={shown ?? ""}
            onValueChange={(v) => setKind(v === "" ? null : v)}
            className="flex-wrap"
          >
            {kinds.map((k) => (
              <ToggleGroupItem
                key={k}
                value={k}
                data-audit-kind={k}
                className="h-7 rounded-full border px-2.5 font-mono text-xs font-normal hover:bg-muted hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
              >
                {k}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        <Table className="min-w-[560px] table-fixed">
          <colgroup>
            <col className="w-28" />
            <col className="w-40" />
            <col />
          </colgroup>
          {entries === null ? (
            <TableBody>
              {[0, 1, 2].map((i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={3}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
            days.map((day) => (
              <Fragment key={day.key}>
                <TableBody data-slot="audit-day">
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="pt-5 pb-1 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {day.label}
                    </TableCell>
                  </TableRow>
                </TableBody>
                {day.entries.map((entry, i) => (
                  <Entry key={`${entry.t}-${entry.kind}-${i}`} entry={entry} />
                ))}
              </Fragment>
            ))
          )}
        </Table>
      </div>
    </ScrollArea>
  );
}
