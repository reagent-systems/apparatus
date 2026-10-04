// Generate src-tauri/icons from src-tauri/app-icon.png when they are missing.
// tauri-build and generate_context! read the icon files, so cargo check and
// tauri dev need them before any build step runs.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const icons = path.join(root, "src-tauri/icons");
const tauriCli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");

export function ensureIcons() {
  if (existsSync(path.join(icons, "icon.png")) && existsSync(path.join(icons, "icon.ico"))) return;
  execFileSync(process.execPath, [tauriCli, "icon", path.join(root, "src-tauri/app-icon.png"), "-o", icons], {
    stdio: "inherit",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureIcons();
}
