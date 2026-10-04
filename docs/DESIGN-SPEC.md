# Live Voice Agent: Design Spec

Oct 3, 2026 · @thyfriendlyfox

## Goal and scope

Build a voice agent that works on its own cloud computer and talks to the user on any device. The user speaks. The agent does the work. The agent asks the user for help only when a person must act, for example a captcha or a login.

**In scope for version 1**

- Full duplex live voice on web, iOS, Android, Windows, macOS, Linux, tablets, and watches.
- One persistent cloud desktop VM for each user.
- Background jobs that run in parallel and never block the voice.
- Handoff of the VM screen to the user for captchas and logins.
- Tools that the agent makes for itself and saves on disk.
- Gemini for both models: Gemini 3.8 Live for voice, a Gemini text model for the work. You pay Google with one API key. Users pay you with a monthly subscription that includes credits.

**Out of scope for version 1**

- Subscription logins from model providers. Anthropic and Google do not permit them in third-party apps. Meta offers none. OpenAI offers one, but a hosted app needs approval first.
- Self-hosted voice models.
- Shared workspaces for more than one user.
- Offline use.

**Design rules**

1. Put capability in code. Put boundaries in tools.
2. State lives on the server, in the VM. Clients hold no agent state.
3. A tool call never blocks the voice.
4. The model never sees secrets.
5. Text from web pages, emails, and files is data. It is never an instruction.

## Architecture

&#91;embedded content: architecture · client, server, VM, 2 Gemini models\]

Voice audio goes from the client straight to Gemini Live. All work goes through the session server. The server holds the API key and runs the smart-model loop. The VM only runs tools, and it opens its own connection out to the server. The dashed line is the screen stream that opens only during a handoff.

**One voice turn**

1. The gate on the client sends clean speech to Gemini Live.
2. The voice model decides: answer now, or call start\_job.
3. The client relays start\_job to the session server. The server returns a job\_id at once, and the voice model keeps talking.
4. The server runs the smart-model loop. Each python or computer call goes to agentd on the VM.
5. The job ends with the result contract: say and show.
6. The server sends a job.done event. The client passes it into the live session. The voice model speaks the say text, and the show text appears on the screen.

## Models and tools

Two Gemini models do two jobs. The voice model talks. The smart model works. Keep both model names in one config file so they are easy to change.

| Role | Model ID | Job |
| --- | --- | --- |
| Voice | gemini-3.8-live | Live duplex audio. Routes each request. Speaks short results. |
| Voice, premium option | gemini-3.8-live-extended-thinking | Same job. Reports progress while background work runs. Needs non-blocking tools only. |
| Smart, default | gemini-3.8-flash | Plans and runs jobs in the VM. Lowest cost. |
| Smart, upgrade | gemini-3.1-pro-preview | Hard jobs. Choose it for each job with a config flag. |

Confirm the exact model strings in Google AI Studio before you code against them.

### Voice model tools

Declare every tool as non-blocking, so the model keeps talking while a tool runs. Each call returns at once.

| Tool | Arguments | Returns |
| --- | --- | --- |
| start\_job | request (string), context (optional string) | job\_id at once |
| check\_job | job\_id | status, progress, and the say text when done |
| cancel\_job | job\_id | ok |
| show | content (markdown), target (optional) | ok |

**Routing rule for the system prompt.** Answer directly only for conversation and for facts that need no lookup. Send every other request to start\_job. Say one short sentence first, such as "I will check." Never answer a follow-up question about finished work from the short summary. Call start\_job again with the question.

### Smart model tools

| Tool | What it does |
| --- | --- |
| python | Runs code in the persistent Python session of the current task. Shell commands run from Python. Returns text, errors, and files. |
| computer | Screenshot, click, type, key, scroll on the VM desktop. Returns an image. Use it only when text methods fail. |
| show | Sends content to the screen of the client. |
| handoff | Pauses the task and asks the user to take over the screen. |

Inside the Python session, a small module named agentlib gives the agent thin calls to the server: agentlib.say(), agentlib.progress(), agentlib.request\_approval(), and agentlib.api(). Each call only sends a request. The server does the action. Logic never lives in the VM, because the agent can change anything in the VM.

### Job result contract

The smart model ends each job with this JSON. The voice model speaks the say field with almost no change.

