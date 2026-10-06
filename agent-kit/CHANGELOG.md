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
- AWS: Terraform for VPC, NAT, a user-VM launch template with no inbound ports and an instance role with no policies, Fargate, ECR, Secrets Manager, EFS, a TURN relay; an `ec2` VM controller; image and provision scripts.
- Web client on React 19, Vite, Tailwind CSS 4 and shadcn/ui: the 3-column desktop layout (job sidebar, pane, feed), the tablet and phone layouts from the sketches, a Screen / Output toggle in the pane. The audio, gate, Live and WebRTC code stays plain TypeScript.
- The orb: a `thinking-orbs` canvas driven by the voice state (idle, connecting, listening, speaking, working); dimmed on a device that does not hold the voice session; still under reduced motion.
- The VM screen widget: live video of the desktop over WebRTC, Control and Release, Done and Cancel during a handoff; pointer, wheel, key and touch input on the `input` data channel.
- Stream and control protocol: `screen.open`, `screen.close`, `control.take`, `control.release`, `screen.opened`, `screen.closed`, `control`, `stream.start`, `stream.stop`; the `input` channel shape with 7 input kinds. agentd streams the X11 desktop with aiortc and `ffmpeg x11grab`; the server mints coturn `use-auth-secret` TURN credentials; `[stream]` in `config/apparatus.toml`.
- The Ink on Paper redesign of the web app, built to `docs/DESIGN.md`: warm paper neutrals with one ink-blue accent, Inter Variable and JetBrains Mono Variable, borders instead of shadows, light and dark on the same hue with Light, Dark and System.
- The voice composer: one card under the thread with the orb centred in it and, above the orb, what the model heard of the current user turn.
- The Jobs desk: filter chips (Needs you, Running, Done; none selected shows every job), jobs grouped by state with Today and Earlier, Approve and Deny or Done and Cancel on every blocked row; the rail lists Needs you, Running and Recent with status glyphs.
- The inspector: Receipt, Steps and Artifacts for the selected job.
- The command palette (Cmd/Ctrl+K) and keys: Enter or Space on the focused orb toggles the agent, Cmd/Ctrl+1 to 5 pick a view, Alt+J jumps to what needs you, Cmd/Ctrl+Shift+C takes or releases control. Voice has no global key.
- The status bar on desktop: connection, voice holder, control holder and credits; hidden from the settings popover or with a right-click.
- Progress steps: the server sends `job.progress` after every tool step, and each job in `ready.jobs` and `GET /jobs` carries the last 50 texts as `progress_history`.
- Demo mode for development: `APPARATUS_DEMO=1` replaces the smart model with a scripted job, an approval or a handoff.
- Borders, a per-device setting on the screen clients: a switch under Appearance and a row in the command palette. Off hides every border, divider and outline ring and puts every surface on the page background; controls and states keep their fill, and floating layers keep their shadow. Off, borderless, is the default; on brings back the lines and stepped surfaces.
- Media for the README in `docs/media/`: 27 stills (a hero for light and dark among them) and 9 GIFs, with a gallery in `docs/media/README.md`. `tools/media` makes them from the real client in demo mode with scripted voice.
### Changed
- `signal` carries `stream_id` on every link; `handoff_id` is gone from it. One handoff opens a stream like any other screen.
- `ready` carries `jobs`, `control` and `streams`; `vm.state` carries `streams` and `user_control`.
- The server serves the Vite dist: `/` → `index.html`, `/assets` from `dist/assets`, top-level files by name; nothing outside `dist`.
- Layout: a 248 px rail, one thread column at most 760 px wide with the composer docked under it, and a resizable pane that is closed by default. Tablets get a 56 px icon rail and a right sheet; phones get sheets for the rail and the pane.
- The pane signals by itself: it opens on a job, on Screen or on a handoff, a handoff locks it until it ends, and the screen frame's ring says who holds the desktop. A picture-in-picture keeps the stream in view while the pane is closed.
- The screen clients are voice only and full duplex, and the orb is the only voice control. The text field, the send button, Talk, Stop, the input modes and the Input setting are gone. Every visible string is content or a one-word label; the Audit header row, the palette headings and the All filters are gone.
- The watch apps (watchOS and Wear OS) show the thinking orb alone on black: no text, no feed, no buttons. A tap anywhere starts or ends a call, like a phone call; the press-and-hold Talk, Stop and the plain-circle orb are gone. A call keeps the microphone open, runs the voice gate on the watch in open-mic mode with echo cancellation, and stops playback on barge-in. The orb is the `thinking-orbs` engine in native ports (vendored Swift kit, Kotlin port with golden tests) and follows the web's state mapping; reduced motion and the always-on display show its static frame. Both gates replay `clients/shared/gate-vectors.json`. `THIRD_PARTY_NOTICES.md` carries the MIT notice.
- The orb is the agent's on-switch on web, desktop, phone and tablet, as on the watches. A tap turns the agent on: it claims the voice session when needed, opens the Live session and keeps the microphone open. A second tap hangs up: it ends any open turn, stops playback, closes the Live session, releases the microphone and gives the voice session back. The switch reads off when the Live session closes by itself. To interrupt the agent, the user talks over it. The orb is a `role="switch"` named "Agent"; the watch apps name their toggle "Agent" too.
- The orb sits centred in the composer box, and what the model heard sits centred above it, at most 2 lines (3 on a phone). The box grows upward, so the orb never moves.
- The orb has no disc, no ring and no shadow: only its dots, black in light mode and white in dark mode, in a circular hit region. Every orb takes its ink from the app's theme, not from the OS, so Light on a dark OS draws black dots.
- Barge-in on the web keeps the rest of the reply the user talked over silent, as on the watches.
### Deprecated
### Removed
- The orb's hold (a forced turn of 350 ms or more), the tap that interrupts, the tap that only claims, the Space hold and the Esc interrupt on the screen clients; `pressTalk`, `releaseTalk` and `interrupt` on the web voice context; the `--orb-disc` and `--orb-ring` tokens.
- The job sidebar, the feed controls and the old pane; the 3-column layout from the sketches.
### Fixed
- The web microphone is released when the switch turns off while `getUserMedia` is still pending; before, the late stream stayed open.
### Security
- Stream input reaches the desktop only during a handoff or from the controlling device's own stream; the server names that stream in `control`.
- The server tells agentd the control state and every open handoff on each VM connect; the gates are re-checked after the desktop lock wait and right before a screenshot; `computer` is refused on the server while a handoff is open; kernels get no `DISPLAY`.
- The Gemini key lives only on the session server. VM environment and files hold no secrets.
- All tool output reaches the model wrapped as external data.
