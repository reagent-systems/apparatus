// Credits (DESIGN.md 7): the balance at 48 px with a 10 px state dot, Top
// up (disabled until a payment path exists), then the rows that moved the
// balance: the time and the signed change in mono. The live balance comes
// from the feed; GET /credits brings the state and the history and is read
// again whenever the balance moves.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useNow } from "@/hooks/use-now";
import { apiGet, creditHistory, parseCredits, signedDelta, type CreditsResponse, type CreditsState } from "@/lib/api";
import { sameDay, shortDate } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useServer } from "@/state/server";

function rowTime(t: number, now: number): string {
  const ms = t * 1000;
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay(ms, now) ? time : `${shortDate(ms)} ${time}`;
}

const DOT: Record<CreditsState, string> = {
  ok: "bg-status-ok",
  low: "bg-status-wait",
  out: "bg-destructive",
};

export function CreditsView() {
  const { httpOrigin, auth } = useServer();
  const [feed] = useFeed();
  const now = useNow();
  const phone = useBreakpoint() === "phone";
  const [fetched, setFetched] = useState<CreditsResponse | null>(null);
  const liveBalance = feed.credits?.balance ?? null;

  useEffect(() => {
    let live = true;
    apiGet<unknown>(httpOrigin, auth, "/credits")
      .then((body) => {
        const parsed = parseCredits(body);
        if (live && parsed) setFetched(parsed);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [httpOrigin, auth, liveBalance]);

  const balance = liveBalance ?? fetched?.balance ?? null;
  const state: CreditsState = fetched?.state ?? feed.credits?.state ?? "ok";
  const rows = creditHistory(fetched?.history ?? []);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div data-slot="credits" data-state={state} className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-8 pt-[60px] pb-6", phone ? "px-4" : "px-6")}>
        <div className="flex items-center gap-4">
          {balance === null ? (
            <Skeleton className="h-[52px] w-40" />
          ) : (
            <div className="flex items-center gap-3">
              <span data-slot="balance" className="text-5xl leading-[52px] font-medium tabular-nums">
                {balance}
              </span>
              <span aria-hidden data-dot={state} className={cn("size-2.5 shrink-0 rounded-full transition-colors duration-150", DOT[state])} />
            </div>
          )}
          <Button disabled className="ml-auto h-9 px-4">
            Top up
          </Button>
        </div>
        {rows.length > 0 ? (
          <ul data-slot="credit-history" className="flex flex-col divide-y">
            {rows.map((row, i) => (
              <li key={`${row.t}-${i}`} className="flex h-10 items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground tabular-nums">{rowTime(row.t, now)}</span>
                <span className="font-mono text-[13px] tabular-nums">{signedDelta(row.delta)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ScrollArea>
  );
}
