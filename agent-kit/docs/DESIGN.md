# DESIGN.md — the apparatus web app

The binding visual and interaction spec for `web/src`. Stack: React 19, Vite 8, Tailwind CSS 4, shadcn/ui (new-york, zinc base), lucide-react, `thinking-orbs`. The Tauri and Capacitor shells show this same app. The two native watch apps are not this app; section 11 gives their screen and their one gesture.

The product rules stay: no explanatory text, taglines, helper text or toasts; state shows through the orb, color, progress and content; copy is short; secrets never appear; no setting changes an endpoint. Every visible string is content or one of the one-word labels in `docs/STYLE.md`, which governs every word on screen. The app is voice only: nothing on screen takes typed input.

Conversation-first won the judging; it took the Jobs view, the Receipt / Steps / Artifacts inspector and the status bar from Manager-first, and the control ring, the fixed status slot and the theme provider from Workspace-first.

## Decisions

| Decision | Choice | Why | Source product |
|---|---|---|---|
| Home surface | One thread with the voice composer docked under it | All four references center a thread over a bottom composer | Quick, Hermes, Paseo, Claude Desktop |
| Oversight | A 248 px rail with nav rows and Needs you / Running / Recent job rows; a Jobs view with filter chips and inline actions | Antigravity 2.0 lost its inbox; blocked work needs a queue with buttons | Hermes (groups, dots), Cowork (chips, in-card buttons), Paseo (order) |
| Needs input | Inline approval and handoff cards with buttons, counted in the rail, Alt+J jumps there | What needs you is in the thread you read | Cowork, Antigravity |
| Verification | Job card = activity slab + say + show + artifact chips; inspector tabs Receipt / Steps / Artifacts | "Verify with artifacts, not logs" as calm rows | Antigravity, Quick |
| Voice presence | The orb in the composer (48 / 56 px), the empty state at 128 px, the 20 px preset as the only spinner | The orb is the state | Hermes, the sketches |
| Composer | One elevated card: the orb at the left and, beside it, what the model heard of the current user turn; nothing else | The box shows what the model thinks the user said, like Claude's voice mode; no model or endpoint picker | Claude Desktop, Quick |
| Input | Voice only. No text field, no send button, no typed path anywhere | The author: "there is no typing needed"; a field invites a second, worse way in | The author |
| Duplex | Full duplex is the only mode: the microphone is open while the Live session is open. No input modes, no mode picker, no Input setting | The agent is full duplex voice, so the two input modes were one mode with a switch nobody needs; the author asked why the open-microphone mode existed | The author |
| Voice control | The orb is the only voice control. Tap: claim, interrupt, close or open. Hold (>= 350 ms): a forced turn until release. No Talk button, no Stop button | "The thinking orb should be the method of interaction." The hold and the tap-to-interrupt keep the spec's manual path: a talk and a stop that always work, because a gate filter can block real speech | The author, `docs/DESIGN-SPEC.md` (Manual path) |
| Screen | The VM in the pane with a 2 px ring that says who holds the desktop; a PiP when the pane is closed | Inverts Antigravity's border on an external window | Antigravity, Paseo |
| Status bar | 24 px desktop strip: connection, voice holder, control holder, credits | Telemetry at a glance, hideable | Hermes |
| Palette | Warm paper neutrals (hue 60–85), one ink-blue accent (hue 264), amber / green / red for state only | Calm; Antigravity's identity is an editor preset | Claude Desktop, Quick, Paseo |
| Type | Inter Variable 14 px UI / 15 px prose; JetBrains Mono Variable 13 px | Antigravity's type is "really, really small" | Quick, Paseo |
| Elevation | Borders, not shadows; one shadow on the composer | Flat surfaces read faster | Paseo, Claude Desktop |
| Theme | Light default; dark on the same hue; System follows the OS | Antigravity's light mode was an afterthought | Quick, Paseo |
| Copy | Every visible string is content or a one-word label from the `docs/STYLE.md` list. No placeholders, hints, captions, helper lines, empty-state text or toasts; icon buttons carry icons only; status is a glyph, a ring, a bar or a one-word chip | The author: "remove explanatory microcopy; no little reassurances; it's obvious what the buttons do" | The author, Cowork |
| Filters | The Jobs chips are Needs you, Running, Done; the Audit chips are the kinds the server returned. No chip selected shows everything, so no chip says All | "All" is a label the list does not need | The author |
| Keyboard | Space held is the orb's hold, Esc interrupts, Cmd/Ctrl+K palette, Cmd/Ctrl+1–5 views, Alt+J | Keyboard-first like every reference | Antigravity, Codex, Hermes |
| Watch screen | The thinking orb on black and nothing else: no text, no feed, no buttons, no icons, no status line | The author: "make the watch orb only, no text … JUST THE THINKING ORB. NO BUTTONS." A watch face has no room for a thread; the voice carries the content and the orb carries the state | The author |
| Watch gesture | A tap anywhere toggles a call, like a phone call: tap to start, tap to hang up. No hold, no long-press, no second gesture | The author: "its tap to start the conversation, no need to hold. its like a phone call through the watch." It replaces the spec's push-to-talk default on watches (`docs/DESIGN-SPEC.md`, Voice gate on the client). During a call the microphone stays open, so a hold has nothing to add | The author |
| Watch gate | The voice gate runs on the watch, in open-mic mode, with the server's thresholds; parity with the web gate is proven by shared vectors | The spec puts the gate on the device, before audio leaves it ("Voice gate on the client", "Clients are thin"). An open microphone with no gate sends coughs, clicks and the agent's own echo to the model and bills them | `docs/DESIGN-SPEC.md` |

