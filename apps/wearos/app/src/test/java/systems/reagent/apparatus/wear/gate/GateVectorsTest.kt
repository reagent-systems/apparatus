package systems.reagent.apparatus.wear.gate

import java.io.File
import java.util.IdentityHashMap
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Replays packages/gate-vectors/gate-vectors.json, written by the web gate (`npm run gate-vectors
 * -w apps/web`), through the Kotlin gate and asserts the identical event list per scenario.
 * Gradle passes the file's path; it is read in place so the three ports share one copy.
 */
class GateVectorsTest {

    private val vectors: JSONObject by lazy {
        val path = checkNotNull(System.getProperty("apparatus.gateVectors")) {
            "system property apparatus.gateVectors is not set; run the tests through Gradle"
        }
        JSONObject(File(path).readText())
    }

    @Test
    fun everyScenarioEmitsTheWebGateEvents() {
        val scenarios = vectors.getJSONArray("scenarios")
        val failures = ArrayList<String>()
        for (i in 0 until scenarios.length()) {
            val scenario = scenarios.getJSONObject(i)
            val name = scenario.getString("name")
            val run = replay(scenario)
            val expected = normalize(scenario.getJSONArray("events"))
            if (run.events != expected) {
                failures += "$name\n  expected $expected\n  actual   ${run.events}"
                continue
            }
            val counts = scenario.getJSONObject("counts")
            for (key in counts.keys()) {
                if (run.counts[key] != counts.getInt(key)) failures += "$name count $key ${run.counts[key]} != ${counts.getInt(key)}"
            }
            if (run.endState != scenario.getString("end_state")) failures += "$name end state ${run.endState}"
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
        println("gate vectors: ${scenarios.length()} scenarios match the web gate")
    }

    @Test
    fun defaultConfigEqualsTheServerTable() {
        // Scenarios without overrides carry the [gate] table of config/apparatus.toml verbatim.
        val scenario = scenarioNamed("one_utterance")
        assertEquals(GateConfig.merge(scenario.getJSONObject("config")), GateConfig.DEFAULT)
    }

    @Test
    fun mergeKeepsDefaultsForMissingOrMistypedFields() {
        val merged = GateConfig.merge(JSONObject().put("min_speech_ms", 100).put("vad_hangover_ms", "fast").put("speaker_check", 1))
        assertEquals(100.0, merged.minSpeechMs, 0.0)
        assertEquals(GateConfig.DEFAULT.vadHangoverMs, merged.vadHangoverMs, 0.0)
        assertEquals(false, merged.speakerCheck)
        assertEquals(GateConfig.DEFAULT, GateConfig.merge(null))
    }

    @Test
    fun decisionLogHoldsReasonsAndNoAudio() {
        val gate = Gate(GateConfig.DEFAULT) {}
        val loud = frame(6553)
        repeat(20) { gate.pushFrame(loud) }
        repeat(30) { gate.pushFrame(frame(0)) }
        val log = gate.log().map { it.decision to it.reason }
        assertEquals(listOf("speech_start" to "voice_ms=300", "speech_end" to "complete"), log)
    }

    // ---- replay -------------------------------------------------------------------------

    private class Run(val events: List<Map<String, Any>>, val counts: Map<String, Int>, val endState: String)

    private fun replay(scenario: JSONObject): Run {
        val input = scenario.getJSONObject("input")
        val frames = buildFrames(input)
        val speaking = input.getJSONArray("model_speaking").let { a ->
            List(a.length()) { a.getJSONObject(it).getDouble("from_ms") to a.getJSONObject(it).getDouble("to_ms") }
        }
        val steps = input.getJSONArray("steps")
        val index = IdentityHashMap<ShortArray, Int>()
        frames.forEachIndexed { i, f -> index[f] = i }

        val events = ArrayList<MutableMap<String, Any>>()
        val counts = linkedMapOf("speechStart" to 0, "audio_frames" to 0, "speechEnd" to 0, "bargeIn" to 0, "drop" to 0)
        var pushed = 0
        var current = 0
        val gate = Gate(
            config = GateConfig.merge(scenario.getJSONObject("config")),
            isModelSpeaking = { speaking.any { (from, to) -> from <= current * 20.0 && current * 20.0 < to } },
        ) { e ->
            fun base(kind: String): MutableMap<String, Any> =
                linkedMapOf("at" to pushed.toDouble(), "t_ms" to pushed * 20.0, "kind" to kind)
            when (e) {
                GateEvent.SpeechStart -> {
                    counts.merge("speechStart", 1, Int::plus)
                    events += base("speechStart").apply { put("forced", false) }
                }
                is GateEvent.Audio -> {
                    counts.merge("audio_frames", 1, Int::plus)
                    val i = checkNotNull(index[e.frame]) { "audio event with a frame the replay did not push" }
                    val last = events.lastOrNull()
                    if (last != null && last["kind"] == "audio" &&
                        (last["first_frame"] as Double) + (last["frames"] as Double) == i.toDouble()
                    ) {
                        last["frames"] = (last["frames"] as Double) + 1
                    } else {
                        events += base("audio").apply {
                            put("first_frame", i.toDouble())
                            put("frames", 1.0)
                        }
                    }
                }
                is GateEvent.SpeechEnd -> {
                    counts.merge("speechEnd", 1, Int::plus)
                    events += base("speechEnd").apply { put("reason", e.reason.wire) }
                }
                is GateEvent.BargeIn -> {
                    counts.merge("bargeIn", 1, Int::plus)
                    events += base("bargeIn").apply {
                        put("voice_ms", e.voiceMs)
                        put("words", e.words.toDouble())
                    }
                }
                is GateEvent.Drop -> {
                    counts.merge("drop", 1, Int::plus)
                    events += base("drop").apply {
                        put("reason", e.reason.wire)
                        put("voice_ms", e.voiceMs)
                    }
                }
            }
        }

        fun applySteps(before: Int) {
            for (s in 0 until steps.length()) {
                val step = steps.getJSONObject(s)
                if (step.getInt("before_frame") != before) continue
                when (val op = step.getString("op")) {
                    "transcript" -> gate.setTranscript(step.getString("text"))
                    "stop" -> gate.stopAll()
                    else -> error("unknown step op $op")
                }
            }
        }

        for (i in frames.indices) {
            applySteps(i)
            current = i
            pushed = i + 1
            gate.pushFrame(frames[i])
            assertEquals(pushed * 20.0, gate.now, 1e-9)
        }
        applySteps(frames.size)
        return Run(events, counts, gate.state.wire)
    }

    /** The file's frame formula: ms / 20 frames per segment, a square wave of half period 40 at +-q. */
    private fun buildFrames(input: JSONObject): List<ShortArray> {
        val segments = input.getJSONArray("segments")
        val frames = ArrayList<ShortArray>()
        for (s in 0 until segments.length()) {
            val segment = segments.getJSONObject(s)
            val q = segment.getInt("q")
            repeat(segment.getInt("ms") / 20) { frames += frame(q) }
        }
        assertEquals(input.getInt("frames"), frames.size)
        return frames
    }

    private fun frame(q: Int): ShortArray = ShortArray(320) { k -> (if (k % 80 < 40) q else -q).toShort() }

    /** JSON events to maps with every number as a Double, the shape [replay] records. */
    private fun normalize(array: JSONArray): List<Map<String, Any>> = List(array.length()) { i ->
        val o = array.getJSONObject(i)
        val out = LinkedHashMap<String, Any>()
        for (key in o.keys()) {
            val v = o.get(key)
            out[key] = if (v is Number) v.toDouble() else v
        }
        out
    }

    private fun scenarioNamed(name: String): JSONObject {
        val scenarios = vectors.getJSONArray("scenarios")
        for (i in 0 until scenarios.length()) {
            if (scenarios.getJSONObject(i).getString("name") == name) return scenarios.getJSONObject(i)
        }
        error("no scenario $name")
    }
}
