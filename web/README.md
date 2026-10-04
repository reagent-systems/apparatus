# apparatus web client

The thin client: microphone capture, the voice gate, the Live session, the
feed, the pane and the VM screen. It holds no agent state, no prompt and no
model name. The same bundle runs inside the native shells through
`bridge.js`.

The UI is React 19 with Vite, Tailwind CSS 4 and shadcn/ui (style new-york,
base color zinc, CSS variables). The audio, gate, Live and protocol modules
are plain TypeScript with no DOM and no React; the tests import only those.

## Commands

```sh
npm run dev         # vite dev server; proxies the server routes to :8080
npm run typecheck   # tsc --noEmit
npm run build       # node build.mjs -> dist/
npm test            # node --test test/*.test.ts (Node 22, native type stripping)
npm run verify      # typecheck, build, test; green before any push
```

`build.mjs` runs Vite's `build()` and then esbuild twice. No network. It writes:

| Output | Source | Role |
|---|---|---|
| `dist/index.html` | `index.html` | loads `/bridge.js` as a classic script, then the module bundle |
| `dist/assets/*` | `src/main.tsx` and `src/index.css` | the app and its stylesheet, hashed names |
| `dist/worklet.js` | `src/audio/worklet.ts` | AudioWorklet (esm): downmix, resample to 16 kHz, 20 ms Int16 frames |
| `dist/bridge.js` | `src/bridge-web.ts` | default web bridge (iife); a native shell overwrites this file |

`index.html` at the web root is the Vite entry. `<script src="/bridge.js">`
is a classic script: Vite leaves it alone and it runs before the deferred
module script. The AudioWorklet loads from `/worklet.js`.

The session server serves `dist/` at `/`. The page uses relative URLs:
`POST /token` and `GET /ws/client?auth=<auth>&device=<device>` on the same
origin, or on `bridge.serverOrigin` inside a shell.

`npm run dev` proxies `/token`, `/credits`, `/audit`, `/jobs`, `/config`,
`/prompts` and `/ws` (WebSocket) to `http://localhost:8080`, and serves
`/bridge.js` and `/worklet.js` from esbuild on request (`vite.config.ts`).

## Run

1. Start the session server in dev mode.
2. `npm run build`.
3. Open the server origin in a browser. The auth value comes from
   `bridge.secureStore.get("apparatus.auth")` (localStorage on the web) and
   falls back to `dev`.
4. Press the orb to open the microphone, or hold Talk.

## Components

One React tree, responsive. `src/main.tsx` boots: theme, bridge, auth,
device, then `ServerProvider > VoiceProvider > App`.

