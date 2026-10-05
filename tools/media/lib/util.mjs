import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MEDIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = path.resolve(MEDIA, "..", "..");
export const CHROMIUM = process.env.MEDIA_CHROMIUM ?? "/opt/pw-browsers/chromium";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a command; resolve with stdout, reject with stderr on a non-zero exit. */
export function run(cmd, args, { cwd, env, quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      err += d;
      if (!quiet) process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${err.slice(-4000)}`))));
  });
}

export function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function log(...args) {
  console.log("[media]", ...args);
}
