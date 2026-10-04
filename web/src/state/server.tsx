// ServerContext: the one ServerSocket, shared by every component.
// `subscribe` hands every S2C message to a handler; `send` writes one C2S.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApparatusBridge } from "../bridge.ts";
import { C2S, type C2SMessage, type Device, type S2CMessage, type S2CReady } from "../protocol.ts";
import { ServerSocket } from "../ws.ts";

export type ServerHandler = (msg: S2CMessage) => void;

export type ServerValue = {
  send: (msg: C2SMessage) => boolean;
  subscribe: (handler: ServerHandler) => () => void;
  deviceId: string | null;
  /** The last `ready` message. */
  ready: S2CReady | null;
  connected: boolean;
  device: Device;
  /** `http(s)://host` of the session server, for fetch. */
  httpOrigin: string;
  auth: string;
  bridge: ApparatusBridge;
};

const ServerContext = createContext<ServerValue | null>(null);

export type ServerProviderProps = {
  bridge: ApparatusBridge;
  auth: string;
  device: Device;
  httpOrigin: string;
  children: ReactNode;
};

export function ServerProvider({ bridge, auth, device, httpOrigin, children }: ServerProviderProps) {
  const handlers = useRef(new Set<ServerHandler>());
  const socket = useRef<ServerSocket | null>(null);
  const [ready, setReady] = useState<S2CReady | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const wsOrigin = httpOrigin.replace(/^http/, "ws");
    const ws = new ServerSocket({
      origin: wsOrigin,
      auth,
      device,
      onOpen: () => {
        setConnected(true);
        ws.send({ type: C2S.HELLO, device, wants_voice: true });
      },
      onClose: () => setConnected(false),
      onMessage: (msg) => {
        if (msg.type === "ready") setReady(msg);
        for (const h of handlers.current) h(msg);
      },
    });
    socket.current = ws;
    ws.connect();
    return () => {
      ws.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [auth, device, httpOrigin]);

  const send = useCallback((msg: C2SMessage): boolean => socket.current?.send(msg) ?? false, []);
  const subscribe = useCallback((handler: ServerHandler): (() => void) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const value = useMemo<ServerValue>(
    () => ({
      send,
      subscribe,
      deviceId: ready?.device_id ?? null,
      ready,
      connected,
      device,
      httpOrigin,
      auth,
      bridge,
    }),
    [send, subscribe, ready, connected, device, httpOrigin, auth, bridge],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerValue {
  const v = useContext(ServerContext);
  if (!v) throw new Error("useServer outside ServerProvider");
  return v;
}

/** Subscribe for the life of the component. `handler` is read through a ref,
 *  so a new closure per render needs no resubscribe. */
export function useServerMessages(handler: ServerHandler): void {
  const { subscribe } = useServer();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((msg) => ref.current(msg)), [subscribe]);
}
