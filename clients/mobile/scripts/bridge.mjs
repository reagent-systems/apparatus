// Bundle src/bridge.ts to dist/bridge.js with the server origin baked in.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { serverOrigin } from "./origin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: [path.join(root, "src/bridge.ts")],
  outfile: path.join(root, "dist/bridge.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  define: { "process.env.APPARATUS_SERVER_ORIGIN": JSON.stringify(serverOrigin()) },
  logLevel: "info",
});
