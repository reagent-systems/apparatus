// Boot: bridge, auth, server socket, voice path, UI wiring.

import { getBridge, type ApparatusBridge, type BridgePlatform } from "./bridge.ts";
import { DEFAULT_GATE, DEFAULT_LIVE, mergeGate, mergeLive, type GateConfig, type LiveConfig } from "./config.ts";
import { C2S, type Device, type S2CMessage } from "./protocol.ts";
import { ServerSocket } from "./ws.ts";
import { VoiceController } from "./voice.ts";
import { Orb, type OrbState } from "./ui/orb.ts";
import { Feed } from "./ui/feed.ts";
import { Pane } from "./ui/pane.ts";
import { HandoffView } from "./ui/handoff.ts";
import { mountLayout, isTabletWidth } from "./ui/layout.ts";
import type { GateLogEntry } from "./gate/gate.ts";
import type { SpeakerProfile } from "./gate/speaker.ts";

declare global {
  interface Window {
    apparatusGateLog?: () => GateLogEntry[];
    apparatusEnrollSpeaker?: (samples: Int16Array, consent: boolean) => SpeakerProfile;
  }
}

const AUTH_KEY = "apparatus.auth";

function detectDevice(platform: BridgePlatform): Device {
  if (platform === "desktop") return "desktop";
  if (platform === "ios" || platform === "android") return isTabletWidth() ? "tablet" : platform;
  return "web";
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  return b;
}

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const bridge: ApparatusBridge = getBridge();
  const auth = (await bridge.secureStore.get(AUTH_KEY)) ?? "dev";
  const httpOrigin = (bridge.serverOrigin ?? location.origin).replace(/\/+$/, "");
  const wsOrigin = httpOrigin.replace(/^http/, "ws");
  const device = detectDevice(bridge.platform);

  // ---- UI -------------------------------------------------------------------
  const root = document.getElementById("app") ?? document.body.appendChild(document.createElement("div"));
  const feed = new Feed();
  const pane = new Pane();
  const talk = button("talk");
  const stop = button("stop");
  const orb = new Orb(() => onOrbClick());
  const handoff = new HandoffView({
    sendSignal: (handoff_id, payload) => ws.send({ type: C2S.SIGNAL, handoff_id, payload }),
    onDone: (handoff_id) => {
      ws.send({ type: C2S.HANDOFF_DONE, handoff_id });
      closeHandoff();
    },
    onCancel: (handoff_id) => {
      ws.send({ type: C2S.HANDOFF_CANCEL, handoff_id });
      closeHandoff();
    },
  });
  mountLayout(root, { feed: feed.el, pane: pane.el, orb: orb.el, talk, stop });

  // ---- state ----------------------------------------------------------------
  let gateConfig: GateConfig = DEFAULT_GATE;
  let liveConfig: LiveConfig = DEFAULT_LIVE;
  let voice: VoiceController | null = null;
  let pushRegistered = false;

  // Created at the first `ready`, so the gate runs on the server's table and
  // never on the fallbacks. Presses before that do nothing.
  function createVoice(): VoiceController {
    if (voice) return voice;
    voice = new VoiceController({
      serverOrigin: httpOrigin,
      auth,
      gateConfig,
      liveConfig,
      send: (msg) => ws.send(msg),
      onTranscript: (role, text, final) => feed.transcript(role, text, final),
      onChange: refreshOrb,
      storage: storageOrNull(),
    });
    const v = voice;
    window.apparatusGateLog = () => v.gate.log();
    window.apparatusEnrollSpeaker = (samples, consent) => v.enroll(samples, consent);
    return v;
  }

  function refreshOrb(): void {
    const v = voice;
    let state: OrbState = "idle";
    if (v?.listening) state = "listening";
    else if (v?.speaking) state = "speaking";
    else if (feed.runningJobs > 0) state = "working";
    orb.setState(state);
    orb.setHeld(v?.holdsVoice ?? false);
    orb.setLive(v?.liveOpen ?? false);
  }
  setInterval(refreshOrb, 100);

  function openHandoff(handoffId: string): void {
    handoff.open(handoffId);
    pane.host(handoff.el);
  }

  function closeHandoff(): void {
    handoff.close();
    pane.unhost();
  }

  function notifyIfHidden(body: string): void {
    if (!bridge.notify || document.visibilityState === "visible") return;
    void bridge.notify("apparatus", body).catch(() => undefined);
  }

  function onOrbClick(): void {
    const v = voice;
    if (!v) return;
    if (!v.holdsVoice) {
      v.start(); // sends voice.claim; starts on voice.granted
      return;
    }
    if (v.liveOpen) v.end();
    else v.start();
  }

  // ---- server socket ----------------------------------------------------------
  const ws = new ServerSocket({
    origin: wsOrigin,
    auth,
    device,
    onOpen: () => ws.send({ type: C2S.HELLO, device, wants_voice: true }),
    onMessage: handle,
  });

  function registerPush(): void {
    if (pushRegistered || !bridge.push) return;
    pushRegistered = true;
    const push = bridge.push;
    push.onNotification((data) => {
      if (data.kind === "handoff") {
        const id = data.handoff_id ?? data.id;
        if (id) openHandoff(id);
      }
    });
    void push
      .register()
      .then((reg) => {
        if (reg) ws.send({ type: C2S.PUSH_REGISTER, platform: reg.platform, token: reg.token });
      })
      .catch((err: unknown) => console.error("push", err));
  }

  function handle(msg: S2CMessage): void {
    switch (msg.type) {
      case "ready": {
        gateConfig = mergeGate(msg.gate);
        liveConfig = mergeLive(msg.live);
        createVoice().setHoldsVoice(msg.voice_holder !== null && msg.voice_holder === msg.device_id);
        registerPush();
        break;
      }
      case "voice.granted":
        voice?.setHoldsVoice(true);
        break;
      case "voice.revoked":
        voice?.setHoldsVoice(false);
        break;
      case "transcript":
        // the voice holder shows its own Live transcripts
        if (!voice?.holdsVoice) feed.transcript(msg.role, msg.text, true);
        break;
      case "job.started":
        feed.jobStarted(msg.job_id, msg.request);
        break;
      case "job.progress":
        feed.jobProgress(msg.job_id, msg.text, msg.percent ?? null);
        break;
      case "job.done":
        feed.jobDone(msg.job_id, msg.status, msg.say);
        if (msg.show) pane.showMarkdown(msg.show);
        break;
      case "show":
        pane.showMarkdown(msg.content);
        break;
      case "handoff.requested":
        feed.handoff(msg.reason);
        openHandoff(msg.handoff_id);
        notifyIfHidden(msg.voice ?? msg.reason);
        break;
      case "handoff.ended":
        if (handoff.active === msg.handoff_id) closeHandoff();
        break;
      case "approval.requested":
        feed.approval(msg.approval_id, msg.action, msg.details, (approved) =>
          ws.send({ type: C2S.APPROVAL_ANSWER, approval_id: msg.approval_id, approved }),
        );
        notifyIfHidden(msg.voice ?? `${msg.action}: ${msg.details}`);
        break;
      case "approval.ended":
        feed.approvalEnded(msg.approval_id, msg.approved);
        break;
      case "credits":
        feed.credits(msg.voice);
        break;
      case "signal":
        void handoff.handleSignal(msg.handoff_id, msg.payload);
        break;
      case "error":
        console.error("server", msg.code, msg.message);
        break;
      case "tool.result":
      case "pong":
        break;
    }
    voice?.handleServer(msg);
    refreshOrb();
  }

  // ---- buttons ----------------------------------------------------------------
  talk.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    talk.setPointerCapture(e.pointerId);
    talk.classList.add("bar__talk--down");
    voice?.pressTalk();
  });
  const release = (): void => {
    talk.classList.remove("bar__talk--down");
    voice?.releaseTalk();
  };
  talk.addEventListener("pointerup", release);
  talk.addEventListener("pointercancel", release);
  talk.addEventListener("lostpointercapture", release);
  talk.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      if (!e.repeat) voice?.pressTalk();
      e.preventDefault();
    }
  });
  talk.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") release();
  });
  stop.addEventListener("click", () => voice?.stop());

  ws.connect();
}

void boot();
