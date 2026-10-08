#!/usr/bin/env bash
# The one health gate. CI runs this exact script. Local runs the same.
# Order: lint -> typecheck -> build -> tests -> repo gates.
# A gate that cannot run here skips loudly; it never passes silently.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$*"; }
skip() { printf '\n!! SKIPPED: %s\n' "$*"; SKIPPED=1; }
SKIPPED=0

if ! command -v uv >/dev/null; then echo "uv is required (https://docs.astral.sh/uv/)"; exit 1; fi
if ! command -v node >/dev/null; then echo "node 22 is required"; exit 1; fi

step "python: sync"
uv sync --frozen --quiet 2>/dev/null || uv sync --quiet

step "python: lint and format"
uv run ruff check packages/protocol apps/server apps/agentd
uv run ruff format --check packages/protocol apps/server apps/agentd

step "js: install (one npm workspace, one lockfile)"
npm ci --silent

step "js: typecheck, build, tests (turbo, every workspace that has the task)"
# --force: the gate never passes on a cached result.
npx turbo run typecheck build test --force

step "python: tests"
uv run pytest -q

step "gates: config documented"
uv run python verify/gates/config_documented.py

step "gates: protocol documented"
uv run python verify/gates/protocol_documented.py

step "gates: no placeholders in agent-kit"
if grep -rn '{{[A-Z_]*}}' agent-kit --include='*.md' | grep -v 'SETUP.md' | grep -v 'ROUTING.md:.*{{THIS}}' ; then
  echo "agent-kit still has placeholders"; exit 1
fi

step "gates: workflows parse"
uv run python verify/gates/workflows_parse.py

step "gates: shells and watch apps"
# On Linux the Tauri crates link against the webkit2gtk and glib dev packages;
# a runner without them (CI's ubuntu-latest) has no desktop toolchain.
if command -v cargo >/dev/null && { [ "$(uname)" != Linux ] || pkg-config --exists webkit2gtk-4.1 glib-2.0 2>/dev/null; }; then
  # generate_context! needs ../dist and src-tauri/icons; a fresh clone has neither.
  npm run prepare-dist -w apps/desktop --silent
  (cd apps/desktop/src-tauri && cargo check --quiet) || exit 1
else
  skip "cargo check for apps/desktop (no Rust toolchain or no webkit2gtk-4.1/glib dev libraries here)"
fi
if command -v xcodebuild >/dev/null; then
  (cd apps/watchos && xcodegen generate >/dev/null && xcodebuild -quiet -project ApparatusWatch.xcodeproj -scheme ApparatusWatch -destination 'generic/platform=watchOS Simulator' build CODE_SIGNING_ALLOWED=NO) || exit 1
else
  skip "xcodebuild for apps/watchos and apps/mobile/ios (no Xcode here)"
fi
if command -v gradle >/dev/null && [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
  (cd apps/wearos && gradle --quiet assembleDebug) || exit 1
else
  skip "gradle assembleDebug for apps/wearos and apps/mobile/android (no Android SDK here)"
fi

printf '\n== verify: OK'
if [ "$SKIPPED" = 1 ]; then printf ' (with skipped gates; CI runs them on their native runners)'; fi
printf '\n'
