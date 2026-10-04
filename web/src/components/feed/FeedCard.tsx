// One feed card. Transcripts are short; job, approval and handoff cards are
// tall. A card holds the thing itself and nothing about it.

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FeedCard as FeedCardModel, JobEntry } from "@/feed/reducer";

export type FeedCardProps = {
  card: FeedCardModel;
  job: JobEntry | undefined;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onOpenJob: (jobId: string) => void;
};

export function FeedCard({ card, job, onAnswer, onOpenJob }: FeedCardProps) {
  switch (card.kind) {
    case "transcript":
      return (
        <Card
          className={cn(
            "max-w-[90%] gap-0 py-2 shadow-none",
            card.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start",
            !card.final && "opacity-80",
          )}
        >
          <CardContent className="px-3 text-sm break-words">{card.text}</CardContent>
        </Card>
      );
    case "job": {
      const failed = job?.status === "failed";
      const running = job ? job.status === "running" || job.status === "queued" || job.status === "paused" : false;
      return (
        <Card
          role="button"
          tabIndex={0}
          onClick={() => onOpenJob(card.jobId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onOpenJob(card.jobId);
          }}
          className={cn("w-full cursor-pointer gap-2 py-3", failed && "border-destructive")}
        >
          <CardContent className="flex flex-col gap-2 px-4">
            {job?.request ? <p className="text-sm text-muted-foreground break-words">{job.request}</p> : null}
            {running && job?.progress ? <p className="text-sm break-words">{job.progress}</p> : null}
            {!running && job?.say ? <p className="text-sm break-words">{job.say}</p> : null}
            {running ? (
              <div className="h-0.5 w-full rounded bg-border">
                <div
                  className="h-full rounded bg-primary transition-[width]"
                  style={{ width: job?.percent === null || job?.percent === undefined ? "0%" : `${job.percent}%` }}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      );
    }
    case "approval":
      return (
        <Card className={cn("w-full gap-2 py-3", card.approved === false && "opacity-70")}>
          <CardContent className="flex flex-col gap-2 px-4">
            <p className="text-sm font-semibold break-words">{card.action}</p>
            <p className="text-sm break-words">{card.details}</p>
            {card.approved === null ? (
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => onAnswer(card.approvalId, true)}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onAnswer(card.approvalId, false)}>
                  Deny
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      );
    case "handoff":
      return (
        <Card className={cn("w-full gap-2 py-3", card.outcome === null && "border-amber-500")}>
          <CardContent className="px-4 text-sm break-words">{card.reason}</CardContent>
        </Card>
      );
    case "credits":
      return (
        <Card className="w-full gap-0 py-2 shadow-none">
          <CardContent className="px-3 text-sm text-muted-foreground break-words">{card.text}</CardContent>
        </Card>
      );
  }
}