| File | Task |
|---|---|
| `src/App.tsx` | State: the feed reducer, the sidebar selection, the pane mode, push registration, hidden-page notifications, Done and Cancel, Approve and Deny. |
| `src/state/server.tsx` | `ServerContext` on `ServerSocket`: `{ send, subscribe, deviceId, ready, connected, device, httpOrigin, auth, bridge }`. `useServerMessages(handler)` subscribes for a component's life. Sends `hello` on every open. |
| `src/state/voice.tsx` | `VoiceContext` on `VoiceController`: `{ holdsVoice, liveOpen, listening, speaking, start, end, pressTalk, releaseTalk, stop, claim, subscribeTranscript, holdsVoiceNow }`. Polled every 100 ms and on change. Sets `window.apparatusGateLog` and `window.apparatusEnrollSpeaker`. |
| `src/state/feed.tsx` | `useFeed()`: the reducer wired to the socket and to the Live transcripts. The voice holder skips the server's transcript relay. |
| `src/feed/reducer.ts` | Pure. Cards, jobs, the latest `show`, the latest spoken line, the active handoff. Tested in `test/reducer.test.ts`. |
| `src/components/layout/AppShell.tsx` | The frame: desktop `sidebar | pane | feed`; tablet `pane | feed`; phone the feed column with the pane in a full-screen Sheet. |
| `src/components/jobs/JobSidebar.tsx` | shadcn Sidebar: running jobs, a Separator, recent jobs, then Audit and Credits. |
| `src/components/pane/Pane.tsx` | The large pane: a Screen / Output toggle, then `VmScreen` or the markdown (`ShowOutput.tsx`) or a view. A handoff forces Screen. |
| `src/components/feed/Feed.tsx`, `FeedCard.tsx` | ScrollArea of cards: transcripts short, job, approval (Approve, Deny) and handoff cards tall, credits short. |
| `src/components/feed/Controls.tsx` | Talk (press and hold) and Stop as two squares, the spoken line as one wide bar, the orb at the bottom right. |
| `src/components/views/AuditView.tsx`, `CreditsView.tsx` | `GET /audit` rows; `GET /credits` balance with the Top up placeholder. |
| `src/components/orb/Orb.tsx` | The orb (owned by the orb agent). |
| `src/components/vm/VmScreen.tsx` | The VM screen (owned by the VM agent). |
| `src/components/ui/*` | shadcn/ui: sidebar, card, scroll-area, separator, button, toggle, toggle-group, sheet, skeleton. The sidebar's tooltip was removed: the UI holds no helper text. |
| `src/hooks/use-breakpoint.ts` | phone < 768, tablet 768..1023, desktop >= 1024; `isTabletWidth()` for `hello.device`. |
| `src/lib/theme.ts` | The `dark` class on `<html>` follows `prefers-color-scheme`. |
| `src/vm/input.ts` | Pure: the `input` data-channel shape, pointer math over a letterboxed video, perfect-negotiation decisions. Tested in `test/vm-input.test.ts`. |

Breakpoints from the sketches: desktop and wide tablet (>= 1024 px) show
three columns, the sidebar, the pane and the feed with the orb at the bottom
right. Tablet (768 to 1023 px) shows the pane left and the feed right. Phone
(< 768 px) shows the feed stack, the two squares, the wide bar and the orb;
the VM screen and the handoff open as a full-screen Sheet with Done and
Cancel. Tapping a job card on a phone opens its output in the Sheet.

### Stub contracts

Two files are stubs for the other agents. The layout imports them with
exactly these props.

`src/components/orb/Orb.tsx`:

```ts
export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "working";
export function Orb({ state, held, live, onClick }: {
  state: OrbState;
  held: boolean;      // this device holds the voice session
  live: boolean;      // a Live session is open
  onClick: () => void;
}): JSX.Element
```

`connecting` shows while the server socket is down. `working` shows while a
job runs and nothing is heard or spoken. The click claims the voice session,
or toggles the microphone when this device holds it.

`src/components/vm/VmScreen.tsx`:

```ts
export function VmScreen({ mode, handoffId, onDone, onCancel }: {
  mode: "watch" | "handoff";
  handoffId: string | null;
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element
```

The widget mounts when the user picks Screen or a handoff is active, and
unmounts when neither holds. On mount it sends `screen.open`; on unmount
`screen.close {stream_id}`. It reads `screen.opened`, `signal`,
`screen.closed` and `control` through `useServerMessages` and sends
`signal`, `control.take` and `control.release` through `useServer().send`.
In handoff mode it shows Done and Cancel; the layout answers them with
`handoff.done` and `handoff.cancel`. The pure helpers in `src/vm/input.ts`
hold the data-channel shape and the math.

## Gate pipeline

Per 20 ms frame, in `src/gate/gate.ts`:

1. Echo cancellation, noise suppression, gain: browser/OS voice processing,
   requested in the `getUserMedia` constraints (`src/audio/capture.ts`).
   The AEC reference is the device output; playback goes through one
   `AudioContext` to that output. There is no direct reference feed.
2. VAD (`vad.ts`): RMS energy against `vad_energy_threshold`; `active`
   adds `vad_hangover_ms` after the last voiced frame.
3. Minimum duration: a candidate with less than `min_speech_ms` of raw voice
   is dropped as `too_short`. Candidate frames are buffered on the device
   and flushed when the segment is confirmed.
