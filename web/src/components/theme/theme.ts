// Pure: the theme choice and how it resolves. No DOM; `ThemeProvider.tsx`
// applies the result to <html>, and index.html runs the same resolution
// inline before the first paint.

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "apparatus.theme";

export const THEMES: readonly Theme[] = ["light", "dark", "system"];

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** Whether `.dark` goes on <html> for this choice and this OS preference. */
export function isDark(theme: Theme, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemDark);
}
