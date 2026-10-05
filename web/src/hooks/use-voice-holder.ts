// Which device holds the voice session, as the voice controller last heard
// it: `ready.voice_holder`, `voice.granted` (this device), `voice.revoked`
// (the device in `by`), and null once this device turns its switch off and
// gives the voice session back.

import { useVoice } from "@/state/voice";

export function useVoiceHolder(): string | null {
  return useVoice().voiceHolder;
}

/**
 * The word for a device: this device's platform. The server sends no name for
 * another device, so that one is "" and the caller shows the icon alone; an
 * id fragment is never a label.
 */
export function deviceLabel(id: string | null, self: string | null, selfDevice: string): string {
  if (id === null) return "";
  if (self !== null && id === self) return selfDevice;
  return "";
}
