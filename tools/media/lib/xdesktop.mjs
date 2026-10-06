// A real X desktop for the VM screen: Xvfb and plain X apps, the pieces
// vm/setup.sh installs. No window manager: the one terminal draws its own
// 1 px border, and the keyboard follows the pointer (X's default focus).
// agentd runs with AGENTD_DESKTOP=xdo and streams it with ffmpeg x11grab
// (agentd/agentd/stream.py). The X apps get the client's own JetBrains Mono
// (web/node_modules/@fontsource-variable/jetbrains-mono, OFL), converted
// to TTF for fontconfig.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, ZONE, run, sleep } from "./util.mjs";

const NEEDS = ["Xvfb", "xterm", "xdotool", "import", "display", "convert", "ffmpeg", "uv", "fc-list"];
/** The desktop colour: a warm paper grey near DESIGN.md's --border, set as the root window background. */
export const ROOT = "#dfdad1";

/** JetBrains Mono as a TTF in `dir`, and a fontconfig file that adds `dir` to the system fonts. */
async function monoFont(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(REPO, "web/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2");
  if (!fs.existsSync(src)) throw new Error(`${src} is missing: run npm --prefix web install`);
  const ttf = path.join(dir, "JetBrainsMono.ttf");
  await run("uv", ["run", "--quiet", "--no-project", "--with", "fonttools", "--with", "brotli", "python", "-c",
    "import sys\nfrom fontTools.ttLib import TTFont\nf = TTFont(sys.argv[1])\nf.flavor = None\nf.save(sys.argv[2])", src, ttf]);
  const conf = path.join(dir, "fonts.conf");
  fs.writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${dir}</dir><cachedir>${path.join(dir, "cache")}</cachedir></fontconfig>\n`);
  return conf;
}

/**
 * The root window's colour and the arrow pointer, as a desktop session sets
 * them (xsetroot's job; python-xlib does it here). RetainPermanent keeps both
 * after the client exits.
 */
async function styleRoot(env) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(ROOT.slice(i, i + 2), 16));
  const py = `from Xlib import display, X
d = display.Display(); s = d.screen(); root = s.root
d.set_close_down_mode(X.RetainPermanent)
px = s.default_colormap.alloc_color(${r * 257}, ${g * 257}, ${b * 257}).pixel
font = d.open_font("cursor")
arrow = font.create_glyph_cursor(font, 68, 69, (0, 0, 0), (65535, 65535, 65535))
root.change_attributes(background_pixel=px, cursor=arrow)
root.clear_area()
d.sync()`;
  await run("uv", ["run", "--quiet", "--no-project", "--with", "python-xlib", "python", "-c", py], { env });
}

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
  // TZ: the clock on the desktop shows the same morning as the browser.
  const env = { DISPLAY: display, TZ: ZONE, FONTCONFIG_FILE: await monoFont(path.join(work, "fonts")) };
  const stop = async () => {
    for (const p of [...procs].reverse()) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await sleep(300);
  };
  try {
    procs.push(start(["Xvfb", display, "-screen", "0", `${width}x${height}x24`, "-nolisten", "tcp", "-noreset"], {}, log));
    for (let i = 0; i < 40 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) await sleep(100);
    if (!fs.existsSync(`/tmp/.X11-unix/X${n}`)) throw new Error(`Xvfb ${display} did not start (log: ${log})`);
    await styleRoot(env);
    for (const argv of apps) procs.push(start(argv, env, log));
    await sleep(1200);
  } catch (e) {
    await stop();
    throw e;
  }
  /** Start one more X app on this display, as a user opens a window. Resolves with its process. */
  const open = async (argv) => {
    const child = start(argv, env, log);
    procs.push(child);
    await sleep(1500);
    return child;
  };
  return { display, stop, log, env, open };
}

/** One frame straight from the X server, to prove there is something to stream. */
export async function grab(display, file) {
  await run("import", ["-display", display, "-window", "root", file]);
  return file;
}
