# Style

apparatus uses one voice for every text.
The rules keep the text short, clear and easy to translate.

## Rules

1. Write one instruction in one sentence.
2. Keep an instruction under 20 words.
3. Keep a descriptive sentence under 25 words.
4. Use the active voice.
5. Use the simple present tense.
6. Use one word for one idea. Do not use synonyms.
7. Do not use contractions.
8. Do not use marketing words.
9. Start an instruction with the verb.
10. Use a list for a sequence of steps.
11. Use a table for a set of values.
12. Write numbers as digits.

## User interface

`docs/DESIGN.md` is the visual law for the web app: tokens, type, layout, components, states and keys.
This file governs the words on screen; DESIGN.md governs everything else.
Every visible string is content or one of the labels below. Nothing else ships.
Content is what was said, a job request, a `say` line, `show` output, details, a reason, a number, a time or a name.
The user interface holds no explanatory text.
State the thing; never reassure about it.
Do not add a sentence, a hint, a caption, a helper line, a placeholder, a tagline or empty-state text.
Do not make a label longer than it needs to be. An icon button shows its icon only.
Do not add a tooltip or a toast. Nothing on screen pops up to announce a state.
The app is voice only. No text field, no typed input.
The only labels are these words:

| Kind | Labels |
|---|---|
| Nav nouns | Thread, Jobs, Screen, Audit, Credits |
| Action verbs | Approve, Deny, Done, Cancel, Control, Release, Top up |
| Group labels | Needs you, Running, Recent, Done, Failed, Today, Earlier |
| Result chips | Approved, Denied, Cancelled, Timed out |
| Pane tabs | Output, Screen, Receipt, Steps, Artifacts |
| Settings | Appearance, Light, Dark, System, Borders, Notifications, Status bar |

Accessible names are not visible and are not labels. They stay short: Talk (the orb), Settings, Rail, Pane, Close, Output, Screen, End, Kind, Commands.

State shows through the orb, color, progress, a status glyph and a one-word chip.
It never shows through a sentence, a badge with a phrase, or a toast.

### Status glyphs

A glyph is a 16 px icon with no word beside it.

| State | Glyph | Color |
|---|---|---|
| Running | the 20 px orb, `working` | ink |
| Queued | `Clock` | muted |
| Paused | `Pause` | muted |
| Needs you, approval | `Hand` | amber (`status-wait`) |
| Needs you, handoff | `MousePointerClick` | amber (`status-wait`) |
| Done | `CircleCheck` | green (`status-ok`) |
| Failed | `CircleX` | red (`destructive`) |
| Cancelled | `CircleMinus` | muted |

A running job also shows a 16 px progress ring; an ended job shows its elapsed time.

### Chips

A chip holds one word, or two for "Timed out". An answered approval shows Approved or Denied.
An ended handoff shows Done, Cancelled or Timed out. A count chip holds digits only, capped at "99+".

### Subtitles and meta

A subtitle is one muted line under a title. It holds the thing itself: the progress text, the `say` line,
the approval `action` or the handoff `reason`. A subtitle that adds a state and a time joins them with a
middle dot: "Needs you · 2m". Use the label word for the state; "Needs input" is a synonym and does not ship.
Meta is a number or a short time: "now", "12m", "3h", "2d", "4 Oct", "1:24", "3 steps".

## Spoken text

The `say` field is spoken aloud. At most 2 sentences. No lists, no markdown, no emoji.
Detail goes to the screen with `show`. The voice calls the VM "your computer".

## Terms

| Use | Do not use |
|---|---|
| job | task (in user-facing text; "task" is the VM-side unit in code) |
| handoff | takeover, intervention, manual mode |
| approval | confirmation, permission prompt |
| credits | tokens, points, balance units |
| the orb | the button, the mic indicator |
| the feed | the chat, the timeline, the log |
| Thread (the view that shows the feed) | Chat, Conversation, Home (as a view title) |
| the pane | the panel, the canvas, the viewer |
| your computer | the VM, the machine, the sandbox (in speech) |
| say | speak, announce |
| show | display, render |
| interrupt (the user talks over the agent; the gate's barge-in stops playback) | stop, mute |
| Done, Cancel | Finish, Abort, Close |
| Approve, Deny | Allow, Reject, OK |
| Control, Release | Take over, Give back, Remote |
| Screen, Output | Live view, Stream, Desktop (as a button title) |
| voice session | call, stream |
| saved tool | script, macro, skill |
| memory note | fact, memory item |
