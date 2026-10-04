// While the model speaks, the bar to interrupt it is higher: enough voice
// time and enough words. Both limits are inclusive.

export type BargeInConfig = { minVoiceMs: number; minWords: number };

export class BargeInRule {
  readonly minVoiceMs: number;
  readonly minWords: number;

  constructor(cfg: BargeInConfig) {
    this.minVoiceMs = cfg.minVoiceMs;
    this.minWords = cfg.minWords;
  }

  allows(voiceMs: number, words: number): boolean {
    return voiceMs >= this.minVoiceMs && words >= this.minWords;
  }
}
