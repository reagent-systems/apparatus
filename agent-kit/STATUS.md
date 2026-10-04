# STATUS.md — where the project actually stands

The single source of truth for project state. Claims require evidence: a
passing gate, a linked run, a tag. Updated in the same commit as the
behavior change. The weekly cycle (WEEKLY.md step 5) refreshes it.

| Area | State | Evidence |
|---|---|---|
| Protocol (`protocol/`) | ✅ | `verify/verify.sh` green: 9 protocol tests; `protocol_documented` gate |
| agentd + agentlib (`agentd/`) | ✅ | 22 tests with real subprocess kernels: persistence, timeouts, desktop lock, handoff pause, approval round trip |
| Session server (`server/`) | ✅ | 39 tests: config, ledger, store, Live setup, job loop against a real in-process agentd core, both WebSockets |
| Web client (`web/`) | ✅ unit · ❌ live | 74 node tests for gate, turn, barge-in, Live wire; no microphone or Gemini key has run it |
| Desktop shell (`clients/desktop`, Tauri 2) | 🚧 | `cargo check` clean, debug binary built on Linux; bundles for macOS and Windows unbuilt |
| Phone shells (`clients/mobile`, Capacitor 6) | 🚧 | Android debug APK built with the web dist inside; iOS project generated, never compiled here |
| watchOS app (`clients/watchos`) | 🚧 | Swift written, XcodeGen spec written, no Xcode here |
| Wear OS app (`clients/wearos`) | 🚧 | Kotlin written, no Gradle build here |
| CI: verify, nightly, release, client builds | ✅ parse · ❌ run | `workflows_parse` gate; no run on GitHub yet |
| GCP: Terraform, VM image, Cloud Run deploy | 🚧 | Written under `deploy/gcp`, `vm/`; never applied |
| Voice shell on the paid tier (build order 1) | ❌ | Needs a key and a microphone |
| Voice gate on recorded cases (build order 2) | ❌ | Logic unit-tested; no audio fixtures |
| Screen stream for handoff (build order 7) | ❌ | Signaling relay exists; no stream server on the VM |
| Billing: ledger ✅, Stripe ❌ | 🚧 | Ledger tests; no Stripe code |
| Firestore store adapter | ❌ | `memory` and `file` adapters only |

States: ✅ done (gated) · 🚧 in progress · ❌ not started · 🧊 frozen/won't do.

## Current week

- **Shipping:** between cycles. Version 1 skeleton landed; the queue top is the voice shell on the paid tier.
- **Last release:** none
- **Known red:** none in the gate. The native-shell gates skip in environments without their toolchains.
- **Assumed values to confirm:** `security@reagent.systems` in SECURITY.md; every model string in `config/apparatus.toml`; the Live wire facts listed in `web/README.md`.
