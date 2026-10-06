// screen-control.gif: the pane only (its header, the VM screen, the Control
// bar), drawn at 1.5x. The X screen is 960 x 540 and the pane's frame shows it
// at 918 px, nearly 1:1. The agent wrote report.csv; a terminal is open where
// it is, beside an xclock. Control: the ring turns primary; the real X
// pointer (x11grab draws it) glides into the terminal and clicks; the user
// types `column -ts, report.csv` through the page and the VM prints the
// table, which holds 1.5 s; the user clears the terminal, glides the pointer
// back and releases. The last frame matches the first, so the loop has no
// cut. Real frames only: the scene fails unless the stream decodes and the X
// server shows the keys landed.
//
// 50 fps on page time, frame by frame, like the other GIFs (lib/vtime.mjs):
// the page's clocks move 20 ms a frame, and the scene's input (each pointer
// position of a glide, each key) is sent on its own frame. The stream's video
// runs in wall time, so before each frame is taken lib/vmsync.mjs waits until
// the input has landed on the X server, the X screen holds still, and the
// page's video shows that X screen: it matches a grab of it, shows the X
// pointer where X has it and not where it was. A frame the decoder shows with
// a grey cast after a large change is waited out. agentd streams at 10 fps
// here (AGENTD_STREAM_FPS), the rate its encoder sustains at this size.
//
// Each glide moves the X pointer at least 2 px a frame (an eased glide with a
// floor on its speed), so no frame of a glide repeats the one before. Frames
// repeat only where the VM screen and the page are both still (the holds,
// between keys); the scene lists them. The xclock draws no second hand and is
// stopped (SIGSTOP) while the frames are taken: taking them takes minutes of
// wall time, and a clock without a second hand shows the same picture over
// the 11 s the GIF shows.

import fs from "node:fs";
import path from "node:path";
import { parkPointer } from "../lib/browser.mjs";
import { dropFrames, encodeChecked, record } from "../lib/gifscene.mjs";
import { COMMAND, openScreen, paneClip, restPoint, seedOrders } from "../lib/screenflow.mjs";
import { terminalBox, withScreen } from "../lib/screen.mjs";
import { VmSync } from "../lib/vmsync.mjs";
import { ROOT } from "../lib/xdesktop.mjs";
import { log, run, sleep } from "../lib/util.mjs";

/** The rail collapsed, the pane at its widest (640 px). */
const PREFS = { "apparatus.rail": "1", "apparatus.pane.width": "80" };
/** 1.5x: the pane is about 958 px wide. Wide enough for the pane's 640 px beside the thread's 400. */
const DEVICE = { viewport: { width: 1160, height: 540 }, deviceScaleFactor: 1.5 };
const SCREEN = { width: 960, height: 540 };
/**
 * The X capture rate. Frames are taken on page time, so the stream's rate sets how long each
 * frame waits, not the GIF's. At 960 x 540 agentd's VP8 encoder (aiortc, in Python) keeps up
 * with 10 frames a second on a loaded 4-core machine; at 20 and more it falls behind, and the
 * page's video shows the X screen seconds late, later and later (see tools/media/README.md).
 */
const STREAM_FPS = 10;
const FPS = 50;
const STEP = 1000 / FPS;
/** Frames each pointer glide takes: 0.9 s. */
const GLIDE_FRAMES = 45;
/** The glide's share of constant speed: its slowest frame still moves the pointer (at least 2 px here). */
const GLIDE_LINEAR = 0.25;
/** A key or the click is held 2 frames; the next key comes 2 frames after the release: 12.5 keys a second. */
const KEY_HOLD = 2 * STEP;
const KEY_GAP = 2 * STEP;
/** Wall ms the stream plays before the recording, so the decoder is past its start-up burst. */
const STREAM_SETTLE_MS = 4000;

/** The page point the client maps to X pixel `p` (web/src/vm/input.ts normalizePointer, agentd input_argv). */
async function mapper(page) {
  const g = await page.locator("video").first().evaluate((v) => {
    const r = v.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, vw: v.videoWidth, vh: v.videoHeight };
  });
  const k = Math.min(g.width / g.vw, g.height / g.vh);
  const bw = g.vw * k;
  const bh = g.vh * k;
  const left = g.left + (g.width - bw) / 2;
  const top = g.top + (g.height - bh) / 2;
  return (p) => ({ x: left + (p.x / (g.vw - 1)) * bw, y: top + (p.y / (g.vh - 1)) * bh });
}

