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
- `MEDIA_ZONE` (an IANA zone such as `Etc/GMT-7`) pins the clock, so scenes run apart show the same morning.
- Stills that show a job at work hold that job's later events at the browser (`JobHold`); GIFs
  space job events 0.5 to 0.6 s apart. Nothing is added, dropped or rewritten.
- The GIFs' agent speaks at 3.4 words a second; the stills' at 3.
- Some stills pick a window height (desktop 800 to 960 px, phone 780 to 920 px) that puts a
  row's top edge at the top of the thread, so no card is cut there (`fitHeightToRow`).

## What it makes

| Scene | Output |
|---|---|
| `day` | One day on one server, three devices at once. `hero-light.png`, `hero-dark.png`: three devices in a row with gutters, nothing over another: the desktop window (1024 px, the pane closed) listening, with what the model heard above the orb; the phone on a Receipt (`phone-sheet`); the Wear OS app listening, in a round case. `thread`: a job at work, the approval last, the orb listening. `borders-on`: the same frame with Borders on (the opt-in; every other capture shows the default, borderless); `borders-split`: `borders-on` and `thread` side by side with a gutter. `tablet`, `phone-thread`: the approval last above a dimmed orb. `phone-listening`: the phone holding the voice session over a job at work. `phone-sheet`: the pane as a sheet on a Receipt. The 3 phone stills share one window height. `jobs`: the Jobs view, the pane on a Receipt. `approval-card`, `handoff-card`: the cards that need you, close, on one canvas. `palette`: the command palette over the window. `audit`, `credits` |
| `voice-to-job` | `voice-to-job.gif`: the thread column at 2x, 880 px wide, 50 fps on page time; the finished thread as the poster, a fade through the page colour, then a tap, a spoken request, a job, its steps, the result |
| `approval` | `approval.gif`: the thread column at 2x, 880 px wide, 50 fps on page time; Approve on a job that needs you (hover, then the press held 0.6 s); the job runs and ends; the end fades through the page colour into the poster |
| `orb` | `orb.gif`, `orb-dark.gif`: a square centred on the phone composer's orb at 3x, 50 fps on page time: off, listening with the heard line above it, speaking, working, speaking, off; both the same frame count |
| `phone` | `phone.gif`: the voice-to-job story at 390 px in a phone bezel, 50 fps on page time like the desktop GIFs |
| `appearance` | `appearance.gif`: the whole desktop window, Settings open from the rail footer, 50 fps on page time: Light, Dark, Borders on and off; the pointer glides to each choice and each repaint shows as the app draws it |
| `screen` | `screen.png`: the whole desktop window, the thread with the job that wrote report.csv, the pane on the VM screen under Control, the table printed |
| `screen-control` | `screen-control.gif`: the pane at 1.5x, about 956 px wide, 50 fps on page time; Control, the X pointer glides in (at least 2 px a frame) and clicks, a typed command lands in the VM, Release. Each frame waits until the page's video matches the X screen (`lib/vmsync.mjs`) |
| `watch-strip` | `watch-strip.png`: the Wear OS screen: off, listening, speaking, working |
| `watch` | `watch.gif`, `watch-dark.gif`: the Wear OS screen through a voice session, rendered at 50 fps, on the page colour through an antialiased round mask |
| `phone-tour` (opt-in) | A morning on the phone, which holds the voice session throughout: `phone-<n>-<screen>.png` and `-dark`, 390 x 844 at 3x, 17 screens: `1-empty`, `2-listening`, `3-working`, `4-done`, `5-receipt`, `6-steps`, `7-artifacts`, `8-approval`, `9-approved`, `10-handoff`, `11-screen`, `12-jobs`, `13-menu`, `14-settings`, `15-credits`, `16-speaking`, `17-borders-on`. `sheet-light.png`, `sheet-dark.png`: the 17 screens at 360 px, 6 to a row, on the page colour. Each theme runs the whole morning on its own stack, with a real X desktop for the Screen; the client runs with the shell seam set to platform `android`, as the Capacitor shell sets it. The window is fixed at 844 px, so the lines of `9-approved` (the user asks to hear when the email is sent) and `16-speaking` (a two-line answer) are sized so the end of the thread starts on a whole row. The terminal hides its text cursor; `10-handoff` streams the sign-in page the job asks about; `11-screen` is shot after `15-credits` and the comparison's result |

