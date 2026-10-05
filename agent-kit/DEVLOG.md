# DEVLOG.md — the live devlog

The plain history of this project. A person who knows nothing about the
code reads this file and knows what happened, in order, with no jargon.
Append only. Never rewrite an old entry — a wrong entry gets a
correction entry, not an edit.

Write every entry in the voice of `TONE.md`.

## Entry shape

Every entry has the same shape:

```
## YYYY-MM-DD — <one line: what happened>

<What we did. What worked. What broke. What we learned.
3–10 short sentences. Plain words. Past tense for what happened,
present tense for how things now stand.>

Evidence: <commit / tag / gate run / screenshot>
```

## When to write

- Every WEEKLY.md cycle writes one entry at step 5 (before merge).
- A failed or abandoned attempt gets an entry too. The devlog records
  what happened, not what succeeded. A week with no shipped feature
  still gets its entry.
- Out-of-band work (security patch, gate repair, big triage) gets one.
- SETUP.md writes the first entry: "Installed the agent kit."

## What does not go here

- Code detail that belongs in commit messages.
- Promises about the future — that is ROADMAP.md.
- State claims — that is STATUS.md. The devlog is the story; STATUS is
  the snapshot.

---

<!-- Entries below, newest first. -->

## 2026-10-05 — The orb became the agent's on-switch, centred, with no disc

The author asked for one tap to turn the agent on and off on every screen, like the
watch call. I replaced the orb's tap-and-hold rules with a pure toggle module. The
controller now claims, opens Live and the microphone on "on", and hangs up on "off",
including `voice.release`. A Live session that closes by itself now turns the switch off;
before, the microphone stayed open and the next speech reopened Live. I also fixed a race:
a switch turned off while `getUserMedia` was pending left the late stream open. The orb now
sits centred in the composer with the heard line above it, and it has no disc: black dots
on light, white dots on dark. The 20 px orbs used `theme="auto"`, which falls back to the
OS theme, so Light on a dark OS drew white dots; every orb now reads the app theme. Headless Chromium with a fake
microphone checked the switch, the corners of the hit region and a live theme switch. No
real microphone or Gemini key ran it.

Evidence: `npm --prefix web run verify` 181 tests pass; `verify/verify.sh` OK (Xcode and Android gates skipped); Wear OS `gradle test` 20 tests pass per variant.

## 2026-10-05 — A Borders switch takes every line and every panel off the screen

The author asked for a toggle that removes borders and dividers and makes everything one background.
Borders is now a switch under Appearance and a row in the command palette, stored per device.
Off sets one attribute on the page; one block of colour tokens then turns every line transparent and every surface into the page colour.
Lines keep their width, so nothing moves when the switch flips.
Nine hard-coded line colours needed their own rule, among them the amber bar on a pending approval and the red edge on a failed job.
Those states still show through the amber or red glyph the card already had.
Buttons, chips, the orb, progress bars and selected rows keep their fill; popovers and sheets keep their shadow.
Nobody has looked at the off mode on a screen yet: the checks are a build, unit tests and a test that reads the stylesheet.

Evidence: `npm --prefix web run verify` and `verify/verify.sh` (results in the report of this change); `web/test/borders.test.ts`.

## 2026-10-05 — The watches became the thinking orb alone, and a tap is a phone call

The author asked for the watch screen to be the thinking orb and nothing else: no text, no buttons.
The author also asked for a tap, not a hold: a call through the watch, like a phone call.
We removed the feed, Talk, Stop, the plain circle and the press-and-hold code from both watch apps.
A tap now starts a call: the microphone stays open, the voice gate runs on the watch, and the agent speaks from the speaker.
A second tap hangs up. Speaking over the agent stops its audio through the gate's barge-in rule.
The orb is the same engine as the web's: a vendored Swift port on watchOS and a Kotlin port on Wear OS, both checked against the library's 72 golden frames.
Both gate ports replay 12 scenarios that the web gate wrote to `clients/shared/gate-vectors.json`.
No watch, simulator or emulator ran either app here, so the audio, the haptics and the wrist-down call are untested.

Evidence: `verify/verify.sh` run on 2026-10-05 (result in the report of this change); `clients/watchos/README.md` and `clients/wearos/README.md` list what was checked.

## 2026-10-05 — The screen clients became voice only, with the orb as the one control

The author asked for less on screen: no typing, no input modes, no long labels, no reassurance.
I removed the text field, the send button, Talk, Stop, the mode picker and the Input setting.
The composer now holds the orb and the line the model heard, and nothing else.
A tap on the orb claims, interrupts, closes or opens the voice session; a hold of 350 ms is a forced turn.
That keeps the spec's manual path: a talk and a stop that always work when the gate blocks real speech.
I found one gap: after Stop, the rest of the model's reply arrived and played again. A reply latch now keeps it silent.
The All filters, the Audit header row and the palette headings went with the copy sweep.
No microphone, finger or keyboard has run the new gesture; only its pure rules are tested.

Evidence: `npm --prefix web run verify` green, 164 tests, 0 fail; `verify/verify.sh` OK on 2026-10-05 with the Xcode and Android gates skipped; a headless Chromium check held Space 600 ms and the orb ring showed.

## 2026-10-05 — The web app was rebuilt to a design spec drawn from 5 products

