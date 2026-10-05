// Light / Dark / System. The `.dark` class on <html> is the one switch:
// Tailwind's dark variant and the 20 px orbs (theme="auto") both read it.
//
// First paint: index.html applies the localStorage copy of the choice
// inline, before any script loads. `main.tsx` then reads the bridge's
// secureStore (the native shells' store) and hands the result in as
// `initial`, applied synchronously on mount. A change writes both stores.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApparatusBridge } from "@/bridge";
import { isDark, parseTheme, THEME_KEY, type Theme } from "./theme";

export type ThemeValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
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

function writeLocal(theme: Theme): void {
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked site data: the secure store still holds it.
  }
}

/** The stored choice, for `main.tsx` to read before the tree mounts. */
export async function readStoredTheme(bridge: ApparatusBridge): Promise<Theme> {
  return parseTheme(await bridge.secureStore.get(THEME_KEY));
}

export type ThemeProviderProps = {
  bridge: ApparatusBridge;
  initial?: Theme;
  children: ReactNode;
};

export function ThemeProvider({ bridge, initial = "system", children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    applyTheme(initial);
    return initial;
  });

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      writeLocal(next);
      const store = bridge.secureStore;
      void (next === "system" ? store.delete(THEME_KEY) : store.set(THEME_KEY, next)).catch(() => undefined);
    },
    [bridge],
  );

  const value = useMemo<ThemeValue>(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

export type { Theme } from "./theme";
