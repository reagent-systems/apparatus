// The 24 px desktop strip (DESIGN.md 2): connection dot, the voice holder,
// the controlling device while `control.active`, the balance. Middot
// separated, an icon and a noun each. A right-click hides it; the settings
// popover brings it back.

import { useState, type ReactNode } from "react";
import { Coins, Mic, MousePointer2 } from "lucide-react";
import { DeviceName } from "@/components/status/DeviceName";
import { deviceLabel, useVoiceHolder } from "@/hooks/use-voice-holder";
import { cn } from "@/lib/utils";
import { useFeed } from "@/state/feed";
import { useScreenStore } from "@/state/screen";
import { useSelection } from "@/state/selection";
import { useServer, useServerMessages } from "@/state/server";

const ICON = { size: 12, strokeWidth: 1.5, "aria-hidden": true } as const;

function Item({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

function Sep() {
  return <span aria-hidden>·</span>;
}

export function StatusBar() {
  const { connected, ready, deviceId, device } = useServer();
  const { setStatusBar } = useSelection();
  const { controlActive } = useScreenStore();
  const holder = useVoiceHolder();
  const [{ credits }] = useFeed();
  const [controlBy, setControlBy] = useState<string | null>(ready?.control?.by ?? null);
  useServerMessages((msg) => {
    if (msg.type === "ready") setControlBy(msg.control?.by ?? null);
    else if (msg.type === "control") setControlBy(msg.active ? msg.by : null);
  });

  // Down before the first socket; reconnecting once it has been up.
  const link = connected ? "ok" : ready ? "wait" : "down";
  const items: ReactNode[] = [
    <Item key="link">
      <span
        role="img"
        aria-label={link === "ok" ? "Connected" : link === "wait" ? "Reconnecting" : "Offline"}
        data-link={link}
        className={cn(
          "inline-block size-1.5 rounded-full",
          link === "ok" && "bg-status-ok",
          link === "wait" && "bg-status-wait",
          link === "down" && "bg-destructive",
        )}
      />
    </Item>,
  ];
  if (holder && deviceLabel(holder, deviceId, device)) {
    items.push(
      <Item key="voice">
        <Mic {...ICON} />
        <DeviceName id={holder} self={deviceId} selfDevice={device} />
      </Item>,
    );
  }
  if (controlActive && controlBy && deviceLabel(controlBy, deviceId, device)) {
    items.push(
      <Item key="control">
        <MousePointer2 {...ICON} />
        <DeviceName id={controlBy} self={deviceId} selfDevice={device} />
      </Item>,
    );
  }
  if (credits !== null) {
    items.push(
      <Item key="credits">
        <Coins {...ICON} />
        <span
          className={cn("tabular-nums", credits.state === "low" && "text-status-wait", credits.state === "out" && "text-destructive")}
        >
          {credits.balance}
        </span>
      </Item>,
    );
  }

  return (
    <footer
      data-slot="status-bar"
      onContextMenu={(e) => {
        e.preventDefault();
        setStatusBar(false);
      }}
      className="flex h-6 shrink-0 items-center gap-2 border-t border-sidebar-border bg-sidebar px-3 text-[11px] text-muted-foreground select-none"
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 ? <Sep /> : null}
          {item}
        </span>
      ))}
    </footer>
  );
}
