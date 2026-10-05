// Pure: the keys and the string forms of the persisted selection. No DOM;
// `selection.tsx` reads and writes them through the bridge secureStore.
// Tested in `test/selection-codec.test.ts`.

export type View = "thread" | "jobs" | "screen" | "audit" | "credits";
export type PaneMode = "output" | "screen";

export const SELECTION_KEYS = {
  view: "apparatus.view",
  rail: "apparatus.rail",
  statusBar: "apparatus.statusbar",
  paneWidth: "apparatus.pane.width",
  notifications: "apparatus.notifications",
} as const;

export const VIEWS: readonly View[] = ["thread", "jobs", "screen", "audit", "credits"];

/** The views that fill the thread column. `screen` is the pane, never a column. */
export const COLUMN_VIEWS: readonly View[] = ["thread", "jobs", "audit", "credits"];

/** Percent of the window (not of the rail-less group) the pane takes when first opened (DESIGN.md 2). */
export const PANE_WIDTH_DEFAULT = 42;
/** The pane's pixel bounds (`min-w-[360px] max-w-[640px]`). */
export const PANE_PX_MIN = 360;
export const PANE_PX_MAX = 640;
export const PANE_WIDTH_MIN = 15;
export const PANE_WIDTH_MAX = 80;

export function isView(value: unknown): value is View {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

/** A stored view; `screen` and anything unknown read as the thread. */
export function parseView(raw: string | null | undefined): View {
  return isView(raw) && raw !== "screen" ? raw : "thread";
}

/** The thread is the default and is not stored. */
export function formatView(view: View): string | null {
  return view === "thread" || view === "screen" ? null : view;
}

/** A stored flag: "1" or "0"; anything else is the fallback. */
export function parseFlag(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

export function formatFlag(value: boolean): string {
  return value ? "1" : "0";
}

/** A stored pane width in percent, clamped; anything unreadable is the default. */
export function parsePaneWidth(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return PANE_WIDTH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return PANE_WIDTH_DEFAULT;
  return Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, Math.round(n)));
}

export function formatPaneWidth(percent: number): string {
  return String(parsePaneWidth(String(percent)));
}

/** The pane's width in pixels for a stored percent of the window, clamped to 360..640. */
export function panePixels(percent: number, windowWidth: number): number {
  return Math.min(PANE_PX_MAX, Math.max(PANE_PX_MIN, Math.round((percent / 100) * windowWidth)));
}

/** A pane width in pixels as the percent of the window that `panePixels` reads back. */
export function panePercent(pixels: number, windowWidth: number): number {
  if (!(windowWidth > 0)) return PANE_WIDTH_DEFAULT;
  return parsePaneWidth(String((pixels / windowWidth) * 100));
}