## 1. Thesis and the three moves

The app is one thread. Everything said, every job, approval, handoff, output and credits change is a card in it. The orb sits inside the composer at the bottom and is the only animated object on the screen. The rail on the left counts and lists; it never competes with the thread.

Three moves that beat Google Antigravity:

1. **What needs you is where you are.** An approval is a card with Approve and Deny on it; a handoff is a card with Done and Cancel on it. Both sit in the thread, count in the rail under "Needs you" with an amber hand glyph, and are one keystroke away (Alt+J). The Jobs view lists them first with the same buttons. Antigravity folded its inbox into a sidebar filter and OS toasts; apparatus has no toasts and needs none.
2. **The voice presence is the product.** Antigravity's voice is dictation into a text box. Here there is no text box: the orb is the composer's only control, is the empty state, is the running glyph on every job row, and beside it the composer shows what the model heard.
3. **Calm surfaces at a readable size.** 14 px UI, 15 px prose, warm paper neutrals, one ink accent, hairline borders, one shadow, and a dark mode on the same hue. Antigravity ships editor presets at IDE density; apparatus ships a product palette at reading density.

## 2. App shell

### Regions (desktop, width >= 1024)

```
┌──────────┬────────────────────────────────┬───────────────┐
│ rail 248 │ thread (column max-w 760)      │ pane (closed  │
│          │   ...cards...                  │ by default)   │
│          │ [ composer card with the orb ] │ Output|Screen │
├──────────┴────────────────────────────────┴───────────────┤
│ status bar 24                                              │
└───────────────────────────────────────────────────────────┘
```

**Rail** (`components/rail/Rail.tsx`, replaces `JobSidebar`): `w-[248px] bg-sidebar border-r border-sidebar-border`, built on shadcn `Sidebar collapsible="icon"`. The top 40 px is the drag strip: a 20 px `OrbMini` (`breathing`, paused) as the product mark, "apparatus" in 14 px / 500, a `PanelLeft` icon button. Then five nav rows, `h-8 px-2 rounded-[6px] text-sm` with a 16 px icon: **Thread** (`MessageSquare`), **Jobs** (`ListChecks`, trailing count chip of Needs you + Running), **Screen** (`Monitor`, trailing 6 px dot: `--primary` while this device holds control, `--status-wait` during a handoff, `--muted-foreground` while a stream is open), **Audit** (`ScrollText`), **Credits** (`Coins`, trailing balance in `text-xs tabular-nums`, `--status-wait` at `low`, `--destructive` at `out`). The selected row is `bg-sidebar-accent text-sidebar-accent-foreground`, no border (Quick's lavender pill). Below, three groups with a 12 px uppercase label at `tracking-[0.08em] text-muted-foreground` (Hermes's micro-labels): **NEEDS YOU**, **RUNNING**, **RECENT**, each listing job rows (section 5); an empty group does not render. The footer is a 36 px row: a 24 px initials avatar in `--primary`, the device name in 13 px, a `Settings2` icon button that opens the settings popover (section 7).

**Thread** (`components/thread/Thread.tsx`): `flex-1 min-w-0`. A 40 px header strip carries `data-tauri-drag-region`, the rail toggle at the left and the pane toggle (`PanelRight`) at the right. A `ScrollArea` holds a centered column `max-w-[760px] px-6` with cards at `gap-4`, 60 px of air above the first card, and the composer docked at the bottom of the same column with `pb-3`.

**Pane** (`components/pane/Inspector.tsx`): `min-w-[360px] max-w-[640px]`, default 42 % of the window, in a shadcn `ResizablePanelGroup` with the thread; width persists under `apparatus.pane.width`. Header 40 px: a `ToggleGroup type="single"` with **Output** and **Screen**, and an `X` icon button. Closed by default; opens on a job selection (Output), on Screen in the rail, or on a handoff (Screen, locked until the handoff ends).

**Status bar** (`components/layout/StatusBar.tsx`, desktop only): `h-6 bg-sidebar border-t text-[11px] text-muted-foreground`, middot-separated items, each an icon plus a noun: a 6 px dot (`--status-ok` connected, `--status-wait` reconnecting, `--destructive` down); `Mic` + the voice holder's device name; `MousePointer2` + the controlling device's name while `control.active`; `Coins` + the balance. Right-click hides it; the state persists under `apparatus.statusbar`.

### Tablet (768–1023)

The rail collapses to a 56 px icon rail: five icons with their chips and dots, no job rows. The pane opens as a `Sheet side="right"` at `w-[60vw]`. No status bar.

### Phone (< 768)

The thread is the screen. A 48 px top bar holds `PanelLeft` (the rail as `Sheet side="left"` at `w-[280px]` with the job groups) and `Monitor` (the Screen). The composer is docked with `pb-[max(0.75rem,env(safe-area-inset-bottom))]`. The pane is a `Sheet side="bottom" className="h-full"`; a handoff locks it (`showCloseButton={false}`) until Done or Cancel. The Jobs view replaces the thread when chosen from the rail sheet.

