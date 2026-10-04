# Configuration

apparatus reads one TOML file, `config/apparatus.toml`, plus a small set of environment
variables for deployment facts. The TOML holds every model name, threshold, budget and
price. The environment holds the API key and where things run. Secrets never go in the TOML.

| Where | Path |
|---|---|
| Repository | `config/apparatus.toml` |
| Server container | `/app/config/apparatus.toml` (`APPARATUS_CONFIG`) |
| Clients | None. The server sends the `[gate]` table in the `ready` message and `live.idle_close_seconds` in `/token`. |

A missing or damaged file never crashes the server. Defaults apply and one log line names
the problem. An unknown field is ignored with a log line. The gate
`verify/gates/config_documented.py` fails when a field in the TOML or in the code is missing
from this page.

## Fields

### `[models]`

| Field | Type | Default | Use |
|---|---|---|---|
| `models.voice` | string | `"gemini-3.8-live"` | Live model for the voice. Routes requests, speaks short results. |
| `models.voice_premium` | string | `"gemini-3.8-live-extended-thinking"` | Live model that reports progress while jobs run. Needs non-blocking tools only. |
| `models.smart` | string | `"gemini-3.8-flash"` | Model for the job loop. Lowest cost. |
| `models.smart_upgrade` | string | `"gemini-3.1-pro-preview"` | Model for hard jobs. Chosen per job with `model=pro` in the start_job context. |
| `models.smart_use_upgrade` | bool | `False` | Use the upgrade model for every job. |

### `[live]`

| Field | Type | Default | Use |
|---|---|---|---|
| `live.token_new_session_seconds` | int | `60` | Seconds an ephemeral token may start a session. |
| `live.token_expire_seconds` | int | `1800` | Seconds an ephemeral token may send messages. |
| `live.idle_close_seconds` | int | `120` | Client closes the Live session after this long with no speech and no job event. |
| `live.input_sample_rate` | int | `16000` | PCM rate the client sends. |
| `live.output_sample_rate` | int | `24000` | PCM rate the Live API returns. |
| `live.automatic_activity_detection` | bool | `False` | Let Gemini detect turns. False: the client gate sends activity signals. |
| `live.session_resumption` | bool | `True` | Ask for resumption handles and reuse them in the next session. |
| `live.context_window_compression` | bool | `True` | Sliding-window compression of the Live context. |
| `live.summary_max_chars` | int | `2000` | Size of the rolling conversation summary loaded into each new session. |

### `[gate]`

| Field | Type | Default | Use |
|---|---|---|---|
| `gate.vad_energy_threshold` | float | `0.015` | RMS energy above which a 20 ms frame counts as voice. |
| `gate.vad_hangover_ms` | int | `240` | Keep voice active this long after energy drops. |
| `gate.min_speech_ms` | int | `300` | Drop sounds shorter than this: a cough, a laugh, mm-hm. |
| `gate.silence_complete_ms` | int | `500` | Silence that ends a turn when the sentence looks complete. |
| `gate.silence_incomplete_ms` | int | `2500` | Silence that ends a turn when the sentence looks unfinished. |
| `gate.bargein_min_voice_ms` | int | `300` | Clear voice needed to interrupt the model while it speaks. |
| `gate.bargein_min_words` | int | `2` | Words needed to interrupt the model while it speaks. |
| `gate.bargein_stop_ms` | int | `200` | Playback must stop within this time after a valid interruption. |
| `gate.speaker_check` | bool | `False` | Compare speech with the enrolled voice. Turn on in shared rooms. |
| `gate.speaker_match_threshold` | float | `0.75` | Similarity needed for the speaker check to pass. |

### `[jobs]`

| Field | Type | Default | Use |
|---|---|---|---|
| `jobs.max_steps` | int | `40` | Model steps per job before it stops. |
| `jobs.max_tokens` | int | `400000` | Input plus output tokens per job before it stops. |
| `jobs.max_wall_seconds` | int | `900` | Wall time per job before it stops. Time in a handoff or approval counts. |
| `jobs.context_summary_chars` | int | `60000` | Replace old steps with a summary when the history passes this size. |
| `jobs.context_keep_steps` | int | `6` | Steps kept verbatim after a summary. |
| `jobs.python_timeout_seconds` | int | `120` | Kill the kernel when one python call runs longer. Blocked agentlib time does not count. |
| `jobs.handoff_wait_minutes` | int | `30` | After this wait the handoff ends with outcome `timeout` and the task stays paused. |
| `jobs.approval_wait_minutes` | int | `30` | After this wait an approval counts as denied. |

### `[vm]`

| Field | Type | Default | Use |
|---|---|---|---|
| `vm.idle_stop_minutes` | int | `30` | Stop the VM after this long with no session, no job and nothing waiting. |
| `vm.desktop_lock_wait_seconds` | int | `5` | A second task waits this long for the desktop before `desktop_busy`. |
| `vm.disk_home` | string | `"/home/agent"` | Home of the agent user on the VM. The disk layout lives under it. |

### `[stream]`

The screen stream: WebRTC from the VM to one client device, signaled through the server.

| Field | Type | Default | Use |
|---|---|---|---|
| `stream.stun_url` | string | `"stun:stun.l.google.com:19302"` | STUN server every peer uses. Empty sends no STUN entry. |
| `stream.turn_ttl_seconds` | int | `3600` | Lifetime of one minted TURN credential. |
| `stream.fps` | int | `12` | Capture rate agentd uses for the stream. |
| `stream.width` | int | `1280` | Frame width. Match the Xvfb screen in `vm/setup.sh`. |
| `stream.height` | int | `800` | Frame height. |

