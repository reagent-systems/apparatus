// Build: three bundles and the page. No network.
//   src/main.ts          -> dist/app.js      the app
//   src/audio/worklet.ts -> dist/worklet.js  AudioWorklet module
//   src/bridge-web.ts    -> dist/bridge.js   default bridge; a native shell overwrites it
//   src/index.html       -> dist/index.html

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: here,
  entryPoints: {
    app: "src/main.ts",
    worklet: "src/audio/worklet.ts",
    bridge: "src/bridge-web.ts",
  },
  outdir: dist,
  entryNames: "[name]",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});

await copyFile(join(here, "src", "index.html"), join(dist, "index.html"));
