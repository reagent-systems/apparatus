// Voice activity detection over 20 ms PCM frames.
//
// `raw` is the per-frame decision. `active` adds the hangover: it stays true
// for `hangoverMs` after the last raw frame, so a short dip inside a word does
// not split a segment. The gate counts voice time from `raw` and ends a
// segment on `active`.

export type VadResult = { raw: boolean; active: boolean; energy: number };

export interface Vad {
  process(frame: Int16Array | Float32Array): VadResult;
  reset(): void;
}

/** RMS of a frame on the [-1, 1] scale. Int16 input is normalized. */
export function frameRms(frame: Int16Array | Float32Array): number {
  if (frame.length === 0) return 0;
  const scale = frame instanceof Int16Array ? 1 / 32768 : 1;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] * scale;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

export type EnergyVadOptions = {
  threshold: number;
  hangoverMs: number;
  sampleRate?: number;
};

// Silero or another model implements `Vad` with the same `raw`/`active`
// contract; wrap its probability with the same hangover logic.
export class EnergyVad implements Vad {
  readonly threshold: number;
  readonly hangoverMs: number;
  readonly sampleRate: number;
  private hangoverLeftMs = 0;

  constructor(opts: EnergyVadOptions) {
    this.threshold = opts.threshold;
    this.hangoverMs = opts.hangoverMs;
    this.sampleRate = opts.sampleRate ?? 16000;
  }

  process(frame: Int16Array | Float32Array): VadResult {
    const frameMs = (frame.length / this.sampleRate) * 1000;
    const energy = frameRms(frame);
    const raw = energy >= this.threshold;
    const active = raw || this.hangoverLeftMs > 1e-6;
    if (raw) this.hangoverLeftMs = this.hangoverMs;
    else this.hangoverLeftMs = Math.max(0, this.hangoverLeftMs - frameMs);
    return { raw, active, energy };
  }

  reset(): void {
    this.hangoverLeftMs = 0;
  }
}
