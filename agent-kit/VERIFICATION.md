# VERIFICATION.md — one command answers "is this repo healthy"

`verify/verify.sh` runs, in order:

1. Lint / format check — `uv run ruff check packages/protocol apps/server apps/agentd && uv run ruff format --check packages/protocol apps/server apps/agentd`
2. Build — `npm ci` at the root, then `npx turbo run typecheck build test --force`: every workspace with the task (apps/web typecheck, Vite and esbuild build, node tests; packages/orb typecheck and tests; apps/desktop and apps/mobile typecheck; apps/site `astro check` and the Astro static build). `--force` skips the turbo cache.
3. Tests — `uv run pytest` (protocol, agentd with real kernels, server with a real in-process agentd core)
4. Repo gates, each a script under `verify/gates/`, each independently runnable:
   - `config_documented.py` — every field in `config/apparatus.toml` and in `apps/server/apparatus_server/config.py` has a row in `docs/CONFIGURATION.md`, and the two agree.
   - `protocol_documented.py` — every message type in `apparatus_protocol` appears in `docs/PROTOCOL.md`.
   - `workflows_parse.py` — every workflow parses and every job has `timeout-minutes`.
   - placeholder scan — no double-brace template placeholder left in `agent-kit/`.
   - native shells — `cargo check` (desktop, after `prepare-dist` writes `apps/desktop/dist` and the icons; on Linux it needs the webkit2gtk-4.1 and glib dev packages), `xcodebuild` (watchOS, iOS), `gradle assembleDebug` (Wear OS, Android). Each skips loudly when its toolchain is absent; CI runs them on their native runners through the `clients-*.yml` workflows.

## Rules

- CI runs **the same command** as local. No CI-only logic.
- A gate that can't run in some environment **skips loudly**, never
  passes silently.
- New behavior lands with its gate in the same PR whenever feasible.
- A feature's completion promise (ROADMAP.md) should be backed by a gate
  here whenever it can be — evidence that keeps proving itself beats
  evidence produced once.
- Fixing a flaky or broken gate is always in scope, for any task.

## What the gate does not prove

Live voice against Gemini, a real microphone, a real VM on Compute Engine, push
delivery, and the native shells on their own devices. Those are proven by the ROADMAP
items that name them, with their evidence recorded in STATUS.md.