TURN credentials follow coturn `use-auth-secret`: username is `<unix expiry>:apparatus`, credential is `base64(HMAC-SHA1(secret, username))`. The server mints one pair per `screen.open` and sends it in `screen.opened` as part of `ice_servers`.

### `[credits]`

| Field | Type | Default | Use |
|---|---|---|---|
| `credits.credit_price_usd` | float | `0.01` | What the user pays for one credit. |
| `credits.trial_grant` | int | `500` | Credits a new user gets. |
| `credits.monthly_grant` | int | `3000` | Credits each paid cycle adds. |
| `credits.rollover` | bool | `False` | Keep unused credits at the monthly grant. |
| `credits.daily_cap` | int | `1500` | Most credits one user can spend in one UTC day. |
| `credits.low_balance_fraction` | float | `0.2` | Say "credits low" once when the balance falls to this share of the grants. |
| `credits.job_hold` | int | `100` | Credits reserved when a job starts. The unused part returns at the end. |

### `[prices]`

| Field | Type | Default | Use |
|---|---|---|---|
| `prices.live_audio_in_usd_per_minute` | float | `0.005` | List price, audio in. |
| `prices.live_audio_out_usd_per_minute` | float | `0.018` | List price, audio out. |
| `prices.smart_input_usd_per_mtok` | float | `0.75` | List price, smart model input per 1M tokens. |
| `prices.smart_output_usd_per_mtok` | float | `3.75` | List price, smart model output per 1M tokens. |
| `prices.smart_cached_input_usd_per_mtok` | float | `0.075` | List price, cached input per 1M tokens. |
| `prices.upgrade_input_usd_per_mtok` | float | `2.0` | List price, upgrade model input per 1M tokens. |
| `prices.upgrade_output_usd_per_mtok` | float | `12.0` | List price, upgrade model output per 1M tokens. |
| `prices.vm_usd_per_hour` | float | `0.1` | Your measured VM cost per running hour. |
| `prices.disk_usd_per_month` | float | `2.0` | Your measured disk cost per month. |
| `prices.markup` | float | `1.5` | Multiplier from cost to credits charged. |

## Environment

| Variable | Default | Use |
|---|---|---|
| `GEMINI_API_KEY` | empty | The one Google key. Only the session server reads it. Empty runs the fake model and fake tokens. |
| `APPARATUS_CONFIG` | `config/apparatus.toml` | Path to the config file. |
| `APPARATUS_HOST` / `APPARATUS_PORT` | `0.0.0.0` / `8080` | Server bind. |
| `APPARATUS_AUTH_MODE` | `dev` | `dev` trusts the bearer value as a user id. `firebase` verifies Identity Platform ID tokens. |
| `FIREBASE_PROJECT_ID` | empty | Audience for `firebase` auth and project for FCM. |
| `APPARATUS_STORE` | `memory` | Store adapter: `memory` or `file`. |
| `APPARATUS_DATA_DIR` | `data` | Folder for the `file` store. |
| `APPARATUS_VM_ENROLL_SECRET` | empty | Shared secret behind the VM hello HMAC. Empty accepts every VM (development). |
| `APPARATUS_VM_CONTROLLER` | `local` | `local` (no-op) or `gce` (Compute Engine start/stop). |
| `GCE_PROJECT` / `GCE_ZONE` | empty | For the `gce` controller. |
| `APPARATUS_PUSH` | `log` | Push adapter: `log` or `fcm`. |
| `APPARATUS_WEB_DIST` | `web/dist` | Folder with the built web app, served at `/`. |
| `APPARATUS_TURN_URL` | empty | TURN relay for the screen stream, for example `turn:1.2.3.4:3478?transport=udp`. Empty: STUN only. |
| `APPARATUS_TURN_SECRET` | empty | The coturn `static-auth-secret`. Needed with `APPARATUS_TURN_URL`. |

### agentd (on the VM)

| Variable | Default | Use |
|---|---|---|
| `AGENTD_SERVER_URL` | `ws://localhost:8080/ws/agentd` | The one outbound connection. |
| `AGENTD_VM_ID` / `AGENTD_USER_ID` | `local` / `dev` | Identity the VM claims in hello. |
| `APPARATUS_VM_ENROLL_SECRET` or `APPARATUS_VM_ENROLL_SECRET_FILE` | empty | Secret for the hello HMAC; the file form is for the systemd unit. |
| `AGENTD_HOME` | `/home/agent` | Root of the disk layout. |
| `AGENTD_SOCKET` | `$AGENTD_HOME/.agentd.sock` | Unix socket agentlib talks to. |
| `AGENTD_DESKTOP` | `fake` | Desktop backend: `fake` or `xdo`. |
| `DISPLAY` | `:0` | X display for `xdo`. |
| `AGENTD_PYTHON_TIMEOUT_SECONDS` | `120` | Default per-call limit when the server sends none. |
| `AGENTD_DESKTOP_LOCK_WAIT_SECONDS` | `5` | Wait before `desktop_busy`. |
| `AGENTD_KERNEL_USER` | unset | Run kernels as this user through sudo. |
| `AGENTD_MAX_OUTPUT_CHARS` | `50000` | Truncate one python call's output beyond this. |
| `AGENTD_RECONNECT_MIN_SECONDS` / `AGENTD_RECONNECT_MAX_SECONDS` | `1` / `30` | Backoff for the outbound link. |
| `AGENTD_STREAM_FPS` | `12` | Capture rate of the screen stream (`ffmpeg x11grab`). Match `stream.fps`. |
| `AGENTD_STREAM_WIDTH` / `AGENTD_STREAM_HEIGHT` | `1280` / `800` | Frame size of the screen stream and the pixel space for stream input. Match `stream.width` and `stream.height`. |