Each `day` still and `screen.png` also has a `-dark` variant. `--list` prints the table.
An opt-in scene runs only when it is named: `node tools/media/capture.mjs phone-tour --out /tmp/phone-tour`.

## Run it

```sh
npm --prefix tools/media install
npm --prefix web run build                      # or pass --build
MEDIA_ZONE=Etc/GMT-7 node tools/media/capture.mjs --out /tmp/media   # every scene, one clock
node tools/media/capture.mjs voice-to-job screen --out /tmp/media --themes light
```

Options: `--work <dir>` keeps logs and frames in a folder you name, `--keep-frames` keeps
the PNG frames of each GIF, `--web-dist <dir>` serves another build of the client.

It needs `uv`, `ffmpeg`, ImageMagick and Chromium at `/opt/pw-browsers/chromium`
(`MEDIA_CHROMIUM` overrides it). `screen`, `screen-control` and `phone-tour` also need `Xvfb`, `xterm`,
`xdotool` and fontconfig; they convert the client's JetBrains Mono to TTF with `fonttools`
through `uv`. `watch`, `watch-strip` and `day` also need Gradle and the
Android SDK (`ANDROID_HOME`, default `/opt/android-sdk`).

A scene that cannot make its asset fails and makes nothing. The run ends with one line per
asset or failure, and fails when a GIF passes 8 MB or the output folder passes 40 MB.

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
5. A scene with `vtime` (a frame rate) records on page time (`lib/vtime.mjs`): Playwright's
   page clock is installed before the app loads, paused when the recording starts, and stepped
   1000 / fps ms a frame. Each step runs the page's timers, moves every CSS and Web Animation
   by the same step, runs the animation frame callbacks once at the step's time, and waits for
   the paint; `lib/record.mjs` then takes one screenshot. The microphone's frames, the agent's
   audio clock, the session server's messages and the stand-in's lines all follow page time, so
   a slow capture neither drops frames nor compresses the story. Without `vtime`,
   `lib/record.mjs` records at a constant wall-clock rate. `lib/gif.mjs` encodes with
   a two-pass palette (`stats_mode=full`, so the green done check keeps its colour) and checks
   that every frame carries the rate's delay (2 cs at 50 fps; browsers play 0 or 1 cs as 10). The
   desktop GIFs crop to the thread column (`lib/column.mjs`) in a window tall enough that the
   thread never scrolls. `voice-to-job.gif` and `phone.gif` open on the second after the
   story's end (recorded, so the loop's end runs straight on into it), then fade through the
   page colour into the empty thread, so a full thread never snaps to an empty one;
   `approval.gif` closes its loop through the page colour the same way. The fades take
   17 + 1 + 17 frames, 0.7 s. Every GIF is 50 fps on page time (the watch's at 50 fps on
   Paparazzi's clock); `screen-control.gif` also waits for the VM stream at every frame (6).
6. `lib/screen.mjs` runs a real X desktop at 1280 x 720 (960 x 540 for the GIF) with no window
   manager: a warm root colour, an xclock and an xterm in JetBrains Mono, side by side, opened in `~/reports` after the agent wrote
   `report.csv`. agentd streams it with x11grab over WebRTC and takes input through xdotool.
   Nothing is typed by the harness: the user types under Control through the page
   (`lib/screenflow.mjs`), and the scene fails unless decoded frames arrive and the X server
   shows the keys landed. The stream's video runs in wall time and the page on page time, so
   `screen-control` sends each pointer position and each key on its own frame, and before each
   screenshot `lib/vmsync.mjs` waits until the input has landed on X, the X screen holds still,
   and the video (drawn to a canvas at the X size) matches a grab of X with the cursor drawn as
   x11grab draws it: at most 3 pixels off by more than 48 in luma round the pointer and 40
   elsewhere (the last run: none anywhere), and the bare root window in its own colour (so a grey decoder frame is waited
   out). A long-running python-xlib helper takes the grabs and turns X's key autorepeat off (a
   key held 40 ms of page time stays down for as long as its frames take in wall time). The
   xclock has no second hand and is stopped (SIGSTOP) while the frames are taken. agentd
   streams at 10 fps here (`AGENTD_STREAM_FPS`); the GIF's rate does not depend on it.
