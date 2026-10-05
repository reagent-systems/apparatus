// VoiceContext: the VoiceController on this device. Created at the first
// `ready`, so the gate runs on the server's table and never on the
// fallbacks. Taps before that do nothing. State is polled every 100 ms
// and on every controller change. Voice only and full duplex: there is no
// typed input and no input mode. The orb is the agent's on-switch: `toggle`.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergeGate, mergeLive } from "../config.ts";
import type { GateLogEntry } from "../gate/gate.ts";
import type { SpeakerProfile } from "../gate/speaker.ts";
import type { TranscriptRole } from "../protocol.ts";
import { VoiceController } from "../voice.ts";
import { useServer } from "./server.tsx";

declare global {
  interface Window {
    apparatusGateLog?: () => GateLogEntry[];
    apparatusEnrollSpeaker?: (samples: Int16Array, consent: boolean) => SpeakerProfile;
  }
}

export type TranscriptHandler = (role: TranscriptRole, text: string, final: boolean) => void;

export type VoiceSnapshot = {
  holdsVoice: boolean;
  /** Another device holds the voice session: the orb dims. */
  otherHoldsVoice: boolean;
  /** The device that holds the voice session, as last heard. */
  voiceHolder: string | null;
  /** The switch reads on. */
  on: boolean;
  liveOpen: boolean;
  listening: boolean;
  speaking: boolean;
};

export type VoiceValue = VoiceSnapshot & {
  /** The orb's tap. Off to on: claim when needed, open the Live session and the microphone. On to off: hang up. */
  toggle: () => void;
  subscribeTranscript: (handler: TranscriptHandler) => () => void;
  /** The current value, outside React's render cycle. */
  holdsVoiceNow: () => boolean;
};

const VoiceContext = createContext<VoiceValue | null>(null);

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(v: VoiceController | null): VoiceSnapshot {
  if (!v) return { holdsVoice: false, otherHoldsVoice: false, voiceHolder: null, on: false, liveOpen: false, listening: false, speaking: false };
  return {
    holdsVoice: v.holdsVoice,
    otherHoldsVoice: v.otherHoldsVoice,
    voiceHolder: v.voiceHolder,
    on: v.on,
    liveOpen: v.liveOpen,
    listening: v.listening,
    speaking: v.speaking,
  };
}

function same(a: VoiceSnapshot, b: VoiceSnapshot): boolean {
  return (
    a.holdsVoice === b.holdsVoice &&
    a.otherHoldsVoice === b.otherHoldsVoice &&
    a.voiceHolder === b.voiceHolder &&
    a.on === b.on &&
    a.liveOpen === b.liveOpen &&
    a.listening === b.listening &&
    a.speaking === b.speaking
  );
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const server = useServer();
  const controller = useRef<VoiceController | null>(null);
  const transcriptHandlers = useRef(new Set<TranscriptHandler>());
  const [state, setState] = useState<VoiceSnapshot>(() => snapshot(null));

  const refresh = useCallback(() => {
    const next = snapshot(controller.current);
    setState((prev) => (same(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 100);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const { send, httpOrigin, auth } = server;
    return server.subscribe((msg) => {
      switch (msg.type) {
        case "ready": {
          if (!controller.current) {
            const v = new VoiceController({
              serverOrigin: httpOrigin,
              auth,
              gateConfig: mergeGate(msg.gate),
              liveConfig: mergeLive(msg.live),
              send,
              onTranscript: (role, text, final) => {
                for (const h of transcriptHandlers.current) h(role, text, final);
              },
              onChange: refresh,
              storage: storageOrNull(),
            });
            controller.current = v;
            window.apparatusGateLog = () => v.gate.log();
            window.apparatusEnrollSpeaker = (samples, consent) => v.enroll(samples, consent);
          }
          controller.current.syncHolder(msg.voice_holder, msg.device_id);
          break;
        }
        case "voice.granted":
          controller.current?.granted();
          break;
        case "voice.revoked":
          controller.current?.revoked(msg.by);
          break;
        default:
          break;
      }
      controller.current?.handleServer(msg);
      refresh();
    });
  }, [server.subscribe, server.send, server.httpOrigin, server.auth, refresh]);

  const actions = useMemo<Omit<VoiceValue, keyof VoiceSnapshot>>(
    () => ({
      toggle: () => controller.current?.toggle(),
      subscribeTranscript: (handler) => {
        transcriptHandlers.current.add(handler);
        return () => {
          transcriptHandlers.current.delete(handler);
        };
      },
      holdsVoiceNow: () => controller.current?.holdsVoice ?? false,
    }),
    [],
  );

  const value = useMemo<VoiceValue>(() => ({ ...state, ...actions }), [state, actions]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceValue {
  const v = useContext(VoiceContext);
  if (!v) throw new Error("useVoice outside VoiceProvider");
  return v;
}
