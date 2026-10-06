#!/usr/bin/env node
// node tools/media/capture.mjs [scene…] --out <dir> [--work <dir>] [--build] [--web-dist <dir>]
//                               [--themes light,dark] [--keep-frames] [--list]
//
// Each scene is one module in scenes/ and makes one asset (a still scene also
// makes its dark variant). Every scene starts its own session server in demo
// mode and its own agentd, so no scene sees another's data.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEDIA, REPO, log, mkdirp, run } from "./lib/util.mjs";

function parse(argv) {
  const opts = { scenes: [], out: null, work: null, build: false, themes: ["light", "dark"], list: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--work") opts.work = argv[++i];
    else if (a === "--build") opts.build = true;
    else if (a === "--web-dist") opts.webDist = argv[++i];
    else if (a === "--themes") opts.themes = argv[++i].split(",");
    else if (a === "--list") opts.list = true;
    else if (a === "--keep-frames") opts.keep = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.scenes.push(a);
  }
  return opts;
}

async function loadScenes() {
  const dir = path.join(MEDIA, "scenes");
  const scenes = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
    const mod = (await import(path.join(dir, f))).default;
    scenes.set(mod.name, mod);
  }
  return scenes;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const scenes = await loadScenes();
  if (opts.list) {
    for (const s of scenes.values()) console.log(`${s.name.padEnd(16)} ${s.kind.padEnd(6)} ${s.makes}`);
    return;
  }
  if (!opts.out) throw new Error("--out <dir> is required");
  const names = opts.scenes.length ? opts.scenes : [...scenes.keys()].filter((n) => !scenes.get(n).optIn);
  for (const n of names) if (!scenes.has(n)) throw new Error(`unknown scene ${n}; --list shows them`);
  const out = mkdirp(path.resolve(opts.out));
  const work = mkdirp(path.resolve(opts.work ?? fs.mkdtempSync(path.join(os.tmpdir(), "apparatus-media-"))));
  const webDist = path.resolve(opts.webDist ?? path.join(REPO, "web/dist"));
  if (opts.build) {
    log("building the web client");
    await run("npm", ["--prefix", path.join(REPO, "web"), "run", "build"], { quiet: false });
  }
  const ctx = { out, work, webDist, themes: opts.themes, keepFrames: opts.keep };
  const report = [];
  for (const n of names) {
    const scene = scenes.get(n);
    const t0 = Date.now();
    log(`scene ${n}`);
    try {
      const made = (await scene.run(ctx)) ?? [];
      report.push({ scene: n, ok: true, made, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      console.error(`[media] scene ${n} failed: ${e.stack ?? e}`);
      report.push({ scene: n, ok: false, error: String(e.message ?? e), seconds: Math.round((Date.now() - t0) / 1000) });
    }
  }
  fs.writeFileSync(path.join(work, "report.json"), JSON.stringify(report, null, 2));
  for (const r of report) {
    if (!r.ok) console.log(`FAIL ${r.scene}: ${r.error}`);
    else for (const m of r.made) console.log(`ok   ${r.scene}: ${typeof m === "string" ? m : JSON.stringify(m)}`);
  }
  // The brief's budget: at most 40 MB of media in all, subfolders included.
  const sizeOf = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : fs.statSync(p).size);
  const total = sizeOf(out);
  const mb = (total / 1024 / 1024).toFixed(1);
  if (total > 40 * 1024 * 1024) {
    console.log(`FAIL budget: ${out} holds ${mb} MB, over 40 MB`);
    process.exitCode = 1;
  } else log(`${out} holds ${mb} MB`);
  log(`work folder: ${work}`);
  if (report.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`[media] ${e.stack ?? e}`);
  process.exit(1);
});
