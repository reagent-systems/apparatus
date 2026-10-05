// Port of web/src/gate/gate.ts, open-microphone path. The voice gate decides what audio
// leaves the watch and when a turn ends.
//
// Order per frame: VAD -> minimum duration -> barge-in bar (while the model speaks) -> speaker
// check -> turn detector. Echo cancellation and noise suppression run before this, in the
// capture path (AudioIn). Parity with the web is proven by clients/shared/gate-vectors.json
// (GateVectorsTest), not by reading.
//
// Not thread-safe: the caller serialises every call. Events fire synchronously on the
// calling thread.

package systems.reagent.apparatus.wear.gate

/** Off unless `gate.speaker_check` is true. The watch ships no embedder, so it never checks. */
interface SpeakerCheck {
    val enabled: Boolean

    /** [samples] is the buffered start of a speech segment, PCM16 at 16 kHz. */
    fun matches(samples: ShortArray): Boolean
}

object NoSpeakerCheck : SpeakerCheck {
    override val enabled = false

    override fun matches(samples: ShortArray) = true
}

enum class SpeechEndReason(val wire: String) {
    Complete("complete"),
    Incomplete("incomplete"),
    ManualStop("manual_stop"),
    MaxDuration("max_duration"),
}

enum class DropReason(val wire: String) {
    TooShort("too_short"),
    BargeinRejected("bargein_rejected"),
    SpeakerMismatch("speaker_mismatch"),
    ManualStop("manual_stop"),
}

sealed interface GateEvent {
    data object SpeechStart : GateEvent

    /** One frame of the open turn, the same array the capture handed in. */
    class Audio(val frame: ShortArray) : GateEvent

    data class SpeechEnd(val reason: SpeechEndReason) : GateEvent

    data class BargeIn(val voiceMs: Double, val words: Int) : GateEvent

    data class Drop(val reason: DropReason, val voiceMs: Double) : GateEvent
}

enum class GateState(val wire: String) {
    Idle("idle"),
    Pending("pending"),
    Speaking("speaking"),
    Rejected("rejected"),
}

class GateLogEntry(val t: Long, val decision: String, val reason: String)

