# Media

Stills and GIFs for the repository README. `tools/media` makes them.

Captures use demo mode (`APPARATUS_DEMO=1`: scripted jobs) with scripted voice; real jobs take minutes.
Every frame is the real web client, except the watch: that is the Wear OS app, rendered with Paparazzi.
The Screen shows a bare X session, not the VM image's XFCE desktop.
Every capture shows the default look, Borders off, except `borders-split`.

## Regenerate

```sh
npm install                     # at the root: every workspace
npm run build -w apps/web
MEDIA_ZONE=Etc/GMT-7 node tools/media/capture.mjs --out docs/media   # one clock for every scene
rm docs/media/audit*.png docs/media/borders-on*.png   # made by the day scene, not published
```

`tools/media/README.md` lists the scenes, the options and what each needs.

## Hero

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="hero-dark.png">
  <img alt="The web app at desktop width, listening, with what the model heard above the orb; the web app at phone size on a job's receipt; the Wear OS app listening" src="hero-light.png">
</picture>

`hero-light.png`, `hero-dark.png`: the web app at desktop width, listening, the web app at phone size on a job's receipt, and the watch listening. Each device is a separate real capture.

## GIFs

The GIFs play at 50 fps (2 cs a frame), each frame its own moment of the app, captured on the page's own clock; the watch GIFs are Paparazzi renders at 50 fps.
`screen-control.gif` shows the live VM stream: each of its frames is taken once the page's video matches the VM's screen.

<picture><source media="(prefers-color-scheme: dark)" srcset="voice-to-job-dark.gif"><img alt="A spoken request becomes a job with a table and report.csv" src="voice-to-job.gif"></picture>

`voice-to-job.gif`, `voice-to-job-dark.gif`: speak; the agent starts a job and says the result.

<table>
  <tr>
    <td width="50%"><img alt="Approve on an email the agent drafted; the job ends" src="approval.gif"></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="phone-dark.gif"><img alt="The same request on a phone" src="phone.gif"></picture></td>
  </tr>
  <tr>
    <td><code>approval.gif</code>: the agent asks before it acts.</td>
    <td><code>phone.gif</code>, <code>phone-dark.gif</code>: the same request on a phone.</td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="orb-dark.gif"><img alt="The orb: off, listening with the heard line above it, speaking, working, speaking, off" src="orb.gif"></picture></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="watch-dark.gif"><img alt="The Wear OS app's orb states in sequence, rendered with Paparazzi" src="watch.gif"></picture></td>
  </tr>
  <tr>
    <td><code>orb.gif</code>, <code>orb-dark.gif</code>: the orb is the agent's on-switch. Above it, what the model heard.</td>
    <td><code>watch.gif</code>, <code>watch-dark.gif</code>: the watch shows the orb and nothing else.</td>
  </tr>
  <tr>
    <td width="50%"><img alt="Light, Dark and Borders under Appearance" src="appearance.gif"></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="screen-control-dark.gif"><img alt="Control of your computer's screen, a typed command, Release" src="screen-control.gif"></picture></td>
  </tr>
  <tr>
    <td><code>appearance.gif</code>: Light, Dark, Borders.</td>
    <td><code>screen-control.gif</code>, <code>screen-control-dark.gif</code>: take Control of your computer, then Release it.</td>
  </tr>
</table>

## Stills

Each still has a `-dark` variant, except `watch-strip.png`.

