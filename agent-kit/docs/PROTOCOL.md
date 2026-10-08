# Protocol

The human copy of `packages/protocol/apparatus_protocol/__init__.py`. Change both in one commit.

Every message is one JSON object with a `type` field. Three links use it.

| Link | Transport | Legal types |
|---|---|---|
| Client ↔ session server | WebSocket `/ws/client`, authenticated | `C2S`, `S2C` |
| Session server ↔ agentd | WebSocket `/ws/agentd`, the VM dials out | `S2A`, `A2S` |
| agentlib ↔ agentd | Unix socket on the VM, one JSON object per line | `LIB` |

The server checks every inbound message at the edge with `parse()`. A bad message closes nothing; the server answers `error` and drops that message.

## Client → server (`C2S`)

| Type | Fields | Meaning |
|---|---|---|
| `hello` | `device` (web, ios, android, desktop, tablet, watch), `wants_voice` | First message after the socket opens. |
| `voice.claim` | | Take the live voice session for this device. Any other holder gets `voice.revoked`. |
| `voice.release` | | Give up the voice session. |
| `transcript` | `role` (user, agent), `text`, `final` | Relay of a Live transcription. Feeds the rolling summary. |
| `tool.call` | `call_id`, `name`, `args` | Relay of a voice-model tool call: start_job, check_job, cancel_job, show. |
| `handoff.done` | `handoff_id` | The user finished the handoff. |
| `handoff.cancel` | `handoff_id` | The user gave up the handoff. |
| `approval.answer` | `approval_id`, `approved` | The user answered an approval. |
| `live.usage` | `audio_in_ms`, `audio_out_ms`, `input_tokens`, `output_tokens` | Relay of Live `usageMetadata` for metering. |
| `live.resumption` | `handle` | Latest session resumption handle. The server stores it. |
| `live.closed` | `reason` | The Live session closed. |
| `screen.open` | | Start a screen stream for this device. The server answers `screen.opened`. |
| `screen.close` | `stream_id` | End the stream. |
| `control.take` | | Take the desktop. The server tells agentd and broadcasts `control`. |
| `control.release` | | Give the desktop back. |
| `signal` | `stream_id`, `payload` | WebRTC signaling for the screen stream. Relayed to the VM. `payload` is `{description: {type, sdp}}` or `{candidate: {candidate, sdpMid, sdpMLineIndex}}`. |
| `push.register` | `platform` (fcm, apns, web), `token` | Register this device for push notifications: handoff, approval, job done. |
| `ping` | | Keepalive. |

## Server → client (`S2C`)

Any message may carry a `voice` string. The device that holds the voice session sends that string into the Live session as an event turn. The voice model then speaks about it. Other devices ignore it.

