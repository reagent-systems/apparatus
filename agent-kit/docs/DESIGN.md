# DESIGN.md — the apparatus web app

The binding visual and interaction spec for `web/src`. Stack: React 19, Vite 8, Tailwind CSS 4, shadcn/ui (new-york, zinc base), lucide-react, `thinking-orbs`. The Tauri and Capacitor shells show this same app. The watch apps are out of scope.

The product rules stay: no explanatory text, taglines, helper text or toasts; state shows through the orb, color, progress and content; copy is short; secrets never appear; no setting changes an endpoint. `docs/STYLE.md` governs every word on screen.

Conversation-first won the judging; it took the Jobs view, the Receipt / Steps / Artifacts inspector and the status bar from Manager-first, and the control ring, the fixed status slot and the theme provider from Workspace-first.

## Decisions

| Decision | Choice | Why | Source product |
|---|---|---|---|
| Home surface | One thread with the voice composer docked under it | All four references center a thread over a bottom composer | Quick, Hermes, Paseo, Claude Desktop |
| Oversight | A 248 px rail with nav rows and Needs you / Running / Recent job rows; a Jobs view with filter chips and inline actions | Antigravity 2.0 lost its inbox; blocked work needs a queue with buttons | Hermes (groups, dots), Cowork (chips, in-card buttons), Paseo (order) |
| Needs input | Inline approval and handoff cards with buttons, counted in the rail, Alt+J jumps there | What needs you is in the thread you read | Cowork, Antigravity |
| Verification | Job card = activity slab + say + show + artifact chips; inspector tabs Receipt / Steps / Artifacts | "Verify with artifacts, not logs" as calm rows | Antigravity, Quick |
| Voice presence | The orb in the composer (48 / 56 px), the empty state at 128 px, the 20 px preset as the only spinner | The orb is the state | Hermes, the sketches |
| Composer | One elevated card: text field, Talk (hold), Stop, one picker (Push to talk / Open mic) | One elevated object; no model or endpoint picker | Quick, Claude Desktop |
| Screen | The VM in the pane with a 2 px ring that says who holds the desktop; a PiP when the pane is closed | Inverts Antigravity's border on an external window | Antigravity, Paseo |
| Status bar | 24 px desktop strip: connection, voice holder, control holder, credits | Telemetry at a glance, hideable | Hermes |
| Palette | Warm paper neutrals (hue 60–85), one ink-blue accent (hue 264), amber / green / red for state only | Calm; Antigravity's identity is an editor preset | Claude Desktop, Quick, Paseo |
| Type | Inter Variable 14 px UI / 15 px prose; JetBrains Mono Variable 13 px | Antigravity's type is "really, really small" | Quick, Paseo |
| Elevation | Borders, not shadows; one shadow on the composer | Flat surfaces read faster | Paseo, Claude Desktop |
| Theme | Light default; dark on the same hue; System follows the OS | Antigravity's light mode was an afterthought | Quick, Paseo |
| Copy | No placeholders, hints or toasts; status is a glyph, a ring, a bar or a one-word chip | Product rule | Cowork |
| Keyboard | Space (hold) talks, Esc stops, Cmd/Ctrl+K palette, Cmd/Ctrl+1–5 views, Alt+J | Keyboard-first like every reference | Antigravity, Codex, Hermes |

## 1. Thesis and the three moves

The app is one thread. Everything said, every job, approval, handoff, output and credits change is a card in it. The orb sits inside the composer at the bottom and is the only animated object on the screen. The rail on the left counts and lists; it never competes with the thread.

Three moves that beat Google Antigravity:

1. **What needs you is where you are.** An approval is a card with Approve and Deny on it; a handoff is a card with Done and Cancel on it. Both sit in the thread, count in the rail under "Needs you" with an amber hand glyph, and are one keystroke away (Alt+J). The Jobs view lists them first with the same buttons. Antigravity folded its inbox into a sidebar filter and OS toasts; apparatus has no toasts and needs none.
2. **The voice presence is the product.** Antigravity's voice is dictation into a text box. Here the orb is in the composer, is the empty state, is the running glyph on every job row, and the composer's two labeled buttons are Talk and Stop.
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
| Space (held, focus outside a text field and the VM video) | Talk |
| Esc | Stop |
| Enter in the text field | Send; Shift+Enter inserts a newline |
| Cmd/Ctrl+K | Command palette |
| Cmd/Ctrl+1 … 5 | Thread, Jobs, Screen, Audit, Credits |
| Cmd/Ctrl+B | Rail |
| Cmd/Ctrl+J | Pane |
| Alt+J | Focus the oldest card that needs you |
| Enter / Backspace on a focused approval or handoff card | Approve / Deny; Done / Cancel |
| Cmd/Ctrl+Shift+C | Control / Release |

