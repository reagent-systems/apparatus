// Synthetic PCM frames for gate tests. 20 ms at 16 kHz = 320 samples.

export const RATE = 16000;
export const FRAME = 320;

/** A frame with the given RMS amplitude on the [-1, 1] scale. */
export function frame(amplitude: number): Int16Array {
  const out = new Int16Array(FRAME);
  if (amplitude === 0) return out;
  // a square-ish 200 Hz tone: RMS equals the amplitude
  const period = RATE / 200;
  for (let i = 0; i < FRAME; i++) {
    const sign = (i % period) < period / 2 ? 1 : -1;
    out[i] = Math.round(sign * amplitude * 32767);
  }
  return out;
}

export function silence(): Int16Array {
  return frame(0);
}

export function loud(): Int16Array {
  return frame(0.2);
}

export function frames(ms: number, make: () => Int16Array): Int16Array[] {
  const n = Math.round(ms / 20);
  const out: Int16Array[] = [];
  for (let i = 0; i < n; i++) out.push(make());
  return out;
}