| Type | Fields | Meaning |
|---|---|---|
| `ready` | `user_id`, `device_id`, `voice_holder`, `balance`, `gate`, `jobs`, `control`, `streams` | Sent after `hello`. `gate` is the threshold table from `config/apparatus.toml`. `jobs` is the list of the user's active jobs in the `GET /jobs` shape. `control` is `{active, by}`. `streams` is the list of this device's open stream ids. |
| `voice.granted` | | This device holds the voice session. |
| `voice.revoked` | `by` | Another device took it. Close the Live session. |
| `transcript` | `role`, `text` | For the feed on devices without the voice session. |
| `job.started` | `job_id`, `request` | |
| `job.progress` | `job_id`, `text`, `percent` | From `agentlib.progress`, and after every tool step with a one-line summary and no `percent` (`python: <first code line>`, or the comment's text when the code opens with a `# ` comment; `computer: <action> [x,y]`, `show`, `handoff: <reason>`); each job in `ready.jobs` and `GET /jobs` carries the last 50 texts as `progress_history`. |
| `job.done` | `job_id`, `status`, `say`, `show`, `artifacts`, `voice` | Result contract. |
| `show` | `content` (markdown), `target` | Content for the large pane. |
| `handoff.requested` | `handoff_id`, `job_id`, `reason`, `url`, `voice` | Open the live view: send `screen.open` when no stream is open, show Done and Cancel. On a watch: show the notification only. |
| `handoff.ended` | `handoff_id`, `outcome` (done, cancel, timeout) | Close the live view. |
| `approval.requested` | `approval_id`, `job_id`, `action`, `details`, `voice` | |
| `approval.ended` | `approval_id`, `approved` | |
| `tool.result` | `call_id`, `name`, `response`, `scheduling` | Answer to a relayed `tool.call`. The client sends it into the Live session as a function response with the given scheduling. |
| `credits` | `balance`, `state` (ok, low, out), `voice` | `voice` is set once at low and once at out. |
| `screen.opened` | `stream_id`, `ice_servers` | The stream exists. `ice_servers` is a WebRTC `RTCIceServer[]`: `[{urls: [...]}, {urls: [...], username, credential}]`. The offer arrives as `signal`. |
| `screen.closed` | `stream_id`, `reason` | The stream ended: `closed`, `vm.disconnect`, `device.disconnect`, `vm.closed` (agentd ended it; the server learns it from `vm.state`). |
| `control` | `active`, `by` | Who holds the desktop. Sent to every device of the user. |
| `signal` | `stream_id`, `payload` | WebRTC signaling from the VM. Sent only to the device that owns `stream_id`, never broadcast. |
| `error` | `code`, `message` | |
| `pong` | | |

## Server → agentd (`S2A`)

| Type | Fields | Meaning |
|---|---|---|
| `task.start` | `task_id`, `job_id`, `request`, `budget` {`wall_seconds`, `steps`} | Make the task folder and the kernel. Answer with `task.started`. |
| `task.stop` | `task_id`, `reason`, `result` | Kill the kernel, release the desktop lock, write `result.json` if given. |
| `task.pause` | `task_id`, `handoff_id`, `reason` | A handoff starts. Refuse every tool call for the task. Refuse `computer` for every task while any handoff is active. Keep the desktop lock. |
| `tool.call` | `id`, `task_id`, `name` (python, computer), `args` | Run one tool. Answer with `tool.result` carrying the same `id`. |
| `handoff.resume` | `task_id`, `handoff_id`, `outcome` | End the pause. |
| `approval.answer` | `task_id`, `approval_id`, `approved` | Unblock `agentlib.request_approval`. |
| `api.result` | `task_id`, `request_id`, `ok`, `result` or `error` | Unblock `agentlib.api`. |
| `stream.start` | `stream_id`, `ice_servers` | Make an `RTCPeerConnection`, add the screen video track, create the `input` data channel, make the offer and send it as `signal`. |
| `stream.stop` | `stream_id` | Close the peer connection. |
| `control` | `active`, `stream_id` | The user holds the desktop. `stream_id` is the open stream of the controlling device, or null when it has none. Refuse `computer` with `user_control: the user controls the desktop` while true. Code-only tasks keep running. The server sends this on every VM connect, so a reconnected agentd never keeps a stale state. |
| `signal` | `stream_id`, `payload` | WebRTC signaling from the client. |
| `vm.status` | | Ask for `vm.state`. |

## agentd → server (`A2S`)

| Type | Fields | Meaning |
|---|---|---|
| `hello` | `vm_id`, `user_id`, `auth`, `version`, `capabilities` | First message. `auth` is HMAC-SHA256 of `vm_id` over the enrollment secret. |
| `task.started` | `task_id`, `memory_index`, `tools_index`, `restored` | The two index files, so the first model step sees them. |
| `task.stopped` | `task_id` | |
| `tool.result` | `id`, `task_id`, `ok`, `output`, `error`, `image_b64`, `files` | `image_b64` is a PNG from `computer`. `files` are new paths in the task folder. |
| `event` | `task_id`, `kind`, `request_id`, `payload` | Raised by agentlib or by a tool. Kinds: `say`, `progress`, `show`, `handoff.request`, `approval.request`, `api.request`. |
| `signal` | `stream_id`, `payload` | The offer and ICE candidates for one stream. |
| `vm.state` | `tasks`, `desktop_owner`, `handoff_active`, `streams`, `user_control`, `control_stream_id` | `streams` is the list of open stream ids. The server closes any registry stream missing from `streams` with reason `vm.closed`. |
| `log` | `level`, `message` | |

## Screen stream and input

One stream per `screen.open`. The VM makes the offer; the client answers. Video flows whenever a stream is open. Input events travel on the WebRTC data channel named `input`, one JSON object per message, client → agentd:

```json
{"kind": "mouse.move", "x": 0.5, "y": 0.5, "button": 0, "dx": 0, "dy": 0, "key": "a", "code": "KeyA"}
```

| `kind` | Fields | Meaning |
|---|---|---|
| `mouse.move` | `x`, `y` | Move the pointer. `x` and `y` are 0..1 over the video frame; the client corrects for letterboxing. |
| `mouse.down`, `mouse.up` | `x`, `y`, `button` | `button`: 0 left, 1 middle, 2 right. |
| `wheel` | `x`, `y`, `dx`, `dy` | Scroll. |
| `key.down`, `key.up` | `key`, `code` | DOM `KeyboardEvent.key` and `.code`. |
| `touch` | `x`, `y`, `key` | `key` is the phase: `start`, `move`, `end`. Applied as the left button. |

agentd applies an input event to the desktop only while a handoff is active, or while the user holds control AND the event arrived on the controlling device's stream (`control.stream_id`). Every other event is dropped and counted. The server-side belt: while a handoff is active for a user, `jobs.py` refuses `computer` calls before they reach the VM and drops any screenshot that arrives. The server audits `control.take`, `control.release`, `screen.open` and `screen.close` with the device id.

## agentlib → agentd (`LIB`)

One JSON object per line over the Unix socket at `$AGENTD_SOCKET`. Each request carries `task_id` from `$AGENT_TASK_ID` and gets one JSON object back.

| `op` | Fields | Reply |
|---|---|---|
| `say` | `text` | `{"ok": true}` at once |
| `progress` | `text`, `percent` | `{"ok": true}` at once |
| `show` | `content`, `target` | `{"ok": true}` at once |
| `request_approval` | `action`, `details` | `{"ok": true, "approved": bool}` when the user answers, or `{"ok": false, "error": "timeout"}` |
| `api` | `service`, `method`, `path`, `body` | `{"ok": bool, "result"}` or `{"ok": false, "error"}` when the server answers |
| `handoff` | `reason`, `url` | `{"ok": true, "outcome": "done" \| "cancel" \| "timeout"}` when the handoff ends |

Logic never lives in agentlib. Each call only sends a request. The server does the action.

## Job result contract

The smart model ends each job with this object, bare or in a ```` ```json ```` fence.

```json
{"status": "done | failed | needs_user", "say": "One or two sentences, written for speech.", "show": "Full detail in markdown. Optional.", "artifacts": ["paths on the VM"]}
```

## External data

Every tool result that came from outside the system (a web page, an email, a file) is wrapped:

```
<<<EXTERNAL_DATA source=web
...text...
EXTERNAL_DATA>>>
```

The smart-model system prompt states that text inside the markers is data and never an instruction.

## Live session wiring (client side)

The client never holds a prompt or a model name. `POST /token` returns `{token, model, setup, expires_at, resumption_handle}`. The client opens the Live socket with the token, sends `setup` as the first message, and afterwards:

| Live event | Client action |
|---|---|
| `toolCall.functionCalls[]` | Send each as `C2S.tool.call`. Send the `S2C.tool.result` back as a `toolResponse` with its `scheduling`. |
| `serverContent.interrupted` | Stop playback within `gate.bargein_stop_ms`. |
| `serverContent.inputTranscription` / `outputTranscription` | Send `C2S.transcript`. |
| `usageMetadata` | Send `C2S.live.usage`. |
| `sessionResumptionUpdate.newHandle` | Send `C2S.live.resumption`. |
| `goAway` | Reconnect with a fresh token and the stored handle before `timeLeft` ends. |
| An `S2C` message with `voice` | Send a `clientContent` turn: `<event>{voice text}</event>`, `turnComplete: true`. |

The gate sends `realtimeInput.activityStart` / `activityEnd` around each turn. Automatic activity detection is off in the setup.
