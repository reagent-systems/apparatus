// ScreenContext: the one screen stream for this device, `useScreen` hoisted
// to app scope so the pane and the PiP read the same `MediaStream`.
// `wantOpen` / `wantClose` count the holders: the stream opens with the
// first and closes after the last. The close waits one tick, because React
// runs the leaving holder's cleanup before the arriving holder's effect in
// the same commit (the pane closes, the PiP mounts); the stream must not
// drop and reopen in between.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useScreen, type ScreenValue } from "../components/vm/useScreen.ts";

export type ScreenStoreValue = ScreenValue & {
  wantOpen: () => void;
  wantClose: () => void;
};

const ScreenContext = createContext<ScreenStoreValue | null>(null);

export function ScreenProvider({ children }: { children: ReactNode }) {
  const screen = useScreen();
  const { open, close } = screen;
  const wants = useRef(0);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = (): void => {
    if (closing.current !== null) {
      clearTimeout(closing.current);
      closing.current = null;
    }
  };

  const wantOpen = useCallback(() => {
    cancelClose();
    wants.current += 1;
    if (wants.current === 1) open();
  }, [open]);

  const wantClose = useCallback(() => {
    if (wants.current === 0) return;
    wants.current -= 1;
    if (wants.current > 0) return;
    cancelClose();
    closing.current = setTimeout(() => {
      closing.current = null;
      if (wants.current === 0) close();
    }, 0);
  }, [close]);

  useEffect(() => cancelClose, []);

  const value = useMemo<ScreenStoreValue>(() => ({ ...screen, wantOpen, wantClose }), [screen, wantOpen, wantClose]);
  return <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>;
}

export function useScreenStore(): ScreenStoreValue {
  const v = useContext(ScreenContext);
  if (!v) throw new Error("useScreenStore outside ScreenProvider");
  return v;
}

/** Hold the stream open while `active`. One call per component that shows it. */
export function useWantScreen(active: boolean): void {
  const { wantOpen, wantClose } = useScreenStore();
  useEffect(() => {
    if (!active) return;
    wantOpen();
    return wantClose;
  }, [active, wantOpen, wantClose]);
}
