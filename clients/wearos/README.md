# apparatus for Wear OS

The watch client. The screen is the thinking orb on black and nothing else: no text, no
buttons. A tap anywhere is a phone call: tap to start talking, tap again to hang up.
Notifications carry handoff and approval. Kotlin, Compose for Wear OS, one module.

## What it does

1. Opens one WebSocket to the session server: `/ws/client?auth=<auth>&device=watch`, and sends
   `hello` with `wants_voice: false`. The watch takes the voice session only for a call.
2. Takes the gate thresholds from `ready.gate` (the `[gate]` table of `config/apparatus.toml`,
   the same table as `GET /config/gate`) and the idle limit from `ready.live.idle_close_seconds`.
3. **Tap, not in a call**: a click haptic, the foreground service starts, the audio session goes
   to voice-call mode, and the watch sends `voice.claim`. Before the first `ready` the call
   starts all the same and the claim goes out at `ready`. On `voice.granted` it fetches a token
   from `POST /token`, opens the Gemini Live socket, sends the `setup` message verbatim, and opens
   the microphone for the whole call (full duplex).
4. The voice gate runs on every 20 ms frame, in open-microphone mode. It sends `activityStart`,
   the audio of the turn and `activityEnd` (the Live setup has automatic activity detection off,
   so the gate owns the turn). Coughs and clicks are dropped. Speech over the agent that clears
   the barge-in bar (300 ms and 2 words) stops playback at once and mutes the rest of that reply.
5. Plays the model's 24 kHz PCM16 on the call path. Relays tool calls, transcripts, usage and
   resumption handles per `agent-kit/docs/PROTOCOL.md`. On `goAway` it opens a replacement
   session and switches when no turn is open.
6. **Tap, in a call**: hang up. The open turn ends with `activityEnd`, playback stops, the Live
   session closes (`live.closed`), the microphone and the audio session are released, the watch
   sends `voice.release`, the service stops, and a double-click haptic plays.
7. The call also ends by itself, with the same haptic, when the Live session closes (error,
   server drop, a failed token), after `idle_close_seconds` with nobody speaking, on
   `voice.revoked`, or when another app takes the audio for good (a phone call). After a
   server socket drop the next `ready` decides: the watch claims the voice session again when
   nobody holds it, and ends the call when another device took it after this call held it.
   A hang-up while `voice.claim` is in flight sends `voice.release` after it, and a late
   `voice.granted` with no call open is released at once.
8. Shows `handoff.requested` as a notification: "Continue on another device". Shows
   `approval.requested` as a notification with Approve and Deny. The answer goes over the open
   socket, or waits in the encrypted store for the next `ready`.

The watch holds no agent state. There is no settings screen.

## First launch

Nothing covers the orb. Android 12+ draws a splash on every cold start from the activity theme;
`res/values-v31/themes.xml` makes it plain black with an empty icon (`drawable/splash_blank.xml`),
so the orb is the first thing drawn. The app asks for no permission at launch. The first call tap
asks for `RECORD_AUDIO`, and for `POST_NOTIFICATIONS` (Wear OS 4 and later) with it; the call
starts once the microphone is granted. Android lets no app remove these system dialogs. They
appear once, as the result of the tap. Approval notifications posted before the first call are
not shown on Wear OS 4 and later; they still reach the other devices.

## The orb

The orb is a Kotlin port of the `thinking-orbs` engine (npm 0.3.2, MIT, by Jakub Antalik;
upstream `github.com/Jakubantalik/Libraries.dev`, `packages/thinking-orbs` at `0d44887`), the
same library the web client draws. `ui/orb/engine` is pure geometry; `ui/orb/ThinkingOrb.kt`
draws the 64 px preset scaled to 80% of the screen's shorter side, in the library's dark theme
(light dots on black). The frame clock is Compose's, like the web's `requestAnimationFrame`.

The mapping is `web/src/orb-state.ts`, ported as `ui/OrbRender.kt`:

| Voice state | Animation |
|---|---|
| idle | `breathing` |
| server socket down | `connecting` |
| the gate has a turn open | `listening` |
| the agent speaks | `composing` |
| a job runs | `working` |
| no call and no job | `breathing` at speed 0.5 |
| another device holds the voice session | paused, opacity 0.35 |
| Remove animations, or the ambient (always-on) display | the library's static frame (t = 0.6) |

Accessibility: the screen is one element, a switch named "Agent" whose state is On or Off.
TalkBack's double tap toggles it.

## Build

Requirements: JDK 17 or newer, Android SDK with `platforms;android-34` and `build-tools;34.0.0`, Gradle 8.9 or newer on `PATH`.