7. `lib/wear.mjs` copies `clients/wearos` to the work folder, adds Paparazzi and
   `wear/MediaWatchTest.kt`, and renders the app's own `Screen` over time at the test's
   `FPS` (50), and once with another device holding the voice session.
8. `lib/compose.mjs` lays out real captures on a backdrop for the hero, and `phone.gif` gets
   the same bezel. Neither draws inside a capture. `lib/frames.mjs` edits GIF time: holds,
   cuts and fades of whole real frames.

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
- A finished job's say line shows twice in a row: in the job card and as the agent's spoken
  line under it. The agent speaks the say line unchanged, as `voice.py` asks, and the feed
  keeps both cards.
- Under Control a shifted key reaches the VM unshifted: `*` arrived as `8`. The typed
  command uses no shifted key. The likely cause: agentd runs one `xdotool` process per
  input event from the data channel and does not wait for one before the next
  (`stream.py`, `on_input`), so close key events can land out of order. On the phone,
  keys 40 ms apart also arrived as control characters (a letter as Ctrl+letter, which
  printed bare prompts and then froze the terminal on Ctrl+S); `phone-tour` types one key
  every 180 ms, and they land as typed.
- On a phone a handoff opens the locked Screen sheet at once (DESIGN.md 4), so the handoff
  card itself is never in view there; `phone-10-handoff` is that sheet, with the reason,
  Done and Cancel. The demo's handoff opens no page on the VM, so `phone-tour` opens a
  sign-in page (`lib/signin.mjs`) at the demo's address, `reports.larkspur.example`, in a
  Chromium app window on the X desktop before the request, and closes it after Done.
- Closing the phone's Screen sheet after a handoff and opening it again from the top bar
  starts a second stream that at times shows no frames, and keys sent under Control at times
  reach the VM many seconds late or not at all (agentd runs one `xdotool` process per input
  event, so a queue of pointer moves holds back the keys behind it). The handoff's own
  stream, kept open after Done, kept faint blocks of the closed sign-in page. VP8 frames
  right after the encoder starts over (a bitrate change) are coarse: a grey cast, blocks of
  the frame before. `phone-tour` shoots `11-screen` on a fresh stream from the top bar, sends
  few pointer moves, waits up to 20 s for the keys, types once (it checks the X screen before
  typing again), and compares the video in each Screen still with an X grab, taking the
  still again when they differ.
- When agentd's VP8 encoder (aiortc, in Python) cannot keep up with `AGENTD_STREAM_FPS`, the
  stream falls behind without bound: at 960 x 540 on a loaded 4-core machine, 20 and 30 fps
  showed the X screen 10 to 15 s late and later each second, and 60 fps never showed a pointer
  move or a new window at all within 15 s, while the page kept decoding frames; 10 fps held at
  about 0.4 s. `X11FrameSource` reads every frame x11grab writes, in order, so a slow encoder
  works through an ever older backlog; dropping to the newest frame would bound the delay.
  `screen-control` streams at 10 fps.
- At high stream rates the page's video turns grey for about half a second after a large
  change on the VM screen (the table printing, `clear`), likely aiortc's VP8 rate control (it
  starts at 500 kbps) spending too few bits on colour. `screen-control` waits it out before
  each frame. It sends a key's down and up two frames apart and waits for each down to land,
  so a down and its up do not race (see the shifted-key item above).
