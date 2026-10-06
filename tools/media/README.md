# tools/media

This tool makes the README stills and GIFs. Every frame is the real web client, served by
the session server, with a real agentd. The Tauri and Capacitor shells run the same client.

Captures use demo mode (`APPARATUS_DEMO=1`, scripted jobs) and a scripted stand-in for the Gemini Live socket.

Capture settings that differ from a plain local run:

- The day belongs to `maya.ortiz` (dev auth takes the token as the user id), so the avatar reads "MO".
- The desktop shots load the client with the shell seam set to platform `desktop`, as the
  Tauri shell's `bridge.js` does, so the device reads "Desktop". The client has no device names.
- The browser and the VM clock run in a fixed-offset zone where it is mid-morning (`ZONE` in `lib/util.mjs`).
- Overlay scrollbars are hidden, as `--hide-scrollbars` hides the native ones.
- Every capture shows the client's default look, Borders off, except `borders-on` and `borders-split`.
- Stills that show a job at work hold that job's later events at the browser (`JobHold`); GIFs
  space job events 0.5 to 0.6 s apart. Nothing is added, dropped or rewritten.
- The GIFs' agent speaks at 3.4 words a second; the stills' at 3.
- Some stills pick a window height (desktop 800 to 960 px, phone 780 to 920 px) that puts a
  row's top edge at the top of the thread, so no card is cut there (`fitHeightToRow`).

## What it makes

| Scene | Output |
|---|---|
| `day` | One day on one server, three devices at once. `hero-light.png`, `hero-dark.png`: the desktop listening with the pane on a Receipt, the phone on the approval card, and the Wear OS orb (working, paused and dimmed: the desktop holds the voice session) on one backdrop. `thread`: a job at work, the approval last, the orb listening. `borders-on`: the same frame with Borders on (the opt-in; every other capture shows the default, borderless); `borders-split`: Borders on at left, off at right, one frame. `tablet`, `phone-thread`: the approval last above a dimmed orb. `phone-listening`: the phone holding the voice session. `phone-sheet`: the pane as a sheet on a Receipt. `jobs`: the Jobs view, the pane on a Receipt. `approval-card`, `handoff-card`: the cards that need you, close. `palette`: the command palette over the window. `audit`, `credits` |
| `voice-to-job` | `voice-to-job.gif`: the thread column; the finished thread as the poster, then a tap, a spoken request, a job, its steps, the result |
| `approval` | `approval.gif`: the thread column; Approve on a job that needs you; the job runs and ends |
| `orb` | `orb.gif`, `orb-dark.gif`: the orb close: idle, listening, speaking, working, speaking, idle |
| `phone` | `phone.gif`: the voice-to-job story at 390 px in a phone bezel |
| `appearance` | `appearance.gif`: Light, Dark, Borders off and on, in Settings on the tablet layout |
| `screen` | `screen.png`: the pane on the VM screen under Control, the table printed |
| `screen-control` | `screen-control.gif`: Control, a click and a typed command land in the VM, Release |
| `watch-strip` | `watch-strip.png`: the Wear OS screen: no call, listening, speaking, working |
| `watch` | `watch.gif`, `watch-dark.gif`: the Wear OS screen through a call |

Each `day` still and `screen.png` also has a `-dark` variant. `--list` prints the table.

## Run it

```sh
npm --prefix tools/media install
npm --prefix web run build                      # or pass --build
node tools/media/capture.mjs --out /tmp/media   # every scene
node tools/media/capture.mjs voice-to-job screen --out /tmp/media --themes light
```

Options: `--work <dir>` keeps logs and frames in a folder you name, `--keep-frames` keeps
the PNG frames of each GIF, `--web-dist <dir>` serves another build of the client.

