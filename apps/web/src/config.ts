// Gate thresholds and Live constants.
//
// The server sends the [gate] table of config/apparatus.toml in `ready.gate`.
// The values here equal that table and are fallbacks only: the client holds
// no thresholds of its own.

export type GateConfig = {
  vad_energy_threshold: number;
  vad_hangover_ms: number;
  min_speech_ms: number;
  silence_complete_ms: number;
  silence_incomplete_ms: number;
  bargein_min_voice_ms: number;
  bargein_min_words: number;
  bargein_stop_ms: number;
  speaker_check: boolean;
  speaker_match_threshold: number;
};

export const DEFAULT_GATE: GateConfig = {
  vad_energy_threshold: 0.015,
  vad_hangover_ms: 240,
  min_speech_ms: 300,
  silence_complete_ms: 500,
  silence_incomplete_ms: 2500,
  bargein_min_voice_ms: 300,
  bargein_min_words: 2,
  bargein_stop_ms: 200,
  speaker_check: false,
  speaker_match_threshold: 0.75,
};

// The [live] fields the client needs. `ready` may carry them as `live`.
export type LiveConfig = {
  idle_close_seconds: number;
  input_sample_rate: number;
  output_sample_rate: number;
};

export const DEFAULT_LIVE: LiveConfig = {
  idle_close_seconds: 120,
  input_sample_rate: 16000,
  output_sample_rate: 24000,
};

export const FRAME_MS = 20;
export const FRAME_SAMPLES = (DEFAULT_LIVE.input_sample_rate * FRAME_MS) / 1000;

function mergeTyped<T extends Record<string, number | boolean>>(defaults: T, partial: unknown): T {
  const out = { ...defaults };
  if (typeof partial !== "object" || partial === null) return out;
  const src = partial as Record<string, unknown>;
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const v = src[key as string];
    if (typeof v === typeof defaults[key]) {
      (out as Record<string, unknown>)[key as string] = v;
    }
  }
  return out;
}

/** The server table over the defaults. A missing or mistyped field keeps its default. */
export function mergeGate(partial: unknown): GateConfig {
  return mergeTyped(DEFAULT_GATE, partial);
}

export function mergeLive(partial: unknown): LiveConfig {
  return mergeTyped(DEFAULT_LIVE, partial);
}