```json
{"status": "done | failed | needs_user", "say": "One or two sentences, written for speech.", "show": "Full detail in markdown. Optional.", "artifacts": ["paths on the VM"]}
```

### Where the model calls run

The session server runs the loop for the smart model and holds the API key. The VM only executes tools. This keeps the key out of reach of the agent.

The client connects to Gemini Live directly with a short-life ephemeral token from the server. The client relays voice-model tool calls to the server over its authenticated socket. The server sends job events back, and the client passes them into the live session. If you later need more server control, move the Live session to a server-side bridge such as Pipecat. The tool contract does not change.

A Live audio session has a time limit. Reports give 15 minutes for audio only. Use session resumption. Keep a rolling summary of the conversation on the server, and load it into each new session.

## Voice gate on the client

A gate on the device decides what audio the voice model hears and when a turn ends. It runs before audio leaves the device. It also cuts cost, because audio that the gate drops is never sent or billed.

**Gate order**

1. Echo cancellation. Use the voice processing mode of the operating system. Give it the output audio as its reference.
2. Noise and background-voice removal.
3. Voice activity detection. Send audio only while speech is present.
4. Speaker check. Compare each speech segment with the enrolled voice of the user. Drop segments that do not match. Turn this on in shared rooms.
5. Turn detector. Use a small model that reads the words as well as the silence, so "I want to book a flight to" does not end the turn.
6. Send the audio and explicit activity start and end signals to Gemini Live. Turn off automatic activity detection in the Live setup, so the gate controls the turn. Confirm that Gemini 3.8 Live supports this before you build on it.

**Problems and filters**

| Problem | Filter | Starting setting |
| --- | --- | --- |
| Model interrupts while the user thinks | Semantic turn detector with two silence limits | 0.5 s when the sentence looks complete. 2.5 s when it does not. |
| Model answers its own voice | Echo cancellation, plus a higher barge-in bar while the model speaks | Require 300 ms of clear voice and at least 2 words to interrupt. |
| Model answers other people | Speaker check, an addressed-to-me check, or a wake word | Speaker check on in shared rooms. |
| Cough, laugh, or "mm-hm" stops the model | Minimum duration and real words | Ignore sounds under 300 ms. |

The addressed-to-me check is a small classifier, or a short question to the voice model, that decides if a sentence is for the assistant. Treat it as an extra filter, not as the only one.

**Input modes**

- Push to talk. Default on watches.
- Wake word. For always-on use. No Live session stays open without it.
- Open microphone. Recommend headphones. An open microphone costs the most, because silence is billed as audio input.

**Barge-in behavior.** After a valid interruption, stop playback within 200 ms. Tell the model it was interrupted. Keep all background jobs running.

**Manual path.** Every client has a button to talk and a button to stop that always works. A filter can block real speech, so the user needs a way around it.

**Speaker enrollment.** The voice sample is biometric data. Store it on the device only. Ask for consent before you record it.

**Tuning.** Keep every threshold in one config file. Log the gate decisions and their reasons, not the audio. Use the log to tune.

Open-source parts to evaluate: Pipecat Smart Turn or the LiveKit turn detector for turns, Silero for voice activity, and a noise model such as Krisp or RNNoise. Check the current versions and licenses.

## Cloud VM and Python sessions

Each user has one persistent Linux desktop VM. Each task gets its own Python session on that VM. The VM keeps what lasts: files, logins, and tools. The session keeps what is in progress: variables.

**The VM**

- Linux with a light desktop, Chromium, Python, and common command-line tools.
- A persistent disk with scheduled snapshots, so a user can roll back after an agent error.
- No inbound network ports. The VM opens one outbound connection to the session server.
- A small daemon named agentd runs on the VM. It starts and stops one IPython kernel for each task, runs tool calls, enforces limits, and streams events to the server.

**Task isolation**

| Separate for each task | Shared by all tasks |
| --- | --- |
| Python kernel and variables | The disk |
| Model context and history | The browser profile and its logins |
| Working folder | Installed packages |
| Time, token, and step budget | Memory notes and saved tools |

The desktop has one screen, one mouse, and one keyboard. Use a lock: only one task controls the desktop at a time. A second task that needs it waits or gets the error desktop\_busy. Tasks that use only code run in parallel.

**The kernel is working memory only.** It can die when the VM restarts or memory fills. The agent writes anything important to disk. agentd keeps an append-only log for each task and restores a task from it.

