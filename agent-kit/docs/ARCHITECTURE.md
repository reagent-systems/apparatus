# Architecture

apparatus is a voice agent: a Python session server, a Python daemon on each user's Linux
desktop VM, and thin clients that run one TypeScript web app or a native watch app. The
code has 10 parts. The TypeScript side is one npm workspace (root `package.json`, Turborepo); the
Python side is one uv workspace (root `pyproject.toml`).

| Part | Folder | Task |
|---|---|---|
| Protocol | `packages/protocol/` | Message types for the three links; the job result contract; external-data markers. No dependencies. |
| Session server | `apps/server/` | Holds client and VM sockets, mints Live tokens, runs the smart-model loop, keeps jobs, handoffs, approvals, the ledger and the audit log. |
| agentd | `apps/agentd/agentd/` | On the VM. One Python kernel per task, python and computer tools, desktop lock, task log, one outbound link. |
| agentlib | `apps/agentd/agentlib/` | Inside a task kernel. Thin calls to the server through agentd: say, progress, show, request_approval, api, handoff. |
| Web client | `apps/web/` | Audio capture and playback, the voice gate, the Live session, the thread and the voice composer, the rail and the Jobs desk, the pane, the orb, the VM screen. React 19, Vite, Tailwind CSS 4, shadcn/ui, built to `docs/DESIGN.md`; the audio, gate and WebRTC code is plain TypeScript. |
| Shared web packages | `packages/design/`, `packages/orb/` | The colour tokens, the `dark` and `flat` variants, the Tailwind theme mapping and the fonts; the orb renderer (`OrbCanvas`, its painter and clock). Source packages with no build step; `apps/web` imports both. |
| Website | `apps/site/` | The public page about apparatus. Astro static HTML with the design tokens, the live orb and the captures from `docs/media`; Vercel deploys it. It talks to no server. |
| Native shells | `apps/desktop`, `apps/mobile` | Tauri 2 and Capacitor 6 around the web app, each with a `bridge.js` for keychain, push and notifications. |
| Watch apps | `apps/watchos`, `apps/wearos` | Native apps on the same protocol. The screen is the thinking orb alone; a tap starts or ends a full duplex call with the voice gate on the watch. Handoff and approval arrive as notifications; no handoff screen. |
| Deployment | `config/`, `infra/gcp/`, `infra/local/`, `infra/vm/`, `verify/`, `.github/` | The one config file, GCP Terraform, the local docker-compose, VM image scripts, the health gate, CI. |

## Data flow

One voice turn that needs work:

1. The gate on the client (`apps/web/src/gate/gate.ts`) hears speech, sends `activityStart`, streams 16 kHz PCM to Gemini Live, and sends `activityEnd` when the turn is over.
2. The voice model decides to call `start_job`. The Live socket delivers a `toolCall`; the client relays it as `C2S.tool.call` over its server socket (`apps/web/src/voice.ts`).
3. `apps/server/apparatus_server/main.py` runs the voice tool. `jobs.py` takes a credit hold, starts the VM, answers `tool.result {job_id}` with scheduling `SILENT`, and schedules the loop. The voice model keeps talking.
4. The loop waits for the VM link (`vm.py`), sends `task.start`, and gets the memory and tools indexes back from agentd (`apps/agentd/agentd/core.py`).
5. Each model step (`model.py`) returns text or tool calls. `python` and `computer` go to agentd as `tool.call`; agentd runs them in the task kernel (`kernel.py`) or on the desktop (`desktop.py`) and answers `tool.result`. The server wraps the output as external data and appends it to the history. Every step is metered, checkpointed and audited.
6. Inside a python call, task code may call `agentlib.request_approval` or `agentlib.handoff`. agentd blocks the kernel, raises an `event`; the server pauses the job, tells every client, sends a push, and resumes the kernel when the user answers.
7. The model ends with the result contract. The server stops the task, settles the hold, writes the audit entry, and broadcasts `job.done` with a `voice` line.
8. The client that holds the voice session injects the `voice` line as an `<event>` turn. The voice model speaks the `say` text; the `show` text appears in the pane.

