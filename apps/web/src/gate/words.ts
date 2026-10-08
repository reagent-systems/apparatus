// Word counts for the barge-in rule.
//
// Before a turn is confirmed no audio has left the device, so no transcript
// exists yet. `EnergyBurstWordEstimator` guesses from the energy contour: one
// voiced burst between two dips is one word. `TranscriptWordCounter` counts
// words in the interim transcript once one arrives; the gate takes the larger
// of the two.

export interface WordEstimator {
  /** One frame: `voiced` is the raw VAD decision for it. */
  push(voiced: boolean, frameMs: number): void;
  count(): number;
  reset(): void;
}

export type BurstOptions = {
  /** A burst shorter than this is noise, not a word. */
  minBurstMs?: number;
  /** A dip shorter than this is inside a word. */
  minDipMs?: number;
};

export class EnergyBurstWordEstimator implements WordEstimator {
  readonly minBurstMs: number;
  readonly minDipMs: number;
  private inBurst = false;
  private burstMs = 0;
  private dipMs = 0;
  private counted = false;
  private words = 0;

  constructor(opts: BurstOptions = {}) {
    this.minBurstMs = opts.minBurstMs ?? 40;
    this.minDipMs = opts.minDipMs ?? 40;
  }

  push(voiced: boolean, frameMs: number): void {
    if (voiced) {
      if (!this.inBurst) {
        this.inBurst = true;
        this.burstMs = 0;
        this.counted = false;
      }
      this.dipMs = 0;
      this.burstMs += frameMs;
      if (!this.counted && this.burstMs >= this.minBurstMs) {
        this.counted = true;
        this.words += 1;
      }
      return;
    }
    if (!this.inBurst) return;
    this.dipMs += frameMs;
    if (this.dipMs >= this.minDipMs) {
      this.inBurst = false;
      this.dipMs = 0;
    }
  }

  count(): number {
    return this.words;
  }

  reset(): void {
    this.inBurst = false;
    this.burstMs = 0;
    this.dipMs = 0;
    this.counted = false;
    this.words = 0;
  }
}

/** Tokens with at least one letter or digit. */
export function countWords(text: string): number {
  let n = 0;
  for (const tok of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(tok)) n += 1;
  }
  return n;
}

export class TranscriptWordCounter {
  private text = "";

  setText(text: string): void {
    this.text = text;
  }

  count(): number {
    return countWords(this.text);
  }

  reset(): void {
    this.text = "";
  }
}
