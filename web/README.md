# apparatus web client

The thin client: microphone capture, the voice gate, the Live session, the
feed, the show pane and the handoff view. It holds no agent state, no prompt
and no model name. The same bundle runs inside the native shells through
`bridge.js`.

## Commands

```sh
npm run typecheck   # tsc --noEmit
npm run build       # node build.mjs -> dist/
npm test            # node --test test/*.test.ts (Node 22, native type stripping)
npm run verify      # all three; green before any push
```

`build.mjs` uses the esbuild JS API and needs no network. It writes:

| Output | Source | Role |
|---|---|---|
| `dist/app.js` | `src/main.ts` | the app (ESM, es2022, source map) |
| `dist/worklet.js` | `src/audio/worklet.ts` | AudioWorklet: downmix, resample to 16 kHz, 20 ms Int16 frames |
| `dist/bridge.js` | `src/bridge-web.ts` | default web bridge; a native shell overwrites this file |
| `dist/index.html` | `src/index.html` | loads `bridge.js` then `app.js` |

The session server serves `dist/` at `/`. The page uses relative URLs:
`POST /token` and `GET /ws/client?auth=<auth>&device=<device>` on the same
origin, or on `bridge.serverOrigin` inside a shell.

## Run

1. Start the session server in dev mode.
2. `npm run build`.
3. Open the server origin in a browser. The auth value comes from
   `bridge.secureStore.get("apparatus.auth")` (localStorage on the web) and
   falls back to `dev`.
4. Press the orb to open the microphone, or hold `talk`.

## Gate pipeline

Per 20 ms frame, in `src/gate/gate.ts`:

1. Echo cancellation, noise suppression, gain: browser/OS voice processing,
   requested in the `getUserMedia` constraints (`src/audio/capture.ts`).
   The AEC reference is the device output; playback goes through one
   `AudioContext` to that output. There is no direct reference feed.
2. VAD (`vad.ts`): RMS energy against `vad_energy_threshold`; `active`
   adds `vad_hangover_ms` after the last voiced frame.
3. Minimum duration: a candidate with less than `min_speech_ms` of raw voice
   is dropped as `too_short`. Candidate frames are buffered on the device
   and flushed when the segment is confirmed.
4. Barge-in bar (`bargein.ts`, `words.ts`): while playback has audio
   scheduled, the candidate must reach `bargein_min_voice_ms` of voice and
   `bargein_min_words` words. Words come from the energy contour (one burst
   between two dips is one word) or from the interim transcript, whichever
   is larger. A candidate that never clears the bar is dropped as
   `bargein_rejected`. On a valid barge-in the gate emits `bargeIn`, the
   controller calls `playback.stop()`, and the turn continues as normal. The
   Live server also sends `interrupted`, which stops playback too.
5. Speaker check (`speaker.ts`): off unless `speaker_check` is true.
6. Turn detector (`turn.ts`): silence from the last raw voiced frame.
   The turn ends at `silence_complete_ms` when the completeness model says
   the transcript looks complete, else at `silence_incomplete_ms`.

Events: `speechStart` -> `realtimeInput.activityStart`; `audio` ->
`realtimeInput.audio`; `speechEnd` -> `realtimeInput.activityEnd`.
Automatic activity detection is off in the server-built `setup`.

Manual path: holding `talk` forces the turn open past every filter;
releasing ends it. `stop` flushes playback and ends any open turn.
Clicking the orb claims the voice session (`voice.claim`) or toggles the
microphone when this device holds it.

### Thresholds

Every threshold lives in `config/apparatus.toml` `[gate]`. The server sends
that table in `ready.gate`; `src/config.ts` holds equal values as fallbacks
and `mergeGate` fills any missing field. The table applies when the voice
controller is created at the first `ready`.

| Field | Use |
|---|---|
| `vad_energy_threshold` | RMS on the [-1, 1] scale that counts as voice |
| `vad_hangover_ms` | `active` stays true this long after the last voiced frame |
| `min_speech_ms` | shorter candidates are dropped |
| `silence_complete_ms` | end of turn after a complete-looking sentence |
| `silence_incomplete_ms` | end of turn after an incomplete one |
| `bargein_min_voice_ms`, `bargein_min_words` | the bar while the model speaks |
| `bargein_stop_ms` | playback stop budget; `Playback.stop()` cancels every scheduled source at once |
| `speaker_check`, `speaker_match_threshold` | speaker check on/off and cosine threshold |

`ready` may also carry `live.idle_close_seconds` (default 120). With no
speech and no job event for that long the Live socket closes and the
microphone stops; the next talk press reopens both with a fresh token and
the stored resumption handle.

### Decision log

`gate.log()` returns the ring buffer of `{t, decision, reason}`; `t` is ms
of audio processed. In the page, `window.apparatusGateLog()` returns it.
It never holds audio.

## Live wiring

`src/live/session.ts` opens the Live socket with the ephemeral token, sends
the `setup` object from `/token` verbatim, waits for `setupComplete`, then
streams. Realtime input sent before setup completes is queued (30 s cap).
`src/live/messages.ts` has the pure builders and the parser; one server
message becomes a list of events.

