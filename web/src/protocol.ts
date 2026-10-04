// Client <-> session server messages. Mirror of agent-kit/docs/PROTOCOL.md
// (C2S and S2C tables). Change both in one commit. DOM-free.

export const C2S = {
  HELLO: "hello",
  VOICE_CLAIM: "voice.claim",
  VOICE_RELEASE: "voice.release",
  TRANSCRIPT: "transcript",
  TOOL_CALL: "tool.call",
  HANDOFF_DONE: "handoff.done",
  HANDOFF_CANCEL: "handoff.cancel",
  APPROVAL_ANSWER: "approval.answer",
  LIVE_USAGE: "live.usage",
  LIVE_RESUMPTION: "live.resumption",
  LIVE_CLOSED: "live.closed",
  SCREEN_OPEN: "screen.open",
  SCREEN_CLOSE: "screen.close",
  CONTROL_TAKE: "control.take",
  CONTROL_RELEASE: "control.release",
  SIGNAL: "signal",
  PUSH_REGISTER: "push.register",
  PING: "ping",
} as const;

export const S2C = {
  READY: "ready",
  VOICE_GRANTED: "voice.granted",
  VOICE_REVOKED: "voice.revoked",
  TRANSCRIPT: "transcript",
  JOB_STARTED: "job.started",
  JOB_PROGRESS: "job.progress",
  JOB_DONE: "job.done",
  SHOW: "show",
  HANDOFF_REQUESTED: "handoff.requested",
  HANDOFF_ENDED: "handoff.ended",
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_ENDED: "approval.ended",
  TOOL_RESULT: "tool.result",
  CREDITS: "credits",
  SCREEN_OPENED: "screen.opened",
  SCREEN_CLOSED: "screen.closed",
  CONTROL: "control",
  SIGNAL: "signal",
  ERROR: "error",
  PONG: "pong",
} as const;

export type C2SType = (typeof C2S)[keyof typeof C2S];
export type S2CType = (typeof S2C)[keyof typeof S2C];

export type Device = "web" | "ios" | "android" | "desktop" | "tablet" | "watch";
export type TranscriptRole = "user" | "agent";
export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "needs_user" | "cancelled";
export type HandoffOutcome = "done" | "cancel" | "timeout";
export type CreditsState = "ok" | "low" | "out";
export type Scheduling = "INTERRUPT" | "WHEN_IDLE" | "SILENT";
export type PushPlatform = "fcm" | "apns" | "web";
export type ScreenClosedReason = "closed" | "vm.disconnect" | "device.disconnect" | "vm.closed";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** Who holds the desktop. `by` is a device id, or null when nobody does. */
export type ControlState = { active: boolean; by: string | null };

/** WebRTC signaling payload: one description or one candidate. */
export type SignalPayload =
  | { description: { type: string; sdp: string } }
  | { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } };

/** One ICE server as the browser takes it: `RTCIceServer`. */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** One job as `ready.jobs` and GET /jobs carry it. */
export type JobSummary = {
  job_id: string;
  request: string;
  status: JobStatus;
  created?: number;
  ended?: number | null;
  say?: string;
  show?: string | null;
  progress?: string;
  percent?: number | null;
};

// ---- client -> server ----------------------------------------------------

export type C2SHello = { type: typeof C2S.HELLO; device: Device; wants_voice: boolean };
export type C2SVoiceClaim = { type: typeof C2S.VOICE_CLAIM };
export type C2SVoiceRelease = { type: typeof C2S.VOICE_RELEASE };
export type C2STranscript = { type: typeof C2S.TRANSCRIPT; role: TranscriptRole; text: string; final: boolean };
export type C2SToolCall = { type: typeof C2S.TOOL_CALL; call_id: string; name: string; args: JsonObject };
export type C2SHandoffDone = { type: typeof C2S.HANDOFF_DONE; handoff_id: string };
export type C2SHandoffCancel = { type: typeof C2S.HANDOFF_CANCEL; handoff_id: string };
export type C2SApprovalAnswer = { type: typeof C2S.APPROVAL_ANSWER; approval_id: string; approved: boolean };
export type C2SLiveUsage = {
  type: typeof C2S.LIVE_USAGE;
  audio_in_ms: number;
  audio_out_ms: number;
  input_tokens: number;
  output_tokens: number;
};
export type C2SLiveResumption = { type: typeof C2S.LIVE_RESUMPTION; handle: string };
export type C2SLiveClosed = { type: typeof C2S.LIVE_CLOSED; reason: string };
export type C2SScreenOpen = { type: typeof C2S.SCREEN_OPEN };
export type C2SScreenClose = { type: typeof C2S.SCREEN_CLOSE; stream_id: string };
export type C2SControlTake = { type: typeof C2S.CONTROL_TAKE };
export type C2SControlRelease = { type: typeof C2S.CONTROL_RELEASE };
export type C2SSignal = { type: typeof C2S.SIGNAL; stream_id: string; payload: SignalPayload };
export type C2SPushRegister = { type: typeof C2S.PUSH_REGISTER; platform: PushPlatform; token: string };
export type C2SPing = { type: typeof C2S.PING };

