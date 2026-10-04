// DOM-free helpers for the VM screen widget: the "input" data channel
// shape, pointer normalization over a letterboxed video, the move rate
// limiter, and the perfect-negotiation decisions. The widget in
// components/vm owns the elements; src/vm/peer.ts owns the
// RTCPeerConnection; this file holds only the math.

import type { SignalPayload } from "../protocol.ts";

/** One JSON object per data-channel message, client -> agentd.
 *  `x` and `y` are 0..1 over the video frame. `button`: 0 left, 1 middle,
 *  2 right. `key`/`code` are DOM KeyboardEvent.key / .code. A touch carries
 *  its phase in `key`. */
export type InputEvent =
  | { kind: "mouse.move"; x: number; y: number }
  | { kind: "mouse.down"; x: number; y: number; button: number }
  | { kind: "mouse.up"; x: number; y: number; button: number }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number }
  | { kind: "key.down"; key: string; code: string }
  | { kind: "key.up"; key: string; code: string }
  | { kind: "touch"; x: number; y: number; key: "start" | "move" | "end" };

export type InputKind = InputEvent["kind"];
export type PointerKind = Extract<InputEvent, { x: number }>["kind"];
export type KeyKind = "key.down" | "key.up";
export type TouchPhase = Extract<InputEvent, { kind: "touch" }>["key"];

export function encodeInput(event: InputEvent): string {
  return JSON.stringify(event);
}

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