/** Distinct consecutive frames: runs of byte-identical decoded frames (ffmpeg framemd5), as [first, last] index pairs. */
async function repeatRuns(pattern) {
  const out = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", pattern, "-f", "framemd5", "-"]);
  const sums = out.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim());
  const runs = [];
  for (let k = 1; k < sums.length; k++) {
    if (sums[k] !== sums[k - 1]) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === k - 1) last[1] = k;
    else runs.push([k, k]);
  }
  return { runs, count: runs.reduce((n, [a, b]) => n + b - a + 1, 0), frames: sums.length };
}

export default {
  name: "screen-control",
  kind: "gif",
  makes: "screen-control.gif: Control, a click and a command land in the VM, Release (needs Xvfb, xterm, xclock, xdotool, ffmpeg)",
  async run(ctx) {
    const opts = { name: "screen-control", device: DEVICE, prefs: PREFS, platform: "desktop", screen: SCREEN, clockSeconds: false, vtime: FPS, stackEnv: { AGENTD_STREAM_FPS: String(STREAM_FPS) } };
    return withScreen(ctx, opts, async (app, { desk }) => {
      const { page, clock } = app;
      const wait = (ms) => clock.sleep(ms);
      // The 640 px screen's 12 px, scaled: the 36-column terminal ends beside the clock, not over it.
      desk.termFontPx = 18;
      await seedOrders(app, desk);
      // The X pointer rests where the user last left it, beside the terminal.
      const rest = await restPoint(desk);
      await run("xdotool", ["mousemove", String(rest.x), String(rest.y)], { env: desk.env });
      await openScreen(app, "screen-control");
      const clip = await paneClip(page);
      await sleep(STREAM_SETTLE_MS);
      const term = await terminalBox(desk);
      const target = { x: term.x + term.w - 140, y: term.y + term.h - 60 };
      const toPage = await mapper(page);
      // Patches of the bare root window (X px): a strip along the bottom left, under the
      // terminal, and one along the top, above the windows; the pointer crosses neither.
      const patches = [
        { x: 10, y: SCREEN.height - 50, w: Math.round(SCREEN.width * 0.45) - 10, h: 42 },
        { x: 10, y: 6, w: SCREEN.width - 20, h: 30 },
      ];
      const root = [1, 3, 5].map((i) => Number.parseInt(ROOT.slice(i, i + 2), 16));
      const sync = new VmSync(page, desk.env, { screen: SCREEN, root, patches, log });
      sync.dumpDir = path.join(app.work, "vmsync");
      await sync.install();
      const settle = (t) => sync.settle(t);
      // The clock stands still while the frames are taken (see the head of this file).
      process.kill(desk.clock.pid, "SIGSTOP");
      let frames;
      let rec;
      try {
        app.vt.afterFrame.add(settle); // before the recorder's screenshot
        rec = await record(app, ctx, { fps: FPS, clip });
        await wait(300);
        rec.mark("start");
        await wait(900);
        // Control, as a hand presses it: the pointer on the button, a beat, the press.
        const control = await page.getByRole("button", { name: "Control", exact: true }).first().boundingBox();
        await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2);
        await wait(300);
        await page.mouse.down();
        await wait(KEY_HOLD);
        await page.mouse.up();
        // The user looks at the ring; input is on once the client focuses the video.
        await wait(1200);
        if (!(await page.evaluate(() => document.activeElement?.tagName === "VIDEO"))) throw new Error("Control: the client never turned input on (the video took no focus)");
        // The page's pointer onto the video where the X pointer rests: it does not move.
        await page.mouse.move(toPage(rest).x, toPage(rest).y);
        sync.expectPointer(rest);
        await wait(200);
        const glide = async (from, to) => {
          let last = from;
          for (let i = 1; i <= GLIDE_FRAMES; i++) {
            const u = i / GLIDE_FRAMES;
            const e = (1 - GLIDE_LINEAR) * (0.5 - Math.cos(Math.PI * u) / 2) + GLIDE_LINEAR * u;
            const p = { x: Math.round(from.x + (to.x - from.x) * e), y: Math.round(from.y + (to.y - from.y) * e) };
            if (Math.max(Math.abs(p.x - last.x), Math.abs(p.y - last.y)) < 2) throw new Error(`glide: frame ${i} moves the pointer under 2 px`);
            last = p;
            const q = toPage(p);
            await page.mouse.move(q.x, q.y);
            sync.expectPointer(p);
            await wait(STEP);
          }
        };
        await glide(rest, target);
        await wait(250);
        await page.mouse.down();
        await wait(KEY_HOLD);
        await page.mouse.up();
        await wait(300);
        const type = async (text) => {
          for (const ch of [...text, "Enter"]) {
            await sync.expectChange(`the key ${ch}`);
            await page.keyboard.down(ch);
            await wait(KEY_HOLD);
            await page.keyboard.up(ch);
            await wait(KEY_GAP);
          }
        };
        await type(COMMAND);
        await wait(1500); // the table
        await type("clear");
        await wait(600);
        await glide(target, rest);
        await wait(300);
        // Release, as a hand presses it; then the page's pointer leaves the pane.
        const release = await page.getByRole("button", { name: "Release", exact: true }).first().boundingBox();
        await page.mouse.move(release.x + release.width / 2, release.y + release.height / 2);
        await wait(250);
        await page.mouse.down();
        await wait(KEY_HOLD);
        await page.mouse.up();
        await parkPointer(page);
        await wait(1100);
        rec.mark("end");
        frames = await rec.stop({ from: "start", to: "end" });
      } finally {
        app.vt.afterFrame.delete(settle);
        sync.stop();
        process.kill(desk.clock.pid, "SIGCONT");
      }
      const startT = frames.times[0];
      const proofs = sync.frames.filter((f) => f.t >= startT && f.t <= frames.times[frames.times.length - 1]);
      if (proofs.length !== frames.count) throw new Error(`screen-control: ${proofs.length} synced frames for ${frames.count} recorded`);
      const waited = proofs.map((p) => p.waited).sort((a, b) => a - b);
      const wallMs = proofs.map((p) => p.wallMs).sort((a, b) => a - b);
      log(`screen-control: ${frames.count} frames on page time; each waited a median ${waited[waited.length >> 1]} (max ${waited[waited.length - 1]}) video frames and ${wallMs[wallMs.length >> 1]} ms (max ${wallMs[wallMs.length - 1]}) for the video to show the X screen`);
      // Repeats: where neither the VM nor the page changed. None may fall on a frame where the X pointer moved or the X screen changed.
      const rep = await repeatRuns(frames.pattern);
      const inMotion = [];
      for (const [a, b] of rep.runs) for (let k = a; k <= b; k++) if (proofs[k].moved || proofs[k].changed) inMotion.push(k);
      const at = (k) => `${((frames.times[k] - startT) / 1000).toFixed(2)} s`;
      log(`screen-control: ${rep.count} frames repeat the frame before, in ${rep.runs.length} runs where the VM and the page are still: ${rep.runs.map(([a, b]) => `${a}-${b} (${at(a)})`).join(", ") || "none"}`);
      if (inMotion.length) throw new Error(`screen-control: frames ${inMotion.join(", ")} repeat the frame before while the VM changed`);
      const gif = await encodeChecked({ input: frames.pattern, fps: frames.fps, out: path.join(ctx.out, "screen-control.gif"), width: null, raw: frames.raw });
      fs.writeFileSync(path.join(app.work, "timing.json"), JSON.stringify({ times: frames.times, proofs, repeats: rep.runs }, null, 1));
      dropFrames(rec, ctx);
      if (!fs.existsSync(gif.file)) throw new Error("screen-control.gif was not written");
      const glideFrames = proofs.filter((p) => p.moved).length;
      return [{ ...gif, repeats: rep.count, repeatRuns: rep.runs, pointerFrames: glideFrames, changedFrames: proofs.filter((p) => p.changed).length }];
    });
  },
};
