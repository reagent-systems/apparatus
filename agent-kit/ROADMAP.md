# ROADMAP.md — the source of all work

**This file is not optional.** Every feature the agent builds flows down
from here. If it isn't on this roadmap, it doesn't get built; if it needs
building, it gets added here first. One item ships per weekly cycle
(see `WEEKLY.md`).

## North star

apparatus is a voice agent that works on its own cloud computer and talks to the user on
any device. The user speaks; the agent does the work on a persistent Linux desktop VM; it
asks the user only when a person must act. Version 1 is complete when one user can talk to
it on the web, a phone, a desktop and a watch, hand it a login, approve a send, and pay for
it with credits, with every secret kept away from the model.

## Feature Queue — ordered; top unblocked item ships next

### 1. Voice shell on the paid tier
- **Promise:** A 10-minute Live session on the paid tier runs from the web client with the orb switched on, an answer and a spoken barge-in interruption, and the billed tokens for each minute are recorded in STATUS.md.
- **Evidence:** The session audit log (`token.mint`, `live.closed`) and a table of billed tokens per minute in STATUS.md.
- **Use case:** Ask and hear.
- **Scope guard:** No gate tuning, no VM work. Fix only what stops the session from running.
- **Status:** ready (blocked only on a Gemini key in the environment)

### 2. Voice gate on recorded cases
- **Promise:** Three recorded audio fixtures (a pause mid-sentence, the model's own voice from speakers, a cough) pass as node tests against the thresholds in `config/apparatus.toml`.
- **Evidence:** `web/test/gate-fixtures.test.ts` green in `verify/verify.sh`.
- **Use case:** Ask and hear.
- **Scope guard:** No new filters; Silero and Smart Turn stay behind their interfaces.
- **Status:** ready

### 3. A real VM runs a job
- **Promise:** On one Compute Engine VM built by `vm/setup.sh`, the request "make a CSV of the planets and summarize it" ends with `status: done`, a CSV in the task folder, and the voice stays responsive during the job.
- **Evidence:** The audit log of the job and the `job.done` message; the Terraform apply output.
- **Use case:** Get a file made.
- **Scope guard:** No browser work, no handoff.
- **Status:** ready (needs a GCP project)

### 4. Firestore store adapter
- **Promise:** `APPARATUS_STORE=firestore` passes `server/tests/test_store.py` against the Firestore emulator in CI.
- **Evidence:** A CI job with the emulator; `docs/ADAPTERS.md` row.
- **Use case:** Run while away.
- **Scope guard:** No schema beyond the six Store methods.
- **Status:** ready

### 5. Screen stream for the handoff
- **Promise:** A user logs in during a handoff from the web client, the agent continues, and the audit log shows no `computer` call between `handoff.start` and `handoff.end`.
- **Evidence:** The audit log; a screen recording.
- **Use case:** Log in once.
- **Scope guard:** A TURN relay from `deploy/gcp/main.tf`. The stream is aiortc in agentd; Selkies was not taken.
- **Status:** in progress. Shipped in part on 2026-10-04: the stream and control protocol, the agentd streamer (aiortc, `ffmpeg x11grab`), the server relay with TURN credentials, and the VM screen widget with Control and Release. Evidence: 8 agentd loopback tests, 8 server stream tests, 110 web tests. Open: the run on a real VM with a real browser, the audit log of a login handoff, the screen recording. The real run waits on item 3.

### 6. Stripe subscription and top-ups
- **Promise:** A Checkout payment adds the monthly grant to the ledger through the webhook, and a user with zero credits cannot start a job.
- **Evidence:** Webhook test with Stripe's CLI; `/credits` history.
- **Use case:** Pay with credits.
- **Scope guard:** Web only. No in-app purchases.
- **Status:** ready

### 7. Kernel X isolation
- **Promise:** Task code in a kernel cannot connect to the desktop's X display: with `DISPLAY=:0` set by the code itself, `import -window root` and `xdotool` fail with an authorization error, while the computer tool still works.
- **Evidence:** A test on the VM image (`vm/setup.sh`) and an agentd test with a real Xvfb started with `-auth`.
- **Use case:** Log in once.
- **Scope guard:** Separate users for the desktop session and the kernels, an X auth cookie the kernel user cannot read. No change to the tool contract.
- **Status:** ready

## Later — candidates, not yet specced

- Egress proxy that enforces approvals (version 2 of the design) — approvals stop being a convention.
- `agentlib.api()` with the server as OAuth client — tokens never enter the VM.
- Speaker check with a real embedder — shared rooms.
- Wake word — always-on use without an open session.
- Extended-thinking voice model option — progress reports while jobs run.
- Batch API for slow jobs — about half price.
- Self-hosted voice model — cost and terms.
- OpenAI plan login after approval — a second provider.

## Shipped

| Week | Feature | Release | Evidence |
|---|---|---|---|
| 2026-10-04 | Version 1 skeleton: protocol, agentd, server, web client, native shells, CI, GCP Terraform | unreleased | `verify/verify.sh` green at the install commit |
| 2026-10-05 | Web app redesign to `docs/DESIGN.md` (Ink on Paper), shipped in part: thread and voice composer that types, rail, Jobs desk, inspector, command palette, status bar, progress steps, demo mode | unreleased | `npm --prefix web test` 154 pass; 63 server tests; `verify/verify.sh` green; 54 + 62 headless Chromium screenshots against demo mode, judged twice against DESIGN.md. Open: a run with a microphone and a key, typed text into a live Live session, the orb at DPR 2, the macOS overlay titlebar |

## Explicitly not doing

- Subscription logins from model providers in version 1 — Anthropic and Google do not permit them in third-party apps.
- Shared workspaces for more than one user — one VM serves one user.
- Offline use — the voice and the work both live in the cloud.
- Solving captchas — the agent always hands off.
- In-app purchases in native apps — until the Apple and Google rules are checked.

## Queue changes

- 2026-10-05 — The human asked for a redesign of the web app against 5 reference products; it ran outside the numbered queue and serves Ask and hear, Approve a send and Log in once. `docs/DESIGN.md` is its spec. Shipped in part (see Shipped); the open checks ride on items 1 and 5. The queue order is unchanged.
- 2026-10-04 — Added item 7 (Kernel X isolation) from the review round: the handoff rule is enforced for the computer tool and the server, not yet at the X socket.

- 2026-10-04 — Seeded from the design spec's build order and its "facts to verify". Provisional: the human has not ranked it.
- 2026-10-04 — Defect queued, no item yet: `server/tests/test_jobs.py::test_job_runs_python_on_the_vm_and_speaks_the_result` is intermittent (3 of 15 full runs; `wait_done` returns before the `job.done` broadcast). It does not block item 5. Fix it in the next cycle that touches `jobs.py`.
- 2026-10-04 — Item 5 moved to in progress ahead of items 1 to 4: the human asked for the React client, the orb and the VM screen with control, and the stream protocol came with them. The real VM run stays behind item 3. The Selkies evaluation left the scope guard: agentd streams with aiortc.
