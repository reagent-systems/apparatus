// The thread: every card in one centered column. Day dividers, turn headers,
// the end-of-thread button and the 2 s ring on the card of a job selected
// elsewhere. The header strip, the composer and the keyboard (Alt+J reaches
// the cards marked `data-state="pending"` / `"active"`) belong to the shell.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Orb } from "@/components/orb/Orb";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOrbClick } from "@/components/composer/use-orb-click";
import { runningJobs, type FeedCard, type FeedState } from "@/feed/reducer";
import { foldsIntoRequest, sameDay } from "@/lib/status";
import { useFeed } from "@/state/feed";
import { useSelection } from "@/state/selection";
import { useVoice } from "@/state/voice";
import { ApprovalCard } from "./ApprovalCard";
import { CreditsLine } from "./CreditsLine";
import { DayDivider } from "./DayDivider";
import { HandoffCard } from "./HandoffCard";
import { JobCard } from "./JobCard";
import { ScrollToEnd, AWAY_PX } from "./ScrollToEnd";
import { SpeechCard } from "./SpeechCard";
import { TurnHeader } from "./TurnHeader";
import { useNow } from "@/hooks/use-now";

/** Agent cards closer than this share one turn header. */
const TURN_MS = 60_000;
const HIGHLIGHT_MS = 2_000;

const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none";

function isUserSpeech(card: FeedCard): boolean {
  return card.kind === "transcript" && card.role === "user";
}

function renderCard(card: FeedCard, highlightedJob: string | null): ReactNode {
  switch (card.kind) {
    case "transcript":
      return <SpeechCard card={card} />;
    case "job":
      return <JobCard jobId={card.jobId} at={card.at} highlighted={highlightedJob === card.jobId} />;
    case "approval":
      return <ApprovalCard card={card} />;
    case "handoff":
      return <HandoffCard card={card} />;
    case "credits":
      return <CreditsLine card={card} />;
  }
}

/** When a card's part of the turn finished: a job's end, else its arrival. */
function finishedAt(card: FeedCard, feed: FeedState): number {
  if (card.kind === "job") return feed.jobs[card.jobId]?.endedAt ?? card.at;
  return card.at;
}

type Turn = { key: string; at: number };

/**
 * Cards with their dividers and turn headers, in order. Agent cards closer
 * than TURN_MS share one header, which carries the finish time of the last
 * of them. Only the newest header shows `working`; older ones hold still.
 */
function items(feed: FeedState, now: number, working: boolean, highlightedJob: string | null): ReactNode[] {
  const out: ReactNode[] = [];
  const turns: Turn[] = [];
  const headerAt: number[] = [];
  let dayAt: number | null = null;
  let lastAgentAt: number | null = null;
  for (const card of feed.cards) {
    if (card.kind === "job") {
      const job = feed.jobs[card.jobId];
      if (job && foldsIntoRequest(job, feed)) continue;
    }
    if (dayAt === null || !sameDay(dayAt, card.at)) {
      out.push(<DayDivider key={`day-${card.id}`} at={card.at} now={now} />);
      dayAt = card.at;
      lastAgentAt = null;
    }
    if (isUserSpeech(card)) {
      lastAgentAt = null;
    } else {
      if (lastAgentAt === null || card.at - lastAgentAt > TURN_MS) {
        turns.push({ key: `turn-${card.id}`, at: 0 });
        headerAt.push(out.length);
        out.push(null);
      }
      const turn = turns[turns.length - 1];
      turn.at = Math.max(turn.at, finishedAt(card, feed));
      lastAgentAt = card.at;
    }
    out.push(
      <div key={card.id} className={`flex w-full flex-col ${ENTER}`}>
        {renderCard(card, highlightedJob)}
      </div>,
    );
  }
  turns.forEach((turn, i) => {
    const latest = i === turns.length - 1;
    out[headerAt[i]] = <TurnHeader key={turn.key} at={turn.at} working={latest && working} still={!latest} />;
  });
  return out;
}

function viewportOf(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

export function Thread() {
  const [feed] = useFeed();
  const voice = useVoice();
  const { selectedJobId } = useSelection();
  const onOrb = useOrbClick();
  const now = useNow();

  const root = useRef<HTMLDivElement | null>(null);
  const column = useRef<HTMLDivElement | null>(null);
  const away = useRef(false);
  const lastSeenId = useRef<string | null>(feed.cards[feed.cards.length - 1]?.id ?? null);
  const [isAway, setIsAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [highlightedJob, setHighlightedJob] = useState<string | null>(null);

  const working = runningJobs(feed).length > 0;
  const empty = feed.cards.length === 0;

  const scrollToEnd = useCallback((smooth = false) => {
    const vp = viewportOf(root.current);
    if (!vp) return;
    vp.scrollTo({ top: vp.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // The 240 px rule: past it, new cards count instead of scrolling.
  useEffect(() => {
    const vp = viewportOf(root.current);
    if (!vp) return;
    const onScroll = (): void => {
      const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      const next = distance > AWAY_PX;
      if (next !== away.current) {
        away.current = next;
        setIsAway(next);
      }
      if (!next) setUnseen(0);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => vp.removeEventListener("scroll", onScroll);
  }, []);

  // New cards, counted by the last id so the count keeps going once the
  // feed sits at MAX_CARDS and old cards fall off the front.
  useLayoutEffect(() => {
    const cards = feed.cards;
    const lastId = cards[cards.length - 1]?.id ?? null;
    const prev = lastSeenId.current;
    if (lastId === prev) return;
    lastSeenId.current = lastId;
    const at = prev === null ? -1 : cards.findIndex((c) => c.id === prev);
    const added = at >= 0 ? cards.length - 1 - at : cards.length;
    if (away.current) {
      if (added > 0) setUnseen((u) => u + added);
      return;
    }
    scrollToEnd();
  }, [feed.cards, scrollToEnd]);

  // A card that grows in place (interim speech, activity rows, the show)
  // keeps the end in view while the user sits there.
  useEffect(() => {
    const el = column.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!away.current) scrollToEnd();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty, scrollToEnd]);

  // A job selected elsewhere: bring its card in and ring it for 2 s.
  useEffect(() => {
    if (!selectedJobId) return;
    const vp = viewportOf(root.current);
    const el = root.current?.querySelector<HTMLElement>(`[data-kind="job"][data-job-id="${CSS.escape(selectedJobId)}"]`);
    if (!vp || !el) return;
    const v = vp.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < v.top || r.bottom > v.bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedJob(selectedJobId);
    const timer = setTimeout(() => setHighlightedJob(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [selectedJobId]);

  return (
    <div ref={root} data-kind="thread" data-state={empty ? "empty" : "cards"} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        {empty ? (
          <div className="flex min-h-[60vh] w-full items-center justify-center">
            <Orb state="idle" held={voice.holdsVoice} live={voice.liveOpen} onClick={onOrb} size={128} />
          </div>
        ) : (
          <div ref={column} className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-4 break-words px-6 pt-[60px] pb-4 max-md:px-4">
            {items(feed, now, working, highlightedJob)}
          </div>
        )}
      </ScrollArea>
      {isAway ? (
        <ScrollToEnd
          unseen={unseen}
          onClick={() => {
            setUnseen(0);
            scrollToEnd(true);
          }}
        />
      ) : null}
    </div>
  );
}
