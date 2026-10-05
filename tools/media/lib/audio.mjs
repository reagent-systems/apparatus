// Speech-like sound for the capture harness. Nothing here is a voice: it is a
// pitched, syllable-shaped signal loud enough to drive the client's real code
// paths (the gate's energy VAD on the microphone side, the playback clock on
// the agent side), so the orb shows listening and speaking as it would.

import fs from "node:fs";
import { run } from "./util.mjs";

/**
 * A WAV for Chromium's fake microphone (--use-file-for-fake-audio-capture),
 * made by ffmpeg: `leadMs` of silence, then each [startMs, endMs] segment of
 * speech-like sound, then silence to `totalMs`. Chromium loops the file, so
 * `totalMs` must outlast the scene.
 */
export async function micWav(file, { segments, totalMs = 60_000, rate = 48_000 }) {
  const total = (totalMs / 1000).toFixed(3);
  const gate = segments.length === 0 ? "0" : segments.map(([a, b]) => `between(t,${(a / 1000).toFixed(3)},${(b / 1000).toFixed(3)})`).join("+");
  // f0 near 150 Hz with a slow drift, three harmonics, 4.3 Hz syllables that
  // never dip long enough to end a turn, and a little breath noise.
  const f0 = "(150+18*sin(2*PI*0.7*t))";
  const carrier = `(sin(2*PI*${f0}*t)+0.55*sin(4*PI*${f0}*t)+0.3*sin(6*PI*${f0}*t)+0.08*(random(0)*2-1))`;
  const env = "(0.35+0.65*pow(abs(sin(2*PI*2.15*t)),0.6))";
  const expr = `0.22*min(1,${gate})*${env}*${carrier}`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=${rate}:d=${total}`, "-ac", "1", "-c:a", "pcm_s16le", file]);
  if (!fs.existsSync(file)) throw new Error(`ffmpeg wrote no ${file}`);
  return file;
}

/** PCM16 little-endian mono at `rate` Hz, speech-like, `ms` long. Deterministic per `seed`. */
export function speechPcm(ms, { rate = 24_000, seed = 1 } = {}) {
  const n = Math.round((rate * ms) / 1000);
  const out = Buffer.alloc(n * 2);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
  // Words of 2 to 4 syllables with short gaps between them.
  const plan = [];
  let t = 0;
  while (t < ms) {
    const syll = 2 + Math.floor((rnd() + 1) * 1.5);
    const len = syll * (170 + 40 * rnd());
    plan.push([t, Math.min(ms, t + len), syll]);
    t += len + 70 + 50 * (rnd() + 1);
  }
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const tm = (i / rate) * 1000;
    let env = 0;
    for (const [a, b, syll] of plan) {
      if (tm >= a && tm < b) {
        const x = (tm - a) / (b - a);
        const edge = Math.min(1, x * 12, (1 - x) * 12);
        env = edge * (0.45 + 0.55 * Math.abs(Math.sin(Math.PI * x * syll)));
        break;
      }
    }
    const f0 = 165 + 25 * Math.sin((2 * Math.PI * tm) / 900) - 20 * (tm / ms);
    phase += (2 * Math.PI * f0) / rate;
    const v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.04 * rnd();
    out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * env * 0.28 * 32767))), i * 2);
  }
  return out;
}