| | | |
|---|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="thread-dark.png"><img width="280" alt="Thread" src="thread.png"></picture><br>Thread | <picture><source media="(prefers-color-scheme: dark)" srcset="jobs-dark.png"><img width="280" alt="Jobs" src="jobs.png"></picture><br>Jobs, the pane on a receipt | <picture><source media="(prefers-color-scheme: dark)" srcset="approval-card-dark.png"><img width="280" alt="Approval" src="approval-card.png"></picture><br>Approval |
| <picture><source media="(prefers-color-scheme: dark)" srcset="screen-dark.png"><img width="280" alt="Screen" src="screen.png"></picture><br>Screen | <picture><source media="(prefers-color-scheme: dark)" srcset="palette-dark.png"><img width="280" alt="Command palette" src="palette.png"></picture><br>Command palette | <picture><source media="(prefers-color-scheme: dark)" srcset="handoff-card-dark.png"><img width="280" alt="Handoff" src="handoff-card.png"></picture><br>Handoff |
| <picture><source media="(prefers-color-scheme: dark)" srcset="credits-dark.png"><img width="280" alt="Credits" src="credits.png"></picture><br>Credits | <picture><source media="(prefers-color-scheme: dark)" srcset="borders-split-dark.png"><img width="280" alt="Borders on, Borders off" src="borders-split.png"></picture><br>Borders on at left, off (the default) at right | <picture><source media="(prefers-color-scheme: dark)" srcset="tablet-dark.png"><img width="280" alt="Tablet" src="tablet.png"></picture><br>Tablet |
| <picture><source media="(prefers-color-scheme: dark)" srcset="phone-thread-dark.png"><img width="280" alt="Phone" src="phone-thread.png"></picture><br>Phone | <picture><source media="(prefers-color-scheme: dark)" srcset="phone-listening-dark.png"><img width="280" alt="Phone, listening" src="phone-listening.png"></picture><br>Phone, listening | <picture><source media="(prefers-color-scheme: dark)" srcset="phone-sheet-dark.png"><img width="280" alt="Phone, receipt" src="phone-sheet.png"></picture><br>Phone, receipt |

<img alt="Wear OS: off, listening, speaking, working" src="watch-strip.png">

`watch-strip.png`: the Wear OS app, off, listening, speaking, working.

## Phone

The phone tour: one request from the empty thread to the end, at 390 × 844 points.

| | | |
|---|---|---|
| <img width="240" alt="Phone: the empty thread, the orb off" src="phone/phone-1-empty.png"><br>Empty | <img width="240" alt="Phone: listening, what the model heard above the orb" src="phone/phone-2-listening.png"><br>Listening | <img width="240" alt="Phone: the request in the thread, the job running with its steps" src="phone/phone-3-working.png"><br>Working |
| <img width="240" alt="Phone: the job done, its table and report.csv in the thread" src="phone/phone-4-done.png"><br>Done | <img width="240" alt="Phone: the pane as a bottom sheet on the job's receipt" src="phone/phone-5-receipt.png"><br>Receipt | <img width="240" alt="Phone: the pane on the job's steps" src="phone/phone-6-steps.png"><br>Steps |
| <img width="240" alt="Phone: the pane on the job's artifacts, report.csv" src="phone/phone-7-artifacts.png"><br>Artifacts | <img width="240" alt="Phone: the agent asks to send an email, with Approve and Deny" src="phone/phone-8-approval.png"><br>Approval | <img width="240" alt="Phone: the email approved, the agent says it will send it" src="phone/phone-9-approved.png"><br>Approved |
| <img width="240" alt="Phone: a handoff, the reports site sign-in, with Done and Cancel" src="phone/phone-10-handoff.png"><br>Handoff | <img width="240" alt="Phone: the Screen tab under Control, with Release" src="phone/phone-11-screen.png"><br>Screen | <img width="240" alt="Phone: Jobs grouped as Needs you, Running and Done" src="phone/phone-12-jobs.png"><br>Jobs |
| <img width="240" alt="Phone: the rail as a sheet over the thread" src="phone/phone-13-menu.png"><br>Rail | <img width="240" alt="Phone: Settings with Appearance, Borders and Notifications" src="phone/phone-14-settings.png"><br>Settings | <img width="240" alt="Phone: Credits, the balance and each charge" src="phone/phone-15-credits.png"><br>Credits |
| <img width="240" alt="Phone: a follow-up answered with revenue by region, the orb speaking" src="phone/phone-16-speaking.png"><br>Speaking | <img width="240" alt="Phone: the thread with Borders on" src="phone/phone-17-borders-on.png"><br>Borders on | |

Each phone screen has a `-dark` twin, for example `phone/phone-1-empty-dark.png`.
