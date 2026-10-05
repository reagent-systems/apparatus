// Light / Dark / System. The `.dark` class on <html> is the one switch:
// Tailwind's dark variant and the 20 px orbs (theme="auto") both read it.
// Borders on / off rides along: `data-borders="off"` on <html> switches the
// token block in index.css that hides every line and flattens every surface.
//
// First paint: index.html applies the localStorage copy of both choices
// inline, before any script loads. `main.tsx` then reads the bridge's
// secureStore (the native shells' store; the localStorage copy when it holds
// none) and hands the results in as `initial` and `initialBorders`, applied
// synchronously on mount and written back to the localStorage copy, so the
// next first paint matches. A change writes both stores.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApparatusBridge } from "@/bridge";
import { bootValue, bordersAttribute, BORDERS_KEY, parseBorders, storedBorders, type Borders } from "./borders";
import { isDark, parseTheme, THEME_KEY, type Theme } from "./theme";

export type ThemeValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  borders: Borders;
  setBorders: (borders: Borders) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function systemQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(SYSTEM_DARK) : null;
}

/** Write `.dark` on <html> for the choice; returns the OS listener's disposer. */
export function applyTheme(theme: Theme): () => void {
  const query = systemQuery();
  const apply = (): void => {
    document.documentElement.classList.toggle("dark", isDark(theme, query?.matches ?? false));
  };
  apply();
  if (!query || theme !== "system") return () => undefined;
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}

/** Write or remove `data-borders` on <html> for the choice. */
export function applyBorders(borders: Borders): void {
  const value = bordersAttribute(borders);
  if (value === null) document.documentElement.removeAttribute("data-borders");
  else document.documentElement.setAttribute("data-borders", value);
}

/** Write the localStorage copy that index.html reads; null removes the key. */
function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked site data: the secure store still holds it.
  }
}

/** Read the localStorage copy; null when it is absent or blocked. */
function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Read the bridge's secure store; null when it is absent or fails. */
async function readSecure(bridge: ApparatusBridge, key: string): Promise<string | null> {
  try {
    return await bridge.secureStore.get(key);
  } catch {
    return null;
  }
}

/** Write the bridge's secure store; null deletes the key. */
function writeStore(bridge: ApparatusBridge, key: string, value: string | null): void {
  const store = bridge.secureStore;
  void (value === null ? store.delete(key) : store.set(key, value)).catch(() => undefined);
}

/** The stored choice, for `main.tsx` to read before the tree mounts. */
export async function readStoredTheme(bridge: ApparatusBridge): Promise<Theme> {
  return parseTheme(bootValue(await readSecure(bridge, THEME_KEY), readLocal(THEME_KEY)));
}

/** The stored Borders choice, for `main.tsx` to read before the tree mounts. */
export async function readStoredBorders(bridge: ApparatusBridge): Promise<Borders> {
  return parseBorders(bootValue(await readSecure(bridge, BORDERS_KEY), readLocal(BORDERS_KEY)));
}

export type ThemeProviderProps = {
  bridge: ApparatusBridge;
  initial?: Theme;
  initialBorders?: Borders;
  children: ReactNode;
};

export function ThemeProvider({ bridge, initial = "system", initialBorders = "on", children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    applyTheme(initial);
    writeLocal(THEME_KEY, initial === "system" ? null : initial);
    return initial;
  });
  const [borders, setBordersState] = useState<Borders>(() => {
    applyBorders(initialBorders);
    writeLocal(BORDERS_KEY, storedBorders(initialBorders));
    return initialBorders;
  });

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyBorders(borders), [borders]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      const stored = next === "system" ? null : next;
      writeLocal(THEME_KEY, stored);
      writeStore(bridge, THEME_KEY, stored);
    },
    [bridge],
  );

  const setBorders = useCallback(
    (next: Borders) => {
      setBordersState(next);
      const stored = storedBorders(next);
      writeLocal(BORDERS_KEY, stored);
      writeStore(bridge, BORDERS_KEY, stored);
    },
    [bridge],
  );

  const value = useMemo<ThemeValue>(() => ({ theme, setTheme, borders, setBorders }), [theme, setTheme, borders, setBorders]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

export type { Theme } from "./theme";
export type { Borders } from "./borders";
