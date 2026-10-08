// The scripted Gemini Live stand-in, for captures only.
//
// The web client opens its Live socket to LIVE_URL (apps/web/src/live/session.ts).
// Playwright's routeWebSocket answers that socket here, inside the harness, so
// the client's own code runs unchanged: it sends the `setup` message from
// POST /token, waits for `setupComplete`, streams the gate's turns, relays
// tool calls to the session server and injects job events as `<event>` turns.
// The stand-in sends only server messages Live sends: setupComplete,
// serverContent (inputTranscription, outputTranscription, modelTurn audio,
// generationComplete, turnComplete, interrupted), toolCall and usageMetadata.
// Shapes follow parseServerMessage in apps/web/src/live/messages.ts.

import fs from "node:fs";
import path from "node:path";
import { speechPcm } from "./audio.mjs";
import { REPO, sleep } from "./util.mjs";
import { WALL } from "./vtime.mjs";

/** LIVE_URL as the client has it, read from the source so the two never drift. */
export function liveUrl() {
  const src = fs.readFileSync(path.join(REPO, "apps/web/src/live/session.ts"), "utf8");
  const m = /export const LIVE_URL\s*=\s*"([^"]+)"/.exec(src);
  if (!m) throw new Error("LIVE_URL not found in apps/web/src/live/session.ts");
  return m[1];
}

const WORDS_PER_SECOND = 3;

/** Milliseconds a line takes to say at a calm pace. */
export function speakMs(text, wps = WORDS_PER_SECOND) {
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / wps) * 1000) + 250;
}

