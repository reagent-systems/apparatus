# STATUS.md — where the project actually stands

The single source of truth for project state. Claims require evidence: a
passing gate, a linked run, a tag. Updated in the same commit as the
behavior change. The weekly cycle (WEEKLY.md step 5) refreshes it.

| Area | State | Evidence |
|---|---|---|
| Protocol (`protocol/`) | ✅ | 12 protocol tests (3 new: `signal` carries `stream_id` on every link, the screen and control shapes, the input kinds); `protocol_documented` gate |
| agentd + agentlib (`agentd/`) | ✅ | 38 tests with real subprocess kernels and an aiortc loopback: persistence, timeouts, desktop lock, handoff pause, approval round trip, per-stream input gate, lock re-check, capture gate, detached tool pump, restart restore |
| Session server (`server/`) | ✅ unit · ⚠ 1 intermittent | 53 tests: config, ledger, store, Live setup, job loop against a real in-process agentd core, both WebSockets, static routes for the Vite dist. `test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result` failed in 3 of 15 full runs on 2026-10-04 and passed alone; see Known red |
| Web client (`web/`) | ✅ unit · ❌ browser · ❌ live | React 19 + Vite + shadcn/ui; `npm run verify` green: typecheck, build (`dist/index.html`, `dist/assets/*`, `dist/bridge.js`, `dist/worklet.js`), 110 node tests (74 before; new: feed reducer 11, VM input 6, negotiation 4, screen events 10, orb state 5). No browser has rendered the React tree; no microphone or Gemini key has run it |
| VM screen stream (client side) | ✅ unit · ❌ browser | `src/vm/peer.ts` answers the offer and keeps the `input` channel; `VmScreen.tsx` with Control, Release, Done, Cancel. The WebRTC path has run in no browser |
| agentd streamer (`agentd/agentd/stream.py`) | ✅ loopback · ❌ VM | 8 tests: aiortc loopback delivers a 160×120 frame and an open `input` channel; input dropped while the gate is closed, applied once open; garbage and unknown kinds dropped; browser candidates parsed; `X11FrameSource` argv only. No `ffmpeg x11grab` run on a real display |
| Stream and control on the server (`streams.py`) | ✅ | 8 tests: coturn credential, STUN-only and TURN ICE lists, registry ownership, `screen.open` reaches the VM and only the opening device, `control.take` reaches the VM and every device, a device disconnect stops its stream and releases control, a VM disconnect closes streams and a reconnect restores control |
| Desktop shell (`clients/desktop`, Tauri 2) | 🚧 | `cargo check` clean, debug binary built on Linux; bundles for macOS and Windows unbuilt |
| Phone shells (`clients/mobile`, Capacitor 6) | 🚧 | Android debug APK built with the web dist inside; iOS project generated and patched, never compiled here |
| watchOS app (`clients/watchos`) | 🚧 | Swift written, XcodeGen spec written, no Xcode here |
| Wear OS app (`clients/wearos`) | 🚧 | `gradle assembleDebug` built `app-debug.apk` (25.8 MB) on Linux with SDK 34; no device run, release build untested |
| CI: verify, nightly, release, client builds | ✅ parse · ❌ run | `workflows_parse` gate; no run on GitHub yet |
| GCP: Terraform, VM image, Cloud Run deploy | 🚧 | Written under `deploy/gcp`, `vm/`; never applied |
| Voice shell on the paid tier (build order 1) | ❌ | Needs a key and a microphone |
| Voice gate on recorded cases (build order 2) | ❌ | Logic unit-tested; no audio fixtures |
| Screen stream for the handoff (roadmap item 5) | 🚧 | Streamer, relay, control and widget exist and pass in loopback (rows above). No real VM, no TURN relay and no browser has run it |
| Billing: ledger ✅, Stripe ❌ | 🚧 | Ledger tests; no Stripe code |
| Firestore store adapter | ❌ | `memory` and `file` adapters only |

States: ✅ done (gated) · 🚧 in progress · ❌ not started · 🧊 frozen/won't do.

## Review round of 2026-10-04

15 adversarial refuters ran against 5 security claims after the stream and control work landed.
Three claims were refuted and fixed in the same day; the fixes have tests: per-stream input gate,
control state synced on every VM connect, gates re-checked after the desktop lock wait and
before the capture, `computer` refused server-side during a handoff, paused tasks restored
after an agentd restart, tool execution detached from the message pump, kernels without
`DISPLAY`. Still open: a task kernel can reach the X socket by setting `DISPLAY` itself
(ROADMAP "Kernel X isolation").

## Current week

- **Shipping:** the React client, the orb, the VM screen widget and the stream protocol landed on 2026-10-04 (roadmap item 5 in part). The queue top is the voice shell on the paid tier.
- **Last release:** none
- **Known red:** `server/tests/test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result` is intermittent: 3 failures in 15 full `uv run pytest -q` runs on 2026-10-04, 0 failures alone or in its file. The failure is `IndexError` at `w.messages(S2C.JOB_DONE)[0]` (line 140): `wait_done` returns before the `job.done` broadcast lands. The gate is green on a pass. Queued in ROADMAP.md. The native-shell gates skip in environments without their toolchains; `tauri build` and `cap sync` against the Vite dist layout ran in no build.
- **Assumed values to confirm:** `security@reagent.systems` in SECURITY.md; every model string in `config/apparatus.toml`; the Live wire facts listed in `web/README.md`.
