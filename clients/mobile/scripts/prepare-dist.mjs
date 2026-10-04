// Build the web client, copy its dist here, and replace bridge.js with the
// mobile bridge. Run it before `cap sync`.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
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

// The web dist is index.html, assets/ (hashed JS and CSS from Vite),
// worklet.js and the default bridge.js. The copy keeps the whole tree;
// scripts/bridge.mjs then overwrites bridge.js.
rmSync(dist, { recursive: true, force: true });
cpSync(path.join(web, "dist"), dist, { recursive: true });
for (const name of ["index.html", "worklet.js", "bridge.js"]) {
  if (!existsSync(path.join(dist, name))) {
    throw new Error(`web build did not emit ${name}`);
  }
}
const assets = path.join(dist, "assets");
if (!existsSync(assets) || !statSync(assets).isDirectory() || readdirSync(assets).length === 0) {
  throw new Error("web build did not emit assets/");
}

run(process.execPath, [path.join(root, "scripts/bridge.mjs")]);