/** Split a line into transcription deltas the way Live streams them: a few words at a time. */
function deltas(text, size = 2) {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const out = [];
  let cur = "";
  let n = 0;
  for (const w of words) {
    cur += w;
    if (!/^\s+$/.test(w)) n += 1;
    if (n >= size && /^\s+$/.test(w)) {
      out.push(cur);
      cur = "";
      n = 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export class LiveStandIn {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.conns = [];
    this.inbox = [];
    this.waiters = [];
    this.calls = 0;
    this.seed = 7;
    // The clock its lines are paced on: the wall, or page time (lib/vtime.mjs),
    // where a wait for the client also lets page time run when the client needs it.
    this.clock = WALL;
  }

  /** Answer the client's Live socket on this page (or context). */
  async install(target) {
    const url = liveUrl();
    await target.routeWebSocket((u) => u.href.startsWith(url), (ws) => this.attach(ws));
  }

  attach(ws) {
    const conn = { ws, setup: null, open: true };
    this.conns.push(conn);
    ws.onMessage((raw) => {
      let m;
      try {
        m = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
      } catch {
        return;
      }
      if (m.setup && !conn.setup) {
        conn.setup = m.setup;
        this.log("live: setup", m.setup.model);
        this.sendOn(conn, { setupComplete: {} });
      }
      const entry = { at: Date.now(), conn, m };
      this.inbox.push(entry);
      for (const w of [...this.waiters]) {
        if (w.pred(entry)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(entry);
        }
      }
    });
    ws.onClose(() => {
      conn.open = false;
      this.log("live: closed by client");
    });
  }

  get conn() {
    for (let i = this.conns.length - 1; i >= 0; i--) if (this.conns[i].open && this.conns[i].setup) return this.conns[i];
    return null;
  }

  sendOn(conn, obj) {
    // Live delivers JSON in binary frames; the client decodes Blob and text alike.
    conn.ws.send(Buffer.from(JSON.stringify(obj), "utf8"));
  }

  send(obj) {
    const c = this.conn;
    if (!c) throw new Error("no open Live session");
    this.sendOn(c, obj);
  }

  /** Resolve with the first client message, from `since` on, that matches. */
  waitMessage(pred, { timeout = 20_000, since = 0, what = "a Live client message" } = {}) {
    const hit = this.inbox.find((e) => e.at >= since && pred(e));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred: (e) => e.at >= since && pred(e), resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`timed out waiting for ${what}`));
        }
      }, timeout);
    });
  }

  async connected(timeout = 20_000) {
    if (this.conn) return this.conn;
    const poll = async () => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (this.conn) return this.conn;
        await sleep(50);
      }
      throw new Error("the client opened no Live session");
    };
    return this.clock.until(poll());
  }

  activity(kind, since, timeout) {
    return this.clock.until(this.waitMessage((e) => e.m.realtimeInput && kind in e.m.realtimeInput, { since, timeout, what: `realtimeInput.${kind}` }));
  }

  /**
   * The user says `text`. The fake microphone plays a speech segment; the
   * client's gate opens a turn on it (activityStart) and closes it after the
   * silence that follows (activityEnd). While the turn is open, what the model
   * heard arrives as inputTranscription deltas spread over `ms`; a finished
   * marker follows the turn's end, as Live sends it. The agent must be on.
   */
  async user(text, opts = {}) {
    await this.hear(text, opts);
    await this.endTurn(opts);
  }

  /**
   * The first half of a user turn: wait for the gate's activityStart, then
   * stream what the model heard over `ms`. The turn stays open while the
   * microphone file plays its segment; `endTurn` closes it.
   */
  async hear(text, { ms = speakMs(text), timeout = 20_000, transcribe = true } = {}) {
    // Each turn takes the first activityStart after the previous turn's end.
    const since = this.turnCursor ?? 0;
    this.turnStart = (await this.activity("activityStart", since, timeout)).at;
    await this.connected();
    const parts = deltas(text, 2);
    const step = Math.max(60, ms / parts.length);
    for (const p of parts) {
      await this.clock.sleep(step);
      if (transcribe) this.send({ serverContent: { inputTranscription: { text: p } } });
    }
    this.transcribing = transcribe;
    this.userMs = ms;
  }

  /** The gate's activityEnd, then the finished marker of the input transcription, as Live sends it. */
  async endTurn({ timeout = 90_000 } = {}) {
    this.turnCursor = (await this.activity("activityEnd", this.turnStart, timeout)).at + 1;
    if (this.transcribing) this.send({ serverContent: { inputTranscription: { text: "", finished: true } } });
  }

  /**
   * The agent says `text`: 24 kHz PCM in modelTurn parts, paced a little ahead
   * of real time like Live, with outputTranscription deltas in step, then
   * generationComplete, usage and turnComplete. Resolves when the audio has
   * played out on the client.
   */
  async agent(text, { ms = speakMs(text), chunkMs = 120, tool = null } = {}) {
    await this.connected();
    const pcm = speechPcm(ms, { seed: this.seed++ });
    const bytesPerMs = 48; // 24 kHz, 16-bit mono
    const chunks = Math.ceil(ms / chunkMs);
    const parts = deltas(text, 3);
    const started = this.clock.now();
    let sentParts = 0;
    for (let i = 0; i < chunks; i++) {
      const slice = pcm.subarray(i * chunkMs * bytesPerMs, Math.min(pcm.length, (i + 1) * chunkMs * bytesPerMs));
      this.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: slice.toString("base64") } }] } } });
      const due = Math.min(parts.length, Math.ceil(((i + 1) / chunks) * parts.length));
      while (sentParts < due) this.send({ serverContent: { outputTranscription: { text: parts[sentParts++] } } });
      // Stay about 300 ms ahead of the playhead.
      const ahead = (i + 1) * chunkMs - (this.clock.now() - started);
      if (ahead > 300) await this.clock.sleep(ahead - 300);
    }
    // The spoken part ends with a finished output transcription, as Live
    // marks the end of a transcription, so the client finalises the line in
    // place before any card the tool call brings.
    this.send({ serverContent: { outputTranscription: { text: "", finished: true } } });
    // A tool call inside the turn: Live sends it after the spoken part and
    // before turnComplete (voice.py: "Say one short sentence first", then
    // start_job). The turn completes once the client has answered the call.
    let toolResult = null;
    if (tool) toolResult = await this.tool(tool.name, tool.args);
    this.send({ serverContent: { generationComplete: true } });
    this.send({
      usageMetadata: {
        promptTokenCount: 900 + Math.round((this.userMs ?? 2000) / 31),
        responseTokenCount: Math.round(ms / 31),
        totalTokenCount: 900 + Math.round((this.userMs ?? 2000) / 31) + Math.round(ms / 31),
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: Math.round(((this.userMs ?? 2000) / 1000) * 32) }],
        responseTokensDetails: [{ modality: "AUDIO", tokenCount: Math.round((ms / 1000) * 32) }],
      },
    });
    this.send({ serverContent: { turnComplete: true } });
    this.userMs = 0;
    const left = ms - (this.clock.now() - started);
    if (left > 0) await this.clock.sleep(left + 150);
    return toolResult;
  }

  /** A toolCall; resolves with the client's toolResponse (the session server's answer). */
  async tool(name, args, { timeout = 20_000 } = {}) {
    await this.connected();
    const id = `call-${++this.calls}`;
    const since = Date.now();
    this.send({ toolCall: { functionCalls: [{ id, name, args }] } });
    const e = await this.clock.until(this.waitMessage(
      (x) => x.m.toolResponse?.functionResponses?.some((r) => r.id === id),
      { since, timeout, what: `toolResponse for ${name}` },
    ));
    return e.m.toolResponse.functionResponses.find((r) => r.id === id).response;
  }

  /** The next `<event>` turn the client injects that matches `re`. Returns its text. */
  async event(re, { timeout = 60_000, since = 0 } = {}) {
    const e = await this.clock.until(this.waitMessage(
      (x) => (x.m.clientContent?.turns ?? []).some((t) => (t.parts ?? []).some((p) => re.test(p.text ?? ""))),
      { since, timeout, what: `an event turn matching ${re}` },
    ));
    const text = e.m.clientContent.turns.flatMap((t) => t.parts.map((p) => p.text)).join("");
    return text.replace(/^<event>|<\/event>$/g, "");
  }

  /** The `say` line of a job.done event, which the voice model speaks almost unchanged. */
  static sayOf(eventText) {
    const m = /^job\.done \S+: ([\s\S]*)$/.exec(eventText);
    return m ? m[1].trim() : eventText;
  }

  interrupted() {
    this.send({ serverContent: { interrupted: true } });
  }
}
