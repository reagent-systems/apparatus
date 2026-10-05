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
4. Press the orb to open the microphone, hold Talk, or type in the composer and press Enter.

### Demo mode

`APPARATUS_DEMO=1` makes the server run scripted jobs with no key; start a local agentd with
`AGENTD_DESKTOP=fake` so they reach a kernel. No seed script is in the repo; seed through the protocol:

1. Open a second socket: `/ws/client?auth=dev&device=desktop`, then send `hello {device: "desktop", wants_voice: false}`.
2. Send `tool.call {name: "start_job", args: {request}}`; "approve" in the request adds an approval, "login" adds a handoff.
3. Send `transcript {role, text, final: true}` for speech cards; keep the socket open while you look.

## Components

One React tree, responsive, built to `agent-kit/docs/DESIGN.md`. `src/main.tsx`
boots: bridge, auth, stored theme, device, then the providers in this order:
`ThemeProvider > ServerProvider > VoiceProvider > FeedProvider >
SelectionProvider > ScreenProvider > App`. Components read these contexts
rather than taking long prop lists.

| File | Task |
|---|---|
| `src/App.tsx` | Computes the orb state, picks the column view, mounts `AppShell` and `CommandPalette`; push registration, hidden-page notifications, the handoff lock on the pane, the keyboard. |
| `src/state/server.tsx` | `ServerContext` on `ServerSocket`: `{ send, subscribe, deviceId, ready, connected, device, httpOrigin, auth, bridge }`. `useServerMessages(handler)` subscribes for a component's life. Sends `hello` on every open. |
| `src/state/voice.tsx` | `VoiceContext` on `VoiceController`: `{ holdsVoice, liveOpen, listening, speaking, start, end, pressTalk, releaseTalk, stop, claim, sendText, inputMode, setInputMode, ... }`. Polled every 100 ms and on change. |
| `src/state/feed.tsx` | `FeedProvider` / `useFeed()`: `[state, dispatch]`, the reducer wired to the socket and the Live transcripts. The voice holder skips the server's transcript relay. |
| `src/feed/reducer.ts` | Pure. Cards (cap 100), jobs by id with `progressHistory` (cap 50), approvals and handoffs by id and by job, `show`, `spoken`, credits; `runningJobs`, `recentJobs`, `needsYou`, `jobOf`, `seedFromReady`. Tested in `test/reducer.test.ts`. |
| `src/state/selection.tsx` | `useSelection()`: view, selected job, pane open / mode / width / lock, rail, status bar, notifications; persisted through `bridge.secureStore` (`selection-codec.ts`). |
| `src/state/screen.tsx` | `useScreenStore()`: `useScreen` (`components/vm/useScreen.ts`) hoisted to app scope with reference-counted `wantOpen` / `wantClose`, so the pane and the PiP share one `MediaStream`. |
| `src/lib/status.ts` | Pure: `bucketOf`, `glyphOf`, `relativeTime`, `elapsedTime`. Tested in `test/status.test.ts`. |
| `src/lib/jobs-list.ts`, `src/lib/api.ts` | The Jobs desk's filter chips, counts, groups and row subtitles (`test/jobs-list.test.ts`); `apiGet` and the `/audit` and `/credits` parsers (`test/api.test.ts`). |
| `src/components/layout/` | `AppShell` (rail, column, pane in a `ResizablePanelGroup`; sheets on tablet and phone), `Titlebar`, `StatusBar`, `CommandPalette`. |
| `src/components/rail/` | `Rail`, `RailNav` (Thread, Jobs, Screen, Audit, Credits), `RailJobRow` and the Needs you / Running / Recent groups, `RailFooter` (settings popover: Input, Appearance, Notifications). |
| `src/components/thread/` | `Thread` and its cards: speech, job (activity slab, say, show, artifacts), approval, handoff, credits line, day divider, turn header, scroll-to-end. |
| `src/components/composer/` | `VoiceComposer` (orb, text field, mode picker, Talk, send, Stop), `TalkButton`, `ModePicker`. |
| `src/components/orb/` | `Orb` (48 / 56 / 128 px on the disc) and `OrbMini` (20 px), both `thinking-orbs`; state names in `src/orb-state.ts`. |
| `src/components/status/` | `StatusGlyph`, `ProgressRing`, `CountChip`. |
| `src/components/pane/` | `Inspector` (Output / Screen), `JobInspector` (Receipt / Steps / Artifacts), `ShowOutput`. |
| `src/components/vm/` | `ScreenFrame` (watch or handoff, the control ring, input), `ScreenPip`, `useScreen`. |
| `src/components/views/` | `JobsView` and `JobRow`, `AuditView` (`GET /audit`), `CreditsView` (`GET /credits`, Top up disabled). |
| `src/components/theme/` | `ThemeProvider` / `useTheme()`: Light, Dark or System; `.dark` on `<html>` before first paint (an inline script in `index.html`), persisted under `apparatus.theme`. |
| `src/components/ui/*` | shadcn/ui primitives. No tooltip, sonner or toast: the UI holds no helper text. |
| `src/hooks/` | `use-breakpoint` (phone < 768, tablet 768..1023, desktop >= 1024; `isTabletWidth()` for `hello.device`), `shortcuts` (pure key matcher) and `use-shortcuts` (the window binding). |
| `src/vm/input.ts` | Pure: the `input` data-channel shape, pointer math over a letterboxed video, perfect-negotiation decisions. Tested in `test/vm-input.test.ts`. |

Desktop shows the rail, the thread column with the composer and the pane,
with a 24 px status bar beneath. Tablet keeps a 56 px icon rail and opens the
pane as a right sheet. Phone shows the thread under a 48 px top bar; the rail
and the pane are sheets, and a handoff locks the pane sheet until Done or
Cancel.

### Keyboard

Space (held, focus outside a text field, a control and the VM video) talks;
Esc stops; Cmd/Ctrl+K opens the palette; Cmd/Ctrl+1..5 pick Thread, Jobs,
Screen, Audit, Credits; Cmd/Ctrl+B toggles the rail; Cmd/Ctrl+J the pane;
Alt+J focuses the oldest card that needs you; Enter / Backspace answer a
focused approval or handoff card; Cmd/Ctrl+Shift+C takes or releases control.

### Screen store

`ScreenFrame` holds the shared stream open while mounted; `ScreenPip` does
the same while the pane is closed on the Screen. The store sends
`screen.open` with the first holder and `screen.close {stream_id}` after the
last. It reads `screen.opened`, `signal`, `screen.closed` and `control`
through `useServerMessages` and sends `signal`, `control.take` and
`control.release`. In handoff mode the frame shows Done and Cancel and sends
`handoff.done` / `handoff.cancel`.

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
| typed text (`voice.sendText`) | claim voice if needed; open the session; `clientContent` user turn with the plain text, `turnComplete: true` (`buildUserTextTurn`); `C2S.transcript {role: "user", final: true}` |

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
