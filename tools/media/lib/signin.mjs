// The reports site's sign-in page on the VM desktop, for the handoff: the
// job asks the user to sign in, so the screen shows the page it asks about.
// A local page served under the demo's own address (demo.py's handoff url,
// reports.larkspur.example, mapped to a local port inside this browser
// only), opened in a Chromium app window on the X display, as a person
// opens a site in its own window. The fields are empty: the user signs in.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CHROMIUM, REPO, sleep } from "./util.mjs";

const HOST = "reports.larkspur.example";
const INTER = path.join(REPO, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in · Larkspur Reports</title>
<style>
@font-face { font-family: Inter; src: url(/inter.woff2) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
html { zoom: 1.4; }
body { background: #f3f0ea; color: #211d19; font: 400 17px/1.45 Inter, sans-serif; display: grid; place-items: center; overflow: hidden; }
main { width: 440px; background: #fff; border: 1px solid #e2dcd2; border-radius: 16px; padding: 40px 44px 44px; }
.brand { font-weight: 500; font-size: 15px; letter-spacing: .02em; color: #6b645b; margin-bottom: 22px; }
h1 { font-weight: 500; font-size: 28px; margin: 0 0 28px; }
label { display: block; font-size: 15px; color: #4a443d; margin: 0 0 8px; }
.field { height: 46px; border: 1px solid #d6cfc4; border-radius: 10px; margin-bottom: 20px; background: #fff; }
button { width: 100%; height: 48px; border: 0; border-radius: 10px; background: #2c5f4f; color: #fff; font: 500 17px Inter, sans-serif; margin-top: 8px; }
</style></head>
<body><main>
<div class="brand">Larkspur Reports</div>
<h1>Sign in</h1>
<label>Email</label><div class="field"></div>
<label>Password</label><div class="field"></div>
<button type="button">Sign in</button>
</main></body></html>`;

/**
 * Serve the page and open it at http://reports.larkspur.example/login in a
 * Chromium app window that fills the X screen. Resolves with { close }.
 */
export async function openSignIn(desk, work) {
  const server = http.createServer((req, res) => {
    if (req.url === "/inter.woff2") {
      res.writeHead(200, { "content-type": "font/woff2" });
      res.end(fs.readFileSync(INTER));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const profile = path.join(work, "signin-profile");
  fs.rmSync(profile, { recursive: true, force: true });
  const logFd = fs.openSync(path.join(work, "signin.log"), "a");
  const child = spawn(
    CHROMIUM,
    [
      `--app=http://${HOST}/login`,
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
      `--user-data-dir=${profile}`,
      "--no-sandbox",
      "--test-type",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--password-store=basic",
      "--disable-features=Translate,MediaRouter,AutofillServerCommunication,HttpsUpgrades",
      "--disable-component-update",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-position=0,0",
      `--window-size=${desk.width},${desk.height}`,
    ],
    { env: { ...process.env, ...desk.env }, stdio: ["ignore", logFd, logFd], detached: true },
  );
  fs.closeSync(logFd);
  await sleep(4000);
  const close = async () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
    await new Promise((r) => server.close(r));
    await sleep(800);
  };
  return { close, url: `http://${HOST}/login` };
}
