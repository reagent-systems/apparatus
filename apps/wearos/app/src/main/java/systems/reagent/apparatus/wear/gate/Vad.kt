// Port of apps/web/src/gate/vad.ts. Voice activity detection over 20 ms PCM16 frames.
//
// `raw` is the per-frame decision. `active` adds the hangover: it stays true for
// `hangoverMs` after the last raw frame, so a short dip inside a word does not split a
// segment. The gate counts voice time from `raw` and ends a segment on `active`.

package systems.reagent.apparatus.wear.gate

import kotlin.math.max
import kotlin.math.sqrt

class VadResult(val raw: Boolean, val active: Boolean, val energy: Double)

/** RMS of a PCM16 frame on the [-1, 1] scale. */
fun frameRms(frame: ShortArray): Double {
    if (frame.isEmpty()) return 0.0
    val scale = 1.0 / 32768
    var sum = 0.0
    for (s in frame) {
        val v = s * scale
        sum += v * v
    }
    return sqrt(sum / frame.size)
}

class EnergyVad(val threshold: Double, val hangoverMs: Double, val sampleRate: Int = 16000) {
    private var hangoverLeftMs = 0.0

    fun process(frame: ShortArray): VadResult {
        val frameMs = (frame.size.toDouble() / sampleRate) * 1000
        val energy = frameRms(frame)
        val raw = energy >= threshold
        val active = raw || hangoverLeftMs > 1e-6
        hangoverLeftMs = if (raw) hangoverMs else max(0.0, hangoverLeftMs - frameMs)
        return VadResult(raw, active, energy)
    }

    fun reset() {
        hangoverLeftMs = 0.0
    }
}
