# Apple Watch client

SwiftUI app for watchOS 10. The screen is the thinking orb on black and
nothing else. A tap anywhere starts a call; a second tap hangs up. A call is
a phone call through the watch: the microphone stays open, the voice gate on
the watch decides each turn, and the agent's voice plays from the speaker.
Handoffs and approvals arrive as system notifications. The app speaks to
Gemini Live directly with an ephemeral token from the session server and
relays tool calls and events over `/ws/client`. See
`agent-kit/docs/PROTOCOL.md`, section "Live session wiring (client side)".

## Layout

| Path | Task |
|---|---|
| `project.yml` | XcodeGen spec. Targets `ApparatusWatch` (bundle id `systems.reagent.apparatus.watch`) and `ApparatusWatchTests`; local package `ThinkingOrbsKit`. |
| `Config/Base.xcconfig` | `APPARATUS_SERVER_ORIGIN` and the signing defaults. |
| `ExportOptions.plist` | Export options for the App Store Connect archive. |
| `Sources/ApparatusWatchApp.swift` | `@main` App, notification setup, APNs token, notification actions, the alert permission (asked on the first call). |
| `Sources/Model/AppModel.swift` | The call: voice claim, Live session, audio, gate, relays, idle close. |
| `Sources/Model/OrbRender.swift` | Pure: voice state to orb animation. Port of `web/src/orb-state.ts`. |
| `Sources/Model/Config.swift` | Build-time constants. |
| `Sources/Gate/*.swift` | Pure: the voice gate in open-mic mode. Port of `web/src/gate`. |
| `Sources/Net/ServerSocket.swift` | `/ws/client` with backoff and a 20 s ping. |
| `Sources/Net/Outbox.swift` | Pure: the messages that wait while the socket is closed. Bounded; never drops a control message. |
| `Sources/Net/TokenClient.swift` | `POST /token`. |
| `Sources/Net/LiveSession.swift` | Gemini Live socket, message builders and parser. |
| `Sources/Net/JSON.swift` | JSONSerialization wrappers and the main-queue hop. |
| `Sources/Audio/AudioEngine.swift` | Microphone to 16 kHz Int16 frames for the whole call; 24 kHz playback with instant flush. |
| `Sources/Audio/ReplyLatch.swift` | Pure: mutes the rest of a reply after a barge-in. Port of `web/src/live/reply-latch.ts`. |
| `Sources/Secure/Keychain.swift` | Strings in the keychain, service `apparatus`. |
| `Sources/UI/ContentView.swift` | The screen: black, the orb, the tap. |
| `Sources/UI/OrbView.swift` | The thinking orb at 80% of the shorter screen side, with its clock. |
| `Tests/GateVectorTests.swift` | Replays `clients/shared/gate-vectors.json` through the Swift gate. |
| `Tests/OrbRenderTests.swift` | The cases of `web/test/orb-state.test.ts`, plus the low-power display. |
| `Tests/ReplyLatchTests.swift` | The cases of `web/test/reply-latch.test.ts`. |
| `Tests/OutboxTests.swift` | A full outbox still takes `voice.claim`, `voice.release` and `live.closed`. |
| `Vendor/ThinkingOrbsKit/` | The Swift port of thinking-orbs, its golden test and vectors. `VENDORED.md` has the source commit and the edits. |

## Generate, open, build, test

Xcode 15.3 or later: the vendored kit needs Swift 5.10, and its
`Package.swift` declares tools version 5.10, so Xcode 15.0 to 15.2 stop with
a tools-version error. Exporting the archive with `ExportOptions.plist`
needs Xcode 15.4 or later (Unverified, item 9).

1. Install XcodeGen: `brew install xcodegen`.
2. Generate the project in this folder: `xcodegen generate`.
3. Open it: `open ApparatusWatch.xcodeproj`.
4. Pick a watchOS Simulator and press Run, or build and test from the shell:

```sh
xcodebuild -project ApparatusWatch.xcodeproj -scheme ApparatusWatch \
  -destination 'generic/platform=watchOS Simulator' -configuration Debug \
  build CODE_SIGNING_ALLOWED=NO
xcodebuild -project ApparatusWatch.xcodeproj -scheme ApparatusWatch \
  -destination 'platform=watchOS Simulator,name=<a watch simulator>' \
  test CODE_SIGNING_ALLOWED=NO
(cd Vendor/ThinkingOrbsKit && xcodebuild -scheme ThinkingOrbsKit \
  -destination 'platform=watchOS Simulator,name=<a watch simulator>' test)
```

`xcrun simctl list devices available` names the simulators. The second
command runs the gate vectors and the orb mapping; the third runs the
kit's golden test (72 cases against `spec/orbs-golden.json`).

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