### Window chrome (Tauri)

`decorations: false`, `titleBarStyle: "Overlay"`, `hiddenTitle: true` on macOS; the rail strip and the thread header carry `data-tauri-drag-region`; the rail strip gets `pl-[76px]` under a `.tauri-mac` class on `<html>` that the Tauri bridge sets. Windows and Linux keep native decorations. The Capacitor shells pad with `env(safe-area-inset-*)`.

### Keyboard

| Key | Action |
|---|---|
| Space held for 350 ms or more (anywhere but the VM video and an open overlay) | The orb's hold: a forced turn until release; a shorter Space does nothing |
| Enter or Space on the focused orb | The orb's tap; Space held on it is the hold |
| Esc | Interrupt: stop playback and end any open turn |
| Cmd/Ctrl+K | Command palette |
| Cmd/Ctrl+1 … 5 | Thread, Jobs, Screen, Audit, Credits |
| Cmd/Ctrl+B | Rail |
| Cmd/Ctrl+J | Pane |
| Alt+J | Focus the oldest card that needs you |
| Enter / Backspace on a focused approval or handoff card | Approve / Deny; Done / Cancel |
| Cmd/Ctrl+Shift+C | Control / Release |

### Command palette

shadcn `Command` inside a `Dialog`, Cmd/Ctrl+K. Four groups with no headings, split by a `CommandSeparator`: the five surfaces (Thread, Jobs, Screen, Audit, Credits), every job by request text with its glyph, Control or Release, and Light, Dark, System. One label and a trailing `Kbd` per row; no headings, no descriptions. Voice has no row: the orb, Space and Esc carry it.

## 3. The orb and the voice composer

The orb is `thinking-orbs` and nothing else. It renders as a filled disc `rounded-full bg-orb-disc` (in dark mode plus `ring-1 ring-orb-ring`) with the library pinned to `theme="dark"`, so the dots are always light on a dark disc.

| Place | Box | Transform | Preset |
|---|---|---|---|
| Composer, desktop and tablet | 48 px | `scale-75` | 64 |
| Composer, phone | 56 px | `scale-[.875]` | 64 |
| Empty thread | 128 px, centered | `scale-200` | 64 |
| Job rows, job card headers, turn headers, product mark | 20 px | none, `theme="auto"` | 20 |

State mapping stays in `orb-state.ts`: idle `breathing` (speed 0.5 while the Live session is closed), connecting `connecting`, listening `listening`, speaking `composing`, working `working`. Another device holding voice: paused at `opacity-40`.

The orb is a `<button aria-label="Talk">` with `aria-pressed` = the Live session is open, and the only voice control in the app. No visible text. One gesture, pure in `composer/orb-gesture.ts` (tested in `test/orb-gesture.test.ts`) and bound in `orb/use-orb-control.ts`:

| Input | Action |
|---|---|
| Tap: a press shorter than `HOLD_MS` = 350 ms | First match wins: this device does not hold the voice session → claim it and open the Live session once granted; the agent speaks → interrupt (playback stops within `bargein_stop_ms`, the rest of the reply stays silent, any open turn ends); the Live session is open → close it; else → open it |
| Hold: a press of 350 ms or more | A forced turn for as long as the press lasts: `pressTalk` forces the gate open past every filter and opens the Live session first when it is closed; release ends the turn. A hold never also fires the tap |
| Pointer cancel, lost pointer capture, blur | Release without a tap |
| Enter on the focused orb | Tap |
| Space on the focused orb | Tap when shorter than 350 ms, hold when longer |

While held: `ring-2 ring-primary ring-offset-2 ring-offset-background` on the disc and `scale-[.97]`. Pointer capture keeps the hold through a drag; `touch-none select-none` keep a long press from scrolling or opening a menu. The 128 px empty-thread orb uses the same gesture. There is no Talk button and no Stop button anywhere: the hold is the manual talk, the tap on a speaking agent and Esc are the manual stop (`docs/DESIGN-SPEC.md`, Manual path).

Full duplex is the only mode. The microphone is open while the Live session is open, and the `VoiceController` runs the gate in `InputMode.OPEN_MIC` always. The gate module stays as it is, with its tests; no screen client changes its mode.

### The composer

`components/composer/VoiceComposer.tsx`, the one elevated object: `flex items-center gap-3 rounded-2xl border bg-card shadow-composer p-3 max-w-[760px]`. One row:

- the orb at the left: 48 px on desktop and tablet, 56 px on a phone;
- beside it, what the model heard of the current user turn (the Live input transcription, what the model thinks the user said) as it arrives: `text-[15px] leading-6`, interim text at `opacity-70`, solid once final, at most 2 lines with the newest line in view. It clears when the agent starts its reply, or 600 ms after the final line lands in the thread as the user card.

Nothing at all shows while nobody speaks: no placeholder, no hint, no caption, no button. No text field, no send button, no picker. The latest spoken line is the last agent card in the thread.

## 4. The thread

Cards share the 760 px column at `gap-4`, prose at `text-[15px] leading-[1.55]`. Every card carries `data-kind` and `data-state` for tests.

