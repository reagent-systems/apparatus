// Floats above the composer once the user has scrolled more than 240 px up;
// carries the count of cards that arrived since.

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const AWAY_PX = 240;

export function ScrollToEnd({ unseen, onClick }: { unseen: number; onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <Button
        variant="outline"
        aria-label="End"
        data-unseen={unseen}
        onClick={onClick}
        className="pointer-events-auto h-9 rounded-full px-3 shadow-md animate-in fade-in duration-200 motion-reduce:animate-none"
      >
        <ChevronDown strokeWidth={1.5} />
        {unseen > 0 ? <span className="text-xs tabular-nums">{unseen}</span> : null}
      </Button>
    </div>
  );
}
