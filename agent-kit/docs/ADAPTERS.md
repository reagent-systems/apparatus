# Adapters

An adapter connects apparatus to one environment: where state lives, who signs the user in,
how a VM starts, how a push is sent, which model answers. apparatus has 8 adapter seams.
Each is a Python `Protocol` with 2 implementations; the first listed is the default and the
safe one. Select one with the environment variable named in each section.

## Store (`APPARATUS_STORE`)

`memory` keeps everything in the process; it starts nothing and loses all on restart.
`file` writes one JSON file per document and one JSONL per log under `APPARATUS_DATA_DIR`.
A `firestore` adapter is queued (ROADMAP item 4).

```sh
APPARATUS_STORE=file APPARATUS_DATA_DIR=data
```

Interface: `server/apparatus_server/store.py` `Store` — `get`, `put`, `delete`, `list`, `append`, `entries`.

## Authenticator (`APPARATUS_AUTH_MODE`)

`dev` trusts the bearer value as the user id; development only. `firebase` verifies an
Identity Platform ID token (RS256, Google's certificates, audience = project).

```sh
APPARATUS_AUTH_MODE=firebase FIREBASE_PROJECT_ID=my-project
```

Interface: `auth.py` `Authenticator.user_id(token) -> str`.

## VM controller (`APPARATUS_VM_CONTROLLER`)

`local` does nothing: agentd runs on this machine. `gce` starts and stops the user's
Compute Engine instance, named by `vm.instance_name(user_id)`.

```sh
APPARATUS_VM_CONTROLLER=gce GCE_PROJECT=my-project GCE_ZONE=us-central1-a
```

Interface: `vm.py` `VmController` — `start`, `stop`, `status`.

## Push (`APPARATUS_PUSH`)

`log` writes a log line. `fcm` calls Firebase Cloud Messaging HTTP v1 with the server's
service-account token; FCM delivers to Android, iOS (APNs) and web.

```sh
APPARATUS_PUSH=fcm FIREBASE_PROJECT_ID=my-project
```

Interface: `push.py` `Push.send(tokens, title, body, data) -> int`.

## Token minter (`GEMINI_API_KEY`)

Empty key: `FakeTokenMinter`, tokens no API accepts, for development. A key:
`GeminiTokenMinter`, `auth_tokens.create` on v1alpha with the model and setup locked.

Interface: `tokens.py` `TokenMinter.mint(...) -> Token`.

## Smart model (`GEMINI_API_KEY`)

Empty key: `FakeSmartModel` with one scripted failure reply. A key: `GeminiSmartModel`
with explicit prefix caching; tests pass a `FakeSmartModel` with a script.

Interface: `model.py` `SmartModel.generate(model, system, history, tools) -> ModelReply`.

## Summarizer (follows the key)

`NaiveSummarizer` keeps the newest lines. `ModelSummarizer` asks the smart model.

Interface: `sessions.py` `Summarizer.summarize(summary, transcript, max_chars) -> str`.

## Desktop backend (`AGENTD_DESKTOP`, on the VM)

`fake` records calls and returns a tiny PNG. `xdo` drives an X display with xdotool and
takes screenshots with ImageMagick `import`.

```sh
AGENTD_DESKTOP=xdo DISPLAY=:0
```

Interface: `agentd/agentd/desktop.py` `DesktopBackend` — `screenshot`, `click`, `move`, `type_text`, `key`, `scroll`.

## Writing a new adapter

Implement the `Protocol` in the module named above, register it in that module's
`make_*` function, add its row here, add its variable to `docs/CONFIGURATION.md`, and give
it a test in the matching `server/tests/test_*.py` (parametrize the existing round-trip
test where one exists, as `test_store.py` does). A new adapter PR carries all four.
