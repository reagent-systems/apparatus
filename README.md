# apparatus

A voice agent that works on its own cloud computer and talks to you on any device. You
speak. The agent does the work on a persistent Linux desktop VM. It asks you only when a
person must act: a captcha, a login, an approval.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero-dark.png">
  <img alt="The desktop app listening, with what the model heard above the orb; a phone on a job's receipt; the Wear OS app listening" src="docs/media/hero-light.png">
</picture>

<img alt="A spoken request becomes a job with a table and report.csv" src="docs/media/voice-to-job.gif">

Speak. The agent starts a job and says the result.

<table>
  <tr>
    <td width="50%"><img alt="Approve on an email the agent drafted; the job ends" src="docs/media/approval.gif"></td>
    <td width="50%"><img alt="The same request on a phone" src="docs/media/phone.gif"></td>
  </tr>
  <tr>
    <td>The agent asks before it acts.</td>
    <td>The same request on a phone.</td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/orb-dark.gif"><img alt="The orb: off, listening with the heard line above it, speaking, working, speaking, off" src="docs/media/orb.gif"></picture></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/watch-dark.gif"><img alt="The Wear OS app through a voice session" src="docs/media/watch.gif"></picture></td>
  </tr>
  <tr>
    <td>The orb is the agent's on-switch. Above it, what the model heard.</td>
    <td>The watch shows the orb and nothing else.</td>
  </tr>
  <tr>
    <td width="50%"><img alt="Light, Dark and Borders under Appearance" src="docs/media/appearance.gif"></td>
    <td width="50%"><img alt="Control of your computer's screen, a typed command, Release" src="docs/media/screen-control.gif"></td>
  </tr>
  <tr>
    <td>Light, Dark, Borders.</td>
    <td>Take Control of your computer, then Release it.</td>
  </tr>
</table>

Captures use demo mode (`APPARATUS_DEMO=1`: scripted jobs) with scripted voice; real jobs take minutes.
Every frame is the real client; the watch is the Wear OS app, rendered with Paparazzi. [docs/media/README.md](docs/media/README.md) has every still and GIF.

Two Gemini models do two jobs. A Live model talks and routes. A text model works in the
VM. One API key, on the server only. Users pay a subscription that includes credits.

| Part | Folder | What it is |
|---|---|---|
| Session server | `server/` | Python. Client and VM sockets, Live tokens, the agent loop, jobs, credits, audit. |
| agentd + agentlib | `agentd/` | Python. Runs on the VM. One kernel per task, tools, desktop lock, handoff pause. |
| Protocol | `protocol/` | The wire contract the three links share. |
| Web client | `web/` | React 19, Vite, Tailwind CSS 4, shadcn/ui. Audio, the voice gate, the feed, the pane, the orb, the VM screen widget with Control and Release. |
| Native shells | `clients/` | Tauri 2 (Windows, macOS, Linux), Capacitor 6 (iOS, Android), SwiftUI (watchOS), Compose (Wear OS). |
| Deployment | `deploy/gcp`, `vm/` | Terraform for GCP, VM image scripts, a local docker-compose. |
| Config | `config/apparatus.toml` | Every model name, threshold, budget and price. |
| Process | `agent-kit/` | How this repo is worked on. Start at `agent-kit/ROUTING.md`. |

## Run it locally

```sh
cp .env.example .env            # add GEMINI_API_KEY for real voice; empty runs the fakes
uv sync && (cd web && npm install && npm run build)
uv run apparatus-server          # http://localhost:8080, dev auth: the user id is "dev"
APPARATUS_DEMO=1 uv run apparatus-server   # instead: scripted jobs without a model key
AGENTD_HOME=/tmp/agent-home uv run agentd   # in a second shell: a local VM stand-in
```

For work on the web client, run the Vite dev server instead of `npm run build`:

```sh
cd web && npm run dev          # http://localhost:5173; proxies /token, /credits, /audit, /jobs, /config, /prompts and /ws to :8080
```

The VM screen needs `ffmpeg`, `xdotool` and an X display on the agentd side; `vm/setup.sh` and `deploy/local/docker-compose.yml` install them. Without them the stream fails to start and agentd logs it.

Or with a virtual desktop in a container: `docker compose -f deploy/local/docker-compose.yml up --build`.

## Check it

```sh
verify/verify.sh
```

Lint, typecheck, build, 208 tests, and the repo gates. CI runs the same script.

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
