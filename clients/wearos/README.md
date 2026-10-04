# apparatus for Wear OS

The watch client. Push to talk, one orb, a short feed, notifications for handoff and approval.
Kotlin, Compose for Wear OS, one module.

## What it does

1. Opens one WebSocket to the session server: `/ws/client?auth=<auth>&device=watch`.
2. Sends `hello` and `voice.claim`. On `voice.granted` it fetches a token from `POST /token`.
3. Opens the Gemini Live socket with that token and sends `setup` verbatim.
4. Press Talk: `activityStart`, then 16 kHz PCM16 frames every 20 ms. Release: `activityEnd`.
5. Plays 24 kHz PCM16 from the model. Stop pauses and flushes the track at once.
6. Relays tool calls, transcripts, usage and resumption handles per `agent-kit/docs/PROTOCOL.md`.
7. Shows `handoff.requested` as a notification: "Continue on another device". A watch has no handoff view.
8. Shows `approval.requested` as a notification with Approve and Deny. The answer goes over the open socket, or waits in the encrypted store for the next `ready`.

The watch holds no agent state. There is no settings screen.

## Build

Requirements: JDK 17 or newer, Android SDK with `platforms;android-34` and `build-tools;34.0.0`, Gradle 8.9 or newer on `PATH`.

```sh
cd clients/wearos
gradle assembleDebug -PAPPARATUS_SERVER_ORIGIN=http://10.0.2.2:8080
```

The APK is at `app/build/outputs/apk/debug/app-debug.apk`.

| Setting | Where | Default |
|---|---|---|
| Server origin | Gradle property `APPARATUS_SERVER_ORIGIN`, compiled into `BuildConfig.SERVER_ORIGIN` | `http://10.0.2.2:8080` (the emulator's host) |
| Auth value | `EncryptedSharedPreferences`, key `auth` | `dev` |
| Release signing | Environment: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | unsigned |

Cleartext HTTP is allowed only when the origin starts with `http://`.

The Gradle wrapper is not committed. Run `gradle wrapper --gradle-version 8.9` once to create it locally; `.gitignore` keeps it out of the repo.

## Push

Push needs `app/google-services.json` from the Firebase console for package `systems.reagent.apparatus.wear`. Without the file the build still succeeds and the app runs without push.

The server sends FCM messages with `notification {title, body}` and a string `data` map. The watch reads `data.type` (or `data.kind`):

| `data.type` | Other keys | Shown as |
|---|---|---|
| `handoff.requested` | `reason` | "Continue on another device" |
| `handoff.ended` | | Removes the handoff notification |
| `approval.requested` | `approval_id`, `action`, `details` | Action and details with Approve and Deny |
| `approval.ended` | `approval_id` | Removes the approval notification |
| `job.done` | `say` | The `say` text |

An unknown type shows the title and body.

## Files

| Path | Role |
|---|---|
| `app/src/main/java/.../MainActivity.kt` | Permissions, content, keep screen on during a turn |
| `.../AppViewModel.kt` | State machine idle, listening, speaking, working; the feed; the relay |
| `.../ui/App.kt` | Orb, Talk, Stop, feed |
| `.../net/ServerSocket.kt` | `/ws/client` with backoff and a 20 s ping |
| `.../net/TokenClient.kt` | `POST /token` |
| `.../net/LiveSession.kt` | Gemini Live socket: builders and parser |
| `.../net/Protocol.kt` | C2S and S2C names, message builders |
| `.../audio/AudioIn.kt` | `AudioRecord`, VOICE_COMMUNICATION, AEC and NS when available |
| `.../audio/AudioOut.kt` | `AudioTrack` streaming, instant stop |
| `.../secure/SecureStore.kt` | `EncryptedSharedPreferences` |
| `.../push/PushService.kt` | `FirebaseMessagingService` |
| `.../push/Notifier.kt` | Notification channels and the 3 notification kinds |
| `.../push/ApprovalReceiver.kt` | Approve and Deny actions |
| `.../SessionHub.kt` | The open socket and the push token for components without an activity |
| `.../VoiceService.kt` | Foreground service, microphone type, while a turn runs |

## Not verified on a device

- The Live endpoint path and `access_token` query parameter. Confirm against the Gemini Live API docs before the paid tier. The constant is in `LiveSession.kt`.
- Echo cancellation on the watch speaker. The app enables the platform AEC; its effect depends on the watch.
- FCM delivery and the data keys above, which the server sets.