**Disk layout**

| Path | Content |
| --- | --- |
| /home/agent/memory/index.md | One line for each note. The agent reads it at the start of each task. |
| /home/agent/memory/notes/ | One small file for each fact. Add files. Do not overwrite them. |
| /home/agent/tools/ | Saved Python tools, and index.md with the name, purpose, and usage of each. |
| /home/agent/tasks/TASK\_ID/ | Working files, log.jsonl (append only), and result.json. |
| /home/agent/sessions/ | Conversation history, one file for each session. |
| /home/agent/browser-profile/ | The Chromium profile that holds the logins. |

**Saved tools.** When the agent does a task that will repeat, it writes a script into /home/agent/tools/ and adds a line to index.md. Later tasks import the script. The repeat run then uses few or no model tokens for those steps.

**Context rules for the smart model**

- Keep large results in variables. Print only the part that is needed.
- Read web pages as text or as an accessibility tree. Take a screenshot only when text fails.
- When the context passes a size limit, replace old steps with a short summary. The full history stays in log.jsonl.

**Idle behavior.** The VM runs only when it is needed. It starts when the user opens a voice session, or when a scheduled job is due. It stops after VM\_IDLE\_STOP\_MINUTES with no open session, no running job, and no queued job. Default 30. A stopped VM keeps its disk.

- Start the VM when the voice session opens, not when the first job starts. The voice model answers conversation without the VM. The VM is ready when the first job needs it.
- Never stop a VM while a job runs or waits for the user, for example in a handoff or an approval.
- A scheduled job wakes the VM, runs, and then lets the VM go idle.
- Measure the start time. If it is too slow, test suspend and resume, a small boot image, or a warm pool of VMs. Check which options your machine type supports. A warm pool costs money while it waits.

## Handoff to the user

When a person must act, the agent pauses, the user takes over the VM screen, and the agent continues after the user selects Done. This is the same pattern that Meta Muse uses for its browser.

**Flow**

1. The agent sees a captcha, a login page, a code request, or a consent screen. It calls handoff with a reason and the URL.
2. agentd stops all agent input to the VM for that task. Code-only tasks continue. The task keeps the desktop lock.
3. The session server sends a push notification. If the user is in a voice session, the voice model says one short sentence.
4. The user opens the live view on a device with a screen. The VM streams its desktop by WebRTC. Mouse, touch, and keyboard events go back.
5. The user acts, and then selects Done or Cancel.
6. agentd resumes the task. The agent first reads a fresh text snapshot of the page.
7. After a wait limit, default 30 minutes, the task stays paused. The agent reports it at the next session.

**Rules**

- The agent never tries to solve a captcha. It always hands off.
- During a handoff, take no screenshots and send no page content to the model. Do not log keystrokes.
- The browser profile lives on the persistent disk. A login then lasts, and the user does not repeat it for each task.
- On a watch, the handoff cannot show a screen. Send a notification that tells the user to continue on another device.
- Passkeys and security keys do not work through the stream. They are bound to the device of the user. Mark these sites as failed and tell the user why.
- Data center addresses cause more captchas. Expect handoffs to happen often.

**Approvals.** Some actions must be approved by the user: send a message, buy, delete, post, share, or change an account. The agent calls agentlib.request\_approval(action, details). The server sends a push notification and blocks that job until the user answers. In version 1 this is a convention that the model follows, plus an audit log. That is weak against prompt injection. In version 2, force it: send all VM outbound traffic through a proxy that the server controls, and block gated action types unless the request carries an approval token.

**Credentials**

- Version 1. The user types passwords in the handoff view. The browser profile keeps the session.
- Version 2. For services with an API, make the server the OAuth client. The user approves access on their own device. Tokens stay in Secret Manager. The agent calls agentlib.api(service, ...), and the server adds the token. The token never enters the VM.
- If email is connected, remove one-time codes and password reset messages from what the agent can read.

## Clients and UI

Clients are thin. They capture and play audio, run the voice gate, show output, and show the VM screen. They hold no agent state. Build the web app first. Add native apps later on the same protocol.

