// GET /credits: the balance, and the top-up button (a placeholder until a
// payment path exists).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type CreditsResponse } from "@/lib/api";
import { useServer } from "@/state/server";

export function CreditsView() {
  const { httpOrigin, auth, ready } = useServer();
  const [credits, setCredits] = useState<CreditsResponse | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<CreditsResponse>(httpOrigin, auth, "/credits")
      .then((res) => {
        if (live) setCredits(res);
      })
      .catch(() => {
        if (live && ready) setCredits({ balance: ready.balance, state: "ok", history: [] });
      });
    return () => {
      live = false;
    };
  }, [httpOrigin, auth, ready]);

  return (
    <div className="flex flex-col items-start gap-6 p-6">
      {credits === null ? <Skeleton className="h-12 w-40" /> : <p className="text-5xl font-semibold tabular-nums">{credits.balance}</p>}
      <Button disabled>Top up</Button>
    </div>
  );
}
