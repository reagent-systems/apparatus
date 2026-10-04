package systems.reagent.apparatus.wear.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Microphone capture: 16 kHz mono PCM16, 20 ms frames.
 *
 * Source VOICE_COMMUNICATION gives the platform echo path. The echo canceller and the noise
 * suppressor are attached when the device offers them. [onFrame] runs on the capture thread
 * with the frame bytes and the RMS level (0..1).
 */
class AudioIn(private val onFrame: (pcm: ByteArray, level: Float) -> Unit) {

    private var record: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var thread: Thread? = null

    @Volatile private var running = false

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
                max(minBuffer, FRAME_BYTES * 10),
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
        val frame = ByteArray(FRAME_BYTES)
        while (running) {
            var offset = 0
            while (offset < FRAME_BYTES && running) {
                val n = rec.read(frame, offset, FRAME_BYTES - offset)
                if (n <= 0) {
                    running = false
                    break
                }
                offset += n
            }
            if (offset == FRAME_BYTES) onFrame(frame.copyOf(), rms(frame))
        }
    }

    private fun release(rec: AudioRecord) {
        echo?.release()
        echo = null
        noise?.release()
        noise = null
        rec.release()
    }

    private fun rms(frame: ByteArray): Float {
        var sum = 0.0
        var i = 0
        while (i + 1 < frame.size) {
            val sample = ((frame[i].toInt() and 0xff) or (frame[i + 1].toInt() shl 8)).toShort().toDouble() / 32768.0
            sum += sample * sample
            i += 2
        }
        return sqrt(sum / (frame.size / 2)).toFloat()
    }

    companion object {
        const val SAMPLE_RATE = 16000
        const val FRAME_MS = 20
        const val FRAME_BYTES = SAMPLE_RATE * FRAME_MS / 1000 * 2
        private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        private const val JOIN_MS = 500L
    }
}