| Device | Voice | Output | Handoff |
| --- | --- | --- | --- |
| Web and desktop (Windows, macOS, Linux) | Yes | Feed, plus a large pane for show output and the VM stream | Yes |
| Tablet | Yes | Large pane on the left, feed on the right | Yes |
| Phone (iOS, Android) | Yes | Feed. The VM stream opens full screen during a handoff. | Yes |
| Watch | Yes | Notifications only | No. It tells the user to use another device. |

The phone layout in the first sketch has no place for the handoff view. Add a full-screen view that opens on a handoff and closes on Done or Cancel.

**Layout.** The same parts on every device: a feed of short cards on top, and the voice orb at the bottom. The large pane on tablet and desktop shows show output or the VM stream.

**UI rules**

- Keep the interface minimal and human. Show only core interactive elements: the orb, the feed, the large pane, and Done and Cancel in the handoff view.
- Do not add explanatory text. No subtitles, taglines, status badges or pills, helper text, or toasts that narrate state.
- State shows through the orb and through the feed content, not through labels.

**Event protocol.** The client keeps one authenticated WebSocket to the session server. All messages are JSON with a type field.

| Direction | Types |
| --- | --- |
| Server to client | transcript, job.started, job.progress, job.done, show, handoff.requested, handoff.ended, approval.requested |
| Client to server | transcript, tool.call (relay of a voice-model tool call), handoff.done, handoff.cancel, approval.answer |

Only one device holds the live voice session at a time. Other devices show the feed and can take over the voice session.

## GCP deployment

Use managed services for everything except the user VMs. This table is from general GCP knowledge, not from current documentation. Check each product and limit before you build.

| Part | Service | Notes |
| --- | --- | --- |
| User VM | Compute Engine with a persistent disk | One VM for each user. Snapshot schedule on the disk. No inbound ports. |
| agentd | A process on the user VM | Opens one outbound connection to the session server. |
| Session server and agent loop | Cloud Run with CPU always allocated and at least one instance, or GKE | Holds client sockets, runs the smart-model loop, mints ephemeral tokens. Saves a checkpoint after every step, so a restart resumes the task. |
| State | Firestore | Users, tasks, jobs, event log, conversation summaries. Clients can listen for changes. |
| Login | Identity Platform | One account system for all clients. |
| Secrets | Secret Manager | Gemini API key and, later, OAuth tokens. Never copied into a VM. |
| Push notifications | Firebase Cloud Messaging | Handoff, approval, and job-done alerts. |
| Screen stream | WebRTC server on the VM, with signaling through the session server and a TURN relay on a small Compute Engine instance | WebRTC needs UDP. Cloud Run cannot carry it. Evaluate Selkies for the stream. |
| Entry point | Cloud Load Balancing | Terminates TLS for the session server. |
| Outbound traffic | Cloud NAT and firewall rules | In version 2, route through a controlled egress proxy for approvals. |

**Network rules for the VM**

- Block access to the instance metadata server from the agent kernel (169.254.169.254). Otherwise the agent can read the service account token of the VM.
- Give the VM service account no permissions.
- Deny the VM access to internal services except the session server.

**Voice path.** The client connects straight to Gemini Live with an ephemeral token. The server mints each token with the API key. A token has a short life. Reports give 1 minute to start a session and 30 minutes to send messages, and you can change both.

**Region.** Put the VM, the disk, and the session server in the region nearest to the user. Distance adds delay to each voice turn.

## Security

The largest risk is prompt injection. A web page, an email, or a file can contain text that tells the agent to act. The agent must treat that text as data. Rules for the agent cannot be the only defense, because the agent can be tricked. Put the hard limits outside the VM.

**Rules**

1. Wrap every tool result that comes from outside (web, email, files) in clear delimiters. The system prompt says that text inside them is never an instruction.
2. Gate sensitive actions with the approval flow: send, buy, delete, post, share, and account changes. In version 2, enforce the gate in the egress proxy.
3. Keep secrets out of the VM. The API key stays on the server. Environment variables and files in the VM hold no secrets.
4. Block the metadata server from the agent. Give the VM service account no permissions.
5. Give the VM no inbound ports. One VM serves one user only.
6. Write an audit log on the server for every tool call, approval, and handoff. The user can read it. The agent cannot change it.
7. During a handoff, capture nothing. See the handoff section.
8. Filter one-time codes and reset links out of any email that the agent can read.
9. Protect the client. Store tokens in the keychain of the operating system. Do not expose a setting that changes the audio endpoint. A researcher showed that a local setting in the Meta Muse Mac app could send voice input to an attacker.
10. Use the speaker check in shared rooms, so a person nearby cannot give the agent commands by voice.
11. Keep snapshots of the disk, so the user can roll back.
12. Store the voice sample of the user on the device only, with consent.