The author corrected me: the sketches were direction only, so the 2026-10-04 layout had to go.
The author named 5 references (Google Antigravity, Amazon Quick, Hermes Desktop, Codex with Paseo,
Claude Cowork) and gave 4 screenshots, of Quick, Hermes, Paseo and Cowork. Research agents wrote one
report per product into `docs/DESIGN-RESEARCH.md`. A judge compared 3 directions, and
Conversation-first won with parts of Manager-first and Workspace-first. The result is
`docs/DESIGN.md`, Ink on Paper: one thread, the orb in a composer that also types, a rail that
counts what needs you, warm paper and one ink accent. 5 owners built it in parallel and 1
integrator joined the parts. The shadcn CLI broke 12 primitives with `import { cn } from "cn"`, and
3 providers were missing at wiring time, so stubs stood in until their owners landed. In both
screenshot rounds the seeded agent line was absent from the 1440 px light shot; I did not find the
cause. No microphone, no Gemini key and no real screen has run the new app.

Evidence: `npm --prefix web test` 154 pass, 0 fail; `uv run pytest -q server/tests` 63 passed; 54 + 62 screenshots judged against DESIGN.md; `verify/verify.sh` green on 2026-10-05.

## 2026-10-04 — The refuters found three holes in the new screen control, and we closed them

After the React client, the orb and the VM screen widget landed, 15 refuter agents attacked
5 security claims. 3 claims fell. The input gate was one flag per VM, so a second device of the
same user could type while another held control. Control lived in agentd's memory across a
reconnect, so a release during a link outage left every computer call refused forever. And a
computer call that waited for the desktop lock was never re-checked, so a screenshot could land
after a handoff began. I fixed all three with tests: the gate is per stream and the server names
the controlling stream; the server syncs control and open handoffs on every VM connect; the
gates run again after the lock and right before the capture, and the server refuses computer
during a handoff on its own. I also detached tool execution from agentd's message pump, which
would have deadlocked a real handoff. The suites now hold 106 Python and 110 Node tests. One
hole stays open and is on the roadmap: a kernel can still reach the X socket by hand.

Evidence: commit "fix: per-stream input gate, control sync, capture gate"; `verify/verify.sh` green.

## 2026-10-04 — The React client, the orb, the VM screen and the stream protocol

I rebuilt the web client on React 19, Vite, Tailwind CSS 4 and shadcn/ui, in the layout
from the sketches: on a desktop a job list, one large pane and a column of cards with the
orb at the bottom right; on a phone the card stack; on a watch the orb alone. The orb is
a `thinking-orbs` canvas; the voice state picks its animation. The pane now has a Screen
button: the VM streams its desktop over WebRTC, and Control gives the user the mouse and
the keyboard until Release. The agent's computer tool refuses while the user holds
control. Code-only jobs keep running. The handoff view is gone; a handoff opens the same
screen with Done and Cancel. The stream runs on aiortc inside agentd with `ffmpeg
x11grab`; the server relays signaling to the one device that owns the stream and mints
TURN credentials. `signal` now carries `stream_id` instead of `handoff_id` on all 3 links.
Three things broke on the way. The server mounted the dist root at `/assets`, so every
Vite bundle 404ed until the mount moved to `dist/assets`. The native shells copied
`app.js` by name, a file that no longer exists; they now copy the whole dist tree. The
`bridge.js` had to become a classic IIFE, because a module script runs after the app
boots. One thing is wrong and not fixed: `test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result`
failed in 3 of 15 full runs (`wait_done` returns before the `job.done` broadcast lands).
Nothing has run in a browser or on a real VM: the stream is proven in loopback only.

Evidence: `uv run pytest -q` 98 passed in 12 runs and 1 failed in 3 runs; `npm --prefix web run verify` green with 110 tests; `verify/verify.sh` green on 2026-10-04.


## 2026-10-04 — Correction: the Wear OS app did build here

The entry below says Wear OS builds wait for CI. That was wrong by the end of the day. A
subagent installed the Android SDK in the sandbox and `gradle assembleDebug` produced the
debug APK after one Kotlin type fix. The release build and a device run are still untested.
Push payloads now carry both the short `kind` and the matching message `type`, because the
two watch apps keyed on different names.

Evidence: commit "fix(wearos): give the server socket an explicit type"; `verify/verify.sh` green.

## 2026-10-04 — Installed the agent kit and built the version 1 skeleton

I started from an empty repository and the design spec. apparatus is a voice agent: the
user talks to a Gemini Live model on any device, and a second Gemini model does the work
on the user's own cloud desktop VM. I built the wire protocol first, then the VM daemon
(agentd), then the session server, then the web client, then native shells for desktop,
phones and watches. The server never lets the model see a key, and every tool result
reaches the model marked as data. 144 automated tests pass: 70 in Python with real
subprocess kernels and a real in-process agentd under the server, 74 in Node for the
voice gate and the Live wire. Nothing has talked to Gemini yet: this sandbox has no key
and no microphone. The native shells compiled where the sandbox allowed it: the Tauri
desktop app on Linux and a debug Android APK. iOS, macOS, Windows, watchOS and Wear OS
builds wait for CI runners with their toolchains. Two things broke on the way: two
protocol message names shared a required-field table and silently overwrote each other
(fixed with a per-link table and a drift test), and a credits test tripped the token
budget before the credit check (the test was wrong). The queue holds 6 items; the top is
a 10-minute Live session on the paid tier.

Evidence: `verify/verify.sh` green at the install commit; `agent-kit/STATUS.md`.
