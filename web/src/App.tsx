// The one React tree. Reads every context, computes the orb state, wires the
// views into the shell, keeps the behaviors the page always had: push
// registration, a local notification while hidden, the handoff lock on the
// pane, the PiP when the pane closes on an open stream, and the keyboard.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { VoiceComposer } from "@/components/composer/VoiceComposer";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { StatusBar } from "@/components/layout/StatusBar";
import type { OrbState } from "@/components/orb/Orb";
import { Inspector } from "@/components/pane/Inspector";
import { Rail } from "@/components/rail/Rail";
import { Thread } from "@/components/thread/Thread";
import { AuditView } from "@/components/views/AuditView";
import { CreditsView } from "@/components/views/CreditsView";
import { JobsView } from "@/components/views/JobsView";
import { ScreenPip } from "@/components/vm/ScreenPip";
import { detailsText, runningJobs } from "@/feed/reducer";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { focusNeedsYou, useShortcuts } from "@/hooks/use-shortcuts";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useScreenStore } from "@/state/screen";
import { useSelection } from "@/state/selection";
import { useServer, useServerMessages } from "@/state/server";
import { useVoice } from "@/state/voice";

export function App() {
  const server = useServer();
  const voice = useVoice();
  const breakpoint = useBreakpoint();
  const [feed, dispatch] = useFeed();
  const selection = useSelection();
  const screen = useScreenStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pushRegistered = useRef(false);

  const { bridge, send, ready } = server;
  const { view, setView, paneOpen, setPaneOpen, paneMode, setPaneMode, setPaneLocked, statusBar, notifications, railOpen, setRailOpen } =
    selection;
  const handoffId = feed.handoff?.handoffId ?? null;

  // Local notification while the page is hidden.
  useServerMessages((msg) => {
    if (!bridge.notify || !notifications || document.visibilityState === "visible") return;
    let body: string | null = null;
    if (msg.type === "handoff.requested") body = msg.voice ?? msg.reason;
    else if (msg.type === "approval.requested") body = msg.voice ?? `${msg.action}: ${detailsText(msg.details)}`;
    if (body) void bridge.notify("apparatus", body).catch(() => undefined);
  });

  // Push registration once, after the first `ready`.
  useEffect(() => {
    if (!ready || pushRegistered.current || !bridge.push) return;
    pushRegistered.current = true;
    const push = bridge.push;
    push.onNotification((data) => {
      if (data.kind === "handoff") {
        const id = data.handoff_id ?? data.id;
        if (id) dispatch({ kind: "handoffOpened", handoffId: id });
      }
    });
    void push
      .register()
      .then((reg) => {
        if (reg) send({ type: C2S.PUSH_REGISTER, platform: reg.platform, token: reg.token });
      })
      .catch((err: unknown) => console.error("push", err));
  }, [ready, bridge, send, dispatch]);

  // A handoff opens the pane in Screen and holds it there until it ends.
  useEffect(() => {
    if (handoffId !== null) {
      setPaneMode("screen");
      setPaneOpen(true);
    }
    setPaneLocked(handoffId !== null);
  }, [handoffId, setPaneMode, setPaneOpen, setPaneLocked]);

  const toggleControl = useCallback(() => {
    if (screen.controlledByMe) screen.releaseControl();
    else if (screen.status === "live") screen.takeControl();
  }, [screen]);

  useShortcuts({
    onShortcut: (shortcut) => {
      switch (shortcut) {
        case "palette":
          setPaletteOpen((o) => !o);
          return;
        case "rail":
          // Desktop and tablet: the SidebarProvider owns Cmd/Ctrl+B.
          if (breakpoint === "phone") setRailOpen(!railOpen);
          return;
        case "pane":
          setPaneOpen(!paneOpen);
          return;
        case "needsYou":
          setView("thread");
          setTimeout(() => focusNeedsYou(), 0);
          return;
        case "control":
          toggleControl();
          return;
        case "stop":
          voice.stop();
          return;
        default:
          setView(shortcut.slice("view:".length) as typeof view);
      }
    },
    onTalkDown: () => voice.pressTalk(),
    onTalkUp: () => voice.releaseTalk(),
  });

  const running = runningJobs(feed);
  let orbState: OrbState = "idle";
  if (!server.connected) orbState = "connecting";
  else if (voice.listening) orbState = "listening";
  else if (voice.speaking) orbState = "speaking";
  else if (running.length > 0) orbState = "working";

  let main: ReactNode;
  switch (view) {
    case "jobs":
      main = <JobsView />;
      break;
    case "audit":
      main = <AuditView />;
      break;
    case "credits":
      main = <CreditsView />;
      break;
    default:
      main = <Thread />;
  }

  // The PiP: the desktop, the pane closed on the Screen, a stream still open.
  const pip =
    breakpoint === "desktop" && view === "thread" && !paneOpen && paneMode === "screen" && screen.status === "live" ? <ScreenPip /> : null;

  return (
    <>
      <AppShell
        rail={<Rail />}
        main={main}
        pane={<Inspector />}
        composer={<VoiceComposer orbState={orbState} />}
        statusBar={breakpoint === "desktop" && statusBar ? <StatusBar /> : null}
        pip={pip}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