export type C2SMessage =
  | C2SHello
  | C2SVoiceClaim
  | C2SVoiceRelease
  | C2STranscript
  | C2SToolCall
  | C2SHandoffDone
  | C2SHandoffCancel
  | C2SApprovalAnswer
  | C2SLiveUsage
  | C2SLiveResumption
  | C2SLiveClosed
  | C2SScreenOpen
  | C2SScreenClose
  | C2SControlTake
  | C2SControlRelease
  | C2SSignal
  | C2SPushRegister
  | C2SPing;

// ---- server -> client ----------------------------------------------------

// Any S2C message may carry `voice`. The voice holder speaks it as an event turn.
type Voiced = { voice?: string };

export type S2CReady = Voiced & {
  type: typeof S2C.READY;
  user_id: string;
  device_id: string;
  voice_holder: string | null;
  balance: number;
  gate: unknown;
  live?: unknown;
  control?: ControlState;
  streams?: string[];
  jobs?: JobSummary[];
};
export type S2CVoiceGranted = Voiced & { type: typeof S2C.VOICE_GRANTED };
export type S2CVoiceRevoked = Voiced & { type: typeof S2C.VOICE_REVOKED; by: string };
export type S2CTranscript = Voiced & { type: typeof S2C.TRANSCRIPT; role: TranscriptRole; text: string };
export type S2CJobStarted = Voiced & { type: typeof S2C.JOB_STARTED; job_id: string; request: string };
export type S2CJobProgress = Voiced & {
  type: typeof S2C.JOB_PROGRESS;
  job_id: string;
  text: string;
  percent: number | null;
};
export type S2CJobDone = Voiced & {
  type: typeof S2C.JOB_DONE;
  job_id: string;
  status: JobStatus;
  say: string;
  show?: string | null;
  artifacts?: string[];
};
export type S2CShow = Voiced & { type: typeof S2C.SHOW; content: string; target?: string | null };
export type S2CHandoffRequested = Voiced & {
  type: typeof S2C.HANDOFF_REQUESTED;
  handoff_id: string;
  job_id: string;
  reason: string;
  url?: string | null;
};
export type S2CHandoffEnded = Voiced & { type: typeof S2C.HANDOFF_ENDED; handoff_id: string; outcome: HandoffOutcome };
export type S2CApprovalRequested = Voiced & {
  type: typeof S2C.APPROVAL_REQUESTED;
  approval_id: string;
  job_id: string;
  action: string;
  details: string;
};
export type S2CApprovalEnded = Voiced & { type: typeof S2C.APPROVAL_ENDED; approval_id: string; approved: boolean };
export type S2CToolResult = Voiced & {
  type: typeof S2C.TOOL_RESULT;
  call_id: string;
  name: string;
  response: JsonObject;
  scheduling: Scheduling;
};
export type S2CCredits = Voiced & { type: typeof S2C.CREDITS; balance: number; state: CreditsState };
export type S2CScreenOpened = Voiced & { type: typeof S2C.SCREEN_OPENED; stream_id: string; ice_servers: IceServer[] };
export type S2CScreenClosed = Voiced & { type: typeof S2C.SCREEN_CLOSED; stream_id: string; reason: ScreenClosedReason };
export type S2CControl = Voiced & { type: typeof S2C.CONTROL } & ControlState;
export type S2CSignal = Voiced & { type: typeof S2C.SIGNAL; stream_id: string; payload: SignalPayload };
export type S2CError = Voiced & { type: typeof S2C.ERROR; code: string; message: string };
export type S2CPong = Voiced & { type: typeof S2C.PONG };

export type S2CMessage =
  | S2CReady
  | S2CVoiceGranted
  | S2CVoiceRevoked
  | S2CTranscript
  | S2CJobStarted
  | S2CJobProgress
  | S2CJobDone
  | S2CShow
  | S2CHandoffRequested
  | S2CHandoffEnded
  | S2CApprovalRequested
  | S2CApprovalEnded
  | S2CToolResult
  | S2CCredits
  | S2CScreenOpened
  | S2CScreenClosed
  | S2CControl
  | S2CSignal
  | S2CError
  | S2CPong;

const S2C_TYPES: ReadonlySet<string> = new Set(Object.values(S2C));

/** One inbound frame to a typed message. Unknown types and bad JSON give null. */
export function parseS2C(raw: unknown): S2CMessage | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const type = (obj as { type?: unknown }).type;
  if (typeof type !== "string" || !S2C_TYPES.has(type)) return null;
  return obj as S2CMessage;
}

export function hasVoice(msg: S2CMessage): msg is S2CMessage & { voice: string } {
  return typeof msg.voice === "string" && msg.voice.length > 0;
}

export const JOB_TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["done", "failed", "needs_user", "cancelled"]);

export function encodeC2S(msg: C2SMessage): string {
  return JSON.stringify(msg);
}
