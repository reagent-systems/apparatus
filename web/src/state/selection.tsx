// SelectionContext: what the shell shows. The view in the thread column, the
// selected job, the pane (open, mode, width, lock), the rail and the status
// bar. The view, the rail, the status bar, the pane width and the
// notification switch persist through the bridge secureStore under the
// `apparatus.*` keys in `selection-codec.ts`.
//
// `setView("screen")` opens the pane in Screen and leaves the column alone:
// the Screen row in the rail is the pane, never a column view.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePersisted, type Codec } from "../hooks/use-persisted.ts";
import { useServer } from "./server.tsx";
import {
  SELECTION_KEYS,
  formatFlag,
  formatPaneWidth,
  formatView,
  parseFlag,
  parsePaneWidth,
  parseView,
  type PaneMode,
  type View,
} from "./selection-codec.ts";

export type { PaneMode, View } from "./selection-codec.ts";

export type SelectionValue = {
  view: View;
  setView: (view: View) => void;
  selectedJobId: string | null;
  /** A job id opens the pane in Output on it; null clears the selection. */
  selectJob: (jobId: string | null) => void;
  paneOpen: boolean;
  setPaneOpen: (open: boolean) => void;
  paneMode: PaneMode;
  setPaneMode: (mode: PaneMode) => void;
  /** A handoff holds the pane in Screen; `setPaneOpen(false)` and `setPaneMode("output")` wait. */
  paneLocked: boolean;
  setPaneLocked: (locked: boolean) => void;
  /** Percent of the window, desktop only. */
  paneWidth: number;
  setPaneWidth: (percent: number) => void;
  railCollapsed: boolean;
  setRailCollapsed: (collapsed: boolean) => void;
  /** Phone only: the rail sheet. */
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
  statusBar: boolean;
  setStatusBar: (shown: boolean) => void;
  /** Local notifications while the page is hidden. */
  notifications: boolean;
  setNotifications: (on: boolean) => void;
  /** The persisted values have been read once. */
  loaded: boolean;
};

const SelectionContext = createContext<SelectionValue | null>(null);

const VIEW_CODEC: Codec<View> = { parse: parseView, format: formatView };
const RAIL_CODEC: Codec<boolean> = { parse: (raw) => parseFlag(raw, false), format: (v) => (v ? formatFlag(v) : null) };
const STATUS_BAR_CODEC: Codec<boolean> = { parse: (raw) => parseFlag(raw, true), format: (v) => (v ? null : formatFlag(v)) };
const NOTIFY_CODEC: Codec<boolean> = { parse: (raw) => parseFlag(raw, true), format: (v) => (v ? null : formatFlag(v)) };
const PANE_WIDTH_CODEC: Codec<number> = { parse: parsePaneWidth, format: formatPaneWidth };

export function SelectionProvider({ children }: { children: ReactNode }) {
  const { bridge } = useServer();
  const [view, storeView, viewLoaded] = usePersisted(bridge, SELECTION_KEYS.view, VIEW_CODEC);
  const [railCollapsed, setRailCollapsed, railLoaded] = usePersisted(bridge, SELECTION_KEYS.rail, RAIL_CODEC);
  const [statusBar, setStatusBar, statusLoaded] = usePersisted(bridge, SELECTION_KEYS.statusBar, STATUS_BAR_CODEC);
  const [paneWidth, setPaneWidth, widthLoaded] = usePersisted(bridge, SELECTION_KEYS.paneWidth, PANE_WIDTH_CODEC);
  const [notifications, setNotifications, notifyLoaded] = usePersisted(bridge, SELECTION_KEYS.notifications, NOTIFY_CODEC);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [paneOpen, setPaneOpenState] = useState(false);
  const [paneMode, setPaneModeState] = useState<PaneMode>("output");
  const [paneLocked, setPaneLocked] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const setPaneOpen = useCallback(
    (open: boolean) => {
      if (!open && paneLocked) return;
      setPaneOpenState(open);
    },
    [paneLocked],
  );

  const setPaneMode = useCallback(
    (mode: PaneMode) => {
      if (mode === "output" && paneLocked) return;
      setPaneModeState(mode);
    },
    [paneLocked],
  );

  const setView = useCallback(
    (next: View) => {
      if (next === "screen") {
        setPaneModeState("screen");
        setPaneOpenState(true);
        return;
      }
      storeView(next);
    },
    [storeView],
  );

  const selectJob = useCallback(
    (jobId: string | null) => {
      setSelectedJobId(jobId);
      if (jobId !== null && !paneLocked) {
        setPaneModeState("output");
        setPaneOpenState(true);
      }
    },
    [paneLocked],
  );

  const loaded = viewLoaded && railLoaded && statusLoaded && widthLoaded && notifyLoaded;

  const value = useMemo<SelectionValue>(
    () => ({
      view,
      setView,
      selectedJobId,
      selectJob,
      paneOpen,
      setPaneOpen,
      paneMode,
      setPaneMode,
      paneLocked,
      setPaneLocked,
      paneWidth,
      setPaneWidth,
      railCollapsed,
      setRailCollapsed,
      railOpen,
      setRailOpen,
      statusBar,
      setStatusBar,
      notifications,
      setNotifications,
      loaded,
    }),
    [
      view,
      setView,
      selectedJobId,
      selectJob,
      paneOpen,
      setPaneOpen,
      paneMode,
      setPaneMode,
      paneLocked,
      paneWidth,
      setPaneWidth,
      railCollapsed,
      setRailCollapsed,
      railOpen,
      statusBar,
      setStatusBar,
      notifications,
      setNotifications,
      loaded,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const v = useContext(SelectionContext);
  if (!v) throw new Error("useSelection outside SelectionProvider");
  return v;
}
