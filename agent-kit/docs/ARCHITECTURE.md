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
| Web client | `web/` | Audio capture and playback, the voice gate, the Live session, the feed, the show pane, the handoff view. Dependency-free TypeScript. |
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

## Session server

| File | Task |
|---|---|
| `main.py` | FastAPI app: `/token`, `/credits`, `/audit`, `/jobs`, `/config/gate`, `/ws/client`, `/ws/agentd`, static web app. Voice-tool dispatch. |
| `config.py` | Loads `config/apparatus.toml` into frozen dataclasses; defaults on damage. |
| `voice.py` | Voice-model tools (NON_BLOCKING), system prompt, Live setup message, token constraints. |
| `smart.py` | Smart-model tools, system prompt, first user message. |
| `model.py` | `SmartModel` adapter: Gemini with explicit prefix caching, or a scripted fake. |
| `tokens.py` | Ephemeral Live tokens: `auth_tokens.create` with locked setup, or a fake. |
| `jobs.py` | Jobs, the loop, budgets, metering, context compaction, checkpoints, handoffs, approvals, credit notices. |
| `vm.py` | `VmLink` (awaitable calls over the agentd socket), `VmRegistry`, `LocalVmController`, `GceVmController`, `IdleStopper`. |
| `clients.py` | Devices per user, the single voice holder, broadcast, push tokens. |
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
| `desktop.py` | `DesktopLock`, `XdoBackend` (xdotool + ImageMagick), `FakeBackend`, `run_action`. |
| `libserver.py` | The Unix socket agentlib talks to. |
| `tasklog.py` | `log.jsonl` and `result.json` per task; restore after a restart. |
| `disk.py` | The layout under `/home/agent`. |
| `config.py` | Environment settings. |

## Web client

| File | Task |
|---|---|
| `src/main.ts` | Boot through the bridge; server socket; UI wiring; push registration. |
| `src/voice.ts` | Capture → gate → Live → playback; the relays; idle close; goAway swap. |
| `src/live/session.ts`, `src/live/messages.ts` | The Live socket and its wire builders and parser. |
| `src/gate/*.ts` | VAD, turn detector, barge-in rule, word estimator, speaker check, the gate state machine with its decision log. |
| `src/audio/*.ts` | Worklet capture at 16 kHz; 24 kHz playback with an immediate stop. |
| `src/ui/*.ts` | Orb, feed, pane, handoff view (WebRTC), layout. |
| `src/bridge.ts`, `src/bridge-web.ts` | The native bridge contract and the web default. |

## Boundaries

| Boundary | Rule |
|---|---|
| Client ↔ Gemini Live | Audio, activity signals, tool calls and responses, event turns. The client never holds the prompt or the model name; both come locked in the token. |
| Client ↔ session server | JSON per `docs/PROTOCOL.md`. Tool calls are relayed, never executed on the client. The `voice` field crosses only to the voice holder. |
| Session server ↔ agentd | `task.*`, `tool.call`, `tool.result`, `event`. The VM dials out. The server sends code to run; the VM never receives a key, a prompt or a model name. |
| agentd ↔ task kernel | JSON lines on a private channel. User code's stdout and stderr are captured; user code cannot read the channel. |
| agentlib ↔ agentd | Unix socket. Requests only. Blocking calls pause the kernel's deadline and raise an event; the server decides. |
| Server ↔ Gemini (smart) | `generate_content` with the stable prefix cached. Tool results cross wrapped as external data. |
| Server ↔ GCP | Compute API for start and stop, Secret Manager through Cloud Run, FCM with the service account. The VM's service account has no roles. |
