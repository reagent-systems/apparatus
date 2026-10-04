// The one React tree. State: the feed reducer, the selection in the
// sidebar, the pane mode, and the handoff from the reducer.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Controls } from "@/components/feed/Controls";
import { Feed } from "@/components/feed/Feed";
import { JobSidebar, type SidebarSelection } from "@/components/jobs/JobSidebar";
import type { OrbState } from "@/components/orb/Orb";
import { Pane, type PaneMode } from "@/components/pane/Pane";
import { AuditView } from "@/components/views/AuditView";
import { CreditsView } from "@/components/views/CreditsView";
import { recentJobs, runningJobs } from "@/feed/reducer";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { C2S } from "@/protocol";
import { useFeed } from "@/state/feed";
import { useServer, useServerMessages } from "@/state/server";
import { useVoice } from "@/state/voice";

export function App() {
  const server = useServer();
  const voice = useVoice();
  const breakpoint = useBreakpoint();
  const [feed, dispatch] = useFeed();
  const [selected, setSelected] = useState<SidebarSelection>({ kind: "live" });
  const [paneMode, setPaneMode] = useState<PaneMode>("output");
  const [sheetOpen, setSheetOpen] = useState(false);
  const pushRegistered = useRef(false);

  const { bridge, send, ready } = server;
  const handoffId = feed.handoff?.handoffId ?? null;

  // Local notification while the page is hidden.
  useServerMessages((msg) => {
    if (!bridge.notify || document.visibilityState === "visible") return;
    let body: string | null = null;
    if (msg.type === "handoff.requested") body = msg.voice ?? msg.reason;
    else if (msg.type === "approval.requested") body = msg.voice ?? `${msg.action}: ${msg.details}`;
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

  // A handoff takes the whole phone screen.
  useEffect(() => {
    if (handoffId !== null) setSheetOpen(true);
  }, [handoffId]);

  const onDone = useCallback(() => {
    if (handoffId) send({ type: C2S.HANDOFF_DONE, handoff_id: handoffId });
    dispatch({ kind: "handoffClosed" });
  }, [handoffId, send, dispatch]);
  const onCancel = useCallback(() => {
    if (handoffId) send({ type: C2S.HANDOFF_CANCEL, handoff_id: handoffId });
    dispatch({ kind: "handoffClosed" });
  }, [handoffId, send, dispatch]);
  const onAnswer = useCallback(
    (approvalId: string, approved: boolean) => {
      send({ type: C2S.APPROVAL_ANSWER, approval_id: approvalId, approved });
    },
    [send],
  );
  const onOpenJob = useCallback((jobId: string) => {
    setSelected({ kind: "job", jobId });
    setPaneMode("output");
    setSheetOpen(true);
  }, []);

  const running = runningJobs(feed);
  const recent = recentJobs(feed);

  let orbState: OrbState = "idle";
  if (!server.connected) orbState = "connecting";
  else if (voice.listening) orbState = "listening";
  else if (voice.speaking) orbState = "speaking";
  else if (running.length > 0) orbState = "working";

  let markdown = feed.show;
  let view: ReactNode | undefined;
  if (selected.kind === "job") {
    const job = feed.jobs[selected.jobId];
    markdown = job ? (job.show ?? (job.say || null)) : null;
  } else if (selected.kind === "audit") view = <AuditView />;
  else if (selected.kind === "credits") view = <CreditsView />;

  const pane = (
    <Pane
      className="h-full"
      mode={paneMode}
      onMode={(m) => {
        setPaneMode(m);
        if (m === "screen") setSheetOpen(true);
        if (m === "output" && selected.kind !== "live" && selected.kind !== "job") setSelected({ kind: "live" });
      }}
      handoffId={handoffId}
      onDone={onDone}
      onCancel={onCancel}
      markdown={markdown}
      view={paneMode === "screen" || handoffId !== null ? undefined : view}
    />
  );

  const feedColumn = (
    <>
      <Feed feed={feed} onAnswer={onAnswer} onOpenJob={onOpenJob} />
      <Controls
        orbState={orbState}
        spoken={feed.spoken}
        onScreen={
          breakpoint === "phone"
            ? () => {
                setPaneMode("screen");
                setSheetOpen(true);
              }
            : undefined
        }
      />
    </>
  );

  return (
    <AppShell
      breakpoint={breakpoint}
      sidebar={<JobSidebar running={running} recent={recent} selected={selected} onSelect={setSelected} />}
      pane={pane}
      feed={feedColumn}
      sheetOpen={sheetOpen && (handoffId !== null || paneMode === "screen" || markdown !== null)}
      sheetLocked={handoffId !== null}
      onSheetClose={() => {
        if (handoffId !== null) return;
        setSheetOpen(false);
        setPaneMode("output");
      }}
    />
  );
}