What the model heard, on the screen:

1. The screen clients are voice only and full duplex: the microphone is open while the Live session is open. There is no typed input. The orb is the agent's on-switch and the only voice control (`apps/web/src/composer/orb-toggle.ts`, run by `VoiceController.toggle`, bound in `apps/web/src/components/orb/use-orb-control.ts`): a tap turns it on (claim when needed, open Live and the microphone) or off (hang up and `voice.release`), like the watches' call. The switch reads off when the Live session closes by itself. Talking over the agent interrupts it through the gate's barge-in rule.
2. Gemini Live sends `inputTranscription` for the user turn. `VoiceController` (`apps/web/src/voice.ts`) passes each piece to the feed as an interim user transcript and to the server as `C2S.transcript`.
3. The composer (`apps/web/src/components/composer/VoiceComposer.tsx`) shows the open interim transcript centred above the orb at `opacity-70`. The thread hides that one card while it is open.
4. When the transcript is final, or the agent's reply closes it, the card lands in the thread. The composer shows a final line solid for 600 ms, then clears; it clears at once when the agent starts to speak.
5. Other devices of the user show the server's relay as cards in their threads; their composers stay empty.

One screen the user watches or takes:

1. The user picks Screen in the rail or the pane, or a handoff arrives. The screen frame (`apps/web/src/components/vm/ScreenFrame.tsx`) or the PiP asks the shared screen store (`apps/web/src/state/screen.tsx`) for the stream; the store sends `screen.open` once for both.
2. `main.py` registers the stream for this device (`streams.py`), mints STUN and TURN entries, sends `stream.start` to agentd and answers `screen.opened` with `stream_id` and `ice_servers`.
3. agentd (`stream.py`) starts the frame source (`ffmpeg x11grab` on the VM, a fake in tests), adds the video track and the `input` data channel to an aiortc peer connection, and sends its offer as `signal`.
4. The server relays `signal` only between the VM and the device that owns `stream_id`. The widget (`apps/web/src/vm/peer.ts`) answers; video flows.
5. Control takes the desktop: `control.take` sets the state on the server, reaches agentd as `control {active: true}` and every device as `control`. agentd refuses `computer` with `user_control` while it is set; code-only tasks keep running.
6. Pointer and key events travel on the `input` channel. agentd applies them only while control is taken or a handoff is active; otherwise it drops them.
7. Release, Done, Cancel or the socket closing ends it: the server sends `stream.stop`, `screen.closed` with a reason, and releases control. Every open, close, take and release lands in the audit log with the device id.

## Session server

| File | Task |
|---|---|
| `main.py` | FastAPI app: `/token`, `/credits`, `/audit`, `/jobs`, `/config/gate`, `/ws/client`, `/ws/agentd`, the Vite dist as static files. Voice-tool dispatch. `screen.*` and `control.*` handling; `signal` relay per device. |
| `config.py` | Loads `config/apparatus.toml` into frozen dataclasses; defaults on damage. |
| `voice.py` | Voice-model tools (NON_BLOCKING), system prompt, Live setup message, token constraints. |
| `smart.py` | Smart-model tools, system prompt, first user message. |
| `model.py` | `SmartModel` adapter: Gemini with explicit prefix caching, or a scripted fake. |
| `tokens.py` | Ephemeral Live tokens: `auth_tokens.create` with locked setup, or a fake. |
| `jobs.py` | Jobs, the loop, budgets, metering, context compaction, checkpoints, handoffs, approvals, credit notices. |
| `vm.py` | `VmLink` (awaitable calls over the agentd socket), `VmRegistry`, `LocalVmController`, `GceVmController`, `IdleStopper`. |
| `clients.py` | Devices per user, the single voice holder, broadcast, `send_to` one device, push tokens. |
| `streams.py` | `StreamRegistry` (stream id → user and device; `Control {active, by}` per user), TURN credentials, `ice_servers`. The server never carries video. |
| `sessions.py` | Rolling conversation summary and resumption handle per user. |
| `ledger.py` | Credits: pricing, grants, holds, settle, daily cap, low and out notices. |
| `audit.py` | Append-only audit per user. |
| `store.py` | `Store` seam: `MemoryStore`, `FileStore`. |
| `auth.py` | `DevAuthenticator`, `FirebaseAuthenticator`. |
| `push.py` | `LogPush`, `FcmPush`, the GCE metadata token. |

