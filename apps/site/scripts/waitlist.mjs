// Reads the waitlist out of the private Blob store, or deletes one entry.
//
//   npm run waitlist -w apparatus-site                          # CSV on stdout: email, createdAt, note
//   npm run waitlist -w apparatus-site -- delete a@example.com  # removes that email's entry
//
// Needs BLOB_READ_WRITE_TOKEN: `vercel env pull --environment=production .env.local`
// in apps/site writes it, and the npm script loads it. The store and the token
// are set up as apps/site/README.md says. Delete .env.local and the CSV after use.

import { BlobNotFoundError, del, get, head, list } from "@vercel/blob";
import { PREFIX, normaliseEmail, pathnameFor } from "../api/waitlist.ts";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. Run `npx vercel env pull --environment=production .env.local` in apps/site first (README: Waitlist).");
  process.exit(1);
}

/** One CSV cell. A leading = + - @ is quoted with ' so a spreadsheet does not run it as a formula. */
function cell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function read(pathname) {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function exportCsv() {
  const pathnames = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) pathnames.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const entries = [];
  for (const pathname of pathnames) {
    const entry = await read(pathname);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const lines = ["email,createdAt,note", ...entries.map((e) => [e.email, e.createdAt, e.note].map(cell).join(","))];
  process.stdout.write(`${lines.join("\n")}\n`);
  console.error(`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);
}

async function remove(raw) {
  const email = normaliseEmail(raw);
  if (!email) {
    console.error("Give the email to delete: npm run waitlist -w apparatus-site -- delete a@example.com");
    process.exit(1);
  }
  const pathname = pathnameFor(email);
  try {
    await head(pathname);
  } catch (e) {
    if (!(e instanceof BlobNotFoundError)) throw e;
    console.error(`no entry for that email (${pathname})`);
    return;
  }
  await del(pathname);
  console.error(`deleted ${pathname}`);
}

const [command, arg] = process.argv.slice(2);
if (command === undefined) await exportCsv();
else if (command === "delete") await remove(arg);
else {
  console.error(`Unknown command ${command}. Use no argument for the CSV, or: delete <email>`);
  process.exit(1);
}
