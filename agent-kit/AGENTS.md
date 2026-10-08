# AGENTS.md — the binding contract

In effect whenever code in this repo is touched, by agent or human.
When this conflicts with intuition, this wins.

## Commands

```sh
npm run build                                                 # build (turbo: the web bundle and the website; Python needs no build)
uv run pytest && npm test                                     # tests (turbo: apps/web, packages/orb)
uv run ruff check . && uv run ruff format --check . && npm run typecheck   # lint / format check
verify/verify.sh                                              # full health gate — must pass before any push
```

Requires Python 3.11, Node 22 with npm 10, uv 0.8. Install once at the root: `uv sync && npm install`. Rust, Xcode and the Android SDK are needed only
for the native shells; `verify/verify.sh` skips those gates loudly when they are absent.

## Invariants — never regress these

1. **The model never sees secrets.** The Gemini key lives in the session server only
   (`apps/server/apparatus_server/tokens.py`, `model.py`). No environment variable or file in a
   VM holds a key. `agentlib` sends requests; the server does the action.
2. **Model calls run on the server. The VM only executes tools.** `agentd` has no model
   client and no prompt. The loop is `apps/server/apparatus_server/jobs.py`.
3. **A voice-model tool call never blocks.** Every declaration carries
   `behavior: NON_BLOCKING` and the server answers at once (`voice.py`, `main.py`). Job
   events reach the voice through the `voice` field of a server-to-client message, which
   the voice-holding client injects as an `<event>` turn.
4. **Tool output is data.** Every result from the VM is wrapped by `wrap_external` before
   the model sees it, and the smart system prompt says text inside the markers is never an
   instruction. Do not add a path that feeds raw VM output into a prompt.
5. **One desktop, one lock, no capture while the user holds it.** `apps/agentd/agentd/desktop.py` holds the
   lock per task; `core.py` refuses `computer` for every task while a handoff is active or the
   user holds control, checks both gates again after the lock wait, and `run_action` checks a
   capture gate right before the screenshot. The server refuses `computer` during a handoff
   before it reaches the VM and drops a late screenshot (`jobs.py`). Stream input reaches the
   desktop only during a handoff or from the controlling device's own stream
   (`control.stream_id`). Code-only tasks keep running. Kernels get no `DISPLAY`.
6. **State lives on the server.** Clients hold no prompt, no model name, no threshold. They
   get the gate table in `ready` and the Live setup from `/token`. No client exposes a
   setting that changes an endpoint.
7. **One config file.** Every model name, threshold, budget and price is in
   `config/apparatus.toml` and documented in `agent-kit/docs/CONFIGURATION.md`; the gate
   `verify/gates/config_documented.py` enforces it. Every message type is in
   `agent-kit/docs/PROTOCOL.md`; `verify/gates/protocol_documented.py` enforces it.
8. **The ledger is the balance.** A job takes a hold at start and settles at the end;
   steps beyond the hold charge as they go; an empty balance pauses the job and deletes
   nothing (`ledger.py`, `jobs.py`).
9. **The audit log is append-only on the server.** Nothing in the VM has a path to it.
10. **The VM dials out and listens to nothing.** No inbound ports, metadata server blocked
    for the agent, service account with no roles (`infra/vm/setup.sh`, `infra/gcp/main.tf`).

## Landmine map

