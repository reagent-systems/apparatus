// A device's name beside its icon, or nothing when the name is unknown: the
// icon then stands alone, never with an id fragment.

import { deviceLabel } from "@/hooks/use-voice-holder";

export function DeviceName({ id, self, selfDevice }: { id: string | null; self: string | null; selfDevice: string }) {
  const label = deviceLabel(id, self, selfDevice);
  return label ? <span className="capitalize">{label}</span> : null;
}
