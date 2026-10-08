# apps/site

The apparatus website: one static page that says what apparatus is, with the real captures from `docs/media`.
Astro 7 and Tailwind CSS 4, with no UI framework on the page: one plain script draws the live orbs with `@apparatus/orb`'s painter and clock. The look and the fonts come from `@apparatus/design`: Inter for text, JetBrains Mono for the commands; a browser fetches only their latin files. Vercel deploys it.

## Commands

Install once at the repository root (`npm install`), never in this folder.

```sh
npm run dev:site                       # at the root: http://localhost:4321
npm run build -w apparatus-site        # static HTML in apps/site/dist
npm run preview -w apparatus-site      # serves dist
npm run typecheck -w apparatus-site    # astro check
npm run media -w apparatus-site        # remakes public/media and src/assets/crops; needs ffmpeg and ImageMagick
npm run og -w apparatus-site           # remakes public/og.png; needs playwright-core (root install) and Chromium
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
| `src/lib/orb.ts` | The live orbs, started once the page is idle: the hero's cycle and its state buttons, the orb section's four states, the closing orb |
| `src/lib/motion.ts` | Whether anything may move: reduced motion, or Pause motion (kept in `localStorage`) |
| `src/lib/links.ts` | Every outbound link; each points at a path on `main` after the monorepo merge. Until then `LOCAL`, `GCP` and `APPS` answer 404 on `main` |
| `src/data/media.json` | The loops' files, sizes and posters, written by `scripts/media.mjs` |
| `src/assets/crops/` | Parts of stills the page shows on their own: the hero's phone and watch (under 640 px), the approval and handoff cards cut to their content. Written by `scripts/media.mjs` |
| `public/media/` | The loops: H.264 MP4, VP9 WebM and WebP posters at 2 widths per GIF, each with a dark twin, named by a hash of their bytes |
| `public/og.png` | The Open Graph image, 1200 × 630: the orb, the name and the one-liner beside the hero's desktop and phone. Written by `scripts/og.mjs` |

The stills are not copied here. `@media` in `astro.config.mjs` points at `docs/media`, and the build turns each still into WebP at the widths the page asks for. A new capture in `docs/media` reaches the site on the next build. A new GIF, or a new hero or card still, needs `npm run media`, because the loops and the crops are committed.

`scripts/media.mjs` rotates each loop so it opens on its action (`start` in `LOOPS`): the typing under Control, the running job card. The poster is a moment of the GIF before the rotation: the finished table. The loops play at 25 fps, half the GIFs' rate. A loop sets its poster only when it nears the screen, so a loop far down the page or under the other theme fetches nothing.

## Motion

The hero orb cycles Listening, Working and Speaking; a state button pins one for 12 s. It leaves Off (breathing) out on purpose: Off's ring of dashes reads as a spinner beside the headline. The orb section shows all four states live, side by side. The loops play while on screen. The orbs start once the page is idle; their static frame is on screen before that, and on a touch screen they draw at 30 fps. Pause motion, the last button in the hero's state row and a link in the footer, holds the orbs and the loops and shows the loops' controls (WCAG 2.2.2); the system's reduced-motion setting does the same, and the orbs then draw their static frame.

## Themed pictures

The hero still and the orb stills are one `<picture>` each, with a dark `<source>` keyed to `prefers-color-scheme`, so a visitor fetches one ink and the hero loads eagerly. When the viewer picks the other theme, `src/lib/client.ts` points each dark source at the page's theme. A visitor whose stored theme differs from the system fetches the hero and the first orb in both inks once, because the browser starts them before any script runs. The other stills are twins under `dark:hidden`, lazy, so the hidden one loads nothing.

## The canonical URL

`astro.config.mjs` sets `site` from `SITE_URL`, else from `https://$VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every build. Without either, the build leaves out the canonical link, `og:url`, the Open Graph image and the sitemap, so no build ships a made-up or relative link where an absolute one is needed. Both variables are listed in `turbo.json`, because turbo passes a build only the variables it is told about.

## Deploy on Vercel

Vercel's Git integration deploys the site: every push to `main` deploys production, and every pull request gets a preview.

One-time setup, by a person with access to the GitHub repository:

1. Open https://vercel.com/new and import `reagent-systems/apparatus`.
2. Set **Root Directory** to `apps/site`. Vercel reads `apps/site/vercel.json` and sets the framework to Astro.
3. Keep **Include files outside the root directory in the Build Step** on. The build needs the root lockfile, `packages/` and `docs/media`.
4. Deploy. Leave the build and install commands to `vercel.json`.
5. When a domain is attached, set the environment variable `SITE_URL` (for example `https://apparatus.example`) for Production, and redeploy.

`vercel.json` sets:

| Field | Value | Why |
|---|---|---|
| `installCommand` | `cd ../.. && npm ci` | One lockfile at the root; `npm ci` in a workspace folder empties the root `node_modules` |
| `buildCommand` | `npx turbo run build --filter=apparatus-site` | Builds the site and anything it depends on, with turbo's cache |
| `outputDirectory` | `dist` | Astro's static output |
| `ignoreCommand` | `npx -y turbo-ignore@2.11.7 && git diff --quiet …HEAD -- ../../docs/media` | Skips the build when a commit touches neither the site, its packages nor `docs/media`. turbo-ignore alone does not see `docs/media`, which belongs to no workspace |
| `headers` | `/_astro/*`, `/media/*` and `/orb/*` cached for a year, immutable | All three hold only hashed file names |

From the command line instead, at the repository root:

```sh
npx vercel login
npx vercel link --repo              # once: links the repository; pick the project whose Root Directory is apps/site
npx vercel --cwd apps/site          # deploys a preview
npx vercel --cwd apps/site --prod   # deploys production
```

The CLI reads the same `vercel.json` and uploads from the repository root, so the build sees the lockfile and the packages. No Vercel account ran these commands while this README was written; `vercel build` ran locally with the settings above and wrote `.vercel/output`.