```sh
cd clients/wearos
gradle test
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

## Tests

`gradle test` runs JVM unit tests; `.github/workflows/clients-wearos.yml` runs them before the build.

| Test | Proves |
|---|---|
| `OrbGoldenTest` | The engine port equals the library: all 18 resolved presets and all 72 golden frames of upstream `spec/orbs-golden.json` (copied with its `LICENSE` into `app/src/test/resources/thinking-orbs/`), every value in draw order within 1e-4. |
| `GateVectorsTest` | The gate port equals `web/src/gate`: every scenario of `clients/shared/gate-vectors.json` gives the identical ordered event list, counts and end state. Gradle passes the file's path (`apparatus.gateVectors`); it is read in place, not copied. Regenerate it with `npm --prefix web run gate-vectors`. |
| `OrbRenderTest` | The state to animation mapping, case for case with `web/test/orb-state.test.ts`. |
| `WithHandleTest` | The `setup` message goes out verbatim, with a resumption handle inside `setup.sessionResumption`. |
| `ReplyLatchTest` | A barge-in mutes the rest of the reply until it ends. |
| `TurnTest` | The completeness heuristic reads text as `web/src/gate/turn.ts` does, a trailing U+0085 included: its regexes end on `\z`, because a Java `$` also matches before a final line terminator. |

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
| `app/src/main/java/.../MainActivity.kt` | Permissions on the first call tap, the ambient observer, reduced motion, the tap |
| `app/src/main/res/values-v31/themes.xml` | The black, icon-free splash of Android 12+ |
| `.../AppViewModel.kt` | The call: start, hang up, the gate, the Live session, the relays |
| `.../ui/App.kt` | The screen: the orb and one toggle over the whole screen |
| `.../ui/OrbRender.kt` | The voice state to the orb's animation, speed, pause and dim |
| `.../ui/orb/ThinkingOrb.kt` | Draws engine frames on a Compose `Canvas` with the frame clock |
| `.../ui/orb/engine/*.kt` | The thinking-orbs engine: projection, noise, the 9 modes, presets |
| `.../gate/*.kt` | The voice gate: VAD, minimum duration, barge-in bar, turn detector |
| `.../net/ServerSocket.kt` | `/ws/client` with backoff and a 20 s ping |
| `.../net/TokenClient.kt` | `POST /token` |
| `.../net/LiveSession.kt` | Gemini Live socket: the pre-setup queue, builders and parser |
| `.../net/Protocol.kt` | C2S and S2C names, message builders |
| `.../audio/AudioIn.kt` | `AudioRecord`, VOICE_COMMUNICATION, AEC and NS when available |
| `.../audio/AudioOut.kt` | `AudioTrack` on the call path, instant stop, the speaking clock (until the track has presented its last frame) |
| `.../audio/CallAudio.kt` | Voice-call audio focus and `MODE_IN_COMMUNICATION` |
| `.../audio/ReplyLatch.kt` | Mutes the rest of a reply after a barge-in |
| `.../Haptics.kt` | Call start and call end haptics |
| `.../secure/SecureStore.kt` | `EncryptedSharedPreferences` |
| `.../push/PushService.kt` | `FirebaseMessagingService` |
| `.../push/Notifier.kt` | Notification channels and the 3 notification kinds |
| `.../push/ApprovalReceiver.kt` | Approve and Deny actions |
| `.../SessionHub.kt` | The open socket and the push token for components without an activity |
| `.../VoiceService.kt` | Foreground service, microphone type, for the whole call |
| `app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt` | The MIT notice of the ported engine, shipped in the APK |

## Screen off

A call keeps running with the wrist down. `VoiceService` is a foreground service of type
`microphone`, started from the tap while the app is in front, which Android 14 requires; it
holds the process and the microphone until hang-up. With the ambient display on, the app stays
on screen in low power and the orb shows its static frame. Swiping the app away ends the call.

## Not verified on a device

No watch and no emulator ran this build. Unverified:

- Audio end to end: capture, playback, `MODE_IN_COMMUNICATION` routing to the watch speaker, and
  whether the platform echo canceller keeps the agent's voice out of the gate on a given watch.
- The call with the screen off: that the microphone foreground service and the open sockets
  survive Doze on a real watch for a long call.
- The haptics (`EFFECT_CLICK`, `EFFECT_DOUBLE_CLICK`) and the ambient callbacks.
- The black splash on a Wear OS 4 or 5 cold start. The APK carries the `v31` theme with
  `windowSplashScreenAnimatedIcon` set to the empty drawable (`aapt2 dump resources`); no watch
  showed it.
- `AudioTrack.getTimestamp` on a watch: that its frame position counts the output latency and
  restarts after `flush`, so "the agent speaks" ends when its last frame has played. When it
  does not restart, the wall-clock estimate decides, as before. Echo right after a gap between
  reply chunks (the queue empty) still meets no barge-in bar, as on the web.
- TalkBack reading "Call, switch, On/Off" and toggling on double tap.
- Frame cost of the orb on watch hardware.
- The Live endpoint path and `access_token` query parameter. Confirm against the Gemini Live API
  docs before the paid tier. The constant is in `LiveSession.kt`.
- FCM delivery and the data keys above, which the server sets.
