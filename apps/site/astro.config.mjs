// @ts-check
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The canonical origin. SITE_URL wins; on Vercel, the project's production
// domain. Without either the build has no origin: canonical, og:url and the
// sitemap are left out, so no build ships a made-up absolute link.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site = process.env.SITE_URL || (vercelHost ? `https://${vercelHost}` : undefined);

// getImage() on an imported still (the hero) also emits the original PNG into
// _astro, though no page uses it. This drops every image in _astro that no
// output file names: about 1.2 MB of deploy, never of a visitor's download.
/** @type {import("astro").AstroIntegration} */
const dropUnusedOriginals = {
  name: "drop-unused-originals",
  hooks: {
    "astro:build:done": ({ dir, logger }) => {
      const root = fileURLToPath(dir);
      /** @type {string[]} */
      const texts = [];
      /** @param {string} d */
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(html|css|js|json|xml|txt|webmanifest)$/.test(e.name)) texts.push(readFileSync(p, "utf8"));
        }
      };
      walk(root);
      const all = texts.join("\n");
      const assets = join(root, "_astro");
      let dropped = 0;
      for (const name of readdirSync(assets)) {
        if (/\.(png|jpe?g)$/.test(name) && !all.includes(name)) {
          rmSync(join(assets, name));
          dropped++;
        }
      }
      logger.info(`dropped ${dropped} unreferenced original image(s) from _astro`);
    },
  },
};

export default defineConfig({
  site,
  base: "/",
  trailingSlash: "ignore",
  // One small stylesheet, inlined: no render-blocking request before the first paint.
  build: { inlineStylesheets: "always" },
  integrations: [...(site ? [sitemap()] : []), dropUnusedOriginals],
  vite: {
    plugins: [tailwindcss()],
    // The stills are the README's own captures, read from the repository root.
    resolve: { alias: { "@media": fileURLToPath(new URL("../../docs/media", import.meta.url)) } },
  },
});
