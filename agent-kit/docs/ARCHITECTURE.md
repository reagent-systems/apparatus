# Architecture

apparatus is a voice agent: a Python session server, a Python daemon on each user's Linux
desktop VM, and thin clients that run one TypeScript web app or a native watch app. The
code has 8 parts.

| Part | Folder | Task |
|---|---|---|
| Protocol | `protocol/` | Message types for the three links; the job result contract; external-data markers. No dependencies. |
| Session server | `server/` | Holds client and VM sockets, mints Live tokens, runs the smart-model loop, keeps jobs, handoffs, approvals, the ledger and the audit log. |
| agentd | `agentd/agentd/` | On the VM. One Python kernel per task, python and computer tools, desktop lock, task log, one outbound link. |
| agentlib | `agentd/agentlib/` | Inside a task kernel. Thin calls to the server through agentd: say, progress, show, request_approval, api, handoff. |
| Web client | `web/` | Audio capture and playback, the voice gate, the Live session, the feed, the pane, the orb, the VM screen widget. React 19, Vite, Tailwind CSS 4, shadcn/ui; the audio, gate and WebRTC code is plain TypeScript. |
| Native shells | `clients/desktop`, `clients/mobile` | Tauri 2 and Capacitor 6 around the web app, each with a `bridge.js` for keychain, push and notifications. |
| Watch apps | `clients/watchos`, `clients/wearos` | Native push-to-talk apps on the same protocol. Notifications only; no handoff screen. |
| Deployment | `config/`, `deploy/`, `vm/`, `verify/`, `.github/` | The one config file, GCP Terraform, VM image scripts, the health gate, CI. |

## Data flow

One voice turn that needs work:

1. The gate on the client (`web/src/gate/gate.ts`) hears speech, sends `activityStart`, streams 16 kHz PCM to Gemini Live, and sends `activityEnd` when the turn is over.
2. The voice model decides to call `start_job`. The Live socket delivers a `toolCall`; the client relays it as `C2S.tool.call` over its server socket (`web/src/voice.ts`).
3. `server/apparatus_server/main.py` runs the voice tool. `jobs.py` takes a credit hold, starts the VM, answers `tool.result {job_id}` with scheduling `SILENT`, and schedules the loop. The voice model keeps talking.
4. The loop waits for the VM link (`vm.py`), sends `task.start`, and gets the memory and tools indexes back from agentd (`agentd/core.py`).
5. Each model step (`model.py`) returns text or tool calls. `python` and `computer` go to agentd as `tool.call`; agentd runs them in the task kernel (`kernel.py`) or on the desktop (`desktop.py`) and answers `tool.result`. The server wraps the output as external data and appends it to the history. Every step is metered, checkpointed and audited.
6. Inside a python call, task code may call `agentlib.request_approval` or `agentlib.handoff`. agentd blocks the kernel, raises an `event`; the server pauses the job, tells every client, sends a push, and resumes the kernel when the user answers.
7. The model ends with the result contract. The server stops the task, settles the hold, writes the audit entry, and broadcasts `job.done` with a `voice` line.
8. The client that holds the voice session injects the `voice` line as an `<event>` turn. The voice model speaks the `say` text; the `show` text appears in the pane.

One screen the user watches or takes:

1. The user picks Screen in the pane, or a handoff arrives. The VM screen widget (`web/src/components/vm/VmScreen.tsx`) mounts and sends `screen.open`.
2. `main.py` registers the stream for this device (`streams.py`), mints STUN and TURN entries, sends `stream.start` to agentd and answers `screen.opened` with `stream_id` and `ice_servers`.
3. agentd (`stream.py`) starts the frame source (`ffmpeg x11grab` on the VM, a fake in tests), adds the video track and the `input` data channel to an aiortc peer connection, and sends its offer as `signal`.
4. The server relays `signal` only between the VM and the device that owns `stream_id`. The widget (`web/src/vm/peer.ts`) answers; video flows.
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

| File | Task |
|---|---|
| `src/main.tsx`, `src/App.tsx` | Boot through the bridge; theme; device detection; the React tree; push registration. |
| `src/state/*.tsx` | `ServerContext` (the server socket), `VoiceContext` (the `VoiceController`), `useFeed` (the feed reducer on the socket). |
| `src/voice.ts` | Capture → gate → Live → playback; the relays; idle close; goAway swap. |
| `src/live/session.ts`, `src/live/messages.ts` | The Live socket and its wire builders and parser. |
| `src/gate/*.ts` | VAD, turn detector, barge-in rule, word estimator, speaker check, the gate state machine with its decision log. |
| `src/audio/*.ts` | Worklet capture at 16 kHz; 24 kHz playback with an immediate stop. |
| `src/components/**/*.tsx` | Layout (`AppShell`), job sidebar, pane, feed cards and controls, the orb (`thinking-orbs` canvas), the VM screen widget with `useScreen`, shadcn/ui primitives. |
| `src/orb-state.ts` | Pure: the voice state → orb animation, speed, paused and dimmed. |
| `src/feed/reducer.ts`, `src/vm/*.ts` | Pure: the feed state; the `input` data-channel shape, pointer math, perfect negotiation; `ScreenPeer`, the answerer side of one stream. |
| `src/bridge.ts`, `src/bridge-web.ts` | The native bridge contract and the web default. |

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
