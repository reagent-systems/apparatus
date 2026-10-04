# apparatus

A voice agent that works on its own cloud computer and talks to you on any device. You
speak. The agent does the work on a persistent Linux desktop VM. It asks you only when a
person must act: a captcha, a login, an approval.

Two Gemini models do two jobs. A Live model talks and routes. A text model works in the
VM. One API key, on the server only. Users pay a subscription that includes credits.

| Part | Folder | What it is |
|---|---|---|
| Session server | `server/` | Python. Client and VM sockets, Live tokens, the agent loop, jobs, credits, audit. |
| agentd + agentlib | `agentd/` | Python. Runs on the VM. One kernel per task, tools, desktop lock, handoff pause. |
| Protocol | `protocol/` | The wire contract the three links share. |
| Web client | `web/` | TypeScript, no dependencies. Audio, the voice gate, feed, pane, handoff view. |
| Native shells | `clients/` | Tauri 2 (Windows, macOS, Linux), Capacitor 6 (iOS, Android), SwiftUI (watchOS), Compose (Wear OS). |
| Deployment | `deploy/gcp`, `vm/` | Terraform for GCP, VM image scripts, a local docker-compose. |
| Config | `config/apparatus.toml` | Every model name, threshold, budget and price. |
| Process | `agent-kit/` | How this repo is worked on. Start at `agent-kit/ROUTING.md`. |

## Run it locally

```sh
cp .env.example .env            # add GEMINI_API_KEY for real voice; empty runs the fakes
uv sync && (cd web && npm install && npm run build)
uv run apparatus-server          # http://localhost:8080, dev auth: the user id is "dev"
AGENTD_HOME=/tmp/agent-home uv run agentd   # in a second shell: a local VM stand-in
```

Or with a virtual desktop in a container: `docker compose -f deploy/local/docker-compose.yml up --build`.

## Check it

```sh
verify/verify.sh
```

Lint, typecheck, build, 144 tests, and the repo gates. CI runs the same script.

## Build the apps

Each client has a reusable workflow under `.github/workflows/clients-*.yml`. A version tag
runs `release.yml`: it verifies, builds every client on its native runner, builds the server
and VM images, and publishes one GitHub Release with every artifact. `clients/README.md`
has the table of platforms, shells, commands and artifacts.

## Deploy

`deploy/gcp/README.md`. Cloud Run for the server, one Compute Engine VM per user, Firestore,
Identity Platform, Secret Manager, FCM, a TURN relay. `deploy.yml` deploys with Workload
Identity Federation when the repository variables are set.

## Where things stand

`agent-kit/STATUS.md`. In short: the code paths are tested end to end with fakes and real
kernels; nothing has yet talked to Gemini or run on a real VM. The first roadmap item is a
10-minute Live session on the paid tier.

## Design

The design spec is `docs/DESIGN-SPEC.md`. Its decisions are encoded in `agent-kit/AGENTS.md`
(invariants), `agent-kit/docs/ARCHITECTURE.md` (parts, data flow, boundaries),
`agent-kit/docs/PROTOCOL.md` (the wire) and `agent-kit/docs/CONFIGURATION.md` (every knob).
