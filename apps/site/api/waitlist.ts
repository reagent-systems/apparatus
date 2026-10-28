// POST /api/waitlist: one email for the hosted-version waitlist, kept in a
// private Vercel Blob store as waitlist/<sha256 of the email>.json.
//
// Vercel compiles each file under api/ on its own, so this file imports no
// local module. @vercel/blob signs in with the project's OIDC token when
// BLOB_STORE_ID is set, else with BLOB_READ_WRITE_TOKEN; connecting a store adds
// one of them. The answer is the same for a new and a listed email,
// and both take at least STORE_MIN_MS, so neither the body nor the time says
// whether an email is on the list. No log line holds an email. Nothing here
// limits how often one client posts: that is the Vercel Firewall rule in
// apps/site/README.md.

import { createHash } from "node:crypto";
import { BlobNotFoundError, head, put } from "@vercel/blob";

export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL = 254;
export const MAX_NOTE = 280;
export const PREFIX = "waitlist/";
/** The hidden field a person never sees; a bot that fills it is answered as if it worked.
 * The name means nothing to autofill, which fills fields named like "website" or "url". */
export const HONEYPOT = "hp_k7q";
/** A stored or listed email is answered no sooner than this after the request arrives. */
export const STORE_MIN_MS = 800;
/** Each store call is cut off after this, so the SDK's retries cannot hold a billed function open. */
export const STORE_TIMEOUT_MS = 4000;

const OK_URL = "/?waitlist=ok#waitlist-ok";
const ERROR_URL = "/?waitlist=error#waitlist-error";
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Invisible and bidi format characters, line and paragraph separators, and the
// fullwidth and halfwidth forms: none belongs in an address, and each one can
// disguise it or give one person a second pathname.
// The Hangul fillers and the blank braille pattern render as nothing too.
const DISGUISE = /[\p{Cf}\p{Zl}\p{Zp}\uff00-\uffef\u115f\u1160\u3164\u2800]/u;
// Pragmatic: a dot-atom local part (RFC 5322 atext, plus letters, marks and
// digits of any script) and a domain of letter-or-digit labels. No quoted
// local part, no domain literal, no comma, semicolon or angle bracket, so the
// list pastes into a To field as one address per row.
const ATEXT = "[\\p{L}\\p{M}\\p{N}!#$%&'*+/=?^_`{|}~-]+";
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
const TLD = "\\p{L}(?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
const EMAIL = new RegExp(`^${ATEXT}(?:\\.${ATEXT})*@(?:${LABEL}\\.)+${TLD}$`, "u");
// A note keeps its line breaks and tabs. A CR is refused once CRLF is folded to LF.
const NOTE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Zl}\p{Zp}]/u;
// Format characters are dropped from a note, except the zero-width joiner that emoji use.
const NOTE_FORMAT = /(?!\u200d)\p{Cf}/gu;

export type WaitlistError =
  | "method_not_allowed"
  | "cross_site"
  | "unsupported_media_type"
  | "too_large"
  | "bad_body"
  | "invalid_email"
  | "invalid_note"
  | "store_failed";

export interface WaitlistEntry {
  email: string;
  note?: string;
  createdAt: string;
  source: "site";
}

/** The part of @vercel/blob this endpoint uses. Tests pass a fake. */
export interface BlobApi {
  head: (pathname: string, options: { abortSignal: AbortSignal }) => Promise<unknown>;
  put: (
    pathname: string,
    body: string,
    options: {
      access: "private";
      contentType: string;
      addRandomSuffix: false;
      allowOverwrite: false;
      abortSignal: AbortSignal;
    },
  ) => Promise<unknown>;
}

/** Trimmed, lower-cased and in NFC, so one address has one form; null when it is not a usable address. */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase().normalize("NFC");
  if (email.length === 0 || email.length > MAX_EMAIL) return null;
  if (CONTROL.test(email) || DISGUISE.test(email) || !EMAIL.test(email)) return null;
  return email;
}

/** Trimmed, LF line breaks, no format characters; undefined when empty; null when too long or holding a control character. */
export function normaliseNote(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const note = value.replaceAll("\r\n", "\n").replace(NOTE_FORMAT, "").trim().normalize("NFC");
  if (note.length === 0) return undefined;
  if ([...note].length > MAX_NOTE || NOTE_CONTROL.test(note)) return null;
  return note;
}

