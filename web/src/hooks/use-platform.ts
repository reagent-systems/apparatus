// The host: a Mac (Cmd and the overlay title bar) and a Tauri window.

const w = typeof window !== "undefined" ? (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }) : null;

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The page runs inside a Tauri window. */
export function isTauri(): boolean {
  return !!w && (w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined);
}

/** The overlay title bar on macOS: traffic lights over the rail strip. */
export function hasOverlayTitlebar(): boolean {
  return isTauri() && isMac();
}