- **Day divider**: `text-xs uppercase tracking-[0.08em] text-muted-foreground` centered; "Today", else the date (`4 Oct`).
- **Turn header**: the first agent card after a user card gets a row of `OrbMini` (`breathing`; `working` while any job runs), a hairline `flex-1 border-t`, and the finish time in `text-xs tabular-nums text-muted-foreground` (Quick's logo + rule + meta).
- **User speech**: `self-end max-w-[80%] rounded-2xl bg-muted px-4 py-2.5`, the final transcript of a user turn. The turn still being heard shows in the composer, not here; its card lands once final, or once the agent replies (then at `opacity-70` if no final came).
- **Agent speech**: plain prose, no bubble, `self-start max-w-[92%]`, rendered through `markdown.ts`. Interim text at `opacity-70`.
- **Job card**: `w-full rounded-xl border bg-card`. Header `px-4 py-3 flex items-center gap-3`: a `StatusGlyph` in a fixed 20 px leading slot (titles never shift when a spinner replaces an icon), the request in `text-sm font-medium truncate`, and at the right a 16 px `ProgressRing` (stroke 2, `--primary`, `percent`; a 90° arc spinning at 1.2 s when `percent` is null) while running, or the elapsed time in `text-xs tabular-nums` once ended. Body: an **activity slab** `mx-4 mb-3 rounded-lg bg-muted/60 px-3 py-2` with the last 3 `progressHistory` lines as `text-[13px]` rows behind a 14 px `Dot`, the live row behind `OrbMini working` (Quick's activity card); when the job ends it collapses to one row "N steps" with a `ChevronRight` toggle (`Collapsible`). Then the **say** line as prose (`px-4 pb-3`), then the **show** markdown in `max-h-40 overflow-hidden` under `mask-image: linear-gradient(to bottom, black 70%, transparent)` with an `ArrowUpRight` icon button at the top-right that opens the pane. Artifacts are `font-mono text-xs rounded-md bg-muted px-2 py-1` chips with the basename; a click opens the pane at that path. Failed: `border-destructive/40`. Cancelled: `opacity-70`.
- **Fold rule**: a job that has shown nothing yet (no steps, no say, no show, no artifacts) and waits on an open approval or handoff does not get its own card. The approval or handoff card carries the request instead: as the title of an approval card (the action and the details then share the mono block), as a muted 13 px line under a handoff's reason. Once the job has something to show, its card returns and the approval card's title is the `action` again. (`foldsIntoRequest` in `lib/status.ts`.)
- **Approval card**: `rounded-xl border bg-card border-l-2 border-l-status-wait` while pending. Row 1: `Hand` 16 px in `text-status-wait`, the `action` in `text-sm font-medium`. Row 2: `details` in `text-sm text-muted-foreground font-mono break-all` (the literal action, as Antigravity highlights the command). Row 3: **Approve** (primary) and **Deny** (outline), `h-9`, side by side on desktop, stacked full width on phone (Cowork). Answered: the amber bar goes and the buttons become a one-word chip, "Approved" with `Check` in `text-status-ok` or "Denied" with `X`; a denied card is `opacity-70`.
- **Handoff card**: same frame, amber bar while active, `Monitor` icon, the `reason` in `text-sm`, **Done** (primary) and **Cancel** (outline). A click opens the pane in Screen; on a phone the locked sheet opens at once. Ended: a chip "Done", "Cancelled" or "Timed out".
- **Credits line**: no card; one centered `text-xs text-muted-foreground` line with `Coins` and the number, `text-status-wait` at `low`, `text-destructive` at `out`.

Consecutive agent cards within 60 seconds share one turn header. Timestamps hide until hover on desktop (`group-hover:opacity-100`) and stay visible at 12 px on phone for job, approval and handoff cards. `MAX_CARDS` stays 100. The thread scrolls to the end on a new card unless the user scrolled up more than 240 px; then a `ChevronDown` round button with the unseen count floats above the composer.

Empty thread: the 128 px orb at `breathing`, with the composer's gesture, and the composer below it. No greeting, no hint.

## 5. Jobs

`lib/status.ts` (pure, tested in `test/status.test.ts`) maps a job to one bucket in Paseo's order: `needs_you` (status `needs_user`, or an open approval or handoff with this `job_id`) > `failed` > `running` (`running`, `queued`, `paused`) > `done` (`done`, `cancelled`).

**StatusGlyph** (`components/status/StatusGlyph.tsx`), 16 px icons, no words: running `OrbMini working`; queued `Clock` muted; paused `Pause` muted; needs_you with an approval `Hand` in `text-status-wait`; needs_you with a handoff `MousePointerClick` in `text-status-wait`; done `CircleCheck` in `text-status-ok`; failed `CircleX` in `text-destructive`; cancelled `CircleMinus` muted.

**Rail rows**: `h-9 px-2 rounded-[6px] text-sm gap-2`, the glyph in a fixed 16 px slot, the request `truncate`, right meta `text-xs tabular-nums text-muted-foreground` (percent while running, relative time otherwise). Recent keeps 20. Selected row `bg-sidebar-accent`. The Jobs nav chip is `h-5 min-w-5 rounded-full bg-accent text-accent-foreground text-[11px] tabular-nums` (Cowork).

**Jobs view** (`components/views/JobsView.tsx`, Cmd/Ctrl+2; the whole screen on phone and tablet, the thread column on desktop). Header: filter chips as a `ToggleGroup type="single"` of pills, **Needs you 2 · Running 3 · Done 4**, counts in `tabular-nums`; no chip selected shows every job, and a click on the selected chip clears it. Groups in bucket order with a "Today" / "Earlier" sub-divider. A `JobRow` is 56 px: a 28 px circle holding the glyph, the request in `text-sm font-medium` on one line, a muted 13 px subtitle (progress text while running; the `say` line when done; the `action` or `reason` while blocked), the relative time at the right. A blocked row adds a 36 px action row: **Approve** + **Deny**, or **Done** + **Cancel**. Actions are always visible.

**Inspector** (the pane in Output with a job selected): a header with the glyph, the request and the start time; `Tabs` at 13 px: **Receipt** (default for ended jobs: the `say` line, the full `show` markdown, the artifact paths as a mono list; a click copies a path and shows `Check` for 1.5 s), **Steps** (default for running jobs: the full `progressHistory` as activity rows with a 2 px progress bar beneath), **Artifacts** (the paths only). Selecting a job also scrolls the thread to its card with a 2 s `ring-2 ring-ring/40` highlight.

## 6. The VM screen

`components/vm/ScreenFrame.tsx` wraps the input logic of `VmScreen.tsx` unchanged. The frame is `rounded-lg bg-black aspect-video overflow-hidden` with the `<video>` at `object-contain`; a `Skeleton` covers it until `status === "live"`. A ring states who holds the desktop: `ring-2 ring-primary ring-offset-2 ring-offset-background` while this device holds control; `ring-2 ring-status-wait` during a handoff; `ring-1 ring-border` while the agent drives; none without a stream. Above the frame a 36 px header: a 6 px dot (`--status-ok` live, `--status-wait` connecting, `--destructive` failed) and a chip with the holder's device name when somebody holds the desktop. Below it a 44 px bar, right-aligned: **Control** (outline), **Release** (outline) while held; in handoff mode **Done** (primary) and **Cancel** (outline). The cursor over the video is `cursor-none` while input is on.

Picture-in-picture: on desktop, when the pane is closed and a stream is open, a 240 x 135 `rounded-lg border shadow-md` thumbnail floats bottom-right of the thread above the composer with the same ring; a click opens the pane in Screen; a handoff promotes it. The stream lives in one store (`state/screen.tsx`, a context around `useScreen`) so the PiP and the pane share one `MediaStream`. Phone: the Screen sheet is full-screen, landscape allowed, the button bar floating in `bg-background/80 backdrop-blur`; a handoff locks it.

## 7. Audit and credits

**Audit** (Cmd/Ctrl+4) renders in the thread column: a shadcn `Table` with day group rows and no header row; each entry is the time (`font-mono text-xs tabular-nums`), the kind (`Badge variant="secondary"`) and the rest as a truncated mono line; a row click expands the JSON in a `pre` (`Collapsible`). Above it, one mono chip per `kind` value the server returns, as a `ToggleGroup type="single"`; no chip selected shows every entry. The client renders only known keys. On phone the table scrolls horizontally.

**Credits** (Cmd/Ctrl+5): the balance at `text-5xl font-medium tabular-nums`, a 10 px dot beside it (`--status-ok` ok, `--status-wait` low, `--destructive` out), then the history as a two-column list (time, signed delta in mono). **Top up** stays a disabled primary button until a payment path exists.

**Settings** live in the rail footer `Popover` and nowhere else: **Appearance** (Light / Dark / System, a `ToggleGroup`), **Notifications** (a `Switch`), and on the desktop **Status bar** (a `Switch`). There is no input setting: voice is full duplex. `theme/ThemeProvider.tsx` replaces `lib/theme.ts`: it writes `.dark` on `<html>` before first paint and persists the choice under `apparatus.theme`. Nothing addresses an endpoint or a model.

## 8. Visual language

Paper and ink: warm paper neutrals (hue 60–85, chroma 0.004–0.010), one ink-blue accent (hue 264), the orb as the ink drop. Status colors: wait (amber), ok (green), failed (= destructive), run (= primary).

### Tokens (`web/src/index.css`, complete)

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.75rem;

  --background: oklch(0.985 0.004 85);
  --foreground: oklch(0.20 0.010 60);
  --card: oklch(0.995 0.002 85);
  --card-foreground: oklch(0.20 0.010 60);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.20 0.010 60);

  --primary: oklch(0.45 0.180 264);
  --primary-foreground: oklch(0.985 0.004 85);
  --secondary: oklch(0.955 0.006 80);
  --secondary-foreground: oklch(0.25 0.010 60);
  --muted: oklch(0.955 0.006 80);
  --muted-foreground: oklch(0.52 0.015 70);
  --accent: oklch(0.93 0.030 264);
  --accent-foreground: oklch(0.30 0.090 264);
  --destructive: oklch(0.55 0.200 25);

  --border: oklch(0.90 0.008 80);
  --input: oklch(0.90 0.008 80);
  --ring: oklch(0.60 0.140 264);

  --chart-1: oklch(0.45 0.180 264);
  --chart-2: oklch(0.72 0.150 70);
  --chart-3: oklch(0.62 0.150 150);
  --chart-4: oklch(0.55 0.200 25);
  --chart-5: oklch(0.70 0.020 70);

  --sidebar: oklch(0.965 0.005 85);
  --sidebar-foreground: oklch(0.25 0.010 60);
  --sidebar-primary: oklch(0.45 0.180 264);
  --sidebar-primary-foreground: oklch(0.985 0.004 85);
  --sidebar-accent: oklch(0.93 0.030 264);
  --sidebar-accent-foreground: oklch(0.30 0.090 264);
  --sidebar-border: oklch(0.90 0.008 80);
  --sidebar-ring: oklch(0.60 0.140 264);

  /* apparatus */
  --status-wait: oklch(0.72 0.150 70);
  --status-ok: oklch(0.62 0.150 150);
  --status-run: oklch(0.45 0.180 264);
  --orb-disc: oklch(0.20 0.010 60);
  --orb-ring: oklch(0.20 0.010 60 / 0%);
  --composer-shadow: 0 8px 24px -12px oklch(0.20 0.010 60 / 25%);
}