## The screen

Black, the orb centred, its diameter 80% of the screen's shorter side. No
text, no buttons, no icons. The orb is ThinkingOrbsKit's `ThinkingOrb`, the
64 preset in its dark theme, scaled to the diameter inside its Canvas. The
animation follows `orbRender` in `web/src/orb-state.ts`:

| State | Orb |
|---|---|
| Server socket down | `connecting` |
| A turn is open (the gate is listening) | `listening` |
| Agent audio is playing | `composing` |
| A job runs | `working` |
| Otherwise | `breathing` |
| No call, no job | `breathing` at speed 0.5 |
| Another device holds the voice session | paused, opacity 0.35 |
| Reduced Motion, or the Always On display (`isLuminanceReduced`) | the library's static frame (engine time 0.6) |

`OrbView` runs the clock itself and hands the kit the instant through
`orbFrozenTime`: wall-clock seconds × the preset speed × the speed above,
the same product the web library uses. Paused holds the frame on screen.

Accessibility: the orb is the one element, a toggle named "Call" with the
value On or Off. VoiceOver's double tap toggles the call.

## Behavior

| Event | Action |
|---|---|
| App opens | Connect to `/ws/client`, send `hello` with `wants_voice: false`. The watch takes the voice session only for a call. Register for APNs. No permission prompt: the first screen is the orb alone. |
| `ready` | Record `device_id`, `voice_holder` and the running jobs. The first `ready` builds the gate from `ready.gate`. A call already started claims the voice session here. |
| Tap, no call | Haptic `.start`. `voice.claim` unless this watch holds the voice session; before the first `ready` (or with the server unreachable) the claim waits for `ready` and the gate drops the microphone's frames until it exists. Ask for the microphone once, and on the first call for notification alerts. Then start the audio engine: playAndRecord, voiceChat, microphone open. |
| `voice.granted` in a call | Fetch a token, open Gemini Live. |
| Gate `speechStart` | `activityStart`, then the buffered frames. |
| Gate `audio` | One 20 ms `realtimeInput.audio` chunk. Before `setupComplete` the frames wait (30 s at most). |
| Gate `speechEnd` | `activityEnd`. |
| Gate `bargeIn` | Playback stops at once, inside `gate.bargein_stop_ms`. The reply latch keeps the rest of that reply silent: chunks still in flight do not play. |
| `serverContent.interrupted` | Playback stops; the latch opens. `generationComplete` and `turnComplete` open it too. |
| Input and output transcription | `transcript` to the server, interim and final, as the web sends them. The input text also feeds the gate's turn detector. |
| `tool.result` | `toolResponse` with the given `scheduling`. |
| Any S2C message with `voice`, in a call | `<event>text</event>` turn with `turnComplete`. With no call it is dropped, as on the web. |
| Tap, in a call | Hang up: the gate ends any open turn (`activityEnd`), Live closes (`live.closed` `user`), playback stops, the engine stops, the microphone tap and the audio session are released, `voice.release`. Haptic `.stop`. |
| Live closes by itself | The call ends; `live.closed` carries the reason. |
| `idle_close_seconds` (120 s) with no turn, no playback and no event | The call ends, `live.closed` `idle`. |
| `voice.revoked` | Another device took the voice session: the call ends. |
| `goAway` | New token, same resumption handle, new socket; the call goes on. An open turn restarts with `activityStart`. |
| Server socket drops in a call | The call goes on; C2S messages wait in the outbox (`Outbox.swift`: interim transcripts are not kept, and a full outbox drops the oldest report, never a claim, release or `live.closed`). On the next `ready` the watch claims the voice session again, or ends the call when another device took it after this call held it. |
| `handoff.requested` | Notification "Continue on another device". |
| `approval.requested` | Notification with Approve and Deny. The answer is `approval.answer`. |
| APNs token | `push.register` with platform `apns` and the hex token, on every connection. |

The server's pushes carry `kind`, `approval_id` and `handoff_id` in `data`
(`server/apparatus_server/jobs.py`). A remote approval push shows the
Approve and Deny actions only when the APNs payload also sets
`aps.category` to `apparatus.approval`; the FCM adapter does not set it
yet. Until it does, remote pushes open the app, and the socket delivers
the approval as a local notification with actions.

## The gate

`Sources/Gate` ports the open-mic path of `web/src/gate`: `gate.ts`,
`vad.ts`, `turn.ts`, `bargein.ts`, `words.ts`, and `speaker.ts` as
`NoSpeakerCheck`. The thresholds come from `ready.gate`, the `[gate]`
table of `config/apparatus.toml` that `GET /config/gate` also serves; a
missing or mistyped field keeps its default, as `mergeGate` does. The web's
push-to-talk path, wake word and decision log are not ported.

