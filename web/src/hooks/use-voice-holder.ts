// Which device holds the voice session: `ready.voice_holder`, then
// `voice.granted` (this device) and `voice.revoked` (the device in `by`).

import { useState } from "react";
import { useServer, useServerMessages } from "@/state/server";

export function useVoiceHolder(): string | null {
  const { ready, deviceId } = useServer();
  const [holder, setHolder] = useState<string | null>(ready?.voice_holder ?? null);
  useServerMessages((msg) => {
    if (msg.type === "ready") setHolder(msg.voice_holder);
    else if (msg.type === "voice.granted") setHolder(deviceId);
    else if (msg.type === "voice.revoked") setHolder(msg.by);
  });
  return holder;
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
