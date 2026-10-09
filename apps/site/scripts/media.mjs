// Makes the site's media from docs/media. Needs ffmpeg (libx264, libvpx-vp9,
// libwebp) and ImageMagick.
//
// Loops: an H.264 MP4, a VP9 WebM and a WebP poster at two widths per GIF,
// named by a hash of their bytes so vercel.json can cache /media for a year.
// Writes src/data/media.json, which the pages read.
//
// Crops: the parts of a still the page shows on its own (the hero's phone
// screen, the approval and handoff cards cut to their content), as PNGs in
// src/assets/crops. The build turns them into WebP like any other still.
//
//   npm run media -w apparatus-site

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dirname, "..");
const source = resolve(site, "../../docs/media");
const out = join(site, "public/media");
const crops = join(site, "src/assets/crops");

// `start` (seconds) rotates the loop so it opens on its action. The phone opens
// on the request in the feed with "On it." (6.0 s of the GIF), so the empty orb
// (1.5 to 5.9 s) plays once, as the loop's tail. `keep` (seconds of the GIF, in
// order) plays only those spans: the screen loop keeps Control pressed, the
// typing, the column -ts table and Release, and cuts the idle cursor between them.
// `poster` is a moment of the GIF itself, before any rotation or cut: the Weekly
// orders table, and the column -ts table printed under Control.
const SCREEN_KEEP = [
  [0.7, 2.0],
  [3.3, 8.2],
  [9.6, 10.5],
];
const LOOPS = [
  { name: "phone", start: 6.0, poster: 12.5 },
  { name: "phone-dark", start: 6.0, poster: 12.5 },
  { name: "screen-control", keep: SCREEN_KEEP, poster: 6.6 },
  { name: "screen-control-dark", keep: SCREEN_KEEP, poster: 6.6 },
  { name: "watch", start: 0, poster: 2.5 },
  { name: "watch-dark", start: 0, poster: 2.5 },
];
/** The GIFs run at 50 fps; for UI captures on a page, 25 fps is about half the bytes. */
const FPS = 25;
/** The small poster's width: a phone's slot at DPR 2 and less. */
const SMALL_POSTER = 480;

// Each crop: the still, and either a fixed box (x, y, w, h in the still's pixels)
// or `trim`, the content box found by ImageMagick plus `margin` pixels of page.
const CROPS = [
  // The hero's phone: the receipt's top 9:14, where its content is; the rest of the screen is blank.
  { name: "hero-receipt", from: "phone/phone-5-receipt.png", box: { x: 0, y: 0, w: 1170, h: 1820 } },
  { name: "hero-receipt-dark", from: "phone/phone-5-receipt-dark.png", box: { x: 0, y: 0, w: 1170, h: 1820 } },
  { name: "handoff-card", from: "handoff-card.png", trim: true, margin: 48 },
  { name: "handoff-card-dark", from: "handoff-card-dark.png", trim: true, margin: 48 },
  { name: "approval-card", from: "approval-card.png", trim: true, margin: 48 },
  { name: "approval-card-dark", from: "approval-card-dark.png", trim: true, margin: 48 },
];

const tool = (cmd, args) => execFileSync(cmd, args).toString().trim();
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file) =>
  tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file])
    .split(",")
    .map(Number);

function hashed(tmp, name, ext) {
  const bytes = readFileSync(tmp);
  const file = `${name}.${createHash("sha256").update(bytes).digest("hex").slice(0, 10)}.${ext}`;
  renameSync(tmp, join(out, file));
  return { file: `/media/${file}`, bytes: bytes.length };
}

