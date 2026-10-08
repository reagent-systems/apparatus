// The one authenticated WebSocket to the session server. Reconnects with
// backoff and keeps the link alive with `ping`.

import { C2S, parseS2C, encodeC2S, type C2SMessage, type S2CMessage, type Device } from "./protocol.ts";

export type ServerSocketOptions = {
  /** `ws://host` or `wss://host`; no path. */
  origin: string;
  auth: string;
  device: Device;
  pingIntervalMs?: number;
  onMessage: (msg: S2CMessage) => void;
  /** Called on every (re)connect, after the socket is open. Send `hello` here. */
  onOpen: () => void;
  onClose?: (reason: string) => void;
};

export class ServerSocket {
  private readonly opts: ServerSocketOptions;
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  constructor(opts: ServerSocketOptions) {
    this.opts = opts;
  }

  get url(): string {
    const q = new URLSearchParams({ auth: this.opts.auth, device: this.opts.device });
    return `${this.opts.origin}/ws/client?${q.toString()}`;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  /** Dropped when the socket is not open; the server state restarts on reconnect. */
  send(msg: C2SMessage): boolean {
    if (!this.connected || !this.socket) return false;
    this.socket.send(encodeC2S(msg));
    return true;
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.socket = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onOpen();
      this.pingTimer = setInterval(() => this.send({ type: C2S.PING }), this.opts.pingIntervalMs ?? 20_000);
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      const msg = parseS2C(ev.data);
      if (msg) this.opts.onMessage(msg);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearTimers();
      this.opts.onClose?.(ev.reason || `code ${ev.code}`);
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles the reconnect
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}
