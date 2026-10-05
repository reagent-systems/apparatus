// One Gemini Live socket. Sends `setup` first, waits for `setupComplete`,
// then streams audio and signals. Realtime input sent before setup is
// complete is queued (bounded) so a turn that starts during connect is
// not lost.

import {
  buildActivityEnd,
  buildActivityStart,
  buildAudioChunk,
  buildEventTurn,
  buildToolResponse,
  parseServerMessage,
  type FunctionResponse,
  type LiveClientMessage,
  type LiveEvent,
} from "./messages.ts";
import type { JsonObject } from "../protocol.ts";

// Ephemeral token in the query string: a browser cannot set headers on a
// WebSocket. CONFIRM against the current Google docs (spec: Facts to verify):
// the host, the `v1alpha` path, the `BidiGenerateContentConstrained` method
// and the `access_token` parameter name.
export const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

// 30 s of 20 ms frames: the most a slow connect may hold back.
const MAX_QUEUE = 1500;

export type LiveSessionOptions = {
  onEvent: (event: LiveEvent) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onError?: (error: unknown) => void;
};

export class LiveSession {
  private readonly opts: LiveSessionOptions;
  private socket: WebSocket | null = null;
  private ready = false;
  private queue: LiveClientMessage[] = [];
  private closed = false;
  /** PCM16 bytes sent and received since the last `takeAudioBytes`. */
  private bytesIn = 0;
  private bytesOut = 0;

  constructor(opts: LiveSessionOptions) {
    this.opts = opts;
  }

  get open(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN && !this.closed;
  }

  get setupDone(): boolean {
    return this.ready;
  }

  /** `setup` is the complete first message from POST /token, sent verbatim. */
  connect(token: string, setup: JsonObject): void {
    const ws = new WebSocket(`${LIVE_URL}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = "blob";
    this.socket = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(setup));
      this.opts.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      void this.decode(ev.data).then((text) => {
        if (text === null) return;
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return;
        }
        for (const event of parseServerMessage(json)) this.handle(event);
      });
    };
    ws.onerror = (ev: Event) => this.opts.onError?.(ev);
    ws.onclose = (ev: CloseEvent) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.ready = false;
      this.opts.onClose?.(ev.reason || `code ${ev.code}`);
    };
  }

  close(reason: string = "client"): void {
    this.closed = true;
    this.queue = [];
    const ws = this.socket;
    this.socket = null;
    this.ready = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, reason.slice(0, 120));
    }
  }

  sendAudio(frame: Int16Array): void {
    const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    this.bytesIn += bytes.byteLength;
    this.enqueue(buildAudioChunk(bytes));
  }

  sendActivityStart(): void {
    this.enqueue(buildActivityStart());
  }

  sendActivityEnd(): void {
    this.enqueue(buildActivityEnd());
  }

  sendEventTurn(voiceText: string): void {
    this.enqueue(buildEventTurn(voiceText));
  }

  sendToolResponse(response: FunctionResponse | FunctionResponse[]): void {
    this.enqueue(buildToolResponse(response));
  }

  /** Audio byte counts since the last call, for usage fallback. */
  takeAudioBytes(): { inBytes: number; outBytes: number } {
    const out = { inBytes: this.bytesIn, outBytes: this.bytesOut };
    this.bytesIn = 0;
    this.bytesOut = 0;
    return out;
  }

  private handle(event: LiveEvent): void {
    if (event.kind === "setupComplete") {
      this.ready = true;
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) this.socket?.send(JSON.stringify(m));
    } else if (event.kind === "audio") {
      this.bytesOut += event.data.byteLength;
    }
    this.opts.onEvent(event);
  }

  private enqueue(msg: LiveClientMessage): void {
    if (this.closed) return;
    if (this.ready && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
      return;
    }
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(msg);
  }

  private async decode(data: unknown): Promise<string | null> {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return null;
  }
}
