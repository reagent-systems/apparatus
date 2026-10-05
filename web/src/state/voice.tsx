// VoiceContext: the VoiceController on this device. Created at the first
// `ready`, so the gate runs on the server's table and never on the
// fallbacks. Presses before that do nothing. State is polled every 100 ms
// and on every controller change.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergeGate, mergeLive } from "../config.ts";
import { InputMode, type GateLogEntry } from "../gate/gate.ts";
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
  inputMode: InputMode;
};

export type VoiceValue = VoiceSnapshot & {
  /** Open the microphone and the Live session; claims the voice session first when needed. */
  start: () => void;
  /** Microphone and session off. */
  end: () => void;
  pressTalk: () => void;
  releaseTalk: () => void;
  /** Flush playback and end any open turn. */
  stop: () => void;
  /** Take the voice session for this device. */
  claim: () => void;
  /** Typed text to the voice model; opens the Live session when closed. */
  sendText: (text: string) => void;
  /** Push to talk or open mic. Persists under `apparatus.input`. */
  setInputMode: (mode: InputMode) => void;
  subscribeTranscript: (handler: TranscriptHandler) => () => void;
  /** The current value, outside React's render cycle. */
  holdsVoiceNow: () => boolean;
};

const VoiceContext = createContext<VoiceValue | null>(null);

const INPUT_KEY = "apparatus.input";

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseInputMode(value: string | null | undefined): InputMode {
  return value === InputMode.PUSH_TO_TALK ? InputMode.PUSH_TO_TALK : InputMode.OPEN_MIC;
}

function readInputMode(): InputMode {
  return parseInputMode(storageOrNull()?.getItem(INPUT_KEY));
}

function writeInputMode(mode: InputMode): void {
  try {
    storageOrNull()?.setItem(INPUT_KEY, mode);
  } catch {
    // storage blocked: the choice lives for this page only
  }
}

function snapshot(v: VoiceController | null, fallbackMode: InputMode): VoiceSnapshot {
  if (!v) return { holdsVoice: false, liveOpen: false, listening: false, speaking: false, inputMode: fallbackMode };
  return { holdsVoice: v.holdsVoice, liveOpen: v.liveOpen, listening: v.listening, speaking: v.speaking, inputMode: v.inputMode };
}

function same(a: VoiceSnapshot, b: VoiceSnapshot): boolean {
  return (
    a.holdsVoice === b.holdsVoice &&
    a.liveOpen === b.liveOpen &&
    a.listening === b.listening &&
    a.speaking === b.speaking &&
    a.inputMode === b.inputMode
  );
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const server = useServer();
  const controller = useRef<VoiceController | null>(null);
  const transcriptHandlers = useRef(new Set<TranscriptHandler>());
  // The stored choice stands in until the controller exists at the first `ready`.
  const storedMode = useRef<InputMode>(readInputMode());
  const [state, setState] = useState<VoiceSnapshot>(() => snapshot(null, storedMode.current));

  const refresh = useCallback(() => {
    const next = snapshot(controller.current, storedMode.current);
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
            v.setInputMode(storedMode.current);
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
      stop: () => controller.current?.stop(),
      claim: () => {
        const v = controller.current;
        if (v && !v.holdsVoice) v.start();
      },
      sendText: (text) => controller.current?.sendText(text),
      setInputMode: (mode) => {
        storedMode.current = mode;
        writeInputMode(mode);
        controller.current?.setInputMode(mode);
        refresh();
      },
      subscribeTranscript: (handler) => {
        transcriptHandlers.current.add(handler);
        return () => {
          transcriptHandlers.current.delete(handler);
        };
      },
      holdsVoiceNow: () => controller.current?.holdsVoice ?? false,
    }),
    [refresh],
  );

  const value = useMemo<VoiceValue>(() => ({ ...state, ...actions }), [state, actions]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceValue {
  const v = useContext(VoiceContext);
  if (!v) throw new Error("useVoice outside VoiceProvider");
  return v;
}
