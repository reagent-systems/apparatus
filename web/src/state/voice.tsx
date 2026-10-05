// VoiceContext: the VoiceController on this device. Created at the first
// `ready`, so the gate runs on the server's table and never on the
// fallbacks. Presses before that do nothing. State is polled every 100 ms
// and on every controller change. Voice only and full duplex: there is no
// typed input and no input mode.

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
  liveOpen: boolean;
  listening: boolean;
  speaking: boolean;
  /** A hold is on: from the orb or from Space. */
  pressing: boolean;
};

export type VoiceValue = VoiceSnapshot & {
  /** Open the microphone and the Live session; claims the voice session first when needed. */
  start: () => void;
  /** Microphone and session off. */
  end: () => void;
  /** A forced turn past every filter; opens the Live session when closed. */
  pressTalk: () => void;
  releaseTalk: () => void;
  /** Stop playback, silence the rest of the reply and end any open turn. */
  interrupt: () => void;
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
  if (!v) return { holdsVoice: false, liveOpen: false, listening: false, speaking: false, pressing: false };
  return { holdsVoice: v.holdsVoice, liveOpen: v.liveOpen, listening: v.listening, speaking: v.speaking, pressing: v.pressing };
}

function same(a: VoiceSnapshot, b: VoiceSnapshot): boolean {
  return (
    a.holdsVoice === b.holdsVoice &&
    a.liveOpen === b.liveOpen &&
    a.listening === b.listening &&
    a.speaking === b.speaking &&
    a.pressing === b.pressing
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
          controller.current.setHoldsVoice(msg.voice_holder !== null && msg.voice_holder === msg.device_id);
          break;
        }
        case "voice.granted":
          controller.current?.setHoldsVoice(true);
          break;
        case "voice.revoked":
          controller.current?.setHoldsVoice(false);
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
      start: () => controller.current?.start(),
      end: () => controller.current?.end(),
      pressTalk: () => controller.current?.pressTalk(),
      releaseTalk: () => controller.current?.releaseTalk(),
      interrupt: () => controller.current?.interrupt(),
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
