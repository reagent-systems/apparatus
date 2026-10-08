// What the rail's parts share: whether the rail is icons only, whether it
// sits in the phone sheet, and how a row closes that sheet.

import { createContext, useContext, type ReactNode } from "react";

export type RailValue = {
  /** Icons only: no labels, no job rows. */
  collapsed: boolean;
  /** Inside the phone sheet. */
  sheet: boolean;
  /** A row was chosen: the phone sheet closes. */
  close: () => void;
};

export const RailContext = createContext<RailValue>({ collapsed: false, sheet: false, close: () => undefined });

export function useRail(): RailValue {
  return useContext(RailContext);
}

export const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

/** The 12 px uppercase micro-label over a group. */
export function RailGroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-4 pb-1 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{children}</div>;
}
