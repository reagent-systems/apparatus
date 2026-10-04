// The feed: a scroll area of cards of mixed height, newest at the bottom.

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FeedState } from "@/feed/reducer";
import { FeedCard } from "./FeedCard";

export type FeedProps = {
  feed: FeedState;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onOpenJob: (jobId: string) => void;
};

export function Feed({ feed, onAnswer, onOpenJob }: FeedProps) {
  const end = useRef<HTMLDivElement | null>(null);
  const last = feed.cards[feed.cards.length - 1];
  const key = last ? `${last.id}:${last.kind === "transcript" ? last.text.length : ""}` : "";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [key]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-3">
        {feed.cards.map((card) => (
          <FeedCard
            key={card.id}
            card={card}
            job={card.kind === "job" ? feed.jobs[card.jobId] : undefined}
            onAnswer={onAnswer}
            onOpenJob={onOpenJob}
          />
        ))}
        <div ref={end} />
      </div>
    </ScrollArea>
  );
}