| Live event | Action |
|---|---|
| `toolCall.functionCalls[]` | `C2S.tool.call` per call; `S2C.tool.result` -> `toolResponse` with its `scheduling` |
| `serverContent.interrupted` | `playback.stop()` |
| `inputTranscription` / `outputTranscription` | `C2S.transcript` (interim and final), feed card, gate transcript |
| `usageMetadata` | `C2S.live.usage`; audio ms from AUDIO modality tokens when present, else from PCM bytes |
| `sessionResumptionUpdate.newHandle` | `C2S.live.resumption`, kept for reconnects |
| `goAway` | open a second session now; switch when it is ready and no turn is open, or 1 s before `timeLeft` ends |
| any `S2C` with `voice` | `clientContent` turn `<event>text</event>`, `turnComplete: true`, only when this device holds voice and a session is open |

`voice.revoked` closes the Live session and stops capture; the page keeps
showing the feed.

## Bridge

`src/bridge.ts` defines the seam to a native shell. `dist/bridge.js` runs
before `app.js` and sets `window.apparatusBridge`; the web default
(`src/bridge-web.ts`) installs one when none exists.

```ts
interface ApparatusBridge {
  platform: "web" | "desktop" | "ios" | "android";
  serverOrigin?: string;           // shells bake it in; web: undefined = page origin
  secureStore: { get(key): Promise<string|null>; set(key, value): Promise<void>; delete(key): Promise<void> };
  push?: { register(): Promise<{platform: "fcm"|"apns"|"web"; token: string} | null>;
           onNotification(cb: (data: Record<string, string>) => void): void };
  notify?: (title: string, body: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}
```

- Auth comes from `secureStore.get("apparatus.auth")`, fallback `dev`.
- `hello.device` and `?device=` map from `platform`; `ios`/`android` with a
  viewport of 768 px or more send `tablet`.
- With `push`, the app calls `register()` after `ready` and sends
  `C2S.push.register {platform, token}`. A notification with
  `data.kind === "handoff"` opens the handoff view for `data.handoff_id`.
- With `notify`, `handoff.requested` and `approval.requested` raise a local
  notification while the page is hidden.
- No UI changes `serverOrigin` or the Live URL (security rule 9).

## Layout

`src/ui/layout.ts` injects one stylesheet. Under 360 px: feed only. Under
768 px: feed and orb bar; the pane shows above the feed when it has
content; the handoff view takes the whole screen. 768 to 1023 px: pane
left, feed right. From 1024 px: feed left, large pane right. The handoff
view always lives inside the pane element.

## Handoff

`src/ui/handoff.ts` opens an `RTCPeerConnection` with a receive-only video
transceiver and a data channel named `input`. Signaling payloads go through
`C2S`/`S2C.signal {handoff_id, payload}` in the perfect-negotiation shape:
`{description: {type, sdp}}` or `{candidate: {...}}`. This side offers
first and also answers an offer from the VM. Input events are JSON on the
data channel: `mouse.move|mouse.down|mouse.up|wheel|key.down|key.up|touch`
with `x`, `y` normalized 0..1 on the video picture, `button`, `dx`, `dy`,
`key`, `code`, `phase`. The VM side must match this shape; agree on it
before the first end-to-end test. No ICE servers are configured yet; pass
`iceServers` to `HandoffView` once the TURN relay exists.

## Stubs and open items

| Part | State |
|---|---|
| Wake word | `WakeWordDetector` interface in `gate.ts`; no detector. Open mic starts without one. |
| Silero VAD | `Vad` interface; `EnergyVad` ships. A model wraps its probability in the same `raw`/`active` contract. |
| Smart Turn / LiveKit turn detector | `CompletenessModel` interface; `HeuristicCompleteness` ships (terminal punctuation -> complete; trailing preposition, conjunction, article, filler or auxiliary -> incomplete; empty transcript -> complete). |
| Speaker embedder | `Embedder` interface; `StubEmbedder` is time-domain statistics and separates nothing. `EmbeddingSpeakerCheck` and the consent-gated `EnrollmentStore` are complete. `window.apparatusEnrollSpeaker(samples, consent)` enrolls; there is no enrollment UI. |
| Noise model (RNNoise, Krisp) | not integrated; the browser `noiseSuppression` constraint stands in. |
| Gate table changes after load | the gate reads `ready.gate` once, at creation. |
| Job events while idle-closed | the feed shows them; the Live session does not reopen to speak them. |

### Live facts to confirm against current Google docs

- The socket URL in `src/live/session.ts`: host, `v1alpha` path,
  `BidiGenerateContentConstrained`, and the `access_token` query parameter
  for ephemeral tokens.
- `realtimeInput.activityStart` / `activityEnd` with automatic activity
  detection off.
- `inputTranscription` / `outputTranscription` text is incremental; the
  client concatenates fragments until `finished` or `turnComplete`.
- `usageMetadata` field names (`promptTokenCount`, `responseTokenCount` or
  `candidatesTokenCount`, `promptTokensDetails[].modality`), and 32 audio
  tokens per second (`AUDIO_TOKENS_PER_SECOND` in `src/voice.ts`).
- `goAway.timeLeft` as a Duration string (`"12.5s"`).
- Live messages may arrive as `Blob`; the client decodes text before
  `JSON.parse`.

Nothing above the unit tests has run against a microphone or a Gemini key
yet. Milestone 1 of the build order (talk, hear an answer, interrupt) is
the first live check.