/** waitlist/<hex sha256 of the normalised email>.json: one object per person. */
export function pathnameFor(email: string): string {
  return `${PREFIX}${createHash("sha256").update(email, "utf8").digest("hex")}.json`;
}

type Kind = "json" | "form";

function mediaType(request: Request): Kind | null {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "application/json") return "json";
  if (type === "application/x-www-form-urlencoded") return "form";
  return null;
}

/** The body as text, or null once it passes `limit` bytes. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function fields(kind: Kind, text: string): Record<string, unknown> | null {
  if (kind === "form") return Object.fromEntries(new URLSearchParams(text));
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: { ok: true } | { ok: false; error: WaitlistError }, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...extra },
  });
}

function answer(kind: Kind | null, status: number, error?: WaitlistError): Response {
  // A form post comes from the page with no script: send the browser back to the message.
  if (kind === "form") return new Response(null, { status: 303, headers: { location: error ? ERROR_URL : OK_URL, ...NO_STORE } });
  return error ? json(status, { ok: false, error }) : json(200, { ok: true });
}

function isNotFound(e: unknown): boolean {
  return e instanceof BlobNotFoundError;
}

async function listed(blob: BlobApi, pathname: string): Promise<boolean> {
  try {
    await blob.head(pathname, { abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS) });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

function logFailure(e: unknown): void {
  // The error's class only. A store error's message can carry the server's text and the
  // pathname, an unsalted hash of the email, so it is not logged.
  const name = e instanceof Error ? e.name : typeof e;
  console.error(`waitlist: store failed: ${name}`);
}

/** A browser post from another site's page: Sec-Fetch-Site says so, or the Origin names another host. */
function crossSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false; // curl and old clients send none
  if (origin === "null") return true; // a sandboxed or opaque origin
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `minStoreMs`: the least time a stored or listed email takes to answer. Tests pass 0. */
export function createHandler(blob: BlobApi, now: () => Date = () => new Date(), minStoreMs = STORE_MIN_MS) {
  return async function handle(request: Request): Promise<Response> {
    const started = Date.now();
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
    }
    // A browser marks a post from another site's page. Curl sends no such header and is not stopped.
    if (crossSite(request)) return json(403, { ok: false, error: "cross_site" });
    const kind = mediaType(request);
    if (!kind) return answer(null, 415, "unsupported_media_type");
    const text = await readLimited(request, MAX_BODY_BYTES);
    if (text === null) return answer(kind, 413, "too_large");
    const body = fields(kind, text);
    if (!body) return answer(kind, 400, "bad_body");

    // A listed email costs one head and a new one a head and a put; the wait hides the
    // difference. A filled honeypot waits too, so its answer looks like a stored one.
    const done = async () => {
      const wait = started + minStoreMs - Date.now();
      if (wait > 0) await sleep(wait);
      return answer(kind, 200);
    };

    const trap = body[HONEYPOT];
    if (typeof trap === "string" ? trap.trim() !== "" : trap !== undefined && trap !== null) return await done();

    const email = normaliseEmail(body.email);
    if (!email) return answer(kind, 400, "invalid_email");
    const note = normaliseNote(body.note);
    if (note === null) return answer(kind, 400, "invalid_note");

    const pathname = pathnameFor(email);
    const entry: WaitlistEntry = { email, ...(note ? { note } : {}), createdAt: now().toISOString(), source: "site" };
    try {
      // A listed email keeps its first entry and its createdAt.
      if (await listed(blob, pathname)) return await done();
      try {
        await blob.put(pathname, JSON.stringify(entry), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS),
        });
      } catch (e) {
        // Two signups for one email at once: the second put finds the first one's object.
        if (!(await listed(blob, pathname))) throw e;
      }
      return await done();
    } catch (e) {
      logFailure(e);
      return answer(kind, 500, "store_failed");
    }
  };
}

const handle = createHandler({
  head: (pathname, options) => head(pathname, options),
  put: (pathname, body, options) => put(pathname, body, options),
});

export const POST = handle;
// Every other method gets 405 from the same code path, not the platform's default.
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
