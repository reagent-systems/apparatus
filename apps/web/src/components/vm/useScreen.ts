// useScreen: one screen stream for this device on the ServerContext.
// `open` sends `screen.open`; `screen.opened` brings the stream id and the
// ICE servers, and the ScreenPeer answers agentd's offer from there.
// Control state follows `ready.control` and `control`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C2S, type ControlState, type IceServer, type S2CMessage, type SignalPayload } from "@/protocol";
import { useServer, useServerMessages } from "@/state/server";
import type { InputEvent } from "@/vm/input";
import { ScreenPeer } from "@/vm/peer";

export type ScreenStatus = "closed" | "opening" | "connecting" | "live" | "failed";

export type ScreenValue = {
  stream: MediaStream | null;
  status: ScreenStatus;
  /** Somebody holds the desktop. */
  controlActive: boolean;
  /** This device holds the desktop. */
  controlledByMe: boolean;
  /** The "input" data channel is open. */
  inputOpen: boolean;
  open: () => void;
  close: () => void;
  takeControl: () => void;
  releaseControl: () => void;
  /** False when nothing is open; the event is dropped. */
  sendInput: (event: InputEvent) => boolean;
};

const NO_CONTROL: ControlState = { active: false, by: null };

export function useScreen(): ScreenValue {
  const { send, ready, deviceId, connected } = useServer();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ScreenStatus>("closed");
  const [inputOpen, setInputOpen] = useState(false);
  const [control, setControl] = useState<ControlState>(ready?.control ?? NO_CONTROL);

  // `wanted` is true between open() and close(). `pendingOpen` is true
  // while a `screen.open` is out on the current socket.
  const wanted = useRef(false);
  const pendingOpen = useRef(false);
  const streamId = useRef<string | null>(null);
  const peer = useRef<ScreenPeer | null>(null);
  // agentd's offer can overtake `screen.opened`; signals for a stream this
  // device does not know yet wait here until the open names that stream.
  const earlySignals = useRef<Map<string, SignalPayload[]>>(new Map());

  const teardown = useCallback((): void => {
    peer.current?.close();
    peer.current = null;
    streamId.current = null;
    setStream(null);
    setInputOpen(false);
  }, []);

  const requestOpen = useCallback((): void => {
    setStatus("opening");
    pendingOpen.current = send({ type: C2S.SCREEN_OPEN });
  }, [send]);

  const startPeer = useCallback(
    (id: string, iceServers: IceServer[]): void => {
      const p = new ScreenPeer({
        onSignal: (payload) => {
          send({ type: C2S.SIGNAL, stream_id: id, payload });
        },
        onTrack: (s) => setStream(s),
        onChannel: (open) => setInputOpen(open),
        onState: (state) => {
          if (peer.current !== p) return;
          if (state === "connected") setStatus("live");
          else if (state === "failed" || state === "closed") setStatus("failed");
          else if (state === "disconnected") setStatus("connecting");
        },
        onError: (err) => console.warn("screen", err),
      });
      peer.current = p;
      streamId.current = id;
      setStatus("connecting");
      p.open(iceServers);
    },
    [send],
  );

  useServerMessages((msg: S2CMessage) => {
    switch (msg.type) {
      case "ready": {
        setControl(msg.control ?? NO_CONTROL);
        if (!wanted.current) return;
        const live = msg.streams ?? [];
        if (streamId.current && !live.includes(streamId.current)) {
          // The server lost the stream with the old socket.
          teardown();
          requestOpen();
        } else if (!streamId.current && !pendingOpen.current) {
          requestOpen();
        }
        return;
      }
      case "control":
        setControl({ active: msg.active, by: msg.by });
        return;
      case "screen.opened": {
        pendingOpen.current = false;
        if (!wanted.current || streamId.current) {
          // Opened for nothing: a close raced the answer, or a duplicate.
          send({ type: C2S.SCREEN_CLOSE, stream_id: msg.stream_id });
          return;
        }
        startPeer(msg.stream_id, msg.ice_servers);
        const queued = earlySignals.current.get(msg.stream_id) ?? [];
        earlySignals.current.clear();
        for (const payload of queued) void peer.current?.handleSignal(payload);
        return;
      }
      case "screen.closed":
        if (msg.stream_id !== streamId.current) return;
        teardown();
        setStatus(msg.reason === "closed" ? "closed" : "failed");
        return;
      case "signal":
        if (msg.stream_id !== streamId.current) {
          if (pendingOpen.current && !streamId.current) {
            const list = earlySignals.current.get(msg.stream_id) ?? [];
            if (list.length < 64) list.push(msg.payload);
            earlySignals.current.set(msg.stream_id, list);
          }
          return;
        }
        void peer.current?.handleSignal(msg.payload);
        return;
      default:
        return;
    }
  });

  // A request on a socket that dropped never gets its answer.
  useEffect(() => {
    if (!connected) pendingOpen.current = false;
  }, [connected]);

  const open = useCallback((): void => {
    if (wanted.current) return;
    wanted.current = true;
    requestOpen();
  }, [requestOpen]);

  const close = useCallback((): void => {
    wanted.current = false;
    const id = streamId.current;
    if (id) send({ type: C2S.SCREEN_CLOSE, stream_id: id });
    teardown();
    setStatus("closed");
  }, [send, teardown]);

  const takeControl = useCallback((): void => {
    send({ type: C2S.CONTROL_TAKE });
  }, [send]);

  const releaseControl = useCallback((): void => {
    send({ type: C2S.CONTROL_RELEASE });
  }, [send]);

  const sendInput = useCallback((event: InputEvent): boolean => peer.current?.send(event) ?? false, []);

  // Close whatever is open when the owner unmounts.
  useEffect(() => () => close(), [close]);

  const controlActive = control.active;
  const controlledByMe = control.active && control.by !== null && control.by === deviceId;

  return useMemo<ScreenValue>(
    () => ({ stream, status, controlActive, controlledByMe, inputOpen, open, close, takeControl, releaseControl, sendInput }),
    [stream, status, controlActive, controlledByMe, inputOpen, open, close, takeControl, releaseControl, sendInput],
  );
}