## agentd

| File | Task |
|---|---|
| `main.py` | Outbound WebSocket with backoff; hello with the enrollment HMAC; an outbox that survives a lost link. |
| `core.py` | Message dispatch, tasks, budgets, tools, pause, agentlib requests. Transport-free. |
| `kernel.py`, `kernel_child.py` | The per-task Python session: a child process with a JSON-lines protocol on a dup of stdout; fd 1 and 2 captured per execution. |
| `desktop.py` | `DesktopLock`, `XdoBackend` (xdotool + ImageMagick), `FakeBackend`, `run_action`, `input_event` for the stream. |
| `stream.py` | `StreamManager`: one aiortc peer connection per stream, `ScreenTrack` over a `FrameSource` (`X11FrameSource`, `FakeFrameSource`), the `input` channel behind a gate. |
| `libserver.py` | The Unix socket agentlib talks to. |
| `tasklog.py` | `log.jsonl` and `result.json` per task; restore after a restart. |
| `disk.py` | The layout under `/home/agent`. |
| `config.py` | Environment settings. |

## Web client

`docs/DESIGN.md` is the binding spec for every file under `src/components`. `src/main.tsx` mounts the providers in this order: `ThemeProvider > ServerProvider > VoiceProvider > FeedProvider > SelectionProvider > ScreenProvider > App`.

