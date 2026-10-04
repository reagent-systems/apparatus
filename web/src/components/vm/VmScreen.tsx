// The VM screen: the live video of the desktop with the user's input on top.
// Watch mode shows Control / Release; input flows once this device holds
// the desktop. Handoff mode shows Done and Cancel; the handoff grants input.
// A Skeleton covers the video until the stream is live.

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useScreen } from "./useScreen";

export type VmScreenMode = "watch" | "handoff";

export type VmScreenProps = {
  mode: VmScreenMode;
  handoffId: string | null;
  onDone: () => void;
  onCancel: () => void;
};

export function VmScreen({ mode, handoffId, onDone, onCancel }: VmScreenProps) {
  const screen = useScreen();
  const { stream, status, controlledByMe, inputOpen, open, close, takeControl, releaseControl, sendInput } = screen;
  const video = useRef<HTMLVideoElement>(null);
  const inputOn = (mode === "handoff" || controlledByMe) && inputOpen;
  const inputOnRef = useRef(inputOn);
  inputOnRef.current = inputOn;

  useEffect(() => {
    open();
    return close;
  }, [open, close]);

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

  return (
    <Card data-mode={mode} data-handoff={handoffId ?? ""} data-status={status} className="h-full gap-0 overflow-hidden py-0 shadow-none">
      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          tabIndex={0}
          className="h-full w-full object-contain outline-none touch-none select-none"
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
        {status !== "live" ? (
          <Skeleton className="pointer-events-none absolute inset-0 rounded-none bg-muted dark:bg-muted-foreground/25" />
        ) : null}
      </div>
      <div className="flex shrink-0 justify-center gap-3 border-t p-3">
        {mode === "handoff" ? (
          <>
            <Button onClick={onDone}>Done</Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : controlledByMe ? (
          <Button variant="outline" onClick={releaseControl}>
            Release
          </Button>
        ) : (
          <Button variant="outline" onClick={takeControl} disabled={status !== "live"}>
            Control
          </Button>
        )}
      </div>
    </Card>
  );
}