.dark {
  --background: oklch(0.19 0.006 60);
  --foreground: oklch(0.95 0.005 85);
  --card: oklch(0.23 0.006 60);
  --card-foreground: oklch(0.95 0.005 85);
  --popover: oklch(0.25 0.006 60);
  --popover-foreground: oklch(0.95 0.005 85);

  --primary: oklch(0.72 0.130 264);
  --primary-foreground: oklch(0.15 0.030 264);
  --secondary: oklch(0.27 0.006 60);
  --secondary-foreground: oklch(0.95 0.005 85);
  --muted: oklch(0.27 0.006 60);
  --muted-foreground: oklch(0.68 0.012 75);
  --accent: oklch(0.30 0.040 264);
  --accent-foreground: oklch(0.88 0.060 264);
  --destructive: oklch(0.68 0.170 25);

  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 14%);
  --ring: oklch(0.62 0.130 264);

  --chart-1: oklch(0.72 0.130 264);
  --chart-2: oklch(0.78 0.140 75);
  --chart-3: oklch(0.72 0.140 150);
  --chart-4: oklch(0.68 0.170 25);
  --chart-5: oklch(0.62 0.015 70);

  --sidebar: oklch(0.165 0.006 60);
  --sidebar-foreground: oklch(0.92 0.005 85);
  --sidebar-primary: oklch(0.72 0.130 264);
  --sidebar-primary-foreground: oklch(0.15 0.030 264);
  --sidebar-accent: oklch(0.30 0.040 264);
  --sidebar-accent-foreground: oklch(0.88 0.060 264);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.62 0.130 264);

  --status-wait: oklch(0.78 0.140 75);
  --status-ok: oklch(0.72 0.140 150);
  --status-run: oklch(0.72 0.130 264);
  --orb-disc: oklch(0.12 0.006 60);
  --orb-ring: oklch(1 0 0 / 14%);
  --composer-shadow: 0 8px 24px -12px oklch(0 0 0 / 60%);
}

