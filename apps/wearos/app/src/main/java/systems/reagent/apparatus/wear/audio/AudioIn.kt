package systems.reagent.apparatus.wear.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * Microphone capture for a call: 16 kHz mono PCM16, 20 ms frames, open for the whole call.
 *
 * Source VOICE_COMMUNICATION is the platform's call path, with its echo reference on the
 * call output (gate steps 1 and 2: the speaker plays while the microphone is open). The echo
 * canceller and the noise suppressor are attached when the watch offers them. [onFrame] runs
 * on the capture thread.
 */
class AudioIn(private val onFrame: (frame: ShortArray) -> Unit) {

    private var record: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var thread: Thread? = null

    @Volatile var running = false
        private set

    /** Starts capture. False when the microphone is not available (no permission, in use). */
    @SuppressLint("MissingPermission") // The caller checks RECORD_AUDIO.
    fun start(): Boolean {
        if (running) return true
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
        if (minBuffer <= 0) return false
        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                CHANNEL,
                ENCODING,
                max(minBuffer, FRAME_SAMPLES * 2 * 10),
            )
        } catch (e: IllegalArgumentException) {
            return false
        } catch (e: SecurityException) {
            return false
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            return false
        }
        if (AcousticEchoCanceler.isAvailable()) {
            echo = AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true }
        }
        if (NoiseSuppressor.isAvailable()) {
            noise = NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true }
        }
        try {
            rec.startRecording()
        } catch (e: IllegalStateException) {
            release(rec)
            return false
        }
        if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            release(rec)
            return false
        }
        record = rec
        running = true
        thread = thread(name = "audio-in", priority = Thread.MAX_PRIORITY) { loop(rec) }
        return true
    }

    /** Stops capture and releases the microphone. The capture thread has exited when this returns. */
    fun stop() {
        val rec = record ?: return
        running = false
        // stop() unblocks a pending read() so the thread can exit.
        try {
            rec.stop()
        } catch (e: IllegalStateException) {
            // Already stopped.
        }
        thread?.join(JOIN_MS)
        thread = null
        release(rec)
        record = null
    }

    private fun loop(rec: AudioRecord) {
        while (running) {
            // A fresh array per frame: the gate buffers frames by reference.
            val frame = ShortArray(FRAME_SAMPLES)
            var offset = 0
            while (offset < FRAME_SAMPLES && running) {
                val n = rec.read(frame, offset, FRAME_SAMPLES - offset)
                if (n <= 0) {
                    running = false
                    break
                }
                offset += n
            }
            if (offset == FRAME_SAMPLES) onFrame(frame)
        }
    }

    private fun release(rec: AudioRecord) {
        echo?.release()
        echo = null
        noise?.release()
        noise = null
        rec.release()
    }

    companion object {
        const val SAMPLE_RATE = 16000
        const val FRAME_MS = 20
        const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1000
        private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        private const val JOIN_MS = 500L
    }
}
