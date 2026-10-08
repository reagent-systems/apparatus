// Gemini Live wire shapes: camelCase JSON over a WebSocket. Pure functions.
//
// Builders return the exact objects the Live API accepts. `parseServerMessage`
// flattens one server message into typed events: one message can carry a
// model turn, a transcription and usage at the same time.

import { encodeBase64, decodeBase64 } from "../base64.ts";
import type { Json, JsonObject, Scheduling } from "../protocol.ts";

export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;

export type RealtimeInput =
  | { realtimeInput: { audio: { data: string; mimeType: string } } }
  | { realtimeInput: { activityStart: Record<string, never> } }
  | { realtimeInput: { activityEnd: Record<string, never> } };

export type ClientContent = {
  clientContent: {
    turns: Array<{ role: "user"; parts: Array<{ text: string }> }>;
    turnComplete: boolean;
  };
};

export type FunctionResponse = {
  id: string;
  name: string;
  response: JsonObject;
  scheduling: Scheduling;
};

export type ToolResponse = { toolResponse: { functionResponses: FunctionResponse[] } };

export type LiveClientMessage = RealtimeInput | ClientContent | ToolResponse | { setup: JsonObject };

export function buildAudioChunk(bytes: Uint8Array, sampleRate: number = INPUT_RATE): RealtimeInput {
  return {
    realtimeInput: {
      audio: { data: encodeBase64(bytes), mimeType: `audio/pcm;rate=${sampleRate}` },
    },
  };
}

export function buildActivityStart(): RealtimeInput {
  return { realtimeInput: { activityStart: {} } };
}

export function buildActivityEnd(): RealtimeInput {
  return { realtimeInput: { activityEnd: {} } };
}

/** An S2C `voice` string as a user turn: `<event>text</event>`, turn complete. */
export function buildEventTurn(voiceText: string): ClientContent {
  const safe = voiceText.replace(/<\/event>/gi, "");
  return {
    clientContent: {
      turns: [{ role: "user", parts: [{ text: `<event>${safe}</event>` }] }],
      turnComplete: true,
    },
  };
}

export function buildToolResponse(responses: FunctionResponse | FunctionResponse[]): ToolResponse {
  const list = Array.isArray(responses) ? responses : [responses];
  return {
    toolResponse: {
      functionResponses: list.map((r) => ({
        id: r.id,
        name: r.name,
        response: r.response,
        scheduling: r.scheduling,
      })),
    },
  };
}

// ---- server -> client ----------------------------------------------------

export type FunctionCall = { id: string; name: string; args: JsonObject };

export type UsageEvent = {
  kind: "usage";
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  promptAudioTokens: number | null;
  responseAudioTokens: number | null;
};

export type LiveEvent =
  | { kind: "setupComplete" }
  | { kind: "audio"; data: Uint8Array; mimeType: string; sampleRate: number }
  | { kind: "text"; text: string }
  | { kind: "interrupted" }
  | { kind: "turnComplete" }
  | { kind: "generationComplete" }
  | { kind: "inputTranscription"; text: string; finished: boolean }
  | { kind: "outputTranscription"; text: string; finished: boolean }
  | { kind: "toolCall"; calls: FunctionCall[] }
  | { kind: "toolCallCancellation"; ids: string[] }
  | UsageEvent
  | { kind: "resumptionUpdate"; newHandle: string | null; resumable: boolean }
  | { kind: "goAway"; timeLeftMs: number | null }
  | { kind: "unknown"; raw: unknown };

