# Changelog

All notable changes to apparatus are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Wire protocol shared by client, server, agentd and agentlib, with its human copy in `docs/PROTOCOL.md`.
- agentd: one Python kernel per task, python and computer tools, desktop lock, handoff pause, append-only task log, the disk layout under `/home/agent`.
- agentlib: `say`, `progress`, `show`, `request_approval`, `api`, `handoff`.
- Session server: ephemeral Live tokens with locked setup, voice-model tools, smart-model loop with context summaries and checkpoints, jobs with budgets and credit holds, handoffs, approvals, audit log, credit ledger with daily cap, rolling conversation summary, idle VM stop, GCE and local VM controllers, FCM and log push.
- Web client: Gemini Live session over an ephemeral token, voice gate (VAD, two-limit turn detector, barge-in rule, min duration, speaker check interface), feed, show pane, handoff view with WebRTC signaling, native bridge seam.
- Native shells: Tauri 2 for Windows, macOS and Linux; Capacitor 6 for iOS and Android; SwiftUI app for watchOS; Compose app for Wear OS.
- CI: one verify gate, nightly, release that builds every client and publishes one GitHub Release, Cloud Run deploy with Workload Identity Federation.
- GCP: Terraform for VPC, NAT, firewall, user-VM template with snapshots, Cloud Run, Secret Manager, Firestore, TURN relay; VM image scripts.
- Web client on React 19, Vite, Tailwind CSS 4 and shadcn/ui: the 3-column desktop layout (job sidebar, pane, feed), the tablet and phone layouts from the sketches, a Screen / Output toggle in the pane. The audio, gate, Live and WebRTC code stays plain TypeScript.
- The orb: a `thinking-orbs` canvas driven by the voice state (idle, connecting, listening, speaking, working); dimmed on a device that does not hold the voice session; still under reduced motion.
- The VM screen widget: live video of the desktop over WebRTC, Control and Release, Done and Cancel during a handoff; pointer, wheel, key and touch input on the `input` data channel.
- Stream and control protocol: `screen.open`, `screen.close`, `control.take`, `control.release`, `screen.opened`, `screen.closed`, `control`, `stream.start`, `stream.stop`; the `input` channel shape with 7 input kinds. agentd streams the X11 desktop with aiortc and `ffmpeg x11grab`; the server mints coturn `use-auth-secret` TURN credentials; `[stream]` in `config/apparatus.toml`.
- The Ink on Paper redesign of the web app, built to `docs/DESIGN.md`: warm paper neutrals with one ink-blue accent, Inter Variable and JetBrains Mono Variable, borders instead of shadows, light and dark on the same hue with Light, Dark and System.
- The voice composer: one card under the thread with the orb and, beside it, what the model heard of the current user turn.
- The Jobs desk: filter chips (Needs you, Running, Done; none selected shows every job), jobs grouped by state with Today and Earlier, Approve and Deny or Done and Cancel on every blocked row; the rail lists Needs you, Running and Recent with status glyphs.
- The inspector: Receipt, Steps and Artifacts for the selected job.
- The command palette (Cmd/Ctrl+K) and keys: Space held is the orb's hold, Esc interrupts, Cmd/Ctrl+1 to 5 pick a view, Alt+J jumps to what needs you, Cmd/Ctrl+Shift+C takes or releases control.
- The status bar on desktop: connection, voice holder, control holder and credits; hidden from the settings popover or with a right-click.
- Progress steps: the server sends `job.progress` after every tool step, and each job in `ready.jobs` and `GET /jobs` carries the last 50 texts as `progress_history`.
- Demo mode for development: `APPARATUS_DEMO=1` replaces the smart model with a scripted job, an approval or a handoff.
### Changed
- `signal` carries `stream_id` on every link; `handoff_id` is gone from it. One handoff opens a stream like any other screen.
- `ready` carries `jobs`, `control` and `streams`; `vm.state` carries `streams` and `user_control`.
- The server serves the Vite dist: `/` → `index.html`, `/assets` from `dist/assets`, top-level files by name; nothing outside `dist`.
- Layout: a 248 px rail, one thread column at most 760 px wide with the composer docked under it, and a resizable pane that is closed by default. Tablets get a 56 px icon rail and a right sheet; phones get sheets for the rail and the pane.
- The pane signals by itself: it opens on a job, on Screen or on a handoff, a handoff locks it until it ends, and the screen frame's ring says who holds the desktop. A picture-in-picture keeps the stream in view while the pane is closed.
- The screen clients are voice only and full duplex, and the orb is the only voice control: a tap claims, interrupts, closes or opens the voice session; a hold of 350 ms or more is a forced turn until release. The text field, the send button, Talk, Stop, the input modes and the Input setting are gone. Every visible string is content or a one-word label; the Audit header row, the palette headings and the All filters are gone.
### Deprecated
### Removed
- The job sidebar, the feed controls and the old pane; the 3-column layout from the sketches.
### Fixed
### Security
- Stream input reaches the desktop only during a handoff or from the controlling device's own stream; the server names that stream in `control`.
- The server tells agentd the control state and every open handoff on each VM connect; the gates are re-checked after the desktop lock wait and right before a screenshot; `computer` is refused on the server while a handoff is open; kernels get no `DISPLAY`.
- The Gemini key lives only on the session server. VM environment and files hold no secrets.
- All tool output reaches the model wrapped as external data.