| File | Task |
|---|---|
| `src/main.tsx`, `src/App.tsx` | Boot through the bridge; the stored theme; device detection; the providers; the orb state; the column view; push registration; hidden-page notifications; the handoff lock on the pane; the keyboard. |
| `src/state/server.tsx`, `voice.tsx`, `feed.tsx` | `ServerContext` (the server socket), `VoiceContext` (the `VoiceController`: the switch `on`, `toggle`, the voice holder; no typed input, no input mode), `FeedProvider` / `useFeed` (the feed reducer on the socket). |
| `src/state/selection.tsx`, `selection-codec.ts` | The view, the selected job, the pane (open, mode, width, lock), the rail, the status bar, notifications; persisted through `bridge.secureStore`. |
| `src/state/screen.tsx` | One app-scoped screen store around `useScreen`: reference-counted `wantOpen` and `wantClose`, so the pane and the PiP share one `MediaStream`. |
| `src/voice.ts` | Capture → gate (always `InputMode.OPEN_MIC`) → Live → playback; the on-switch (claim, open, hang-up, `voice.release`, self-close); the relays; idle close; goAway swap. |
| `src/live/session.ts`, `src/live/messages.ts`, `src/live/reply-latch.ts` | The Live socket, its wire builders and parser, and the latch that keeps a reply the user talked over silent. |
| `src/gate/*.ts` | VAD, turn detector, barge-in rule, word estimator, speaker check, the gate state machine with its decision log. |
| `src/audio/*.ts` | Worklet capture at 16 kHz; 24 kHz playback with an immediate stop. |
| `src/components/layout/` | `AppShell` (rail, column and pane in a `ResizablePanelGroup`; sheets on tablet and phone), `Titlebar`, `StatusBar`, `CommandPalette`. |
| `src/components/rail/` | `Rail`, `RailNav` (Thread, Jobs, Screen, Audit, Credits), `RailJobRow` in the Needs you / Running / Recent groups, `RailFooter` (avatar, device, the settings popover). |
| `src/components/thread/` | `Thread` and its cards: `DayDivider`, `TurnHeader`, `SpeechCard`, `JobCard` with `ActivitySlab`, `ApprovalCard`, `HandoffCard`, `CreditsLine`, `ScrollToEnd`. |
| `src/components/composer/` | `VoiceComposer`: the orb centred in the box and the line the model heard above it. |
| `src/composer/orb-toggle.ts` | Pure: `toggleAction`, `onStep`, `releasesVoice`, the rules of the on-switch. |
| `src/components/orb/` | `Orb` (48, 56 or 128 px; the switch, no disc, a circular hit region, dots in the ink opposite the page), `use-orb-control` (the tap on the voice context) and `OrbMini` (20 px), all drawn by `OrbCanvas` from `@apparatus/orb` (`packages/orb`). |
| `src/components/status/` | `StatusGlyph`, `ProgressRing`, `CountChip`. |
| `src/components/pane/` | `Inspector` (Output / Screen), `JobInspector` (Receipt / Steps / Artifacts), `ShowOutput`. |
| `src/components/vm/` | `ScreenFrame` (the control ring and the input logic), `ScreenPip`, `useScreen`. |
| `src/components/views/` | `JobsView` and `JobRow` (the Jobs desk), `AuditView`, `CreditsView`. |
| `src/components/theme/` | `ThemeProvider` / `useTheme`: Light, Dark or System; `.dark` before first paint. |
| `src/components/ui/` | shadcn/ui primitives. No tooltip, sonner or toast. |
| `src/hooks/` | Breakpoints, the pure shortcut matcher and its window binding, and small hooks. |
| `src/orb-state.ts`, `src/lib/status.ts`, `src/lib/jobs-list.ts` | Pure: the voice state → orb animation; a job → bucket and glyph, relative times; the Jobs desk's chips, counts and groups. |
| `src/feed/reducer.ts`, `src/vm/*.ts` | Pure: the feed state (cards, jobs with `progressHistory`, approvals and handoffs by job); the `input` data-channel shape, pointer math, perfect negotiation; `ScreenPeer`, the answerer side of one stream. |
| `src/bridge.ts`, `src/bridge-web.ts` | The native bridge contract and the web default. |

## Watch clients

`apps/watchos` (SwiftUI) and `apps/wearos` (Kotlin, Compose for Wear OS) run no web view. They speak `docs/PROTOCOL.md` natively and hold no agent state, no prompt and no threshold. `docs/DESIGN.md` section 11 is their screen.

One call, start to end:

1. The app opens `/ws/client` with `hello` `wants_voice: false`. The first `ready` gives the gate table (`ready.gate`, the `[gate]` table that `GET /config/gate` also serves) and `ready.live.idle_close_seconds`.
2. A tap with no call sends `voice.claim` when another device holds the voice session. On `voice.granted` the app fetches `POST /token` and opens Gemini Live with the server's `setup`, which has automatic activity detection off.
3. The microphone stays open for the whole call: 16 kHz Int16, 20 ms frames, on the platform's call path with echo cancellation (watchOS `playAndRecord` + `voiceChat`; Wear OS `VOICE_COMMUNICATION` with `AcousticEchoCanceler` and `NoiseSuppressor`).
4. Every frame goes through the gate in open-mic mode. The gate emits `speechStart`, `audio`, `speechEnd` and `bargeIn`; the app sends `activityStart`, the turn's audio and `activityEnd` to Live. On `bargeIn` it stops playback and a reply latch keeps the rest of that reply silent until `interrupted`, `generationComplete` or `turnComplete`.
5. The app relays tool calls, transcripts, usage and resumption handles as the web does, and injects `voice` lines as `<event>` turns while it holds the voice session.
6. A second tap hangs up: `activityEnd` for an open turn, `live.closed`, playback and microphone stopped, the audio session released, `voice.release`. A Live close, the idle limit or `voice.revoked` ends the call the same way.