export type LiveEventKind = LiveEvent["kind"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** `audio/pcm;rate=24000` -> 24000. Falls back to the Live output rate. */
export function parseMimeRate(mimeType: string): number {
  const m = /rate=(\d+)/.exec(mimeType);
  return m ? Number(m[1]) : OUTPUT_RATE;
}

/** A protobuf Duration as JSON (`"12.5s"` or `{seconds, nanos}`) to ms. */
export function parseDurationMs(d: unknown): number | null {
  if (typeof d === "string") {
    const m = /^(-?\d+(?:\.\d+)?)s$/.exec(d.trim());
    return m ? Math.round(Number(m[1]) * 1000) : null;
  }
  if (isRecord(d)) {
    const s = typeof d.seconds === "string" ? Number(d.seconds) : num(d.seconds);
    return Math.round(s * 1000 + num(d.nanos) / 1e6);
  }
  if (typeof d === "number") return Math.round(d * 1000);
  return null;
}

function audioTokens(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  let found = false;
  let total = 0;
  for (const d of details) {
    if (isRecord(d) && d.modality === "AUDIO") {
      found = true;
      total += num(d.tokenCount);
    }
  }
  return found ? total : null;
}

export function parseServerMessage(json: unknown): LiveEvent[] {
  const events: LiveEvent[] = [];
  if (!isRecord(json)) return [{ kind: "unknown", raw: json }];

  if ("setupComplete" in json) events.push({ kind: "setupComplete" });

  const sc = json.serverContent;
  if (isRecord(sc)) {
    if (sc.interrupted === true) events.push({ kind: "interrupted" });
    const mt = sc.modelTurn;
    if (isRecord(mt) && Array.isArray(mt.parts)) {
      for (const part of mt.parts) {
        if (!isRecord(part)) continue;
        const inline = part.inlineData;
        if (isRecord(inline) && typeof inline.data === "string") {
          const mimeType = typeof inline.mimeType === "string" ? inline.mimeType : `audio/pcm;rate=${OUTPUT_RATE}`;
          events.push({ kind: "audio", data: decodeBase64(inline.data), mimeType, sampleRate: parseMimeRate(mimeType) });
        } else if (typeof part.text === "string") {
          events.push({ kind: "text", text: part.text });
        }
      }
    }
    const it = sc.inputTranscription;
    if (isRecord(it) && typeof it.text === "string") {
      events.push({ kind: "inputTranscription", text: it.text, finished: it.finished === true });
    }
    const ot = sc.outputTranscription;
    if (isRecord(ot) && typeof ot.text === "string") {
      events.push({ kind: "outputTranscription", text: ot.text, finished: ot.finished === true });
    }
    if (sc.generationComplete === true) events.push({ kind: "generationComplete" });
    if (sc.turnComplete === true) events.push({ kind: "turnComplete" });
  }

  const tc = json.toolCall;
  if (isRecord(tc) && Array.isArray(tc.functionCalls)) {
    const calls: FunctionCall[] = [];
    for (const c of tc.functionCalls) {
      if (!isRecord(c) || typeof c.name !== "string") continue;
      calls.push({
        id: typeof c.id === "string" ? c.id : "",
        name: c.name,
        args: isRecord(c.args) ? (c.args as JsonObject) : {},
      });
    }
    events.push({ kind: "toolCall", calls });
  }

  const tcc = json.toolCallCancellation;
  if (isRecord(tcc) && Array.isArray(tcc.ids)) {
    events.push({ kind: "toolCallCancellation", ids: tcc.ids.filter((x): x is string => typeof x === "string") });
  }

  const um = json.usageMetadata;
  if (isRecord(um)) {
    const prompt = num(um.promptTokenCount);
    const response = num(um.responseTokenCount ?? um.candidatesTokenCount);
    events.push({
      kind: "usage",
      promptTokens: prompt,
      responseTokens: response,
      totalTokens: num(um.totalTokenCount) || prompt + response,
      promptAudioTokens: audioTokens(um.promptTokensDetails),
      responseAudioTokens: audioTokens(um.responseTokensDetails ?? um.candidatesTokensDetails),
    });
  }

  const sru = json.sessionResumptionUpdate;
  if (isRecord(sru)) {
    events.push({
      kind: "resumptionUpdate",
      newHandle: typeof sru.newHandle === "string" && sru.newHandle.length > 0 ? sru.newHandle : null,
      resumable: sru.resumable === true,
    });
  }

  const ga = json.goAway;
  if (isRecord(ga)) {
    events.push({ kind: "goAway", timeLeftMs: parseDurationMs(ga.timeLeft) });
  }

  if (events.length === 0) events.push({ kind: "unknown", raw: json });
  return events;
}

export type { Json };
