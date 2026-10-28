# apps/site

The apparatus website: one static page that says what apparatus is, with the real captures from `docs/media`, and one Vercel Function, the waitlist for a hosted version.
Astro 7 and Tailwind CSS 4, with no UI framework on the page: one plain script draws the live orbs with `@apparatus/orb`'s painter and clock. The look and the text font come from `@apparatus/design`: Inter, of which a browser fetches only the latin file. The commands use the system's monospace face, so the first load carries no second font. Vercel deploys it.

## Commands

Install once at the repository root (`npm install`), never in this folder.

```sh
npm run dev:site                       # at the root: http://localhost:4321
npm run build -w apparatus-site        # static HTML in apps/site/dist
npm run preview -w apparatus-site      # serves dist
npm run typecheck -w apparatus-site    # astro check
npm run media -w apparatus-site        # remakes public/media and src/assets/crops; needs ffmpeg and ImageMagick
npm run og -w apparatus-site           # remakes public/og.png; needs playwright-core (root install) and Chromium
npm test -w apparatus-site             # node --test: the waitlist function, with a fake store
npm run waitlist -w apparatus-site     # the waitlist as CSV; see Waitlist below
```

The root `npm run build` and `verify/verify.sh` build and check the site with every other workspace.

## What is where

| Path | Holds |
|---|---|
| `src/pages/index.astro` | The page: the sections in order |
| `src/pages/404.astro` | The page Vercel serves for an unknown path (`dist/404.html`) |
| `src/components/` | One file per section; `Shot.astro` (stills), `Video.astro` (loops), `OrbStill.astro` (the orb's static frame, a `<picture>` of the files below), `Icon.astro` (the Lucide icons in `src/lib/icons.ts`) |
| `src/lib/orb-svg.ts`, `src/pages/orb/[file].ts` | Each orb state's static frame in each ink, drawn at build time by the orb's own painter and written to `/orb/<state>-<ink>.<hash>.svg` |
| `src/lib/client.ts` | The page's script: the theme button (and the themed pictures and `theme-color` with it), the Pause motion buttons, the loops, the copy button |
| `src/components/Waitlist.astro`, `src/lib/waitlist-form.ts` | The waitlist section and its script: a JSON post and a status line; without the script, the form posts itself |
| `api/waitlist.ts` | The Vercel Function behind the form, `POST /api/waitlist` |
| `scripts/waitlist.mjs` | The waitlist out of the store as CSV, or one entry deleted |
| `test/waitlist.test.ts` | The function's tests, against an in-memory fake of `@vercel/blob` |
| `src/lib/orb.ts` | The live orbs, started once the page is idle: the hero's cycle and its state buttons, the orb section's four states, the closing orb |
| `src/lib/motion.ts` | Whether anything may move: reduced motion, or Pause motion (kept in `localStorage`) |
| `src/lib/links.ts` | Every outbound link; each points at a path on `main` |
| `src/data/media.json` | The loops' files, sizes and posters, written by `scripts/media.mjs` |
| `src/assets/crops/` | Parts of stills the page shows on their own: the top of the receipt for the hero's phone, the approval and handoff cards cut to their content. Written by `scripts/media.mjs` |
| `public/media/` | The loops (the phone, the screen under Control, the watch): H.264 MP4, VP9 WebM and WebP posters at 2 widths per GIF, each with a dark twin, named by a hash of their bytes. `Video.astro` lists the smaller of the 2 files first |
| `public/og.png` | The Open Graph image, 1200 × 630: the orb, the name and the one-liner beside the hero's desktop and phone. Written by `scripts/og.mjs` |

The stills are not copied here. `@media` in `astro.config.mjs` points at `docs/media`, and the build turns each still into WebP at the widths the page asks for. A new capture in `docs/media` reaches the site on the next build. A new GIF, or a new card still, needs `npm run media`, because the loops and the crops are committed.

`scripts/media.mjs` cuts each loop so it opens on its action. The phone loop is rotated (`start` in `LOOPS`) to open on the request in the feed with "On it.", so the empty orb plays last. The screen loop keeps 3 spans of the GIF (`keep`): Control pressed, the typing and the table, and Release; the idle cursor between them is cut. The poster is a moment of the GIF before any cut: the finished table. The loops play at 25 fps, half the GIFs' rate. A loop sets its poster only when it nears the screen, so a loop far down the page or under the other theme fetches nothing.

## Motion

The hero orb cycles Listening, Working and Speaking; a state button pins one for 12 s. It leaves Off (breathing) out on purpose: Off's ring of dashes reads as a spinner beside the headline. The orb section shows all four states live, side by side. The loops play while on screen. The orbs start once the page is idle; their static frame is on screen before that, and on a touch screen they draw at 30 fps. Pause motion, the last button in the hero's state row and a link in the footer, holds the orbs and the loops and shows the loops' controls (WCAG 2.2.2); the system's reduced-motion setting does the same, and the orbs then draw their static frame. Under reduced motion both Pause motion buttons are hidden, because a press would change nothing. The hero orb draws at up to 3 device pixels per CSS pixel; the others at up to 2.

## Themed pictures

The orb stills are one `<picture>` each, with a dark `<source>` keyed to `prefers-color-scheme`, so a visitor fetches one ink and the hero orb loads eagerly. When the viewer picks the other theme, `src/lib/client.ts` points each dark source at the page's theme. A visitor whose stored theme differs from the system fetches the first orb in both inks once, because the browser starts it before any script runs. The other stills, the hero stage's among them, are twins under `dark:hidden`, lazy, so the hidden one loads nothing. The hero stage is 3 separate captures set in HTML: `docs/media/thread.png`, the top of `docs/media/phone/phone-5-receipt.png` (a crop) in a drawn bezel, and the watch loop; under 640 px it shows the phone and the watch only.

## The canonical URL

`astro.config.mjs` sets `site` from `SITE_URL`, else from `https://$VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every build. Without either, the build leaves out the canonical link, `og:url`, the Open Graph image and the sitemap, so no build ships a made-up or relative link where an absolute one is needed. Both variables are listed in `turbo.json`, because turbo passes a build only the variables it is told about.

## Waitlist

apparatus is not a hosted service; the page says so and asks for an email from people who want a hosted version. The form posts to `api/waitlist.ts`, a Vercel Function beside the static build. Astro does not see `api/`: Vercel builds each file in it as a function, so the file imports no local module.

`POST /api/waitlist` takes `application/json` or `application/x-www-form-urlencoded` with `email`, an optional `note` and `hp_k7q`, a hidden field a person never fills. Its name means nothing to autofill, so a browser does not fill it for a person.

| Request | JSON answer | Form answer |
|---|---|---|
| A new email | 200 `{ ok: true }`; stores the entry | 303 to `/?waitlist=ok#waitlist-ok` |
| An email already listed | The same as a new email; stores nothing, the first entry and its `createdAt` stay | The same |
| `hp_k7q` filled | The same as a new email; stores nothing | The same |
| A post from another site's page (`Sec-Fetch-Site: cross-site`) | 403 `cross_site`; stores nothing | The same 403 |
| A bad email (over 254 characters; a control, invisible, bidi or fullwidth character; not a dot-atom `x@y.z`, so no quotes, commas, semicolons, angle brackets or `[1.2.3.4]`) | 400 `invalid_email` | 303 to `/?waitlist=error#waitlist-error` |
| A note over 280 characters or with a control character (CRLF counts as one line break; invisible and bidi characters are dropped) | 400 `invalid_note` | The same 303 |
| Malformed or non-object JSON | 400 `bad_body` | — |
| A body over 2048 bytes | 413 `too_large` | The same 303 |
| Another content type | 415 `unsupported_media_type` | — |
| Another method | 405 `method_not_allowed`, `Allow: POST` | — |
| The store fails | 500 `store_failed`; the log line holds the error's class and message, never the email | The same 303 |

Each person is one object, `waitlist/<sha256 of the trimmed, lower-cased, NFC email, hex>.json`, in a private store: `{ email, note?, createdAt, source: "site" }`. Nothing else is kept: no IP address, no user agent. The answer never says whether an email was on the list already: the body is the same, and a stored or listed email is answered no sooner than 800 ms after the request (`STORE_MIN_MS`), so the extra write for a new email does not show in the time.

The pathname is an unsalted sha256, so anyone who sees it can check a guessed email against it. Keep `DEBUG` free of `blob` in production: with it, the SDK logs the paths it calls.

No address is verified: anyone can add anyone's email. Make the first message to the list a confirm-or-forget email with an unsubscribe link, and keep only the people who confirm.

With the script, the form posts JSON. A bad email or note shows under its field, with `aria-invalid`; the result shows in a `role="status"` line, and after a signup the fields go. Without the script, the browser posts the form, the function answers 303, and `:target` shows the message under the fields.

### Set up the store (once)

1. In the Vercel project, open **Storage**, create a **Blob** store and pick **Private** access.
2. Connect the store to the project for **Production** only. A preview build of any pushed branch, and a collaborator's `vercel env pull`, then get no access to the real list. To try the form on a preview, connect a second private store to Preview and Development.
3. Keep Deployment Protection on for previews, and keep **Git Fork Protection** on.
4. Add the Firewall rule and the spend limit below.
5. Redeploy. On Vercel the function signs in with the project's OIDC token and `BLOB_STORE_ID`; no token is copied anywhere.

Until a store is connected to an environment, every valid post there answers 500 `store_failed` and the page says the waitlist did not take the email.

### Limit the posts (once)

Nothing in the code limits how often one client posts. Each post costs a function call, and each new email costs a Blob write and one stored object. On Hobby, a store over its limits can be blocked, which stops the waitlist; on Pro, the overage is billed. In the Vercel project:

1. Open **Firewall** and add a custom rule: if the request path equals `/api/waitlist`, any method, **Rate Limit** with a fixed window of 60 s and 5 requests, keyed on IP, action **Deny** (429). If the plan allows a longer window, add a second rule: 20 requests per hour per IP.
2. Turn on **Bot Protection** (or the managed bot rule set).
3. In the team's **Settings → Billing → Spend Management**, set a limit.

The script on the page shows "The waitlist did not take your email" on a 429.

### Read the list

Link the repository once (`npx vercel link --repo`, under Deploy on Vercel), then:

```sh
cd apps/site
npx vercel env pull --environment=production .env.local   # BLOB_READ_WRITE_TOKEN for the production store; .gitignore keeps it out of git
npm run waitlist > ~/waitlist.csv                         # email, createdAt, note; oldest first; outside the repository
rm .env.local                                             # when done
```

The CSV holds every email. Write it outside the repository, as above, and delete it when you are done; `.gitignore` also ignores `waitlist*.csv` in case one lands in the tree. The token is read and write: delete `.env.local` after use, or copy the token from the store's page into the shell for one command instead. The CSV quotes a cell that starts with `=`, `+`, `-` or `@` with a `'`, so a spreadsheet does not run it as a formula.

### Delete an entry

```sh
npm run waitlist -- delete person@example.com   # with .env.local from Read the list
```

The script derives the object's pathname from the email and deletes that one object. The store's page in the Vercel dashboard can delete it too. Its pathname is `waitlist/` and the sha256 of the email, as above: `printf %s person@example.com | sha256sum`.

## Deploy on Vercel

Vercel's Git integration deploys the site: every push to `main` deploys production, and every pull request gets a preview.

One-time setup, by a person with access to the GitHub repository:

1. Open https://vercel.com/new and import `reagent-systems/apparatus`.
2. Set **Root Directory** to `apps/site`. Vercel reads `apps/site/vercel.json` and sets the framework to Astro.
3. Keep **Include files outside the root directory in the Build Step** on. The build needs the root lockfile, `packages/` and `docs/media`.
4. Deploy. Leave the build and install commands to `vercel.json`.
5. When a domain is attached, set the environment variable `SITE_URL` (for example `https://apparatus.example`) for Production, and redeploy.
6. Set up the waitlist store and the Firewall rule, as Waitlist above says.

`vercel.json` sets:

| Field | Value | Why |
|---|---|---|
| `installCommand` | `cd ../.. && npm ci` | One lockfile at the root; `npm ci` in a workspace folder empties the root `node_modules` |
| `buildCommand` | `npx turbo run build --filter=apparatus-site` | Builds the site and anything it depends on, with turbo's cache |
| `outputDirectory` | `dist` | Astro's static output |
| `ignoreCommand` | `npx -y turbo-ignore@2.11.7 && git diff --quiet …HEAD -- ../../docs/media` | Skips the build when a commit touches neither the site, its packages nor `docs/media`. turbo-ignore alone does not see `docs/media`, which belongs to no workspace. `api/` is inside the workspace, so a change to the function builds |
| `headers` | `/_astro/*`, `/media/*` and `/orb/*` cached for a year, immutable | All three hold only hashed file names |

From the command line instead, at the repository root:

```sh
npx vercel login
npx vercel link --repo              # once: links the repository; pick the project whose Root Directory is apps/site
npx vercel --cwd apps/site          # deploys a preview
npx vercel --cwd apps/site --prod   # deploys production
```

The CLI reads the same `vercel.json` and uploads from the repository root, so the build sees the lockfile and the packages. No Vercel account ran these commands while this README was written; `vercel build` ran locally with the settings above and wrote `.vercel/output`.
