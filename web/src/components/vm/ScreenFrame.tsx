// The VM screen in the pane (DESIGN.md 6): a 36 px header with the stream
// dot and the holder chip, the video in a black 16:9 frame whose ring says
// who holds the desktop, and a 44 px bar of Control / Release, or Done /
// Cancel during a handoff. Input flows once this device holds the desktop
// or a handoff grants it. The stream is the shared one in `state/screen.tsx`;
// this frame only holds it open while mounted. In handoff mode the header
// carries the handoff reason. On a phone the 16:9 frame sits centered on a
// black field that fills the sheet, and the bar floats over the field.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { DeviceName } from "@/components/status/DeviceName";
import { cn } from "@/lib/utils";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useScreenStore, useWantScreen } from "@/state/screen";
import { useServer, useServerMessages } from "@/state/server";
import {
  clampToFrame,
  eventFromKey,
  eventFromPointer,
  MoveLimiter,
  normalizeToFrame,
  stopsDefault,
  wheelDelta,
  type InputEvent,
  type Point,
} from "@/vm/input";
import type { ScreenStatus } from "./useScreen";

export type ScreenFrameMode = "watch" | "handoff";

export type ScreenFrameProps = {
  mode: ScreenFrameMode;
  handoffId: string | null;
};

export type ScreenRingInput = {
  status: ScreenStatus;
  handoff: boolean;
  controlledByMe: boolean;
};

/** The ring of the frame and the PiP: this device holds it, a handoff runs,
 *  the agent drives; none without a stream. */
export function screenRing({ status, handoff, controlledByMe }: ScreenRingInput): string {
  if (status === "closed") return "";
  if (controlledByMe) return "ring-2 ring-primary ring-offset-2 ring-offset-background";
  if (handoff) return "ring-2 ring-status-wait";
  return "ring-1 ring-border";
}

/** The 6 px stream dot. */
export function StreamDot({ status }: { status: ScreenStatus }) {
  return (
    <span
      data-stream={status}
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full transition-colors duration-150",
        status === "live" && "bg-status-ok",
        (status === "opening" || status === "connecting") && "bg-status-wait",
        status === "failed" && "bg-destructive",
        status === "closed" && "bg-muted-foreground/40",
      )}
    />
  );
}

/** The device id that holds the desktop while `control.active`. */
function useControlHolder(): string | null {
  const { ready } = useServer();
  const [by, setBy] = useState<string | null>(ready?.control?.active ? (ready.control.by ?? null) : null);
  useServerMessages((msg) => {
    if (msg.type === "ready") setBy(msg.control?.active ? (msg.control.by ?? null) : null);
    else if (msg.type === "control") setBy(msg.active ? msg.by : null);
  });
  return by;
}