## Cost controls

Caching saves the most. Voice cost depends on the minutes of audio sent, so the gate also saves money. Build the controls below from the start, and log the billed tokens for every turn.

| Control | How | Effect |
| --- | --- | --- |
| Context caching | Turn on caching for the smart model. Keep the stable prompt and history at the start of each request. | Cached input costs about 10% of normal input. This is the largest saving. |
| Data in variables | Keep large results in Python variables. Print slices. | Fewer input tokens on each step. |
| Text before screenshots | Read pages as text or as an accessibility tree. | An image costs many more tokens than the text of the same page. |
| Saved tools | Save repeated work as scripts. | No model tokens for those steps on later runs. |
| Context summaries | Replace old steps with a short summary. | Stops the cost of each step from growing in a long task. |
| Send speech only | Voice activity detection on the device. | Silence is not billed. |
| Short spoken answers | The say field has at most 2 sentences. Put detail on the screen. | Audio output is the most expensive audio token. |
| Close idle sessions | Close the Live session after a short idle time. Default 2 minutes. | No billing for an open, silent session. |
| Job budgets | Set max tokens, max wall time, and max steps for each job. | Stops a job that loops. |
| Daily cap | Set a spend cap for each user. | Limits the worst case. |
| Idle VM stop | VM\_IDLE\_STOP\_MINUTES, default 30. | No compute cost while stopped. The disk still costs. |
| Batch for slow jobs | Use the batch API for jobs that are not urgent. | Providers usually give about 50% off. Confirm for Gemini. |

**Planning numbers.** These are list prices from the Google pricing page and my estimates. They are not measured.

| Item | Price |
| --- | --- |
| Gemini 3.8 Live, audio in | $0.005 per minute |
| Gemini 3.8 Live, audio out | $0.018 per minute |
| Gemini 3.8 Flash, per 1M tokens | $0.75 input, $3.75 output until Dec 31, 2026 |
| Gemini 3.8 Flash, from Jan 1, 2027 | $1.50 input, $7.50 output |
| Gemini 3.1 Pro Preview, per 1M tokens | $2 input, $12 output |

For one heavy user (10 hours of voice and 50M input and 5M output tokens each month), the model cost is about $70 with no controls and about $26 with caching, saved tools, and short voice answers. The VM cost is not in these numbers. Measure it.

The free tier is for development only. Google uses free-tier content to improve its products. Use the paid tier for any real user.

## Billing and credits

Users pay a monthly subscription through Stripe. The subscription includes credits. Credits pay for model use and VM time. You pay Google with one API key.

| Part | How it works |
| --- | --- |
| Subscription | Stripe Billing, one monthly price. Stripe Checkout and the customer portal handle cards, plan changes, and cancels. A webhook tells the server when a payment succeeds or fails. |
| Credits | One unit for all usage. Pick a fixed price for one credit, for example $0.01. Store balances as whole numbers. |
| Included credits | Each paid cycle adds a grant. Decide if unused credits roll over. |
| Top-ups | One-time Stripe payments that add credits. Auto top-up is optional. |
| Ledger | A table on the session server is the source of truth for the balance. Stripe is for payments only. The server checks and deducts on every turn, so it needs a fast local balance. |
| Metering | Turn usage into credits when it happens: live audio from the Gemini Live usage counts, smart-model tokens from each response, and VM hours while the VM runs. Charge a flat monthly part for disk storage. |
| Holds | When a job starts, reserve its budget in credits. When the job ends, return the unused part. |
| Price | Set the credit price above your cost. Cover Gemini use, VM and disk, relay servers, Stripe fees, taxes, and support. Use measured cost for each user, not the estimates in this document. |

**Rules**

1. If credits run out, the voice model says so in one sentence and the server sends a push notification. Running jobs finish their current step, save their state, and pause. No data is deleted.
2. At 20% of credits left, the voice model says so once.
3. Show the balance and the top-up button only on a settings screen. Add no banners and no helper text.
4. Give new users a small trial grant. Do not use the Gemini free tier for users.
5. Sell subscriptions and credits on the web only, until you check the Apple and Google rules for digital purchases. The native apps only use credits.
6. Limit trial grants for each device and payment method, to reduce abuse. Rate-limit sign-ups.
7. Stripe also offers usage-based billing and credit grants. Evaluate them. Keep your own ledger if they cannot deduct credits fast enough for each voice turn.

