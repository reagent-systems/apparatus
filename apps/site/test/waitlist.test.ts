import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { BlobNotFoundError } from "@vercel/blob";
import {
  type BlobApi,
  HONEYPOT,
  MAX_BODY_BYTES,
  MAX_EMAIL,
  MAX_NOTE,
  STORE_MIN_MS,
  createHandler,
  normaliseEmail,
  normaliseNote,
  pathnameFor,
} from "../api/waitlist.ts";

/** An in-memory stand-in for @vercel/blob's head and put. No network. */
function fakeBlob(opts: { failPut?: boolean; failHead?: boolean } = {}) {
  const objects = new Map<string, { body: string; options: unknown }>();
  const calls = { head: 0, put: 0 };
  const api: BlobApi = {
    head: async (pathname) => {
      calls.head++;
      if (opts.failHead) throw new Error("service unavailable");
      const hit = objects.get(pathname);
      if (!hit) throw new BlobNotFoundError();
      return { pathname };
    },
    put: async (pathname, body, options) => {
      calls.put++;
      if (opts.failPut) throw new Error("store unreachable");
      if (objects.has(pathname)) throw new Error("This blob already exists");
      objects.set(pathname, { body, options });
      return { pathname };
    },
  };
  return { api, objects, calls };
}

const T1 = new Date("2026-10-28T10:00:00.000Z");
const T2 = new Date("2026-10-29T11:00:00.000Z");

