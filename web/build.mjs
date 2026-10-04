// Build: the Vite app, then two plain bundles. No network.
//   index.html + src/main.tsx -> dist/index.html, dist/assets/*  (Vite)
//   src/audio/worklet.ts     -> dist/worklet.js   AudioWorklet module (esm)
//   src/bridge-web.ts        -> dist/bridge.js    default bridge, a classic
//                                                 script; a native shell
//                                                 overwrites it

import { build as esbuild } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as vite } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

await vite({ root: here, base: "/", build: { outDir: dist, emptyOutDir: true }, logLevel: "info" });

await esbuild({
  absWorkingDir: here,
  entryPoints: { worklet: "src/audio/worklet.ts" },
  outdir: dist,
  entryNames: "[name]",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});

await esbuild({
  absWorkingDir: here,
  entryPoints: { bridge: "src/bridge-web.ts" },
  outdir: dist,
  entryNames: "[name]",
  bundle: true,
  format: "iife",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});