| Part | watchOS | Wear OS |
|---|---|---|
| The call | `Sources/Model/AppModel.swift` | `AppViewModel.kt`, `VoiceService.kt` (foreground service, type `microphone`) |
| Audio | `Sources/Audio/AudioEngine.swift`, `ReplyLatch.swift` | `audio/AudioIn.kt`, `AudioOut.kt`, `CallAudio.kt`, `ReplyLatch.kt` |
| The gate | `Sources/Gate/*.swift` | `gate/*.kt` |
| Orb mapping | `Sources/Model/OrbRender.swift` | `ui/OrbRender.kt` |
| Orb engine | `Vendor/ThinkingOrbsKit` (vendored Swift port) | `ui/orb/engine/*.kt` (Kotlin port), `ui/orb/ThinkingOrb.kt` |
| Screen | `Sources/UI/ContentView.swift`, `OrbView.swift` | `ui/App.kt`, `MainActivity.kt` |
| Notifications | `ApparatusWatchApp.swift` (`Notifier`, APNs) | `push/PushService.kt`, `Notifier.kt`, `ApprovalReceiver.kt` |

**The gate on the watch.** Both apps port the open-mic path of `apps/web/src/gate` as pure modules: `gate.ts`, `vad.ts`, `turn.ts`, `bargein.ts`, `words.ts`, and `speaker.ts` as `NoSpeakerCheck`. The web's push-to-talk path, wake word and decision log are not ported. A missing or mistyped threshold keeps its default, as `mergeGate` does on the web.

**Shared gate vectors.** `packages/gate-vectors/gate-vectors.json` holds 13 scenarios of synthetic audio and the events the web gate emits for them. `npm run gate-vectors -w apps/web` writes it from the web gate, and `apps/web/test/gate-vectors.test.ts` fails when the file drifts. `GateVectorTests.swift` and `GateVectorsTest.kt` replay every scenario and assert the same ordered events, timings and end state. Parity is proven by these tests, not by reading.

**The orb engine.** The web uses npm `thinking-orbs` 0.3.2 through `packages/orb` (MIT, Jakub Antalik). watchOS vendors the upstream Swift port, ThinkingOrbsKit, from commit `0d44887` with 2 edits listed in its `VENDORED.md`; its golden test checks 72 frames of upstream `spec/orbs-golden.json` within 1e-4. Wear OS has a Kotlin port of the same engine; `OrbGoldenTest` checks the 18 resolved presets and the same 72 golden frames within 1e-4. The notices are in `THIRD_PARTY_NOTICES.md`.

## Boundaries

| Boundary | Rule |
|---|---|
| Client ↔ Gemini Live | Audio, activity signals, tool calls and responses, event turns. The client never holds the prompt or the model name; both come locked in the token. |
| Client ↔ session server | JSON per `docs/PROTOCOL.md`. Tool calls are relayed, never executed on the client. The `voice` field crosses only to the voice holder. |
| Session server ↔ agentd | `task.*`, `tool.call`, `tool.result`, `event`, `stream.*`, `control`, `signal`. The VM dials out. The server sends code to run; the VM never receives a key, a prompt or a model name. |
| Client ↔ agentd (stream) | WebRTC, peer to peer or through the TURN relay. Video from the VM; `input` events to the VM. The server relays `signal` only to the device that owns the stream and never sees a frame. |
| Control | State lives on the server (`StreamRegistry.Control`). agentd holds a copy and refuses `computer` while it is set; a reconnected agentd gets it again. A device that disconnects releases what it held. |
| agentd ↔ task kernel | JSON lines on a private channel. User code's stdout and stderr are captured; user code cannot read the channel. |
| agentlib ↔ agentd | Unix socket. Requests only. Blocking calls pause the kernel's deadline and raise an event; the server decides. |
| Server ↔ Gemini (smart) | `generate_content` with the stable prefix cached. Tool results cross wrapped as external data. |
| Server ↔ GCP | Compute API for start and stop, Secret Manager through Cloud Run, FCM with the service account. The VM's service account has no roles. |