### Command palette

shadcn `Command` inside a `Dialog`, Cmd/Ctrl+K. Groups: **Go** (the five surfaces), **Jobs** (every job by request text with its glyph), **Voice** (Push to talk, Open mic, Stop), **Screen** (Control, Release), **Theme** (Light, Dark, System). One label and a trailing `Kbd` per row; no descriptions.

## 3. The orb and the voice composer

The orb is `thinking-orbs` and nothing else. It renders as a filled disc `rounded-full bg-orb-disc` (in dark mode plus `ring-1 ring-orb-ring`) with the library pinned to `theme="dark"`, so the dots are always light on a dark disc.

| Place | Box | Transform | Preset |
|---|---|---|---|
| Composer, desktop and tablet | 48 px | `scale-75` | 64 |
| Composer, phone | 56 px | `scale-[.875]` | 64 |
| Empty thread | 128 px, centered | `scale-200` | 64 |
| Job rows, job card headers, turn headers, product mark | 20 px | none, `theme="auto"` | 20 |

State mapping stays in `orb-state.ts`: idle `breathing` (speed 0.5 while the Live session is closed), connecting `connecting`, listening `listening`, speaking `composing`, working `working`. Another device holding voice: paused at `opacity-40`.

The orb is a `<button aria-label="Talk">`: a click claims voice, then opens the Live session, then closes it (the `onOrb` logic in `Controls.tsx` today). The labeled Talk button, not the orb, is the press-and-hold target.

### The composer

`components/composer/VoiceComposer.tsx`, the one elevated object: `rounded-2xl border bg-card shadow-composer p-3 max-w-[760px]`. Two rows:

- **Row 1**: the orb box at the left, then a `Textarea` with `text-[15px] leading-6 bg-transparent border-0 shadow-none resize-none min-h-6 max-h-36` (1 to 6 lines, auto-grow), no placeholder. Typed text goes to the same voice model: `voice.sendText(text)` opens the Live session when closed, sends a `clientContent` user turn with `turnComplete: true` (`buildUserTextTurn` in `live/messages.ts`, no `<event>` wrapper), and sends `C2S.TRANSCRIPT {role:"user", final:true}` so other devices see the card.
- **Row 2** (`h-9`): left, the only picker, a `DropdownMenu` trigger `variant="ghost" size="sm"` with a `Mic` icon (Push to talk) or `Radio` icon (Open mic) and the mode word; its two items call `gate.setMode`. Right: **Talk** (`Button size="sm" className="h-9 px-4 touch-none select-none"`, press-and-hold with pointer capture as in `Controls.tsx`, `aria-pressed` and `scale-[.97]` while down; hidden in Open mic mode, where the orb's `listening` state carries the mode), a send button (`ArrowUp`, `size-9 rounded-full` primary) that appears only while the field has text, and **Stop** (`variant="outline" className="h-9 px-4"`, `Square` icon + the word; while the agent speaks it fills `bg-foreground text-background`).

Nothing else is in the card: no model picker, no attach, no caption. The latest spoken line is the last agent card in the thread.

## 4. The thread

Cards share the 760 px column at `gap-4`, prose at `text-[15px] leading-[1.55]`. Every card carries `data-kind` and `data-state` for tests.

- **Day divider**: `text-xs uppercase tracking-[0.08em] text-muted-foreground` centered; "Today", else the date (`4 Oct`).
- **Turn header**: the first agent card after a user card gets a row of `OrbMini` (`breathing`; `working` while any job runs), a hairline `flex-1 border-t`, and the finish time in `text-xs tabular-nums text-muted-foreground` (Quick's logo + rule + meta).
- **User speech**: `self-end max-w-[80%] rounded-2xl bg-muted px-4 py-2.5`. Interim text at `opacity-70`, solid on `final`. Typed text is the same card.
- **Agent speech**: plain prose, no bubble, `self-start max-w-[92%]`, rendered through `markdown.ts`. Interim text at `opacity-70`.
- **Job card**: `w-full rounded-xl border bg-card`. Header `px-4 py-3 flex items-center gap-3`: a `StatusGlyph` in a fixed 20 px leading slot (titles never shift when a spinner replaces an icon), the request in `text-sm font-medium truncate`, and at the right a 16 px `ProgressRing` (stroke 2, `--primary`, `percent`; a 90° arc spinning at 1.2 s when `percent` is null) while running, or the elapsed time in `text-xs tabular-nums` once ended. Body: an **activity slab** `mx-4 mb-3 rounded-lg bg-muted/60 px-3 py-2` with the last 3 `progressHistory` lines as `text-[13px]` rows behind a 14 px `Dot`, the live row behind `OrbMini working` (Quick's activity card); when the job ends it collapses to one row "N steps" with a `ChevronRight` toggle (`Collapsible`). Then the **say** line as prose (`px-4 pb-3`), then the **show** markdown in `max-h-40 overflow-hidden` under `mask-image: linear-gradient(to bottom, black 70%, transparent)` with an `ArrowUpRight` icon button at the top-right that opens the pane. Artifacts are `font-mono text-xs rounded-md bg-muted px-2 py-1` chips with the basename; a click opens the pane at that path. Failed: `border-destructive/40`. Cancelled: `opacity-70`.
- **Fold rule**: a job that has shown nothing yet (no steps, no say, no show, no artifacts) and waits on an open approval or handoff does not get its own card. The approval or handoff card carries the request instead: as the title of an approval card (the action and the details then share the mono block), as a muted 13 px line under a handoff's reason. Once the job has something to show, its card returns and the approval card's title is the `action` again. (`foldsIntoRequest` in `lib/status.ts`.)
- **Approval card**: `rounded-xl border bg-card border-l-2 border-l-status-wait` while pending. Row 1: `Hand` 16 px in `text-status-wait`, the `action` in `text-sm font-medium`. Row 2: `details` in `text-sm text-muted-foreground font-mono break-all` (the literal action, as Antigravity highlights the command). Row 3: **Approve** (primary) and **Deny** (outline), `h-9`, side by side on desktop, stacked full width on phone (Cowork). Answered: the amber bar goes and the buttons become a one-word chip, "Approved" with `Check` in `text-status-ok` or "Denied" with `X`; a denied card is `opacity-70`.
- **Handoff card**: same frame, amber bar while active, `Monitor` icon, the `reason` in `text-sm`, **Done** (primary) and **Cancel** (outline). A click opens the pane in Screen; on a phone the locked sheet opens at once. Ended: a chip "Done", "Cancelled" or "Timed out".
- **Credits line**: no card; one centered `text-xs text-muted-foreground` line with `Coins` and the number, `text-status-wait` at `low`, `text-destructive` at `out`.

Consecutive agent cards within 60 seconds share one turn header. Timestamps hide until hover on desktop (`group-hover:opacity-100`) and stay visible at 12 px on phone for job, approval and handoff cards. `MAX_CARDS` stays 100. The thread scrolls to the end on a new card unless the user scrolled up more than 240 px; then a `ChevronDown` round button with the unseen count floats above the composer.

Empty thread: the 128 px orb at `breathing`, the composer below it. No greeting.

## 5. Jobs

`lib/status.ts` (pure, tested in `test/status.test.ts`) maps a job to one bucket in Paseo's order: `needs_you` (status `needs_user`, or an open approval or handoff with this `job_id`) > `failed` > `running` (`running`, `queued`, `paused`) > `done` (`done`, `cancelled`).

**StatusGlyph** (`components/status/StatusGlyph.tsx`), 16 px icons, no words: running `OrbMini working`; queued `Clock` muted; paused `Pause` muted; needs_you with an approval `Hand` in `text-status-wait`; needs_you with a handoff `MousePointerClick` in `text-status-wait`; done `CircleCheck` in `text-status-ok`; failed `CircleX` in `text-destructive`; cancelled `CircleMinus` muted.

**Rail rows**: `h-9 px-2 rounded-[6px] text-sm gap-2`, the glyph in a fixed 16 px slot, the request `truncate`, right meta `text-xs tabular-nums text-muted-foreground` (percent while running, relative time otherwise). Recent keeps 20. Selected row `bg-sidebar-accent`. The Jobs nav chip is `h-5 min-w-5 rounded-full bg-accent text-accent-foreground text-[11px] tabular-nums` (Cowork).

**Jobs view** (`components/views/JobsView.tsx`, Cmd/Ctrl+2; the whole screen on phone and tablet, the thread column on desktop). Header: filter chips as a `ToggleGroup type="single"` of pills, **All 9 · Needs you 2 · Running 3 · Done 4**, counts in `tabular-nums`. Groups in bucket order with a "Today" / "Earlier" sub-divider. A `JobRow` is 56 px: a 28 px circle holding the glyph, the request in `text-sm font-medium` on one line, a muted 13 px subtitle (progress text while running; the `say` line when done; the `action` or `reason` while blocked), the relative time at the right. A blocked row adds a 36 px action row: **Approve** + **Deny**, or **Done** + **Cancel**. Actions are always visible.

**Inspector** (the pane in Output with a job selected): a header with the glyph, the request and the start time; `Tabs` at 13 px: **Receipt** (default for ended jobs: the `say` line, the full `show` markdown, the artifact paths as a mono list; a click copies a path and shows `Check` for 1.5 s), **Steps** (default for running jobs: the full `progressHistory` as activity rows with a 2 px progress bar beneath), **Artifacts** (the paths only). Selecting a job also scrolls the thread to its card with a 2 s `ring-2 ring-ring/40` highlight.

## 6. The VM screen

`components/vm/ScreenFrame.tsx` wraps the input logic of `VmScreen.tsx` unchanged. The frame is `rounded-lg bg-black aspect-video overflow-hidden` with the `<video>` at `object-contain`; a `Skeleton` covers it until `status === "live"`. A ring states who holds the desktop: `ring-2 ring-primary ring-offset-2 ring-offset-background` while this device holds control; `ring-2 ring-status-wait` during a handoff; `ring-1 ring-border` while the agent drives; none without a stream. Above the frame a 36 px header: a 6 px dot (`--status-ok` live, `--status-wait` connecting, `--destructive` failed) and a chip with the holder's device name when somebody holds the desktop. Below it a 44 px bar, right-aligned: **Control** (outline), **Release** (outline) while held; in handoff mode **Done** (primary) and **Cancel** (outline). The cursor over the video is `cursor-none` while input is on.

Picture-in-picture: on desktop, when the pane is closed and a stream is open, a 240 x 135 `rounded-lg border shadow-md` thumbnail floats bottom-right of the thread above the composer with the same ring; a click opens the pane in Screen; a handoff promotes it. The stream lives in one store (`state/screen.tsx`, a context around `useScreen`) so the PiP and the pane share one `MediaStream`. Phone: the Screen sheet is full-screen, landscape allowed, the button bar floating in `bg-background/80 backdrop-blur`; a handoff locks it.

## 7. Audit and credits

**Audit** (Cmd/Ctrl+4) renders in the thread column: a shadcn `Table` with day group headers; columns `t` (`font-mono text-xs tabular-nums`), kind (`Badge variant="secondary"`), the rest as a truncated mono line; a row click expands the JSON in a `pre` (`Collapsible`). A `Select` filters by the `kind` values the server returns. The client renders only known keys. On phone the table scrolls horizontally.

**Credits** (Cmd/Ctrl+5): the balance at `text-5xl font-medium tabular-nums`, a 10 px dot beside it (`--status-ok` ok, `--status-wait` low, `--destructive` out), then the history as a two-column list (time, signed delta in mono). **Top up** stays a disabled primary button until a payment path exists.

**Settings** live in the rail footer `Popover` and nowhere else: **Input** (Push to talk / Open mic, a `Select`), **Appearance** (Light / Dark / System, a `ToggleGroup`), **Notifications** (a `Switch`). `theme/ThemeProvider.tsx` replaces `lib/theme.ts`: it writes `.dark` on `<html>` before first paint and persists the choice under `apparatus.theme`. Nothing addresses an endpoint or a model.

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

**Empty states**: thread, the 128 px orb; rail groups, absent; Jobs view, chips with zero counts; Audit, the header row; Screen, the skeleton; pane, the latest `show`. No sentence anywhere.

## 9. Component inventory

shadcn/ui already present and kept: `button`, `card`, `scroll-area`, `separator`, `sheet`, `sidebar`, `skeleton`, `toggle`, `toggle-group`.

Add with `npx shadcn@latest add select command dialog popover badge table resizable collapsible textarea dropdown-menu kbd tabs switch`. Do not add `tooltip`, `sonner` or `toast`.

Dependencies to add: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, plus `react-resizable-panels` and `cmdk` through the CLI.

Custom components, all under `web/src/components`:

- `layout/AppShell.tsx` (rewrite: rail, thread, pane in a `ResizablePanelGroup`; Sheet variants for tablet and phone), `layout/Titlebar.tsx`, `layout/StatusBar.tsx`, `layout/CommandPalette.tsx`.
- `rail/Rail.tsx`, `rail/RailNav.tsx`, `rail/RailJobRow.tsx`, `rail/RailFooter.tsx` (avatar, device name, settings popover).
- `thread/Thread.tsx`, `thread/DayDivider.tsx`, `thread/TurnHeader.tsx`, `thread/SpeechCard.tsx`, `thread/JobCard.tsx`, `thread/ActivitySlab.tsx`, `thread/ApprovalCard.tsx`, `thread/HandoffCard.tsx`, `thread/CreditsLine.tsx`, `thread/ScrollToEnd.tsx`.
- `composer/VoiceComposer.tsx`, `composer/TalkButton.tsx` (pointer capture, Space hold), `composer/ModePicker.tsx`.
- `orb/Orb.tsx` (keep; add `size: 48 | 56 | 128` and the disc tokens), `orb/OrbMini.tsx` (split out of `Orb.tsx`, unchanged behavior).
- `status/StatusGlyph.tsx`, `status/ProgressRing.tsx`, `status/CountChip.tsx`.
- `pane/Inspector.tsx` (evolves `Pane`), `pane/JobInspector.tsx` (Receipt / Steps / Artifacts tabs), `pane/ShowOutput.tsx` (keep).
- `vm/ScreenFrame.tsx` (evolves `VmScreen`), `vm/ScreenPip.tsx`.
- `views/JobsView.tsx`, `views/JobRow.tsx`, `views/AuditView.tsx` (table + filter), `views/CreditsView.tsx`.
- `theme/ThemeProvider.tsx`.

State and logic changes:

- `feed/reducer.ts`: per job add `progressHistory: string[]` (capped at 50), `startedAt`, `endedAt`, `artifacts: string[]` (from `job.done.artifacts`), and index approvals and handoffs by `job_id`; export `needsYou(state)` (open approvals and handoffs, oldest first). Tests in `test/reducer.test.ts`.
- `lib/status.ts`: `bucketOf(job, state)` and `glyphOf(job, state)`, pure, tested in `test/status.test.ts`.
- `voice.ts` / `state/voice.tsx`: `sendText(text)` and `setInputMode(mode)` (calls `gate.setMode`).
- `live/messages.ts`: `buildUserTextTurn(text)`.
- `state/screen.tsx`: one shared screen store around `useScreen`.
- `state/selection.tsx`: view, selected job, pane open and mode, rail collapsed; persisted under `apparatus.view`, `apparatus.rail`.
- `docs/STYLE.md`: extend the label list in the same commit with the nav and settings words (Thread, Jobs, Needs you, Running, Recent, Push to talk, Open mic, Light, Dark, System, Top up, Input, Appearance, Notifications) and the chips (Approved, Denied, Cancelled, Timed out).

## 10. Risks and unverified items

1. `thinking-orbs` presets are tuned designs, not scale factors; the 64 preset at `scale-75` and `scale-200` is untested at DPR 2. If the 48 px slot blurs, use the 20 preset at `scale-[2.4]`.
2. `sendText` relies on the Live session accepting a `clientContent` text turn while audio is open; untested. If it fails, text needs a server path and a PROTOCOL.md change.
3. `progressHistory` is lost on reload because `ready.jobs` carries only the latest `progress`; the Steps tab is complete only for jobs seen live.
4. Space as push-to-talk must be gated on focus outside the textarea and the VM video, or a keypress goes to both the mic and the desktop.
5. On iOS Safari a scroll gesture that starts on Talk can cancel the hold; untested on a device.
6. The Tauri overlay titlebar and the 76 px inset come from the Tauri 2 docs, not from this repo's `tauri.conf.json`; verify on macOS.
7. Contrast is computed, not measured: `muted-foreground` on `background` is about 4.6:1; amber on paper is about 2.8:1, so amber colors glyphs and bars only; verify the credits-low number.
8. The orb disc pins `theme="dark"` while `OrbMini` uses `theme="auto"`; `ThemeProvider` must set `.dark` before first paint or the 20 px orbs flash the wrong ink.
9. The shared screen store makes `useScreen` app-scoped; the PiP and the pane must not both call `open()` and `close()`.
10. `react-resizable-panels` adds weight to a bundle the repo keeps small; the Sheet paths do not need it.
11. The references' dark tokens are undocumented; the dark palette here is designed, not copied, and must be judged on screen.
12. The Audit `kind` vocabulary was not checked against the server; the filter takes its values from the data.