export function ScreenFrame({ mode, handoffId }: ScreenFrameProps) {
  const { send, deviceId, device } = useServer();
  const [feed, dispatch] = useFeed();
  const reason = mode === "handoff" && feed.handoff?.handoffId === handoffId ? feed.handoff.reason : "";
  const { stream, status, controlActive, controlledByMe, inputOpen, takeControl, releaseControl, sendInput } = useScreenStore();
  const holder = useControlHolder();
  const phone = useBreakpoint() === "phone";
  const video = useRef<HTMLVideoElement>(null);
  const inputOn = (mode === "handoff" || controlledByMe) && inputOpen;
  const inputOnRef = useRef(inputOn);
  inputOnRef.current = inputOn;

  useWantScreen(true);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  // The desktop gets the keyboard as soon as input is on.
  useEffect(() => {
    if (inputOn) video.current?.focus();
  }, [inputOn]);

  const emit = useCallback(
    (event: InputEvent): void => {
      if (inputOnRef.current) sendInput(event);
    },
    [sendInput],
  );
  const limiter = useMemo(() => new MoveLimiter(emit), [emit]);
  useEffect(() => () => limiter.clear(), [limiter]);

  const toFrame = useCallback((clientX: number, clientY: number, clamp: boolean): Point | null => {
    const v = video.current;
    if (!v) return null;
    const rect = v.getBoundingClientRect();
    return clamp
      ? clampToFrame(clientX, clientY, rect, v.videoWidth, v.videoHeight)
      : normalizeToFrame(clientX, clientY, rect, v.videoWidth, v.videoHeight);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLVideoElement>): void => {
    e.currentTarget.focus();
    if (!inputOn) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toFrame(e.clientX, e.clientY, false);
    if (!p) return;
    limiter.flush();
    emit(e.pointerType === "touch" ? eventFromPointer("touch", p, { phase: "start" }) : eventFromPointer("mouse.down", p, { button: e.button }));
  };
  const onPointerMove = (e: PointerEvent<HTMLVideoElement>): void => {
    if (!inputOn) return;
    const held = e.buttons !== 0;
    const p = toFrame(e.clientX, e.clientY, held);
    if (!p) return;
    limiter.push(e.pointerType === "touch" ? eventFromPointer("touch", p, { phase: "move" }) : eventFromPointer("mouse.move", p));
  };
  const onPointerUp = (e: PointerEvent<HTMLVideoElement>): void => {
    if (!inputOn) return;
    const p = toFrame(e.clientX, e.clientY, true);
    if (!p) return;
    limiter.flush();
    emit(e.pointerType === "touch" ? eventFromPointer("touch", p, { phase: "end" }) : eventFromPointer("mouse.up", p, { button: e.button }));
  };

  // React registers wheel as passive; the page scroll stops only through a
  // native listener.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onWheel = (e: WheelEvent): void => {
      if (!inputOnRef.current) return;
      e.preventDefault();
      const p = toFrame(e.clientX, e.clientY, false);
      if (!p) return;
      emit(eventFromPointer("wheel", p, wheelDelta(e.deltaX, e.deltaY, e.deltaMode)));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [emit, toFrame]);

  const onKey = (kind: "key.down" | "key.up") => (e: KeyboardEvent<HTMLVideoElement>): void => {
    if (!inputOn) return;
    if (stopsDefault(e)) e.preventDefault();
    if (kind === "key.down" && e.repeat) return;
    emit(eventFromKey(kind, e));
  };

  const done = (): void => {
    if (!handoffId) return;
    send({ type: C2S.HANDOFF_DONE, handoff_id: handoffId });
    dispatch({ kind: "handoffClosed" });
  };
  const cancel = (): void => {
    if (!handoffId) return;
    send({ type: C2S.HANDOFF_CANCEL, handoff_id: handoffId });
    dispatch({ kind: "handoffClosed" });
  };

  const ring = screenRing({ status, handoff: mode === "handoff", controlledByMe });

  const header = (
    <div className={cn("flex h-9 shrink-0 items-center gap-2", phone && "px-4")}>
      <StreamDot status={status} />
      {reason ? (
        <span data-slot="handoff-reason" className="min-w-0 flex-1 truncate text-sm">
          {reason}
        </span>
      ) : null}
      {controlActive && holder ? (
        <span
          data-slot="holder"
          className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs text-muted-foreground"
        >
          <MousePointer2 size={12} strokeWidth={1.5} aria-hidden />
          <DeviceName id={holder} self={deviceId} selfDevice={device} />
        </span>
      ) : null}
    </div>
  );

  const frame = (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-black transition-[box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        phone ? "my-auto max-h-full" : "rounded-lg",
        ring,
      )}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        tabIndex={0}
        aria-label="Screen"
        className={cn("h-full w-full object-contain outline-none touch-none select-none", inputOn && "cursor-none")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          if (inputOn) e.preventDefault();
        }}
        onKeyDown={onKey("key.down")}
        onKeyUp={onKey("key.up")}
      />
      {status === "opening" || status === "connecting" ? (
        <Skeleton className="pointer-events-none absolute inset-0 rounded-none bg-white/10" />
      ) : null}
    </div>
  );

  const bar = (
    <div
      data-slot="screen-bar"
      className={cn(
        "flex shrink-0 items-center justify-end gap-2",
        phone ? "absolute inset-x-0 bottom-0 min-h-11 border-t bg-background/90 px-4 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur" : "mt-2 h-11",
      )}
    >
      {mode === "handoff" ? (
        <>
          <Button className="h-9 px-4" onClick={done} disabled={!handoffId}>
            Done
          </Button>
          <Button variant="outline" className="h-9 px-4" onClick={cancel} disabled={!handoffId}>
            Cancel
          </Button>
        </>
      ) : controlledByMe ? (
        <Button variant="outline" className="h-9 px-4" onClick={releaseControl}>
          Release
        </Button>
      ) : (
        <Button variant="outline" className="h-9 px-4" onClick={takeControl} disabled={status !== "live"}>
          Control
        </Button>
      )}
    </div>
  );

  return (
    <div
      data-slot="screen-frame"
      data-mode={mode}
      data-handoff={handoffId ?? ""}
      data-status={status}
      data-input={inputOn || undefined}
      className={cn("flex min-h-0 flex-col", phone ? "relative h-full flex-1" : "p-3 pt-0")}
    >
      {header}
      {phone ? <div className="flex min-h-0 flex-1 items-center px-1">{frame}</div> : frame}
      {bar}
    </div>
  );
}