Parity is proven by the shared vectors, not by reading:
`Tests/GateVectorTests.swift` replays every scenario of
`clients/shared/gate-vectors.json` (written by
`npm --prefix web run gate-vectors` from the web gate) and asserts the same
ordered event list, the same `at` and `t_ms`, and the same end state.

## Wrist down

`UIBackgroundModes` holds `audio` and `remote-notification`. A call keeps an
active playAndRecord session with the engine running, which is what watchOS
needs to keep audio running in the background. Not verified on a device:
whether watchOS keeps the microphone open and the socket alive with the
wrist down for the whole call, whether the key must be `WKBackgroundModes`
instead of `UIBackgroundModes` for a watch-only app, and whether App Store
validation accepts `audio` there. A call that must survive the wrist down
without doubt is a CallKit call (watchOS 9 and later), which this app does
not use.

## Checked without Xcode

There is no Xcode or watchOS SDK in the sandbox that wrote this. With the
Swift 6.4 Linux toolchain:

- The pure parts (`Sources/Gate`, `Sources/Model/OrbRender.swift`,
  `Sources/Audio/ReplyLatch.swift`, `Sources/Net/Outbox.swift`) and the 4
  test files build in a scratch SwiftPM package that symlinks them, with
  the kit's engine for `OrbState`. All 16 tests pass, among them the 13
  vector scenarios (49 events).
- The kit's engine and `OrbGoldenTests` pass: 72 cases, 70,115 values
  within 1e-4. `ThinkingOrb.swift` imports SwiftUI and cannot build on
  Linux.
- `AppModel.swift`, `LiveSession.swift`, `ServerSocket.swift`, `Outbox.swift`,
  `TokenClient.swift`, `JSON.swift` and `Config.swift` typecheck against
  stubs of Combine, WatchKit, `AudioEngine`, `Notifier` and `Keychain`. On
  Linux `URLSessionConfiguration.waitsForConnectivity` is read-only, so
  that one line was left out of the check.

## Unverified

1. The app and the test target compile under Xcode with `SWIFT_VERSION 5.9`.
   `AudioEngine.swift`, `ApparatusWatchApp.swift` and the two views use
   AVFoundation, WatchKit, UserNotifications and SwiftUI and never compiled.
2. `AVAudioInputNode.setVoiceProcessingEnabled(true)` on watchOS, and the
   echo cancellation it gives with the speaker playing. The engine goes on
   without it when the call fails.
3. Speaker output under `playAndRecord` plus `voiceChat` on the watch.
4. `TimelineView(.animation(paused:))` holding its last date when paused,
   and the frame cost of the orb on watch hardware.
5. `AccessibilityTraits.isToggle` with VoiceOver on watchOS 10.
6. The test bundle reads `gate-vectors.json` from its resources; the kit's
   golden test reads its JSON from the source tree through `#filePath`,
   which the Simulator allows.
7. XcodeGen links the kit into both the app and the test bundle; Xcode may
   warn about the duplicate static library.
8. The Live endpoint for ephemeral tokens:
   `v1alpha ... BidiGenerateContentConstrained?access_token=`. The
   google-genai SDKs build this URL; confirm against the current Google docs.
9. `app-store-connect` as the `method` in `ExportOptions.plist` needs Xcode
   15.4 or later; older Xcode wants `app-store`.
10. `scheduleBuffer(_:completionCallbackType: .dataPlayedBack)`: that its
    completion fires after the output latency on watch hardware, so the
    gate keeps the barge-in bar until the agent's last audio has played.
    Echo that the canceller lets through right after a gap between reply
    chunks (the network late, the queue empty) still meets no barge-in bar,
    as on the web.
11. The notification alert prompt from `requestAuthorization` while the
    microphone prompt has just closed. An approval that arrives before the
    first call on this watch posts with no alert permission and is not
    shown; it still reaches the other devices.

## CI

`.github/workflows/clients-watchos.yml` runs on `macos-latest`: XcodeGen, a
Simulator build with signing off, the app's tests and the kit's golden test
on the newest watchOS Simulator on the runner, and, when the four secrets
`APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`,
`WATCHOS_PROVISIONING_PROFILE_BASE64` and `APPLE_TEAM_ID` exist, an archive
for `generic/platform=watchOS` exported with `ExportOptions.plist` and
uploaded as the artifact `watchos`. Build and test logs upload on failure.

The provisioning profile must be an App Store distribution profile for
`systems.reagent.apparatus.watch` with the Push Notifications capability.
