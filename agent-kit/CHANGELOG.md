# Changelog

All notable changes to apparatus are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Wire protocol shared by client, server, agentd and agentlib, with its human copy in `docs/PROTOCOL.md`.
- agentd: one Python kernel per task, python and computer tools, desktop lock, handoff pause, append-only task log, the disk layout under `/home/agent`.
- agentlib: `say`, `progress`, `show`, `request_approval`, `api`, `handoff`.
- Session server: ephemeral Live tokens with locked setup, voice-model tools, smart-model loop with context summaries and checkpoints, jobs with budgets and credit holds, handoffs, approvals, audit log, credit ledger with daily cap, rolling conversation summary, idle VM stop, GCE and local VM controllers, FCM and log push.
- Web client: Gemini Live session over an ephemeral token, voice gate (VAD, two-limit turn detector, barge-in rule, min duration, speaker check interface), push to talk and open mic, feed, show pane, handoff view with WebRTC signaling, native bridge seam.
- Native shells: Tauri 2 for Windows, macOS and Linux; Capacitor 6 for iOS and Android; SwiftUI app for watchOS; Compose app for Wear OS.
- CI: one verify gate, nightly, release that builds every client and publishes one GitHub Release, Cloud Run deploy with Workload Identity Federation.
- GCP: Terraform for VPC, NAT, firewall, user-VM template with snapshots, Cloud Run, Secret Manager, Firestore, TURN relay; VM image scripts.
- Web client on React 19, Vite, Tailwind CSS 4 and shadcn/ui: the 3-column desktop layout (job sidebar, pane, feed), the tablet and phone layouts from the sketches, a Screen / Output toggle in the pane. The audio, gate, Live and WebRTC code stays plain TypeScript.
- The orb: a `thinking-orbs` canvas driven by the voice state (idle, connecting, listening, speaking, working); dimmed on a device that does not hold the voice session; still under reduced motion.
- The VM screen widget: live video of the desktop over WebRTC, Control and Release, Done and Cancel during a handoff; pointer, wheel, key and touch input on the `input` data channel.
- Stream and control protocol: `screen.open`, `screen.close`, `control.take`, `control.release`, `screen.opened`, `screen.closed`, `control`, `stream.start`, `stream.stop`; the `input` channel shape with 7 input kinds. agentd streams the X11 desktop with aiortc and `ffmpeg x11grab`; the server mints coturn `use-auth-secret` TURN credentials; `[stream]` in `config/apparatus.toml`.
### Changed
- `signal` carries `stream_id` on every link; `handoff_id` is gone from it. One handoff opens a stream like any other screen.
- `ready` carries `jobs`, `control` and `streams`; `vm.state` carries `streams` and `user_control`.
- The server serves the Vite dist: `/` → `index.html`, `/assets` from `dist/assets`, top-level files by name; nothing outside `dist`.
### Deprecated
### Removed
### Fixed
### Security
- Stream input reaches the desktop only during a handoff or from the controlling device's own stream; the server names that stream in `control`.
- The server tells agentd the control state and every open handoff on each VM connect; the gates are re-checked after the desktop lock wait and right before a screenshot; `computer` is refused on the server while a handoff is open; kernels get no `DISPLAY`.
- The Gemini key lives only on the session server. VM environment and files hold no secrets.
- All tool output reaches the model wrapped as external data.
