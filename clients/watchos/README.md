# Apple Watch client

SwiftUI app for watchOS 10. Push to talk, the orb, a short feed of spoken
lines, and notifications for handoffs and approvals. It speaks to Gemini
Live directly with an ephemeral token from the session server and relays
tool calls and events over `/ws/client`. See
`agent-kit/docs/PROTOCOL.md`, section "Live session wiring (client side)".

## Layout

| Path | Task |
|---|---|
| `project.yml` | XcodeGen spec. One target `ApparatusWatch`, bundle id `systems.reagent.apparatus.watch`. |
| `Config/Base.xcconfig` | `APPARATUS_SERVER_ORIGIN` and the signing defaults. |
| `ExportOptions.plist` | Export options for the App Store Connect archive. |
| `Sources/ApparatusWatchApp.swift` | `@main` App, notification setup, APNs token, notification actions. |
| `Sources/Model/AppModel.swift` | State machine and relay between server, Live and audio. |
| `Sources/Model/Config.swift` | Build-time constants. |
| `Sources/Net/ServerSocket.swift` | `/ws/client` with backoff and a 20 s ping. |
| `Sources/Net/TokenClient.swift` | `POST /token`. |
| `Sources/Net/LiveSession.swift` | Gemini Live socket, message builders and parser. |
| `Sources/Net/JSON.swift` | JSONSerialization wrappers and the main-queue hop. |
| `Sources/Audio/AudioEngine.swift` | Microphone to 16 kHz Int16 chunks; 24 kHz playback with instant flush. |
| `Sources/Secure/Keychain.swift` | Strings in the keychain, service `apparatus`. |
| `Sources/UI/ContentView.swift` | Orb, feed, Talk, Stop. |
| `Sources/UI/Orb.swift` | The circle. |

## Generate, open, build, run

1. Install XcodeGen: `brew install xcodegen`.
2. Generate the project in this folder: `xcodegen generate`.
3. Open it: `open ApparatusWatch.xcodeproj`.
4. Pick a watchOS Simulator and press Run, or build from the shell:

```sh
xcodebuild -project ApparatusWatch.xcodeproj -scheme ApparatusWatch \
  -destination 'generic/platform=watchOS Simulator' -configuration Debug \
  build CODE_SIGNING_ALLOWED=NO
```

Run the session server on the Mac first (`http://localhost:8080`). The
Simulator reaches the Mac through `localhost`. A real watch needs an
https origin:

```sh
xcodebuild ... APPARATUS_SERVER_ORIGIN='https:/$()/apparatus.example' DEVELOPMENT_TEAM=TEAMID
```

The `$()` keeps xcconfig from reading `//` as a comment. The value lands in
the Info.plist key `ApparatusServerOrigin`. The app has no setting for it.

Regenerate the project after you add, remove or rename a source file. The
generated `ApparatusWatch.xcodeproj` and `Generated/` are not committed.

## Auth

The app reads the bearer value from the keychain, service `apparatus`,
account `auth`. With no entry it sends `dev`, which the server's `dev`
auth mode accepts. There is no login screen yet; write the value with
`Keychain.set(_:account:)` from a debug build or a later sign-in flow.

## Behavior

| Event | Action |
|---|---|
| App opens | Connect to `/ws/client`, send `hello`, then `voice.claim` on `ready`. |
| `voice.granted` | Ask for microphone permission once, fetch a token, open Gemini Live, start audio. |
| Hold Talk | `activityStart`, then 20 ms PCM chunks. Playback stops at once. |
| Release Talk | `activityEnd`. The orb turns orange until the model answers. |
| Stop | Flush playback. Jobs keep running. |
| `tool.result` | `toolResponse` with the given `scheduling`. |
| Any S2C message with `voice` | `<event>text</event>` turn with `turnComplete`. |
| `handoff.requested` | Notification "Continue on another device". |
| `approval.requested` | Notification with Approve and Deny. The answer is `approval.answer`. |
| `goAway` | New token, same resumption handle, new socket. |
| 120 s with no speech, no playback and no job | Close the Live session and the audio engine. The next Talk or event reopens it; audio captured meanwhile is buffered. |
| APNs token | `push.register` with platform `apns` and the hex token, on every connection. |

The server's pushes carry `kind`, `approval_id` and `handoff_id` in `data`
(`server/apparatus_server/jobs.py`). A remote approval push shows the
Approve and Deny actions only when the APNs payload also sets
`aps.category` to `apparatus.approval`; the FCM adapter does not set it
yet. Until it does, remote pushes open the app, and the socket delivers
the approval as a local notification with actions.

## CI

`.github/workflows/clients-watchos.yml` runs on `macos-latest`: XcodeGen,
a Simulator build with signing off, and, when the four secrets
`APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`,
`WATCHOS_PROVISIONING_PROFILE_BASE64` and `APPLE_TEAM_ID` exist, an archive
for `generic/platform=watchOS` exported with `ExportOptions.plist` and
uploaded as the artifact `watchos`. Build logs upload on failure.

The provisioning profile must be an App Store distribution profile for
`systems.reagent.apparatus.watch` with the Push Notifications capability.

## Unverified

This folder was written without macOS or Xcode. Nothing here has compiled.
Check these first:

1. The Swift sources compile under Xcode 16 with `SWIFT_VERSION 5.9`.
   Concurrency: `ServerSocket`, `LiveSession` and `AppModel` are
   `@MainActor`; URLSession and audio callbacks hop with `onMain`.
2. XcodeGen produces a single-target watchOS app from `type: application`,
   `platform: watchOS` (its presets set `SDKROOT watchos` and
   `TARGETED_DEVICE_FAMILY 4`). `project.yml` overrides the preset
   `SKIP_INSTALL YES`, which would empty the archive for a watch-only app.
3. The Live endpoint for ephemeral tokens:
   `v1alpha ... BidiGenerateContentConstrained?access_token=`. The google-genai
   SDKs build this URL; confirm against the current Google docs.
4. `AVAudioPlayerNode` output on the watch speaker under `playAndRecord`
   plus `voiceChat`, and `setVoiceProcessingEnabled(true)` on the input
   node. The engine falls back to no voice processing when that call fails.
5. The `DragGesture(minimumDistance: 0)` press-and-hold on watchOS. If a
   touch up is lost, Stop still ends playback and the next Talk starts a
   new turn.
6. `app-store-connect` as the `method` in `ExportOptions.plist` needs Xcode
   15.4 or later; older Xcode wants `app-store`.
7. The server's `/token` field for the idle limit: the client accepts
   `idle_close_seconds` at the top level or under `live`.
8. The watchOS microphone indicator stays on while a Live session is open,
   because the engine runs between presses to avoid start latency. Capture
   is gated in software; only chunks captured while Talk is held leave the
   device.
