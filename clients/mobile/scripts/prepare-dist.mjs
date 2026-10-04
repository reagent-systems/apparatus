// Build the web client, copy its dist here, and replace bridge.js with the
// mobile bridge. Run it before `cap sync`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = path.resolve(root, "../../web");
const dist = path.join(root, "dist");
const onWindows = process.platform === "win32";

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: onWindows });
}

run(onWindows ? "npm.cmd" : "npm", ["--prefix", web, "run", "build"]);

rmSync(dist, { recursive: true, force: true });
cpSync(path.join(web, "dist"), dist, { recursive: true });
for (const name of ["index.html", "app.js", "worklet.js"]) {
  if (!existsSync(path.join(dist, name))) {
    throw new Error(`web build did not emit ${name}`);
  }
}

run(process.execPath, [path.join(root, "scripts/bridge.mjs")]);
