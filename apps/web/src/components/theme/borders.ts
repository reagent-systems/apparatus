// Pure: the Borders choice. No DOM; `ThemeProvider.tsx` applies the result to
// <html>, and index.html runs the same rule inline before the first paint.
// Off writes `data-borders="off"` on <html>; the token block in index.css
// then hides every line and puts every surface on the page background.

export type Borders = "on" | "off";

export const BORDERS_KEY = "apparatus.borders";

/** The default is off, borderless: anything but "on" parses to off. */
export const DEFAULT_BORDERS: Borders = "off";

export function parseBorders(value: string | null | undefined): Borders {
  return value === "on" ? "on" : DEFAULT_BORDERS;
}

/** The stored value: "on", or null to remove the key (the default is never stored). */
export function storedBorders(borders: Borders): string | null {
  return borders === "on" ? "on" : null;
}

/**
 * The stored value to boot from, for Borders and the theme alike: the secure
 * store's value, or the localStorage copy when the secure store holds none
 * (a failed secure write must not undo the choice the user just saved).
 */
export function bootValue(secure: string | null, local: string | null): string | null {
  return secure !== null ? secure : local;
}

/** The `data-borders` value on <html>: "off", or null for no attribute. */
export function bordersAttribute(borders: Borders): string | null {
  return borders === "off" ? "off" : null;
}