/** The filter that plays `spans` ([from, to] in seconds; `to` null is the end) in order and sets the frame rate. */
function cut(spans) {
  if (!spans.length) return ["-vf", `fps=${FPS}`];
  const n = spans.length;
  const parts = spans.map(([from, to], i) => {
    const range = [from ? `start=${from.toFixed(2)}` : "", to != null ? `end=${to.toFixed(2)}` : ""].filter(Boolean).join(":");
    return `[s${i}]trim=${range},setpts=PTS-STARTPTS[c${i}]`;
  });
  const inputs = spans.map((_, i) => `[s${i}]`).join("");
  const outputs = spans.map((_, i) => `[c${i}]`).join("");
  return ["-filter_complex", `[0:v]split=${n}${inputs};${parts.join(";")};${outputs}concat=n=${n}:v=1,fps=${FPS}[v]`, "-map", "[v]"];
}
/** The spans for a loop: `keep` as given, or the whole GIF rotated to open at `start`. */
const spansOf = ({ start, keep }) => keep ?? (start ? [[start, null], [0, start]] : []);

for (const old of readdirSync(out)) {
  if (/\.(mp4|webm|webp)$/.test(old)) rmSync(join(out, old));
}

const work = mkdtempSync(join(tmpdir(), "site-media-"));
const manifest = {};
for (const loop of LOOPS) {
  const { name, poster } = loop;
  const gif = join(source, `${name}.gif`);
  const [width, height] = probe(gif);
  const mp4 = join(work, `${name}.mp4`);
  const webm = join(work, `${name}.webm`);
  const webp = join(work, `${name}.webp`);
  const small = join(work, `${name}-${SMALL_POSTER}.webp`);
  // yuv420p and +faststart: every browser plays it, and it starts before the whole file arrives.
  ffmpeg("-i", gif, ...cut(spansOf(loop)), "-an", "-c:v", "libx264", "-preset", "veryslow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4);
  // CRF 40 keeps the fallback smaller than the MP4 most browsers pick.
  ffmpeg("-i", gif, ...cut(spansOf(loop)), "-an", "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", webm);
  // -ss after -i: the GIF decodes from the start and the frame is the exact moment.
  ffmpeg("-i", gif, "-ss", String(poster), "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", webp);
  ffmpeg("-i", gif, "-ss", String(poster), "-frames:v", "1", "-vf", `scale=${Math.min(SMALL_POSTER, width)}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "80", small);
  const entry = {
    width,
    height,
    mp4: hashed(mp4, name, "mp4"),
    webm: hashed(webm, name, "webm"),
    poster: hashed(webp, name, "webp"),
    posterSmall: hashed(small, `${name}-${SMALL_POSTER}`, "webp"),
  };
  manifest[name] = entry;
  console.log(`${name}: gif ${readFileSync(gif).length} B, mp4 ${entry.mp4.bytes} B, webm ${entry.webm.bytes} B, spans ${JSON.stringify(spansOf(loop))}`);
}
rmSync(work, { recursive: true });
writeFileSync(join(site, "src/data/media.json"), JSON.stringify(manifest, null, 2) + "\n");

mkdirSync(crops, { recursive: true });
for (const { name, from, box, trim, margin = 0 } of CROPS) {
  const file = join(source, from);
  let b = box;
  if (trim) {
    // The page colour is the still's corner pixel; 3 % fuzz absorbs the encoder's noise.
    const [w, h, x, y] = tool("convert", [file, "-fuzz", "3%", "-trim", "-format", "%w %h %X %Y", "info:"]).split(" ").map(Number);
    const [W, H] = tool("identify", ["-format", "%w %h", file]).split(" ").map(Number);
    const x0 = Math.max(0, x - margin);
    const y0 = Math.max(0, y - margin);
    b = { x: x0, y: y0, w: Math.min(W, x + w + margin) - x0, h: Math.min(H, y + h + margin) - y0 };
  }
  tool("convert", [file, "-crop", `${b.w}x${b.h}+${b.x}+${b.y}`, "+repage", "-strip", join(crops, `${name}.png`)]);
  console.log(`${name}: ${b.w}x${b.h}+${b.x}+${b.y} of ${from}`);
}
