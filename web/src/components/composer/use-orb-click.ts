// The orb's click: claim the voice session, then open the Live session,
// then close it (the `onOrb` logic of the old Controls).

import { useCallback } from "react";
import { useVoice } from "@/state/voice";

export function useOrbClick(): () => void {
  const voice = useVoice();
  const { holdsVoice, liveOpen, claim, end, start } = voice;
  return useCallback(() => {
    if (!holdsVoice) claim();
    else if (liveOpen) end();
    else start();
  }, [holdsVoice, liveOpen, claim, end, start]);
}