/** The picture box of a video with `object-fit: contain` inside `rect`. */
export function pictureBox(rect: Rect, videoWidth: number, videoHeight: number): Rect | null {
  const vw = videoWidth || rect.width;
  const vh = videoHeight || rect.height;
  if (rect.width <= 0 || rect.height <= 0 || vw <= 0 || vh <= 0) return null;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

/** A client position to 0..1 over the video frame. Null outside the picture. */
export function normalizePointer(
  rect: Rect,
  videoWidth: number,
  videoHeight: number,
  clientX: number,
  clientY: number,
): Point | null {
  const box = pictureBox(rect, videoWidth, videoHeight);
  if (!box) return null;
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** `normalizePointer` with the event's argument order. Null outside the frame. */
export function normalizeToFrame(
  clientX: number,
  clientY: number,
  elementRect: Rect,
  videoWidth: number,
  videoHeight: number,
): Point | null {
  return normalizePointer(elementRect, videoWidth, videoHeight, clientX, clientY);
}

/** Like `normalizeToFrame` but clamps to the frame edge instead of
 *  returning null. A button release outside the picture still lands, so
 *  the desktop never keeps a button held. Null only when there is no box. */
export function clampToFrame(
  clientX: number,
  clientY: number,
  elementRect: Rect,
  videoWidth: number,
  videoHeight: number,
): Point | null {
  const box = pictureBox(elementRect, videoWidth, videoHeight);
  if (!box) return null;
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return { x: clamp((clientX - box.left) / box.width), y: clamp((clientY - box.top) / box.height) };
}

// ---- event builders --------------------------------------------------------

export type PointerDetail = { button?: number; dx?: number; dy?: number; phase?: TouchPhase };

/** One pointer-shaped event. `button` for down/up (default 0), `dx`/`dy`
 *  for wheel (default 0), `phase` for touch (default "move"). */
export function eventFromPointer(kind: PointerKind, point: Point, detail: PointerDetail = {}): InputEvent {
  const { x, y } = point;
  switch (kind) {
    case "mouse.move":
      return { kind, x, y };
    case "mouse.down":
    case "mouse.up":
      return { kind, x, y, button: detail.button ?? 0 };
    case "wheel":
      return { kind, x, y, dx: detail.dx ?? 0, dy: detail.dy ?? 0 };
    case "touch":
      return { kind, x, y, key: detail.phase ?? "move" };
  }
}

export type KeyLike = { key: string; code: string };

export function eventFromKey(kind: KeyKind, event: KeyLike): InputEvent {
  return { kind, key: event.key, code: event.code };
}

/** Wheel deltas in pixels. DOM `deltaMode` 1 is lines, 2 is pages. */
export function wheelDelta(deltaX: number, deltaY: number, deltaMode: number): { dx: number; dy: number } {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  return { dx: deltaX * unit, dy: deltaY * unit };
}

/** Keys the browser acts on while the video has focus: scrolling, focus
 *  travel, history. The widget stops their default while input is on. */
const BROWSER_KEYS: ReadonlySet<string> = new Set([
  " ",
  "Spacebar",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Backspace",
]);

export type ModifierKeyLike = KeyLike & { ctrlKey?: boolean; metaKey?: boolean };

export function stopsDefault(event: ModifierKeyLike): boolean {
  return BROWSER_KEYS.has(event.key) || event.ctrlKey === true || event.metaKey === true;
}

// ---- move rate limiter -----------------------------------------------------

export type MoveLimiterOptions = {
  /** Least time between two sends. Default 1000 / 60. */
  minIntervalMs?: number;
  now?: () => number;
  /** Runs `fn` after `ms`. Default setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
};

/** Sends at most one event per interval and never drops the last one: a
 *  burst inside the window is held and the newest wins when the window
 *  ends. For `mouse.move` and `touch` move. */
export class MoveLimiter {
  private readonly send: (event: InputEvent) => void;
  private readonly interval: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private last = Number.NEGATIVE_INFINITY;
  private pending: InputEvent | null = null;
  private timer = false;

  constructor(send: (event: InputEvent) => void, options: MoveLimiterOptions = {}) {
    this.send = send;
    this.interval = options.minIntervalMs ?? 1000 / 60;
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  push(event: InputEvent): void {
    const t = this.now();
    if (!this.timer && t - this.last >= this.interval) {
      this.last = t;
      this.send(event);
      return;
    }
    this.pending = event;
    if (!this.timer) {
      this.timer = true;
      this.schedule(() => this.fire(), Math.max(0, this.last + this.interval - t));
    }
  }

  /** Sends the held event now, if any. */
  flush(): void {
    if (!this.pending) return;
    const event = this.pending;
    this.pending = null;
    this.last = this.now();
    this.send(event);
  }

  /** Drops the held event. */
  clear(): void {
    this.pending = null;
  }

  private fire(): void {
    this.timer = false;
    this.flush();
  }
}

// ---- perfect negotiation ---------------------------------------------------
// This side is the polite peer. agentd makes the offer after `stream.start`;
// this side answers, and also offers when its own negotiation fires first.

export type SignalingState = "stable" | "have-local-offer" | "have-remote-offer" | "have-local-pranswer" | "have-remote-pranswer" | "closed";

/** True when an incoming offer collides with our own: the polite peer rolls back and takes theirs. */
export function offerCollision(incomingType: string, makingOffer: boolean, signalingState: SignalingState): boolean {
  return incomingType === "offer" && (makingOffer || signalingState !== "stable");
}

export type ParsedSignal =
  | { kind: "description"; type: string; sdp: string }
  | { kind: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | null;

/** One signal payload to a tagged value. Unknown shapes give null. */
export function parseSignal(payload: unknown): ParsedSignal {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const d = p.description;
  if (typeof d === "object" && d !== null) {
    const desc = d as Record<string, unknown>;
    if (typeof desc.type === "string" && typeof desc.sdp === "string") {
      return { kind: "description", type: desc.type, sdp: desc.sdp };
    }
    return null;
  }
  const c = p.candidate;
  if (typeof c === "object" && c !== null) {
    const cand = c as Record<string, unknown>;
    if (typeof cand.candidate !== "string") return null;
    return {
      kind: "candidate",
      candidate: cand.candidate,
      sdpMid: typeof cand.sdpMid === "string" ? cand.sdpMid : null,
      sdpMLineIndex: typeof cand.sdpMLineIndex === "number" ? cand.sdpMLineIndex : null,
    };
  }
  return null;
}

export function descriptionPayload(d: { type: string; sdp: string }): SignalPayload {
  return { description: { type: d.type, sdp: d.sdp } };
}

export function candidatePayload(c: {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}): SignalPayload {
  return { candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } };
}