It needs `uv`, `ffmpeg`, ImageMagick and Chromium at `/opt/pw-browsers/chromium`
(`MEDIA_CHROMIUM` overrides it). `screen` and `screen-control` also need `Xvfb`, `xterm`,
`xdotool` and fontconfig; they convert the client's JetBrains Mono to TTF with `fonttools`
through `uv`. `watch`, `watch-strip` and `day` also need Gradle and the
Android SDK (`ANDROID_HOME`, default `/opt/android-sdk`).

A scene that cannot make its asset fails and makes nothing. The run ends with one line per
asset or failure, and fails when a GIF passes 4 MB or the output folder passes 30 MB.

## How it works

1. `lib/stack.mjs` starts the session server in demo mode and one agentd, each on its own
   port, socket and a fresh home. It waits for `/health` and stops both by process group.
2. `lib/browser.mjs` opens Chromium with a fake microphone. The scene's WAV (`lib/audio.mjs`)
   plays from its start each time the page opens the microphone. Its sound is speech-shaped,
   so the client's own gate opens and closes the turn.
3. `lib/live.mjs` answers the client's Live socket inside the harness. It sends only messages
   Live sends: `setupComplete`, `serverContent` (input and output transcription, 24 kHz audio,
   `generationComplete`, `turnComplete`), `usageMetadata` and `toolCall`. A request is the
   agent's short line, a finished output transcription, then the `start_job` call in the same
   turn, then `turnComplete` once the client has answered the call. The client relays each
   call to the session server.
4. `lib/day.mjs` holds the spoken lines. A tap on the orb turns the agent on; each line is one
   switch-on. The demo model (`server/apparatus_server/demo.py`) picks a story from the request
   and runs it on agentd: its own steps, a CSV under `~/reports`, its own say line and table.
   The agent speaks a job's say line unchanged, as `voice.py` asks.
5. `lib/record.mjs` records at a constant rate into a fresh folder; `lib/gif.mjs` encodes with
   a two-pass palette (`stats_mode=full`, so the green done check keeps its colour). The
   desktop GIFs crop to the thread column (`lib/column.mjs`) in a window tall enough that the
   thread never scrolls. `voice-to-job.gif` and `phone.gif` open on their last frame, so the
   loop has no cut; `approval.gif` closes its loop through the page colour.
6. `lib/screen.mjs` runs a real X desktop at 1280 x 720 with no window manager: a warm root
   colour and one xterm in JetBrains Mono, opened in `~/reports` after the agent wrote
   `report.csv`. agentd streams it with x11grab over WebRTC and takes input through xdotool.
   Nothing is typed by the harness: the user types under Control through the page
   (`lib/screenflow.mjs`), and the scene fails unless decoded frames arrive and the X server
   shows the keys landed.
7. `lib/wear.mjs` copies `clients/wearos` to the work folder, adds Paparazzi and
   `wear/MediaWatchTest.kt`, and renders the app's own `Screen` over time, and once with
   another device holding the voice session.
8. `lib/compose.mjs` lays out real captures on a backdrop for the hero, and `phone.gif` gets
   the same bezel. Neither draws inside a capture.

## Known product defects the captures show or work around

- A fresh client dims and pauses its orb until the first tap. The server drops
  `voice_holder` from `ready` when nobody holds the voice session (`msg()` drops `None`), and
  `VoiceController.syncHolder` stores the missing field as a holder, so `otherHoldsVoice`
  reads true. The GIFs that open on the idle orb turn the agent on and off once before they
  record (`primeSwitch`), the state of any returning user.
- When Live sends no finished output transcription before a tool call, the voice holder's
  thread shows the agent's short line twice: `push` in `feed/reducer.ts` closes the open
  transcript on the job card, and `turnComplete` then adds the line again as a new card. The
  stand-in sends the finished marker, so the captures show the line once.
- A python step's feed row is `python: ` and the code's first line (`step_summary` in
  `server/apparatus_server/jobs.py`); the demo's reads `python: # Weekly orders`.
- Under Control a shifted key reaches the VM unshifted: `*` arrived as `8`. The typed
  command uses no shifted key.
