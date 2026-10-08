package systems.reagent.apparatus.wear.gate

import org.json.JSONObject

/**
 * The `[gate]` table of `config/apparatus.toml`, as the server sends it in `ready.gate` (the
 * same table as `GET /config/gate`). Mirror of `apps/web/src/config.ts` `GateConfig`. The defaults
 * equal that table and are fallbacks only: the watch holds no thresholds of its own.
 */
data class GateConfig(
    val vadEnergyThreshold: Double = 0.015,
    val vadHangoverMs: Double = 240.0,
    val minSpeechMs: Double = 300.0,
    val silenceCompleteMs: Double = 500.0,
    val silenceIncompleteMs: Double = 2500.0,
    val bargeinMinVoiceMs: Double = 300.0,
    val bargeinMinWords: Double = 2.0,
    val bargeinStopMs: Double = 200.0,
    val speakerCheck: Boolean = false,
    val speakerMatchThreshold: Double = 0.75,
) {
    companion object {
        val DEFAULT = GateConfig()

        /** The server table over the defaults, like `mergeGate`: a missing or mistyped field keeps its default. */
        fun merge(table: JSONObject?): GateConfig {
            if (table == null) return DEFAULT
            fun num(key: String, fallback: Double): Double = (table.opt(key) as? Number)?.toDouble() ?: fallback
            fun bool(key: String, fallback: Boolean): Boolean = table.opt(key) as? Boolean ?: fallback
            val d = DEFAULT
            return GateConfig(
                vadEnergyThreshold = num("vad_energy_threshold", d.vadEnergyThreshold),
                vadHangoverMs = num("vad_hangover_ms", d.vadHangoverMs),
                minSpeechMs = num("min_speech_ms", d.minSpeechMs),
                silenceCompleteMs = num("silence_complete_ms", d.silenceCompleteMs),
                silenceIncompleteMs = num("silence_incomplete_ms", d.silenceIncompleteMs),
                bargeinMinVoiceMs = num("bargein_min_voice_ms", d.bargeinMinVoiceMs),
                bargeinMinWords = num("bargein_min_words", d.bargeinMinWords),
                bargeinStopMs = num("bargein_stop_ms", d.bargeinStopMs),
                speakerCheck = bool("speaker_check", d.speakerCheck),
                speakerMatchThreshold = num("speaker_match_threshold", d.speakerMatchThreshold),
            )
        }
    }
}
