# Media

Stills and GIFs for the repository README. `tools/media` makes them.

Captures use demo mode (`APPARATUS_DEMO=1`: scripted jobs) with scripted voice; real jobs take longer.
Every frame is the real web client, except the watch: that is the Wear OS app, rendered with Paparazzi.
The Screen shows a bare X session, not the VM image's XFCE desktop.
Every capture shows the default look, Borders off, except `borders-split`.

## Regenerate

```sh
npm --prefix tools/media install
npm --prefix web run build
node tools/media/capture.mjs --out docs/media
rm docs/media/audit*.png docs/media/borders-on*.png   # made by the day scene, not published
```

`tools/media/README.md` lists the scenes, the options and what each needs.

## Hero

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="hero-dark.png">
  <img alt="The desktop app with a job's receipt open and the orb listening, a phone with an approval card, and the Wear OS app" src="hero-light.png">
</picture>

`hero-light.png`, `hero-dark.png`: the desktop app, a phone and the watch on one day.

## GIFs

<img alt="A spoken request becomes a job with a table and report.csv" src="voice-to-job.gif">

`voice-to-job.gif`: speak; the agent starts a job and says the result.

<table>
  <tr>
    <td width="50%"><img alt="Approve on an email the agent drafted; the job ends" src="approval.gif"></td>
    <td width="50%"><img alt="The same request on a phone" src="phone.gif"></td>
  </tr>
  <tr>
    <td><code>approval.gif</code>: the agent asks before it acts.</td>
    <td><code>phone.gif</code>: the same thread on a phone.</td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="orb-dark.gif"><img alt="The orb: idle, listening, working, speaking" src="orb.gif"></picture></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="watch-dark.gif"><img alt="The Wear OS app through a voice session" src="watch.gif"></picture></td>
  </tr>
  <tr>
    <td><code>orb.gif</code>, <code>orb-dark.gif</code>: the orb is the agent's on-switch and shows its state.</td>
    <td><code>watch.gif</code>, <code>watch-dark.gif</code>: the watch shows the orb and nothing else.</td>
  </tr>
  <tr>
    <td width="50%"><img alt="Light, Dark and Borders under Appearance" src="appearance.gif"></td>
    <td width="50%"><img alt="Control of your computer's screen, a typed command, Release" src="screen-control.gif"></td>
  </tr>
  <tr>
    <td><code>appearance.gif</code>: Light, Dark, Borders.</td>
    <td><code>screen-control.gif</code>: take Control of your computer, then Release it.</td>
  </tr>
</table>

## Stills

Each still has a `-dark` variant, except `watch-strip.png`.

| | | |
|---|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="thread-dark.png"><img width="280" alt="Thread" src="thread.png"></picture><br>Thread | <picture><source media="(prefers-color-scheme: dark)" srcset="jobs-dark.png"><img width="280" alt="Jobs" src="jobs.png"></picture><br>Jobs, the pane on a receipt | <picture><source media="(prefers-color-scheme: dark)" srcset="approval-card-dark.png"><img width="280" alt="Approval" src="approval-card.png"></picture><br>Approval |
| <picture><source media="(prefers-color-scheme: dark)" srcset="screen-dark.png"><img width="280" alt="Screen" src="screen.png"></picture><br>Screen | <picture><source media="(prefers-color-scheme: dark)" srcset="palette-dark.png"><img width="280" alt="Command palette" src="palette.png"></picture><br>Command palette | <picture><source media="(prefers-color-scheme: dark)" srcset="handoff-card-dark.png"><img width="280" alt="Handoff" src="handoff-card.png"></picture><br>Handoff |
| <picture><source media="(prefers-color-scheme: dark)" srcset="credits-dark.png"><img width="280" alt="Credits" src="credits.png"></picture><br>Credits | <picture><source media="(prefers-color-scheme: dark)" srcset="borders-split-dark.png"><img width="280" alt="Borders on, Borders off" src="borders-split.png"></picture><br>Borders on at left, off at right | <picture><source media="(prefers-color-scheme: dark)" srcset="tablet-dark.png"><img width="280" alt="Tablet" src="tablet.png"></picture><br>Tablet |
| <picture><source media="(prefers-color-scheme: dark)" srcset="phone-thread-dark.png"><img width="280" alt="Phone" src="phone-thread.png"></picture><br>Phone | <picture><source media="(prefers-color-scheme: dark)" srcset="phone-listening-dark.png"><img width="280" alt="Phone, listening" src="phone-listening.png"></picture><br>Phone, listening | <picture><source media="(prefers-color-scheme: dark)" srcset="phone-sheet-dark.png"><img width="280" alt="Phone, receipt" src="phone-sheet.png"></picture><br>Phone, receipt |

<img alt="Wear OS: off, listening, speaking, working" src="watch-strip.png">

`watch-strip.png`: the Wear OS app, off, listening, speaking, working.