4. Barge-in bar (`bargein.ts`, `words.ts`): while playback has audio
   scheduled, the candidate must reach `bargein_min_voice_ms` of voice and
   `bargein_min_words` words. Words come from the energy contour (one burst
   between two dips is one word) or from the interim transcript, whichever
   is larger. A candidate that never clears the bar is dropped as
   `bargein_rejected`. On a valid barge-in the gate emits `bargeIn`, the
   controller calls `playback.stop()`, and the turn continues as normal. The
   Live server also sends `interrupted`, which stops playback too.
5. Speaker check (`speaker.ts`): off unless `speaker_check` is true.
6. Turn detector (`turn.ts`): silence from the last raw voiced frame.
   The turn ends at `silence_complete_ms` when the completeness model says
   the transcript looks complete, else at `silence_incomplete_ms`.

Events: `speechStart` -> `realtimeInput.activityStart`; `audio` ->
`realtimeInput.audio`; `speechEnd` -> `realtimeInput.activityEnd`.
Automatic activity detection is off in the server-built `setup`.

Manual path: holding Talk forces the turn open past every filter;
releasing ends it. Stop flushes playback and ends any open turn.
Clicking the orb claims the voice session (`voice.claim`) or toggles the
microphone when this device holds it.

### Thresholds

Every threshold lives in `config/apparatus.toml` `[gate]`. The server sends
that table in `ready.gate`; `src/config.ts` holds equal values as fallbacks
and `mergeGate` fills any missing field. The table applies when the voice
controller is created at the first `ready`.

| Field | Use |
|---|---|
| `vad_energy_threshold` | RMS on the [-1, 1] scale that counts as voice |
| `vad_hangover_ms` | `active` stays true this long after the last voiced frame |
| `min_speech_ms` | shorter candidates are dropped |
| `silence_complete_ms` | end of turn after a complete-looking sentence |
| `silence_incomplete_ms` | end of turn after an incomplete one |
| `bargein_min_voice_ms`, `bargein_min_words` | the bar while the model speaks |
| `bargein_stop_ms` | playback stop budget; `Playback.stop()` cancels every scheduled source at once |
| `speaker_check`, `speaker_match_threshold` | speaker check on/off and cosine threshold |

`ready` may also carry `live.idle_close_seconds` (default 120). With no
speech and no job event for that long the Live socket closes and the
microphone stops; the next talk press reopens both with a fresh token and
the stored resumption handle.

### Decision log

`gate.log()` returns the ring buffer of `{t, decision, reason}`; `t` is ms
of audio processed. In the page, `window.apparatusGateLog()` returns it.
It never holds audio.

## Live wiring

`src/live/session.ts` opens the Live socket with the ephemeral token, sends
the `setup` object from `/token` verbatim, waits for `setupComplete`, then
streams. Realtime input sent before setup completes is queued (30 s cap).
`src/live/messages.ts` has the pure builders and the parser; one server
message becomes a list of events.

| Live event | Action |
|---|---|
| `toolCall.functionCalls[]` | `C2S.tool.call` per call; `S2C.tool.result` -> `toolResponse` with its `scheduling` |
| `serverContent.interrupted` | `playback.stop()` |
| `inputTranscription` / `outputTranscription` | `C2S.transcript` (interim and final), feed card, gate transcript |
| `usageMetadata` | `C2S.live.usage`; audio ms from AUDIO modality tokens when present, else from PCM bytes |
| `sessionResumptionUpdate.newHandle` | `C2S.live.resumption`, kept for reconnects |
| `goAway` | open a second session now; switch when it is ready and no turn is open, or 1 s before `timeLeft` ends |
| any `S2C` with `voice` | `clientContent` turn `<event>text</event>`, `turnComplete: true`, only when this device holds voice and a session is open |

`voice.revoked` closes the Live session and stops capture; the page keeps
showing the feed.

## Bridge

`src/bridge.ts` defines the seam to a native shell. `dist/bridge.js` runs
before the module bundle and sets `window.apparatusBridge`; the web default
(`src/bridge-web.ts`) installs one when none exists.

