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
uv run ruff check protocol server agentd
uv run ruff format --check protocol server agentd

step "web: install"
(cd web && if [ -f package-lock.json ]; then npm ci --silent; else npm install --silent; fi)

step "web: typecheck, build, tests"
(cd web && npm run verify --silent)

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
if command -v cargo >/dev/null; then
  (cd clients/desktop/src-tauri && cargo check --quiet) || exit 1
else
  skip "cargo check for clients/desktop (no Rust toolchain here)"
fi
if command -v xcodebuild >/dev/null; then
  (cd clients/watchos && xcodegen generate >/dev/null && xcodebuild -quiet -project ApparatusWatch.xcodeproj -scheme ApparatusWatch -destination 'generic/platform=watchOS Simulator' build CODE_SIGNING_ALLOWED=NO) || exit 1
else
  skip "xcodebuild for clients/watchos and clients/mobile/ios (no Xcode here)"
fi
if command -v gradle >/dev/null && [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
  (cd clients/wearos && gradle --quiet assembleDebug) || exit 1
else
  skip "gradle assembleDebug for clients/wearos and clients/mobile/android (no Android SDK here)"
fi

printf '\n== verify: OK'
if [ "$SKIPPED" = 1 ]; then printf ' (with skipped gates; CI runs them on their native runners)'; fi
printf '\n'
