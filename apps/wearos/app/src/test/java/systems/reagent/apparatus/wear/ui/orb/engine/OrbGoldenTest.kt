package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.abs
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Replays the upstream golden vectors (thinking-orbs at 0d44887, spec/orbs-golden.json, MIT,
 * see resources/thinking-orbs/LICENSE): every resolved preset and every frame, value by value,
 * in draw order, within the file's tolerance.
 */
class OrbGoldenTest {

    private val golden: JSONObject by lazy {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("thinking-orbs/orbs-golden.json")) {
            "thinking-orbs/orbs-golden.json is missing from the test resources"
        }
        JSONObject(stream.bufferedReader().use { it.readText() })
    }

    private val tolerance: Double get() = golden.getDouble("tolerance")

    @Test
    fun everyPresetResolvesLikeTheLibrary() {
        val resolved = golden.getJSONObject("resolved")
        val failures = ArrayList<String>()
        for (key in resolved.keys()) {
            val (state, size) = key.split("-")
            val expected = resolved.getJSONObject(key)
            val actual = resolvePreset(checkNotNull(OrbAnimation.of(state)), size.toInt())
            if (actual.mode.wire != expected.getString("mode")) failures += "$key mode ${actual.mode.wire}"
            if (abs(actual.speed - expected.getDouble("speed")) > tolerance) failures += "$key speed ${actual.speed}"
            val opts = expected.getJSONObject("opts")
            val keys = opts.keys().asSequence().toSet()
            if (keys != actual.opts.keys) failures += "$key keys ${actual.opts.keys} != $keys"
            for (k in keys) {
                val v = actual.opts[k] ?: continue
                if (abs(v - opts.getDouble(k)) > tolerance) failures += "$key $k $v != ${opts.getDouble(k)}"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
        assertEquals(18, resolved.length())
    }

    @Test
    fun everyFrameMatchesTheLibraryInDrawOrder() {
        val cases = golden.getJSONArray("cases")
        val failures = ArrayList<String>()
        var values = 0
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val key = case.getString("key")
            val size = case.getInt("size")
            val resolved = resolvePreset(checkNotNull(OrbAnimation.of(case.getString("state"))), size)
            if (resolved.mode.wire != case.getString("mode")) failures += "$key mode ${resolved.mode.wire}"
            val frame = resolved.frame(size.toDouble(), case.getDouble("t"))
            if (frame.dots.size != case.getInt("dotCount") || frame.lines.size != case.getInt("lineCount")) {
                failures += "$key counts ${frame.dots.size}/${frame.lines.size} != ${case.getInt("dotCount")}/${case.getInt("lineCount")}"
                continue
            }
            val dots = case.getJSONArray("dots")
            frame.dots.forEachIndexed { d, dot ->
                val got = doubleArrayOf(dot.x, dot.y, dot.z, dot.r, dot.white, dot.a)
                for (f in got.indices) {
                    val want = dots.getDouble(d * 6 + f)
                    values++
                    if (abs(got[f] - want) > tolerance) failures += "$key dot $d field $f ${got[f]} != $want"
                }
            }
            val lines = case.getJSONArray("lines")
            frame.lines.forEachIndexed { l, line ->
                val got = doubleArrayOf(line.x1, line.y1, line.x2, line.y2, line.white, line.a, line.w)
                for (f in got.indices) {
                    val want = lines.getDouble(l * 7 + f)
                    values++
                    if (abs(got[f] - want) > tolerance) failures += "$key line $l field $f ${got[f]} != $want"
                }
            }
        }
        assertTrue(failures.take(40).joinToString("\n"), failures.isEmpty())
        assertEquals(72, cases.length())
        println("golden: ${cases.length()} cases, $values values within $tolerance")
    }
}