```ts
interface ApparatusBridge {
  platform: "web" | "desktop" | "ios" | "android";
  serverOrigin?: string;           // shells bake it in; web: undefined = page origin
  secureStore: { get(key): Promise<string|null>; set(key, value): Promise<void>; delete(key): Promise<void> };
  push?: { register(): Promise<{platform: "fcm"|"apns"|"web"; token: string} | null>;
           onNotification(cb: (data: Record<string, string>) => void): void };
  notify?: (title: string, body: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}
```

- Auth comes from `secureStore.get("apparatus.auth")`, fallback `dev`.
- `hello.device` and `?device=` map from `platform`; `ios`/`android` with a
  viewport of 768 px or more send `tablet`.
- With `push`, the app calls `register()` after `ready` and sends
  `C2S.push.register {platform, token}`. A notification with
  `data.kind === "handoff"` opens the handoff for `data.handoff_id`.
- With `notify`, `handoff.requested` and `approval.requested` raise a local
  notification while the page is hidden.
- No UI changes `serverOrigin` or the Live URL (security rule 9).

## VM screen

Signaling goes through `C2S`/`S2C.signal {stream_id, payload}` in the
perfect-negotiation shape: `{description: {type, sdp}}` or
`{candidate: {candidate, sdpMid, sdpMLineIndex}}`. agentd offers after
`stream.start`; this side is the polite peer: it answers, and rolls back its
own offer on a collision (`offerCollision` in `src/vm/input.ts`). ICE servers
arrive in `screen.opened.ice_servers`.

Input events are JSON on the data channel named `input`, one object per
message: `mouse.move | mouse.down | mouse.up | wheel | key.down | key.up |
touch` with `x`, `y` normalized 0..1 over the video frame (the client
corrects for letterboxing: `normalizePointer`), `button` (0 left, 1 middle,
2 right), `dx`, `dy`, `key`, `code` (DOM KeyboardEvent.key / .code). A touch
carries its phase (`start | move | end`) in `key`. agentd applies them only
while the user holds control or a handoff is active.

## Stubs and open items

| Part | State |
|---|---|
| Wake word | `WakeWordDetector` interface in `gate.ts`; no detector. Open mic starts without one. |
| Silero VAD | `Vad` interface; `EnergyVad` ships. A model wraps its probability in the same `raw`/`active` contract. |
| Smart Turn / LiveKit turn detector | `CompletenessModel` interface; `HeuristicCompleteness` ships (terminal punctuation -> complete; trailing preposition, conjunction, article, filler or auxiliary -> incomplete; empty transcript -> complete). |
| Speaker embedder | `Embedder` interface; `StubEmbedder` is time-domain statistics and separates nothing. `EmbeddingSpeakerCheck` and the consent-gated `EnrollmentStore` are complete. `window.apparatusEnrollSpeaker(samples, consent)` enrolls; there is no enrollment UI. |
| Noise model (RNNoise, Krisp) | not integrated; the browser `noiseSuppression` constraint stands in. |
| Gate table changes after load | the gate reads `ready.gate` once, at creation. |
| Job events while idle-closed | the feed shows them; the Live session does not reopen to speak them. |

### Live facts to confirm against current Google docs

- The socket URL in `src/live/session.ts`: host, `v1alpha` path,
  `BidiGenerateContentConstrained`, and the `access_token` query parameter
  for ephemeral tokens.
- `realtimeInput.activityStart` / `activityEnd` with automatic activity
  detection off.
- `inputTranscription` / `outputTranscription` text is incremental; the
  client concatenates fragments until `finished` or `turnComplete`.
- `usageMetadata` field names (`promptTokenCount`, `responseTokenCount` or
  `candidatesTokenCount`, `promptTokensDetails[].modality`), and 32 audio
  tokens per second (`AUDIO_TOKENS_PER_SECOND` in `src/voice.ts`).
- `goAway.timeLeft` as a Duration string (`"12.5s"`).
- Live messages may arrive as `Blob`; the client decodes text before
  `JSON.parse`.

Nothing above the unit tests has run against a microphone or a Gemini key
yet. Milestone 1 of the build order (talk, hear an answer, interrupt) is
the first live check.
