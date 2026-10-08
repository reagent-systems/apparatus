// Port of apps/web/src/gate/words.ts and bargein.ts. Word counts for the barge-in rule, and the rule.
//
// Before a turn is confirmed no audio has left the device, so no transcript exists yet. The
// energy-burst estimator guesses from the energy contour: one voiced burst between two dips is
// one word. The transcript counter counts words of the interim transcript once one arrives; the
// gate takes the larger of the two.

package systems.reagent.apparatus.wear.gate

class EnergyBurstWordEstimator(private val minBurstMs: Double = 40.0, private val minDipMs: Double = 40.0) {
    private var inBurst = false
    private var burstMs = 0.0
    private var dipMs = 0.0
    private var counted = false
    private var words = 0

    /** One frame: [voiced] is the raw VAD decision for it. */
    fun push(voiced: Boolean, frameMs: Double) {
        if (voiced) {
            if (!inBurst) {
                inBurst = true
                burstMs = 0.0
                counted = false
            }
            dipMs = 0.0
            burstMs += frameMs
            if (!counted && burstMs >= minBurstMs) {
                counted = true
                words += 1
            }
            return
        }
        if (!inBurst) return
        dipMs += frameMs
        if (dipMs >= minDipMs) {
            inBurst = false
            dipMs = 0.0
        }
    }

    fun count(): Int = words

    fun reset() {
        inBurst = false
        burstMs = 0.0
        dipMs = 0.0
        counted = false
        words = 0
    }
}

private val LETTER_OR_DIGIT = Regex("[\\p{L}\\p{N}]")

/** Tokens with at least one letter or digit. */
fun countWords(text: String): Int = text.split(JS_WHITESPACE).count { LETTER_OR_DIGIT.containsMatchIn(it) }

class TranscriptWordCounter {
    private var text = ""

    fun setText(text: String) {
        this.text = text
    }

    fun count(): Int = countWords(text)

    fun reset() {
        text = ""
    }
}

/** While the model speaks, the bar to interrupt it is higher: enough voice time and enough words. Both inclusive. */
class BargeInRule(private val minVoiceMs: Double, private val minWords: Double) {
    fun allows(voiceMs: Double, words: Int): Boolean = voiceMs >= minVoiceMs && words >= minWords
}
