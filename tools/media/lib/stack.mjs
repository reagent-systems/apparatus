// The capture stack: the session server in demo mode and one agentd, each on a
// port, socket and home of its own. Both run in their own process group and are
// stopped by pid (the group of that pid), never by a name pattern.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { REPO, USER_ID, sleep } from "./util.mjs";

export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function launch(name, argv, env, logFile) {
  const log = fs.openSync(logFile, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["ignore", log, log],
    detached: true,
  });
  fs.closeSync(log);
  child.on("error", (e) => fs.appendFileSync(logFile, `\n[media] ${name} failed to start: ${e.message}\n`));
  return child;
}

function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig);
    return true;
  } catch {
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  }
}

/** SIGINT (asyncio servers exit cleanly on it), then SIGTERM, then SIGKILL, to the child's own process group. */
async function stopChild(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const done = new Promise((r) => child.once("exit", () => r("exit")));
  for (const sig of ["SIGINT", "SIGTERM"]) {
    if (!signalGroup(pid, sig)) return;
    if ((await Promise.race([done, sleep(3000).then(() => "timeout")])) === "exit") return;
  }
  signalGroup(pid, "SIGKILL");
  console.error(`[media] ${name} (pid ${pid}) needed SIGKILL`);
}

const live = new Set();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  const killAll = () => {
    for (const c of live) {
      try {
        process.kill(-c.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  };
  process.on("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      killAll();
      process.exit(130);
    });
  }
}

/**
 * Start the server (demo mode) and agentd. `work` is a scratch folder for the
 * logs, the agentd home and its socket. `desktop` is "fake" or "xdo"; "xdo"
 * needs `display` (an X server that is already running) and `screen`, its size.
 */
export async function startStack({ work, webDist, desktop = "fake", display = null, screen = null, env = {} }) {
  hookExit();
  fs.mkdirSync(work, { recursive: true });
  const port = await freePort();
  const home = path.join(work, "agent-home");
  // A fresh home: task folders an earlier run left behind are not this day's.
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  // A unix socket path must stay under 108 bytes, so it lives in a short temp folder.
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-"));
  const socket = path.join(sockDir, "agentd.sock");
  const serverLog = path.join(work, "server.log");
  const agentdLog = path.join(work, "agentd.log");
  if (!fs.existsSync(path.join(webDist, "index.html"))) {
    throw new Error(`${webDist}/index.html is missing: run \`npm --prefix ${REPO}/apps/web run build\` or pass --build`);
  }

  const server = launch(
    "server",
    ["uv", "run", "--quiet", "apparatus-server"],
    {
      APPARATUS_DEMO: "1",
      APPARATUS_WEB_DIST: webDist,
      APPARATUS_STORE: "memory",
      APPARATUS_AUTH_MODE: "dev",
      APPARATUS_HOST: "127.0.0.1",
      APPARATUS_PORT: String(port),
      GEMINI_API_KEY: "",
      ...env,
    },
    serverLog,
  );
  live.add(server);
  const origin = `http://127.0.0.1:${port}`;
  const stack = { port, origin, work, server, agentd: null, serverLog, agentdLog, home, socket };
  stack.stop = async () => {
    // agentd sets its stop flag on SIGINT but checks it only when its server
    // link drops, so: flag agentd, stop the server, then wait for agentd.
    if (stack.agentd && stack.agentd.exitCode === null && stack.agentd.signalCode === null) signalGroup(stack.agentd.pid, "SIGINT");
    await stopChild(stack.server, "server");
    await stopChild(stack.agentd, "agentd");
    live.delete(stack.agentd);
    live.delete(stack.server);
    fs.rmSync(sockDir, { recursive: true, force: true });
  };
  try {
    await waitFor(async () => alive(server, "server") && (await health(origin)) !== null, 60_000, `server health on ${origin} (log: ${serverLog})`);
    const agentEnv = {
      AGENTD_HOME: home,
      AGENTD_SOCKET: socket,
      AGENTD_DESKTOP: desktop,
      AGENTD_SERVER_URL: `ws://127.0.0.1:${port}/ws/agentd`,
      AGENTD_USER_ID: USER_ID,
      AGENTD_VM_ID: "local",
    };
    if (display) agentEnv.DISPLAY = display;
    if (screen) {
      agentEnv.AGENTD_STREAM_WIDTH = String(screen.width);
      agentEnv.AGENTD_STREAM_HEIGHT = String(screen.height);
    }
    stack.agentd = launch("agentd", ["uv", "run", "--quiet", "agentd"], { ...agentEnv, ...env }, agentdLog);
    live.add(stack.agentd);
    await waitFor(async () => alive(stack.agentd, "agentd") && ((await health(origin))?.vms ?? 0) >= 1, 60_000, `agentd connect (log: ${agentdLog})`);
  } catch (e) {
    await stack.stop();
    throw e;
  }
  return stack;
}

function alive(child, name) {
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name} exited (${child.exitCode ?? child.signalCode})`);
  return true;
}

async function health(origin) {
  try {
    const res = await fetch(`${origin}/health`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function waitFor(check, timeoutMs, what) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}
