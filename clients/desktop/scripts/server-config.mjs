// Write src-tauri/gen/server.conf.json: the CSP from tauri.conf.json with the
// server origin added to connect-src. `tauri dev` and `tauri build` take it
// through --config (package.json scripts), so the origin is fixed when the
// binary is built and no setting can change it later.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { serverOrigin, webSocketOrigin } from "./origin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const csp = { ...base.app.security.csp };

const origin = serverOrigin();
const extra = [origin, webSocketOrigin(origin)].filter((o) => !csp["connect-src"].split(/\s+/).includes(o));
csp["connect-src"] = [csp["connect-src"], ...extra].join(" ");

const out = path.join(root, "src-tauri/gen/server.conf.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ app: { security: { csp } } }, null, 2) + "\n");
console.log(`server origin ${origin} -> ${path.relative(root, out)}`);
