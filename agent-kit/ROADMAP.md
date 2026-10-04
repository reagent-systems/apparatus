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
- **Promise:** A 10-minute Live session on the paid tier runs from the web client with push to talk, an answer and an interruption, and the billed tokens for each minute are recorded in STATUS.md.
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
- **Scope guard:** Evaluate Selkies first; a TURN relay from `deploy/gcp/main.tf`.
- **Status:** blocked on item 3

### 6. Stripe subscription and top-ups
- **Promise:** A Checkout payment adds the monthly grant to the ledger through the webhook, and a user with zero credits cannot start a job.
- **Evidence:** Webhook test with Stripe's CLI; `/credits` history.
- **Use case:** Pay with credits.
- **Scope guard:** Web only. No in-app purchases.
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

## Explicitly not doing

- Subscription logins from model providers in version 1 — Anthropic and Google do not permit them in third-party apps.
- Shared workspaces for more than one user — one VM serves one user.
- Offline use — the voice and the work both live in the cloud.
- Solving captchas — the agent always hands off.
- In-app purchases in native apps — until the Apple and Google rules are checked.

## Queue changes

- 2026-10-04 — Seeded from the design spec's build order and its "facts to verify". Provisional: the human has not ranked it.