@theme inline {
  /* the shadcn --color-* and --radius-* mappings stay as in index.css today */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
  --color-status-wait: var(--status-wait);
  --color-status-ok: var(--status-ok);
  --color-status-run: var(--status-run);
  --color-orb-disc: var(--orb-disc);
  --color-orb-ring: var(--orb-ring);
  --shadow-composer: var(--composer-shadow);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html,
  body,
  #app {
    height: 100%;
  }
  body {
    @apply bg-background text-foreground font-sans text-sm antialiased;
    font-feature-settings: "cv11", "ss01";
  }
}
```

The `.show-output` markdown rules stay, with headings at `font-medium` instead of `font-semibold`.

### Typography

Packages: `@fontsource-variable/inter` (family "Inter Variable") and `@fontsource-variable/jetbrains-mono` (family "JetBrains Mono Variable"), bundled so the shells work offline. Root font size stays 16 px.

| Role | Family | Size / line | Weight |
|---|---|---|---|
| Prose in the thread, the composer, show markdown | Inter Variable | 15 / 24 | 400 |
| UI labels, rows, buttons, card titles | Inter Variable | 14 / 20 | 400; 500 for titles and labels |
| Subtitles, activity rows | Inter Variable | 13 / 18 | 400 |
| Meta, timestamps, chips (11 in the status bar); group labels uppercase at 0.08em | Inter Variable | 12 / 16 | 400; 500 for group labels |
| Credits balance | Inter Variable | 48 / 52 | 500, tabular |
| Code, paths, details, audit | JetBrains Mono Variable | 13 / 20 | 400 |

Weights 400 and 500 only; 600 nowhere. `tabular-nums` on every number.

### Radius, elevation, density, icons, motion

**Radius**: `--radius: 0.75rem`, so `rounded-sm` 8, `rounded-md` 10, `rounded-lg` 12, `rounded-xl` 16, `rounded-2xl` 16 (Tailwind default). Nav and rail rows `rounded-[6px]`; cards `rounded-xl`; the composer and user bubbles `rounded-2xl`; the orb, dots and chips `rounded-full`.

**Elevation**: borders, not shadows. Surfaces step by one token: `background` → `sidebar` → `card` → `muted`. The composer alone carries `shadow-composer`; popovers, dialogs and the PiP carry `shadow-md`.

**Density**: 4 px grid. Rail rows 36 px, nav rows 32 px, Jobs rows 56 px, card gap 16 px, card padding 16 px, composer padding 12 px, thread gutters 24 px (16 on phone).

**Iconography**: lucide-react, 16 px, `strokeWidth={1.5}`, `currentColor`; 14 px inside activity rows; 20 px in the phone top bar. Colored glyphs are only the status set.

**Motion**: `150ms cubic-bezier(0.2, 0, 0, 1)` for hover and press; card enter `200ms` fade with `translate-y-1`; pane open `250ms`; progress ring and bar `300ms`; the amber bar's removal `200ms`. `prefers-reduced-motion` removes the transitions and pauses the orb. Nothing enters from the edge, glows or bounces.

**Empty states**: thread, the 128 px orb; composer, the orb alone; rail groups, absent; Jobs view, chips with zero counts; Audit, nothing below the chips; Screen, the skeleton; pane, the latest `show`. No sentence anywhere.

## 9. Component inventory

shadcn/ui already present and kept: `button`, `card`, `scroll-area`, `separator`, `sheet`, `sidebar`, `skeleton`, `toggle`, `toggle-group`.

Add with `npx shadcn@latest add command dialog popover badge table resizable collapsible kbd tabs switch`. Do not add `tooltip`, `sonner` or `toast`. `textarea`, `dropdown-menu` and `select` were removed with the text field, the mode picker and the Input and Audit selects.

Dependencies to add: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, plus `react-resizable-panels` and `cmdk` through the CLI.

Custom components, all under `web/src/components`:

- `layout/AppShell.tsx` (rewrite: rail, thread, pane in a `ResizablePanelGroup`; Sheet variants for tablet and phone), `layout/Titlebar.tsx`, `layout/StatusBar.tsx`, `layout/CommandPalette.tsx`.
- `rail/Rail.tsx`, `rail/RailNav.tsx`, `rail/RailJobRow.tsx`, `rail/RailFooter.tsx` (avatar, device name, settings popover).
- `thread/Thread.tsx`, `thread/DayDivider.tsx`, `thread/TurnHeader.tsx`, `thread/SpeechCard.tsx`, `thread/JobCard.tsx`, `thread/ActivitySlab.tsx`, `thread/ApprovalCard.tsx`, `thread/HandoffCard.tsx`, `thread/CreditsLine.tsx`, `thread/ScrollToEnd.tsx`.
- `composer/VoiceComposer.tsx` (the orb and the heard line). `TalkButton.tsx` and `ModePicker.tsx` are gone.
- `orb/Orb.tsx` (`size: 48 | 56 | 128`, the disc tokens, the held ring), `orb/use-orb-control.ts` (the gesture: pointer capture, the `HOLD_MS` timer, Enter and Space), `orb/OrbMini.tsx` (split out of `Orb.tsx`, unchanged behavior).
- `status/StatusGlyph.tsx`, `status/ProgressRing.tsx`, `status/CountChip.tsx`.
- `pane/Inspector.tsx` (evolves `Pane`), `pane/JobInspector.tsx` (Receipt / Steps / Artifacts tabs), `pane/ShowOutput.tsx` (keep).
- `vm/ScreenFrame.tsx` (evolves `VmScreen`), `vm/ScreenPip.tsx`.
- `views/JobsView.tsx`, `views/JobRow.tsx`, `views/AuditView.tsx` (table + filter), `views/CreditsView.tsx`.
- `theme/ThemeProvider.tsx`.

State and logic changes:

- `feed/reducer.ts`: per job add `progressHistory: string[]` (capped at 50), `startedAt`, `endedAt`, `artifacts: string[]` (from `job.done.artifacts`), and index approvals and handoffs by `job_id`; export `needsYou(state)` (open approvals and handoffs, oldest first). Tests in `test/reducer.test.ts`.
- `lib/status.ts`: `bucketOf(job, state)` and `glyphOf(job, state)`, pure, tested in `test/status.test.ts`.
- `composer/orb-gesture.ts`: `HOLD_MS`, `tapAction`, `startPress` / `isHold` / `endPress`, pure, tested in `test/orb-gesture.test.ts`.
- `voice.ts` / `state/voice.tsx`: voice only and full duplex. No `sendText`, no `inputMode` / `setInputMode`, no `apparatus.input` key. `pressTalk` opens the Live session when closed and waits for `voice.granted` when the device does not hold the voice session; `interrupt()` stops playback, ends any open turn and silences the rest of the reply (`live/reply-latch.ts`, tested in `test/reply-latch.test.ts`).
- `live/messages.ts`: no typed-turn builder; `buildEventTurn` is the only `clientContent` turn.
- `state/screen.tsx`: one shared screen store around `useScreen`.
- `state/selection.tsx`: view, selected job, pane open and mode, rail collapsed; persisted under `apparatus.view`, `apparatus.rail`.
- `docs/STYLE.md`: the label list is the closed set of one-word labels; every other visible string is content.

## 10. Risks and unverified items

1. `thinking-orbs` presets are tuned designs, not scale factors; the 64 preset at `scale-75` and `scale-200` is untested at DPR 2. If the 48 px slot blurs, use the 20 preset at `scale-[2.4]`.
2. The orb gesture is tested as pure rules only. No microphone, finger or keyboard has run the hold, the tap-to-interrupt or the Space hold on a device.
3. `progressHistory` is lost on reload because `ready.jobs` carries only the latest `progress`; the Steps tab is complete only for jobs seen live.
4. The Space hold is gated on the VM video and open overlays only. A focused button no longer activates on Space; Enter still does.
5. On iOS Safari a scroll gesture that starts on the orb can cancel the hold (`pointercancel` releases it); untested on a device.
6. The Tauri overlay titlebar and the 76 px inset come from the Tauri 2 docs, not from this repo's `tauri.conf.json`; verify on macOS.
7. Contrast is computed, not measured: `muted-foreground` on `background` is about 4.6:1; amber on paper is about 2.8:1, so amber colors glyphs and bars only; verify the credits-low number.
8. The orb disc pins `theme="dark"` while `OrbMini` uses `theme="auto"`; `ThemeProvider` must set `.dark` before first paint or the 20 px orbs flash the wrong ink.
9. The shared screen store makes `useScreen` app-scoped; the PiP and the pane must not both call `open()` and `close()`.
10. `react-resizable-panels` adds weight to a bundle the repo keeps small; the Sheet paths do not need it.
11. The references' dark tokens are undocumented; the dark palette here is designed, not copied, and must be judged on screen.
12. The Audit `kind` vocabulary was not checked against the server; the filter takes its values from the data.

## 11. The watch apps

`clients/watchos` (SwiftUI, watchOS 10) and `clients/wearos` (Compose for Wear OS) share one design. They do not show the web app.

**The screen.** Black, the thinking orb centred, its diameter 80% of the screen's shorter side. No text, no feed, no transcript, no buttons, no chips, no icons, no status line, and no time drawn by the app. The orb is the `thinking-orbs` engine (npm 0.3.2, MIT, by Jakub Antalik) in a native port: the 64 preset in the library's dark theme, light dots on black, scaled to the diameter. The web's 128 px orb is the same preset at scale 2. watchOS draws it with the vendored Swift kit (`clients/watchos/Vendor/ThinkingOrbsKit`); Wear OS draws it with a Kotlin port (`clients/wearos/.../ui/orb`).

**The mapping.** Both apps port `orbRender` from `web/src/orb-state.ts` (`OrbRender.swift`, `OrbRender.kt`) and add the low-power display:

| Voice state | Orb |
|---|---|
| idle | `breathing` |
| connecting (the server socket is down) | `connecting` |
| listening (the gate has a turn open) | `listening` |
| speaking (the agent's audio plays) | `composing` |
| working (a job runs) | `working` |
| No call and no job | `breathing` at speed 0.5 |
| Another device holds the voice session | paused, opacity 0.35 |
| Reduced motion; the always-on display (watchOS `isLuminanceReduced`, Wear OS ambient mode) | the library's static frame, engine time 0.6 |

**The gesture.** A tap anywhere on the screen toggles the call.

| Tap | Action |
|---|---|
| Not in a call | A short haptic. Claim the voice session when another device holds it, open the Live session, open the microphone for the whole call (full duplex), run the gate in open-mic mode, play the agent's audio |
| In a call | Hang up: end any open turn with `activityEnd`, stop playback, close the Live session, stop and release the microphone and the audio session, release the voice session. A short haptic |

The haptics are `WKInterfaceDevice.play(.start)` and `.stop` on watchOS, `EFFECT_CLICK` and `EFFECT_DOUBLE_CLICK` on Wear OS. To talk over the agent, the user speaks: the gate's barge-in rule stops playback inside `gate.bargein_stop_ms`, as on the web. The call also ends by itself, with the end haptic, when the Live session closes (idle timeout, error, server drop) or another device takes the voice session.

**Audio.** Echo cancellation is on, because the speaker plays while the microphone is open: watchOS uses `AVAudioSession` `.playAndRecord` with mode `.voiceChat`; Wear OS uses `AudioSource.VOICE_COMMUNICATION` with `AcousticEchoCanceler` and `NoiseSuppressor` when the device has them. The Live setup keeps automatic activity detection off (`live.automatic_activity_detection = false`), so the watch sends `activityStart` and `activityEnd` from its gate, like the web.

**Wrist down.** watchOS: the app declares the `audio` background mode and keeps an active playAndRecord session through the call. Wear OS: a foreground service of type `microphone` holds the process and the microphone until hang-up. Neither has run on a watch; each app's README lists what is unverified.

**Accessibility.** The orb is the one accessible element: a toggle named "Call" whose value is On or Off. VoiceOver's and TalkBack's double tap toggles the call.

**Notifications.** Handoffs and approvals stay system notifications, with Approve and Deny on approvals. They are system UI, not the app's screen.

**First launch.** Nothing covers the orb at launch. Wear OS draws a black splash with no icon (`values-v31/themes.xml`) and asks for no permission until the first call tap. On that tap the system asks for the microphone, and on both watches for notifications with it. Neither platform lets an app remove its permission prompts; they are system UI and appear once, as the result of the tap.