## Build order

Build in this order. Do not start a milestone until the test of the one before it passes.

1. **Voice shell.** A web page that connects to Gemini 3.8 Live with an ephemeral token. Push to talk. Test: talk, hear an answer, interrupt it. Run a 10-minute session on the paid tier and record the billed tokens for each minute.
2. **Voice gate.** Echo cancellation, voice activity detection, turn detector, barge-in rule. Test with recorded cases: a pause in the middle of a sentence does not end the turn. The model does not answer its own voice from speakers. A cough does not stop the model.
3. **VM, agentd, and the python tool.** One VM. One kernel for each task. The session server runs the smart-model loop. Test: ask for a CSV and a summary. The job runs in the background while the user keeps talking.
4. **Job protocol.** The tools start\_job, check\_job, and cancel\_job. The job result contract with say and show. The show pane on the client. Test: two jobs run in parallel and the voice stays responsive.
5. **Memory and saved tools.** Disk layout, index files, summaries. Test: a second run of a repeated task uses a saved tool and fewer tokens.
6. **Browser and computer tool.** Text-first reading. Desktop lock. Test: collect data from a site that has no API.
7. **Handoff.** Screen stream, pause, push notification, Done. Test: the user logs in during a handoff and the agent continues. Check that no screenshot was taken during the handoff.
8. **Approvals, audit log, and network rules.** Test: a web page that tells the agent to send an email does not cause an email to be sent.
9. **Cost controls.** Job budgets, daily caps, idle stop, and the credit ledger with Stripe. Test: a job that exceeds its budget stops. An idle VM stops and then starts again on the next request. A user with no credits cannot start a job.
10. **Native clients.** Phone, tablet, desktop, and watch (voice and notifications).
11. **Later options.** Plan login for OpenAI after approval. Users who bring their own API key. Speaker check. Egress proxy that enforces approvals. A self-hosted voice model.

## Facts to verify before launch

The research for this design used news articles and summaries of provider pages. Check each item below against the primary source.

**Gemini 3.8 Live**

- Can you turn off automatic activity detection and send your own activity start and end signals?
- What is the exact syntax to declare a tool as non-blocking?
- Are session resumption and context compression available? What is the current audio-only session limit?
- Does the billing repeat the accumulated context on each turn? How is silence billed?
- What do thinking tokens cost on the Extended Thinking version? A third-party report suggests the cost is higher than the base version.
- Is the addressed-to-me feature (proactive audio) available on version 3.8?

**Smart model**

- Does the chosen Gemini model support computer use? The pricing page that I read lists no computer use model. If it does not, use a different approach for screen control, or a different model for that tool.
- Is Gemini 3.8 Flash strong enough for the agent loop? Test it against Gemini 3.1 Pro Preview on real tasks. The model name is a config value, so the change is small.
- The Flash price doubles on January 1, 2027.

**GCP**

- The cost of a VM for each user, with the idle stop. This design does not estimate it.
- The start time of a stopped VM. The user expects it to be fast. Set a target and measure against it.
- A working WebRTC desktop stream with a TURN relay on Compute Engine.
- Whether Cloud Run is acceptable for long agent loops, or whether GKE is needed.

**Terms and law**

- Free-tier content is used by Google to improve its products. Use the paid tier for real users.
- Check the Gemini API terms for users in the European Economic Area, the United Kingdom, and Switzerland.
- A voice sample for the speaker check is biometric data. Get consent. Store it on the device.
- The OpenAI plan login needs approval for a hosted app. Apply early if you want it.

**Billing**

- Stripe: do credit grants and usage-based billing fit, or is your own ledger simpler?
- Apple and Google rules for selling digital subscriptions and credits inside native apps.
- Tax handling for your sales regions.
- Does Gemini Live report usage for each turn, so you can meter credits?

**Product choices**

- Who pays for model use: decided. Users pay a monthly subscription through Stripe that includes credits. See Billing and credits.
- VM power: decided. The VM stops when idle and starts again fast. Measure the start time.