function jsonPost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://site.test/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function formPost(fields: Record<string, string>): Request {
  return new Request("https://site.test/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** The handler with no minimum answer time, so the tests do not wait. */
const make = (blob: BlobApi, now?: () => Date) => createHandler(blob, now, 0);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("normaliseEmail", () => {
  test("trims and lower-cases", () => {
    assert.equal(normaliseEmail("  Dana@Larkspur.Example \n"), "dana@larkspur.example");
  });
  test("accepts plus tags, subdomains and non-latin local parts", () => {
    assert.equal(normaliseEmail("a+b@mail.example.co.uk"), "a+b@mail.example.co.uk");
    assert.equal(normaliseEmail("josé@example.com"), "josé@example.com");
  });
  test("refuses what is not an address", () => {
    for (const bad of ["", "   ", "dana", "dana@", "@example.com", "dana@example", "dana@example.", "dana@.com", "da na@example.com", "a@b@example.com", "dana@exa mple.com"]) {
      assert.equal(normaliseEmail(bad), null, bad);
    }
  });
  test("refuses a control character inside", () => {
    assert.equal(normaliseEmail("da\u0000na@example.com"), null);
    assert.equal(normaliseEmail("dana@exam\u007fple.com"), null);
    assert.equal(normaliseEmail("dana@example.com\u0085x"), null);
  });
  test("refuses non-strings", () => {
    for (const bad of [undefined, null, 42, ["a@b.co"], { email: "a@b.co" }]) assert.equal(normaliseEmail(bad), null);
  });
  test("refuses invisible, bidi and fullwidth characters", () => {
    for (const bad of ["a\u200b@x.co", "a\u202e@x.co", "a@x.co\u00ad", "a\ufeffb@x.co", "a\u2028@x.co", "\uff41@x.co", "a@x\uff0eco"]) {
      assert.equal(normaliseEmail(bad), null, JSON.stringify(bad));
    }
  });
  test("one form per address: NFD and NFC give one pathname", () => {
    const nfd = normaliseEmail("e\u0301@x.co");
    assert.equal(nfd, "\u00e9@x.co");
    assert.equal(pathnameFor(nfd!), pathnameFor(normaliseEmail("\u00e9@x.co")!));
  });
  test("refuses what splits into several recipients, quoted parts and domain literals", () => {
    for (const bad of ["x;victim@evil.co", "x,victim@evil.co", "<a>@x.co", "a(b)@x.co", "a\\b@x.co", "a:b@x.co", '"a b"@x.co', "a@[127.0.0.1]", "a..b@x.co", ".a@x.co", "a.@x.co", "a@-b.co", "a@b-.co"]) {
      assert.equal(normaliseEmail(bad), null, bad);
    }
  });
  test("accepts every dot-atom character and IDN domains", () => {
    for (const good of ["=1+1@x.co", "o'neil@x.co", "a.b_c-d@x.co", "user@xn--p1ai.xn--p1ai", "user@\u092a\u0902\u091c\u093e\u092c.\u092d\u093e\u0930\u0924"]) {
      assert.equal(normaliseEmail(good), good, good);
    }
  });
  test("holds the 254-character limit after trimming", () => {
    const at = (n: number) => `${"a".repeat(n - "@example.com".length)}@example.com`;
    assert.equal(at(MAX_EMAIL).length, 254);
    assert.equal(normaliseEmail(` ${at(MAX_EMAIL)} `), at(MAX_EMAIL));
    assert.equal(normaliseEmail(at(MAX_EMAIL + 1)), null);
  });
});

describe("normaliseNote", () => {
  test("is optional", () => {
    assert.equal(normaliseNote(undefined), undefined);
    assert.equal(normaliseNote(null), undefined);
    assert.equal(normaliseNote("   "), undefined);
  });
  test("trims and keeps line breaks", () => {
    assert.equal(normaliseNote("  run my tests\nand file bugs  "), "run my tests\nand file bugs");
  });
  test("holds 280 characters, counted as code points", () => {
    assert.equal(normaliseNote("x".repeat(MAX_NOTE)), "x".repeat(MAX_NOTE));
    assert.equal(normaliseNote("x".repeat(MAX_NOTE + 1)), null);
    assert.equal(normaliseNote("🙂".repeat(MAX_NOTE)), "🙂".repeat(MAX_NOTE));
  });
  test("refuses control characters and non-strings", () => {
    assert.equal(normaliseNote("a\u0000b"), null);
    assert.equal(normaliseNote("a\u001bb"), null);
    assert.equal(normaliseNote(7), null);
  });
  test("folds a form post's CRLF to LF and refuses a bare CR or a line separator", () => {
    assert.equal(normaliseNote("one\r\ntwo"), "one\ntwo");
    assert.equal(normaliseNote("one\rtwo"), null);
    assert.equal(normaliseNote("one\u2028two"), null);
  });
  test("drops bidi and invisible format characters, and keeps emoji joiners", () => {
    assert.equal(normaliseNote("x\u202ey\u00adz\u200b"), "xyz");
    assert.equal(normaliseNote("\u{1f468}\u200d\u{1f4bb}"), "\u{1f468}\u200d\u{1f4bb}");
  });
});

describe("pathnameFor", () => {
  test("is waitlist/ plus the hex sha256 of the normalised email", () => {
    assert.equal(pathnameFor("dana@larkspur.example"), `waitlist/${sha("dana@larkspur.example")}.json`);
    assert.match(pathnameFor("a@b.co"), /^waitlist\/[0-9a-f]{64}\.json$/);
  });
  test("one person, one pathname, whatever the case or spaces", () => {
    assert.equal(pathnameFor(normaliseEmail(" Dana@Larkspur.example ")!), pathnameFor(normaliseEmail("dana@larkspur.EXAMPLE")!));
  });
  test("holds no part of the email", () => {
    assert.ok(!pathnameFor("dana@larkspur.example").includes("dana"));
  });
});

describe("the handler", () => {
  test("a new email: one private JSON object with email, note, createdAt and source only", async () => {
    const blob = fakeBlob();
    const res = await make(blob.api, () => T1)(jsonPost({ email: " Dana@Larkspur.example ", note: "  my repo's CI  " }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get("cache-control"), "no-store");
    const stored = blob.objects.get(pathnameFor("dana@larkspur.example"));
    assert.ok(stored);
    assert.deepEqual(JSON.parse(stored.body), {
      email: "dana@larkspur.example",
      note: "my repo's CI",
      createdAt: T1.toISOString(),
      source: "site",
    });
    const { abortSignal, ...options } = stored.options as { abortSignal: unknown };
    assert.ok(abortSignal instanceof AbortSignal);
    assert.deepEqual(options, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false });
  });

  test("no note: the object has no note field", async () => {
    const blob = fakeBlob();
    await make(blob.api, () => T1)(jsonPost({ email: "a@b.co", note: "" }));
    assert.deepEqual(Object.keys(JSON.parse(blob.objects.get(pathnameFor("a@b.co"))!.body)), ["email", "createdAt", "source"]);
  });

  test("a repeat email keeps the first entry and its createdAt, and answers the same", async () => {
    const blob = fakeBlob();
    const first = await make(blob.api, () => T1)(jsonPost({ email: "dana@larkspur.example", note: "first" }));
    const again = await make(blob.api, () => T2)(jsonPost({ email: "DANA@larkspur.example", note: "second" }));
    assert.equal(first.status, again.status);
    assert.deepEqual(await again.json(), { ok: true });
    assert.equal(blob.calls.put, 1);
    assert.equal(blob.objects.size, 1);
    const stored = JSON.parse(blob.objects.get(pathnameFor("dana@larkspur.example"))!.body);
    assert.equal(stored.createdAt, T1.toISOString());
    assert.equal(stored.note, "first");
  });

  test("a put that loses a race to the same email still answers ok", async () => {
    const blob = fakeBlob();
    // head says absent, then another request stores the object before this put.
    const racing: BlobApi = {
      head: blob.api.head,
      put: async (pathname, body, options) => {
        await blob.api.put(pathname, JSON.stringify({ email: "x", createdAt: T1.toISOString(), source: "site" }), options);
        return blob.api.put(pathname, body, options);
      },
    };
    const res = await make(racing, () => T2)(jsonPost({ email: "a@b.co" }));
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(blob.objects.get(pathnameFor("a@b.co"))!.body).createdAt, T1.toISOString());
  });

  test("the honeypot: answered as if it worked, nothing stored", async () => {
    const blob = fakeBlob();
    const json = await make(blob.api)(jsonPost({ email: "bot@spam.example", [HONEYPOT]: "https://spam.example" }));
    assert.equal(json.status, 200);
    assert.deepEqual(await json.json(), { ok: true });
    const form = await make(blob.api)(formPost({ email: "bot@spam.example", [HONEYPOT]: "x" }));
    assert.equal(form.status, 303);
    assert.equal(form.headers.get("location"), "/?waitlist=ok#waitlist-ok");
    assert.equal(blob.calls.head + blob.calls.put, 0);
    assert.equal(blob.objects.size, 0);
  });

  test("an empty honeypot field is a person", async () => {
    const blob = fakeBlob();
    await make(blob.api)(formPost({ email: "a@b.co", note: "", [HONEYPOT]: "" }));
    assert.equal(blob.objects.size, 1);
  });

  test("a form post is answered with 303 to the message, and stores the entry", async () => {
    const blob = fakeBlob();
    const res = await make(blob.api, () => T1)(formPost({ email: "Sam@Example.org", note: "nightly builds" }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/?waitlist=ok#waitlist-ok");
    assert.equal(await res.text(), "");
    assert.equal(JSON.parse(blob.objects.get(pathnameFor("sam@example.org"))!.body).note, "nightly builds");
  });

  test("a bad form post is answered with 303 to the error message", async () => {
    const blob = fakeBlob();
    const res = await make(blob.api)(formPost({ email: "not an email" }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/?waitlist=error#waitlist-error");
    assert.equal(blob.objects.size, 0);
  });

  test("a JSON post with a bad email: 400 invalid_email", async () => {
    const blob = fakeBlob();
    const res = await make(blob.api)(jsonPost({ email: "dana@" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "invalid_email" });
    assert.equal(blob.calls.put, 0);
  });

  test("a note over 280 characters: 400 invalid_note", async () => {
    const res = await make(fakeBlob().api)(jsonPost({ email: "a@b.co", note: "x".repeat(281) }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "invalid_note" });
  });

  test("malformed or non-object JSON: 400 bad_body", async () => {
    for (const body of ["{", "[]", '"a@b.co"', "null", ""]) {
      const res = await make(fakeBlob().api)(jsonPost(body));
      assert.equal(res.status, 400, body);
      assert.deepEqual(await res.json(), { ok: false, error: "bad_body" });
    }
  });

  test("a bad content type: 415, even for a form-like body", async () => {
    for (const type of ["text/plain", "multipart/form-data; boundary=x", ""]) {
      const res = await make(fakeBlob().api)(
        new Request("https://site.test/api/waitlist", { method: "POST", headers: type ? { "content-type": type } : {}, body: "email=a%40b.co" }),
      );
      assert.equal(res.status, 415, type);
      assert.deepEqual(await res.json(), { ok: false, error: "unsupported_media_type" });
    }
  });

  test("a JSON content type with a charset is accepted", async () => {
    const res = await make(fakeBlob().api)(jsonPost({ email: "a@b.co" }, { "content-type": "Application/JSON; charset=utf-8" }));
    assert.equal(res.status, 200);
  });

  test("a body over 2 KB: 413, whether or not it declares its length", async () => {
    const big = { email: "a@b.co", note: "x".repeat(MAX_BODY_BYTES) };
    const declared = await make(fakeBlob().api)(jsonPost(big, { "content-length": String(JSON.stringify(big).length) }));
    assert.equal(declared.status, 413);
    assert.deepEqual(await declared.json(), { ok: false, error: "too_large" });
    // A streamed body carries no length: the reader stops at the limit.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(big)));
        c.close();
      },
    });
    const streamed = await make(fakeBlob().api)(
      new Request("https://site.test/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit),
    );
    assert.equal(streamed.status, 413);
    const form = await make(fakeBlob().api)(formPost({ email: "a@b.co", note: "x".repeat(MAX_BODY_BYTES) }));
    assert.equal(form.status, 303);
    assert.equal(form.headers.get("location"), "/?waitlist=error#waitlist-error");
  });

  test("a body of exactly 2 KB is read", async () => {
    const base = JSON.stringify({ email: "a@b.co", pad: "" });
    const body = JSON.stringify({ email: "a@b.co", pad: "x".repeat(MAX_BODY_BYTES - base.length) });
    assert.equal(body.length, MAX_BODY_BYTES);
    assert.equal((await make(fakeBlob().api)(jsonPost(body))).status, 200);
  });

  test("a method other than POST: 405 with Allow", async () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const res = await make(fakeBlob().api)(new Request("https://site.test/api/waitlist", { method }));
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "POST");
      assert.deepEqual(await res.json(), { ok: false, error: "method_not_allowed" });
    }
  });

  test("a cross-site post from a browser: 403, and nothing stored", async () => {
    const blob = fakeBlob();
    for (const req of [formPost({ email: "a@b.co" }), jsonPost({ email: "a@b.co" })]) {
      req.headers.set("sec-fetch-site", "cross-site");
      const res = await make(blob.api)(req);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, error: "cross_site" });
    }
    assert.equal(blob.calls.head + blob.calls.put, 0);
    const same = formPost({ email: "a@b.co" });
    same.headers.set("sec-fetch-site", "same-origin");
    assert.equal((await make(blob.api)(same)).status, 303);
  });

  test("a post whose Origin names another host: 403; same host, or no Origin, goes through", async () => {
    const blob = fakeBlob();
    for (const origin of ["https://evil.test", "null"]) {
      const req = formPost({ email: "a@b.co" });
      req.headers.set("origin", origin);
      const res = await make(blob.api)(req);
      assert.equal(res.status, 403, origin);
    }
    assert.equal(blob.calls.head + blob.calls.put, 0);
    const same = formPost({ email: "a@b.co" });
    same.headers.set("origin", "https://site.test");
    same.headers.set("host", "site.test");
    assert.equal((await make(blob.api)(same)).status, 303);
    assert.equal((await make(blob.api)(jsonPost({ email: "c@d.co" }))).status, 200);
  });

  test("every store call carries an abort signal, so retries end", async () => {
    const seen: unknown[] = [];
    const blob = fakeBlob();
    const api: BlobApi = {
      head: (p, o) => (seen.push(o.abortSignal), blob.api.head(p, o)),
      put: (p, b, o) => (seen.push(o.abortSignal), blob.api.put(p, b, o)),
    };
    assert.equal((await make(api)(jsonPost({ email: "a@b.co" }))).status, 200);
    assert.equal(seen.length, 2);
    for (const s of seen) assert.ok(s instanceof AbortSignal);
  });

  test("a new email, a listed one and a filled honeypot all take at least the minimum time", async () => {
    const blob = fakeBlob();
    const handle = createHandler(blob.api, undefined, 120);
    for (const body of [{ email: "a@b.co" }, { email: "a@b.co" }, { email: "bot@b.co", [HONEYPOT]: "x" }]) {
      const t = performance.now();
      assert.equal((await handle(jsonPost(body))).status, 200);
      assert.ok(performance.now() - t >= 115, JSON.stringify(body));
    }
    assert.equal(blob.calls.put, 1);
    assert.equal(STORE_MIN_MS, 800);
  });

  test("a store failure: 500 store_failed, and the log line holds no email", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => lines.push(args.join(" ")));
    for (const opts of [{ failPut: true }, { failHead: true }]) {
      const res = await make(fakeBlob(opts).api)(jsonPost({ email: "secret.person@example.com" }));
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { ok: false, error: "store_failed" });
    }
    const form = await make(fakeBlob({ failPut: true }).api)(formPost({ email: "secret.person@example.com" }));
    assert.equal(form.headers.get("location"), "/?waitlist=error#waitlist-error");
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.ok(!line.includes("secret.person"), line);
      assert.ok(!line.includes(sha("secret.person@example.com")), line);
    }
  });
});

describe("the form", () => {
  test("names its hidden field HONEYPOT, a name autofill does not fill", () => {
    const astro = readFileSync(new URL("../src/components/Waitlist.astro", import.meta.url), "utf8");
    assert.match(astro, new RegExp(`name="${HONEYPOT}"`));
    assert.doesNotMatch(HONEYPOT, /web|site|url|mail|name|phone|tel|fax|address|company/i);
  });
});

describe("disguised addresses", () => {
  test("Hangul fillers and the blank braille pattern are refused", () => {
    for (const ch of ["\u3164", "\u115f", "\u1160", "\uffa0", "\u2800"]) {
      assert.equal(normaliseEmail(`a${ch}@x.co`), null, JSON.stringify(ch));
    }
  });
});

describe("the store failure log", () => {
  test("holds the error class only, not its message", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => lines.push(args.join(" ")));
    const api: BlobApi = {
      head: async () => {
        throw new Error("bad_request: waitlist/deadbeef.json");
      },
      put: async () => ({}),
    };
    assert.equal((await createHandler(api, undefined, 0)(jsonPost({ email: "a@b.co" }))).status, 500);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.includes("deadbeef"), lines[0]);
  });
});
