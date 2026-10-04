// The session server origin, fixed at build time.
//
// APPARATUS_SERVER_ORIGIN must be an http(s) origin with no path. The default
// is the local dev server. scripts/bridge.mjs bakes it into dist/bridge.js.

const DEFAULT_ORIGIN = "http://localhost:8080";

export function serverOrigin() {
  const raw = (process.env.APPARATUS_SERVER_ORIGIN ?? "").trim() || DEFAULT_ORIGIN;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`APPARATUS_SERVER_ORIGIN is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`APPARATUS_SERVER_ORIGIN must use http or https: ${raw}`);
  }
  if (url.origin !== raw.replace(/\/$/, "")) {
    throw new Error(`APPARATUS_SERVER_ORIGIN must be an origin with no path: ${raw}`);
  }
  return url.origin;
}
