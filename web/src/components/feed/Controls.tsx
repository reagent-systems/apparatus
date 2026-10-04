// Under the feed: two small squares (Talk, Stop), one wide bar (the latest
// spoken line) and the orb at the bottom right.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Orb, type OrbState } from "@/components/orb/Orb";
import { cn } from "@/lib/utils";
import { useVoice } from "@/state/voice";

export type ControlsProps = {
  orbState: OrbState;
  spoken: string | null;
  /** Phone only: opens the screen full screen. Absent where the pane is on screen. */
  onScreen?: () => void;
};

export function Controls({ orbState, spoken, onScreen }: ControlsProps) {
  const voice = useVoice();
  const [down, setDown] = useState(false);

  const press = (): void => {
    setDown(true);
    voice.pressTalk();
  };
  const release = (): void => {
    setDown(false);
    voice.releaseTalk();
  };
  const onOrb = (): void => {
    if (!voice.holdsVoice) voice.claim();
    else if (voice.liveOpen) voice.end();
    else voice.start();
  };

  return (
    <div className="flex flex-col gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-start gap-2">
        <Button
          variant={down ? "default" : "outline"}
          className={cn("size-14 touch-none select-none", down && "scale-95")}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            press();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              if (!e.repeat) press();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") release();
          }}
        >
          Talk
        </Button>
        <Button variant="outline" className="size-14" onClick={() => voice.stop()}>
          Stop
        </Button>
        {onScreen ? (
          <Button variant="outline" className="size-14" onClick={onScreen}>
            Screen
          </Button>
        ) : null}
      </div>
      <Card className="min-h-14 w-full justify-center gap-0 py-2 shadow-none">
        <CardContent className="px-3 text-sm break-words">{spoken ?? ""}</CardContent>
      </Card>
      <div className="flex justify-center md:justify-end">
        <Orb state={orbState} held={voice.holdsVoice} live={voice.liveOpen} onClick={onOrb} />
      </div>
    </div>
  );
}