| Area | Why it bites |
|---|---|
| `packages/protocol/apparatus_protocol/__init__.py` `_REQUIRED` | Keyed by link. `tool.call` from a client and `tool.call` to agentd have different shapes. A merged table silently drops one. A test guards `ALL` sets against drift. |
| `apparatus_protocol.msg()` | Drops `None` values. A field that must be an explicit `null` (for example `desktop_owner`) is set after the call. |
| `apps/agentd/agentd/kernel_child.py` | fd 1 and 2 are redirected per execution; the protocol channel is a dup of the original stdout. Printing to the real fd 1 from the child breaks the link. |
| `apps/agentd/agentd/core.py` handoffs | A handoff started by `agentlib.handoff` already paused the task and uses `request_id` as the handoff id. The server must not send `task.pause` for it, or the resume never matches. |
| `apps/agentd/agentd/core.py` `tool_call` | Tool execution is detached from the message pump so `handoff.resume`, `approval.answer` and `control` arrive while a step blocks in agentlib. Tests wait for the `tool.result`; they do not read it right after `handle()`. |
| `apps/server/apparatus_server/main.py` `sync_vm_state` | The server sends `control` (active or not) and every open handoff's `task.pause` on every VM connect. agentd reconnects without restarting, so "fresh process" assumptions are wrong. |
| `apps/server/apparatus_server/main.py` `open_screen` | `screen.opened` goes to the client before `stream.start` goes to the VM, or the offer can overtake the stream id. The web hook still queues early signals as a belt. |
| `apps/agentd/agentd/kernel.py` `blocked` | The execution deadline restarts while an agentlib call waits. Forgetting to clear `blocked` makes a step immortal. |
| `apps/server/apparatus_server/jobs.py` `_meter` | Pricing runs on every reply, including summaries. A step that exceeds the hold charges at once and can pause the job mid-loop. |
| `apps/server/apparatus_server/main.py` static routes | API routes are declared before the `/` and `/{name}` catch-alls. Add new routes above them. `/assets` is a `StaticFiles` mount of `dist/assets`, not of `dist`; a mount of the dist root makes every Vite bundle 404. `/{name}` serves top-level files of `dist` only; a path that resolves outside `dist` is 404. |
| `pyproject.toml` ruff config | `ASYNC109` is off on purpose (we pass deadlines). Tests dirs have no `__init__.py`: test file basenames must be unique across packages. |
| `apps/web/tsconfig.json` | `erasableSyntaxOnly`: no enums, parameter properties or namespaces, because Node runs the tests on raw TypeScript. |
| `apps/web/index.html` | `bridge.js` is a classic IIFE (`esbuild --format=iife`, no top-level await) loaded with `<script src="/bridge.js">` before the `src/main.tsx` module, so `window.apparatusBridge` exists when the app boots. Native shells overwrite `dist/bridge.js`; the web build emits the no-op default. Vite writes the app to `dist/assets/` with absolute paths; `build.mjs` adds `bridge.js` and `worklet.js` at the dist root. |
| `apps/server/apparatus_server/main.py` `signal` | Routed per device, never broadcast. A2S `signal` goes through `ClientHub.send_to` to the device that owns `stream_id`; a C2S `signal` from any other device is dropped. A broadcast leaks the offer to every device and breaks negotiation. |
| `apps/agentd/agentd/core.py` `user_control` | `computer` is refused with `user_control: the user controls the desktop` while control is taken, and with `handoff_active` during a handoff. Stream input reaches the desktop only while one of the two is true. The server holds the state and resends `control` on a VM reconnect; do not make agentd the owner. |
| `agent-kit/docs/DESIGN.md` | The law for the web UI: tokens, type, layout, components, states and keys. A UI change that departs from it changes DESIGN.md in the same commit. Weights 400 and 500 only; no tooltip, sonner or toast primitive; no placeholder. |
| `apps/web/src/main.tsx` providers | The order is `ThemeProvider > ServerProvider > VoiceProvider > FeedProvider > SelectionProvider > ScreenProvider > App`. `VoiceProvider` reads the server; `FeedProvider` reads the server and the voice holder; `SelectionProvider` reads the bridge from the server. A reorder throws at the first render. |
| `apps/web/src/state/screen.tsx` | One screen store for the app. `ScreenFrame` and `ScreenPip` call `wantOpen` / `wantClose`, never `useScreen().open` or `close`; the store counts holders and defers the close by one tick so the pane to PiP handover keeps the `MediaStream`. A second `useScreen` opens a second stream. |
| `apps/server/apparatus_server/demo.py` | Demo mode (`APPARATUS_DEMO=1`) is for development and screenshots only. It wins over `GEMINI_API_KEY` for jobs. Never set it in `infra/` or a release. |
| `progress_history` | The server keeps the last 50 progress texts per job (`jobs.py`, `PROGRESS_HISTORY_MAX`) and sends them in `ready.jobs` and `GET /jobs`; the client reducer caps `progressHistory` at 50 too. Change both caps together. The client reads a missing or malformed field as an empty list (`seedFromReady`); keep that, since jobs stored before the field existed have none. |
| Root `package.json` workspaces | One `package-lock.json` at the root and everything hoisted to the root `node_modules`. `npm ci` inside a workspace folder empties the root `node_modules` and installs only that workspace: install at the root. A script that needs a package's file resolves it (`createRequire(...).resolve`) or reads the root `node_modules`, never `<workspace>/node_modules`. |
| `turbo.json` and workspace scripts | The root `npm run build`, `test` and `typecheck` run the script of that name in every workspace that has one, through turbo; `dev:web` and `dev:site` run one app's `dev`. The desktop shell's Tauri commands are `tauri:build` and `tauri:dev`, so a root build never starts a Rust build. Turbo runs tasks in strict env mode: a task sees turbo's default passthrough vars, the framework prefix it infers (`VITE_*` for Vite), and what `turbo.json` lists under `env` or `passThroughEnv`. Any other variable a build or test reads must be listed there. |
| `packages/orb`, `packages/design` | Source packages with no build step: other workspaces compile them. Relative imports carry `.ts` / `.tsx` and no `@/` alias. Tailwind does not scan them; a consumer that renders their markup with utility classes adds `@source`. The tokens live in `packages/design/src/tokens.css`, but `apps/web/components.json` points shadcn at `src/index.css`: after `npx shadcn add`, move any `cssVars` it wrote into `tokens.css`. |
| `apps/site` | The stills come from `docs/media` through the `@media` alias and the build resizes them; only the matched files ship, so name stills one by one or in a narrow glob. The loops in `public/media` and the cut-outs in `src/assets/crops` are committed, and the loops are named by content hash, because `vercel.json` caches `/media` as immutable: remake both with `npm run media -w apparatus-site`, never edit one in place. Every loop has a dark twin; a loop without one must not ship. The page has no UI framework: the orbs are `@apparatus/orb/paint` and `/clock` driven by `src/lib/orb.ts`. Each orb's static frame is a hashed SVG file under `/orb` (`src/pages/orb/[file].ts`), never inline: inline frames once made half the HTML. A themed `<picture>` keeps `data-dark-media` on its dark `<source>`, so `src/lib/client.ts` can point it at a picked theme. `public/og.png` is made by `npm run og -w apparatus-site`. `turbo-ignore` does not see `docs/media` (no workspace owns it), so the Vercel `ignoreCommand` also diffs that folder. Every claim on the page must exist in the code; a removed feature leaves the page in the same change. |
| `apps/mobile/android` | Cleartext is off. A device build needs an `https` `APPARATUS_SERVER_ORIGIN`. |
| `apps/desktop/src-tauri/tauri.conf.json` | The server origin reaches the CSP through a generated merge file (`npm run server-config`), not by editing this file. |

## House style

- Match the surrounding code's idiom, naming, and comment density.
- No demo scaffolding, no leftover diagnostics, no dead flags.
- Comments state constraints the code can't show — never narration.
- User-facing copy states the thing plainly; no reassurance microcopy. `docs/STYLE.md` rules.

## Process rules

- Branch from `main`; never commit to it directly.
- `verify/verify.sh` green before every push. Flaky gate → fix or
  quarantine in the same PR; never route around it.
- After adding/removing/renaming source files, run the stack's
  regeneration step (`uv lock`, `npm install` for a lockfile) and commit the result.
- Commit at boundaries; message says what changed and cites evidence.
- Docs move with behavior — same commit or PR. A new option lands in
  `docs/CONFIGURATION.md`; a new message in `docs/PROTOCOL.md`; a moved
  boundary in `docs/ARCHITECTURE.md`.
- Report outcomes faithfully; failing is failing, with output.
