// The picture in picture (DESIGN.md 6): a 240 x 135 thumbnail of the shared
// stream with the frame's ring, floating over the thread while the pane is
// closed. A click opens the pane in Screen. App.tsx mounts it only while the
// stream is live on the Thread view; it holds the stream while shown, so the
// pane and the PiP hand the one `MediaStream` over without a reopen, and a
// stream that drops unmounts it instead of leaving a grey slab.

import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useScreenStore, useWantScreen } from "@/state/screen";
import { useSelection } from "@/state/selection";
import { screenRing } from "./ScreenFrame";

export function ScreenPip() {
  const { stream, status, controlledByMe } = useScreenStore();
  const [feed] = useFeed();
  const { setView } = useSelection();
  const video = useRef<HTMLVideoElement>(null);
  useWantScreen(true);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  return (
    <button
      type="button"
      aria-label="Screen"
      data-slot="screen-pip"
      data-status={status}
      onClick={() => setView("screen")}
      className={cn(
        "relative block h-[135px] w-[240px] cursor-pointer overflow-hidden rounded-lg border bg-black shadow-md flat:shadow-float outline-none transition-[box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:ring-2 focus-visible:ring-ring/50",
        screenRing({ status, handoff: feed.handoff !== null, controlledByMe }),
      )}
    >
      <video ref={video} autoPlay playsInline muted tabIndex={-1} className="pointer-events-none h-full w-full object-contain" />
      {status !== "live" ? <Skeleton className="pointer-events-none absolute inset-0 rounded-none bg-white/10 flat:dark:bg-white/[0.03]" /> : null}
    </button>
  );
}
