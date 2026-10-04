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
### Changed
### Deprecated
### Removed
### Fixed
### Security
- The Gemini key lives only on the session server. VM environment and files hold no secrets.
- All tool output reaches the model wrapped as external data.
