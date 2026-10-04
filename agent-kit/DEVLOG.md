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
