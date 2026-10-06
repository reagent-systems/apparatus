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

/**
 * The person whose day the captures show. Dev auth takes the token as the
 * user id; the rail avatar shows its initials ("MO"), agentd runs as the same user.
 */
export const USER_ID = "maya.ortiz";

/**
 * A fixed-offset zone (Etc/GMT-N is UTC+N) where it is now mid-morning, so
 * the times on screen read like a working day whenever the harness runs.
 * The browser context and the X desktop's clock both use it.
 */
export function workdayZone(hour = 10, now = new Date()) {
  const utc = now.getUTCHours() + now.getUTCMinutes() / 60;
  let off = Math.round(hour - utc);
  while (off > 14) off -= 24;
  while (off < -12) off += 24;
  return off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/** Computed once per run, so every scene shows the same morning. */
export const ZONE = workdayZone();
