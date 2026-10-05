// A real X desktop for the VM screen: Xvfb, openbox and plain X apps, the
// same pieces vm/setup.sh installs. agentd then runs with AGENTD_DESKTOP=xdo
// and streams it with ffmpeg x11grab (agentd/agentd/stream.py).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { run, sleep } from "./util.mjs";

const NEEDS = ["Xvfb", "openbox", "xterm", "xdotool", "import", "ffmpeg"];

export async function missingTools() {
  const missing = [];
  for (const t of NEEDS) {
    try {
      await run("sh", ["-c", `command -v ${t}`]);
    } catch {
      missing.push(t);
    }
  }
  return missing;
}

function start(argv, env, log) {
  const fd = fs.openSync(log, "a");
  const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: true });
  fs.closeSync(fd);
  return child;
}

/**
 * Start a display of `width` x `height` with a window manager and `apps`
 * (argv lists). Resolves with { display, stop }.
 */
export async function startDesktop({ work, width = 1280, height = 800, apps = [] }) {
  const missing = await missingTools();
  if (missing.length) throw new Error(`the VM screen needs ${missing.join(", ")}`);
  fs.mkdirSync(work, { recursive: true });
  const log = path.join(work, "x.log");
  let n = 90;
  while (fs.existsSync(`/tmp/.X${n}-lock`)) n++;
  const display = `:${n}`;
  const procs = [];
  procs.push(start(["Xvfb", display, "-screen", "0", `${width}x${height}x24`, "-nolisten", "tcp"], {}, log));
  for (let i = 0; i < 40 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) await sleep(100);
  const env = { DISPLAY: display };
  procs.push(start(["openbox"], env, log));
  await sleep(500);
  for (const argv of apps) procs.push(start(argv, env, log));
  await sleep(1200);
  const stop = async () => {
    for (const p of procs.reverse()) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await sleep(300);
  };
  return { display, stop, log, env };
}

/** One frame straight from the X server, to prove there is something to stream. */
export async function grab(display, file) {
  await run("import", ["-display", display, "-window", "root", file]);
  return file;
}
