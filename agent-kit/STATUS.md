# STATUS.md — where the project actually stands

The single source of truth for project state. Claims require evidence: a
passing gate, a linked run, a tag. Updated in the same commit as the
behavior change. The weekly cycle (WEEKLY.md step 5) refreshes it.

| Area | State | Evidence |
|---|---|---|
| Protocol (`packages/protocol/`) | ✅ | 12 protocol tests (3 new: `signal` carries `stream_id` on every link, the screen and control shapes, the input kinds); `protocol_documented` gate |
| agentd + agentlib (`apps/agentd/`) | ✅ | 38 tests with real subprocess kernels and an aiortc loopback: persistence, timeouts, desktop lock, handoff pause, approval round trip, per-stream input gate, lock re-check, capture gate, detached tool pump, restart restore |
| Session server (`apps/server/`) | ✅ unit · ⚠ 1 intermittent | 63 tests: config, ledger, store, Live setup, job loop against a real in-process agentd core, both WebSockets, static routes for the Vite dist, `job.progress` per tool step and `progress_history` (cap 50) in the job dict. `test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result` failed in 3 of 15 full runs on 2026-10-04 and passed alone; see Known red |
| Web client (`apps/web/`) | ✅ unit · 🚧 browser · ❌ live | Rebuilt to `docs/DESIGN.md` (Ink on Paper) on 2026-10-05. Web typecheck clean; web tests 154 of 154 pass (110 before; new: status 13, shortcuts and selection codec 9, the Jobs desk lists, the API helpers, more reducer cases). `verify/verify.sh` green with the Vite build. Headless Chromium rendered the tree against demo mode: 54 screenshots in round 1 and 62 in round 2, at 1440, 820 and 390 px, light and dark, each round judged against DESIGN.md and the 4 references. No microphone or Gemini key has run it; typed text into a Live session is untested (DESIGN.md risk 2); the 64 preset orb at DPR 2 is unjudged on a real screen |
| VM screen stream (client side) | ✅ unit · 🚧 browser | `src/vm/peer.ts` answers the offer and keeps the `input` channel; `ScreenFrame.tsx` with Control, Release, Done, Cancel and the holder ring; `ScreenPip.tsx`; one shared stream in `state/screen.tsx`. Headless Chromium rendered the frame and the handoff ring with no video; the WebRTC path has run in no browser |
| Demo mode (`APPARATUS_DEMO=1`, `apps/server/apparatus_server/demo.py`) | ✅ | Development only. A scripted smart model runs a real job through the loop and a real agentd: python step, progress, show, result with `report.csv`; `approve` adds an approval, `login` a handoff. 5 tests in `test_jobs.py` (`-k demo`); it fed both screenshot rounds on 2026-10-05 |
| agentd streamer (`apps/agentd/agentd/stream.py`) | ✅ loopback · ❌ VM | 8 tests: aiortc loopback delivers a 160×120 frame and an open `input` channel; input dropped while the gate is closed, applied once open; garbage and unknown kinds dropped; browser candidates parsed; `X11FrameSource` argv only. No `ffmpeg x11grab` run on a real display |
| Stream and control on the server (`streams.py`) | ✅ | 8 tests: coturn credential, STUN-only and TURN ICE lists, registry ownership, `screen.open` reaches the VM and only the opening device, `control.take` reaches the VM and every device, a device disconnect stops its stream and releases control, a VM disconnect closes streams and a reconnect restores control |
| Desktop shell (`apps/desktop`, Tauri 2) | 🚧 | `cargo check` clean, debug binary built on Linux; bundles for macOS and Windows unbuilt |
| Phone shells (`apps/mobile`, Capacitor 6) | 🚧 | Android debug APK built with the web dist inside; iOS project generated and patched, never compiled here |
| watchOS app (`apps/watchos`) | 🚧 | Swift written, XcodeGen spec written, no Xcode here |
| Wear OS app (`apps/wearos`) | 🚧 | `gradle assembleDebug` built `app-debug.apk` (25.8 MB) on Linux with SDK 34; no device run, release build untested |
| Monorepo (`apps/`, `packages/`, `infra/`; npm workspace with Turborepo; uv workspace) | ✅ local · ❌ CI run | One root `package-lock.json` seeded from the 4 old ones: 0 resolved versions moved, turbo 2.11.7 added. `turbo run typecheck build test --force`: 9 tasks green (apps/web 186 tests, packages/orb 8, apps/site `astro check` 0 errors and its build). `uv run pytest -q`: 118 pass. The web build's hashed assets (`index-CRvT-hYl.css`, `index-D17GN9wu.js`) did not change. No workflow has run on GitHub |
| Website (`apps/site`, Vercel) | ✅ local · ❌ deployed | Astro 7 static build, `astro check` 0 errors. `vercel build` (CLI 63.1.0, no account) wrote `.vercel/output` from `apps/site/vercel.json`. Playwright rendered it at 1440, 1024, 768 and 390 px, light and dark, with no console error, failed request or horizontal overflow. Lighthouse 12.8.2: 100 in all 4 categories, mobile and desktop; axe-core: 0 violations. No Vercel project exists yet; the one-time setup is in `apps/site/README.md` |
| CI: verify, nightly, release, client builds | ✅ parse · ❌ run | `workflows_parse` gate; no run on GitHub yet |
| GCP: Terraform, VM image, Cloud Run deploy | 🚧 | Written under `infra/gcp`, `infra/vm/`; never applied. On 2026-10-08 I reordered the first deployment (VM image, registry and Gemini secret, server image, full apply, `api_domain` re-apply). `main.tf` now parses and `terraform validate` passes; not run against a real project |
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

- **Shipping:** the React client, the orb, the VM screen widget and the stream protocol landed on 2026-10-04 (roadmap item 5 in part). The Ink on Paper redesign of the web app landed on 2026-10-05: the thread with the voice composer that types, the rail, the Jobs desk, the inspector, the command palette, the status bar, progress steps and demo mode. The queue top is the voice shell on the paid tier.
- **Last release:** none
- **Known red:** `apps/server/tests/test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result` is intermittent: 3 failures in 15 full `uv run pytest -q` runs on 2026-10-04, 0 failures alone or in its file. The failure is `IndexError` at `w.messages(S2C.JOB_DONE)[0]` (line 140): `wait_done` returns before the `job.done` broadcast lands. The gate is green on a pass. Queued in ROADMAP.md. The native-shell gates skip in environments without their toolchains; `tauri build` and `cap sync` against the Vite dist layout ran in no build.
- **Assumed values to confirm:** `security@reagent.systems` in SECURITY.md; every model string in `config/apparatus.toml`; the Live wire facts listed in `apps/web/README.md`.