class Gate(
    val config: GateConfig,
    private val sampleRate: Int = 16000,
    /** Polled every frame. True while playback has audio scheduled. */
    private val isModelSpeaking: () -> Boolean = { false },
    private val speaker: SpeakerCheck = NoSpeakerCheck,
    /** A barge-in candidate that never clears the bar is dropped after this. */
    private val maxPendingMs: Double = 3000.0,
    /** Safety stop for a turn that never goes silent. */
    private val maxTurnMs: Double = 120_000.0,
    private val logCapacity: Int = 200,
    private val listener: (GateEvent) -> Unit,
) {
    private val vad = EnergyVad(config.vadEnergyThreshold, config.vadHangoverMs, sampleRate)
    private val turn = TurnDetector(config.silenceCompleteMs, config.silenceIncompleteMs)
    private val bargein = BargeInRule(config.bargeinMinVoiceMs, config.bargeinMinWords)
    private val words = EnergyBurstWordEstimator()
    private val transcriptWords = TranscriptWordCounter()

    var state: GateState = GateState.Idle
        private set
    private var buffer = ArrayList<ShortArray>()
    private var voiceMs = 0.0
    private var pendingMs = 0.0
    private var turnMs = 0.0
    private var clock = 0.0

    private val entries = arrayOfNulls<GateLogEntry>(logCapacity)
    private var logHead = 0
    private var logSize = 0

    /** True between speechStart and speechEnd. */
    val open: Boolean get() = state == GateState.Speaking

    /** Time in ms, derived from frames processed. */
    val now: Double get() = clock

    /** Latest interim transcript of the open turn, from Live inputTranscription. */
    fun setTranscript(text: String) {
        turn.setTranscript(text)
        transcriptWords.setText(text)
    }

    /** The decision log, oldest first. Never holds audio. */
    fun log(): List<GateLogEntry> = List(logSize) { i ->
        entries[(logHead - logSize + i + logCapacity) % logCapacity]!!
    }

    /** Hang-up. Ends any open turn and clears any candidate. */
    fun stopAll() {
        when (state) {
            GateState.Speaking -> endTurn(SpeechEndReason.ManualStop)
            GateState.Pending -> drop(DropReason.ManualStop)
            else -> Unit
        }
        record("manual_stop", "")
        reset()
    }

    /** One 20 ms frame of microphone audio, 16 kHz mono. */
    fun pushFrame(frame: ShortArray) {
        val frameMs = (frame.size.toDouble() / sampleRate) * 1000
        clock += frameMs
        val v = vad.process(frame)

        if (state == GateState.Speaking) {
            listener(GateEvent.Audio(frame))
            turnMs += frameMs
            // Silence counts from the last raw voiced frame, not from the end of the hangover,
            // so the limits in the config mean what they say.
            val end = turn.update(v.raw, frameMs)
            if (end != null) {
                endTurn(if (end == TurnEnd.Complete) SpeechEndReason.Complete else SpeechEndReason.Incomplete)
            } else if (turnMs >= maxTurnMs) {
                endTurn(SpeechEndReason.MaxDuration)
            }
            return
        }

        if (state == GateState.Rejected) {
            if (!v.active) reset()
            return
        }

        if (state == GateState.Idle) {
            if (!v.raw) return
            state = GateState.Pending
            buffer = ArrayList()
            voiceMs = 0.0
            pendingMs = 0.0
            words.reset()
            transcriptWords.reset()
        }

        // pending: a candidate segment, buffered on the watch
        buffer.add(frame)
        pendingMs += frameMs
        if (v.raw) voiceMs += frameMs
        words.push(v.raw, frameMs)

        if (!v.active) {
            drop(if (voiceMs < config.minSpeechMs) DropReason.TooShort else DropReason.BargeinRejected)
            reset()
            return
        }
        if (voiceMs < config.minSpeechMs) return

        if (isModelSpeaking()) {
            val count = maxOf(words.count(), transcriptWords.count())
            if (!bargein.allows(voiceMs, count)) {
                if (pendingMs >= maxPendingMs) {
                    drop(DropReason.BargeinRejected)
                    state = GateState.Rejected
                    buffer = ArrayList()
                }
                return
            }
            record("barge_in", "voice_ms=${Math.round(voiceMs)} words=$count")
            listener(GateEvent.BargeIn(voiceMs, count))
        }

        if (speaker.enabled && !speaker.matches(concat(buffer))) {
            drop(DropReason.SpeakerMismatch)
            state = GateState.Rejected
            buffer = ArrayList()
            return
        }

        confirm()
    }

    private fun confirm() {
        val buffered = buffer
        buffer = ArrayList()
        state = GateState.Speaking
        turnMs = 0.0
        turn.start()
        transcriptWords.reset()
        record("speech_start", "voice_ms=${Math.round(voiceMs)}")
        listener(GateEvent.SpeechStart)
        for (f in buffered) listener(GateEvent.Audio(f))
    }

    private fun endTurn(reason: SpeechEndReason) {
        record("speech_end", reason.wire)
        listener(GateEvent.SpeechEnd(reason))
        reset()
    }

    private fun drop(reason: DropReason) {
        record("drop", "${reason.wire} voice_ms=${Math.round(voiceMs)}")
        listener(GateEvent.Drop(reason, voiceMs))
    }

    private fun reset() {
        state = GateState.Idle
        buffer = ArrayList()
        voiceMs = 0.0
        pendingMs = 0.0
        turnMs = 0.0
        words.reset()
    }

    private fun record(decision: String, reason: String) {
        entries[logHead] = GateLogEntry(Math.round(clock), decision, reason)
        logHead = (logHead + 1) % logCapacity
        if (logSize < logCapacity) logSize += 1
    }

    private fun concat(frames: List<ShortArray>): ShortArray {
        val out = ShortArray(frames.sumOf { it.size })
        var o = 0
        for (f in frames) {
            f.copyInto(out, o)
            o += f.size
        }
        return out
    }
}
