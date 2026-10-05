package systems.reagent.apparatus.wear.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTimestamp
import android.media.AudioTrack
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * Streaming playback of 24 kHz mono PCM16 on the call path (USAGE_VOICE_COMMUNICATION).
 *
 * [write] queues a chunk; a writer thread feeds the track. [stop] pauses and flushes at once
 * and drops every queued chunk, so a barge-in is silent within one write call, well inside
 * `gate.bargein_stop_ms`. [isSpeaking] mirrors the web Playback: chunks are scheduled back to
 * back on a clock, and the model speaks until the last one has played. It also holds while the
 * track has frames it has not yet presented at the output (its timestamp, which counts the
 * buffer and the HAL latency), so the gate keeps the barge-in bar until the agent's last audio
 * has left the speaker.
 */
class AudioOut(private val sampleRate: Int = SAMPLE_RATE) {
    private val queue = LinkedBlockingQueue<ByteArray>()
    @Volatile private var track: AudioTrack? = null
    private var thread: Thread? = null

    @Volatile private var running = false
    @Volatile private var generation = 0

    /** System.nanoTime when the last scheduled chunk ends; 0 when nothing is scheduled. */
    @Volatile private var endsAtNanos = 0L

    /** Frames the track accepted since it was created or last flushed. Guarded by `this`. */
    private var framesWritten = 0L
    private val timestamp = AudioTimestamp()

    @Synchronized
    fun write(pcm: ByteArray) {
        if (pcm.size < 2) return
        ensureStarted()
        val t = track ?: return
        if (t.playState != AudioTrack.PLAYSTATE_PLAYING) t.play()
        val now = System.nanoTime()
        val start = max(endsAtNanos, now + LEAD_NANOS)
        endsAtNanos = start + (pcm.size / 2) * 1_000_000_000L / sampleRate
        queue.offer(pcm)
    }

    /** True while audio is scheduled or still sounding. Safe from any thread. */
    fun isSpeaking(): Boolean {
        val end = endsAtNanos
        if (end == 0L) return false
        val now = System.nanoTime()
        if (now < end) return true
        // A track that has not presented its frames this long after the wall-clock end is
        // stalled, not speaking.
        if (now - end > STALL_NANOS) return false
        return unpresented()
    }

    @Synchronized
    private fun unpresented(): Boolean {
        val t = track ?: return false
        if (framesWritten == 0L) return false
        return try {
            // The frame at the output now; before the first timestamp, the mixer's read position.
            val presented = if (t.getTimestamp(timestamp)) timestamp.framePosition else t.playbackHeadPosition.toLong() and 0xFFFFFFFFL
            presented < framesWritten
        } catch (e: IllegalStateException) {
            false
        }
    }

    /** Silence now. Queued and in-flight chunks are dropped. */
    @Synchronized
    fun stop() {
        generation++
        endsAtNanos = 0L
        framesWritten = 0L
        queue.clear()
        val t = track ?: return
        if (t.playState == AudioTrack.PLAYSTATE_PLAYING) {
            t.pause()
            t.flush()
        }
    }

    /** Stops and releases the track. The next [write] creates a new one. */
    @Synchronized
    fun release() {
        running = false
        generation++
        endsAtNanos = 0L
        framesWritten = 0L
        queue.clear()
        thread?.interrupt()
        thread = null
        track?.let { t ->
            try {
                t.pause()
                t.flush()
                t.stop()
            } catch (e: IllegalStateException) {
                // Uninitialized track.
            }
            t.release()
        }
        track = null
    }

    private fun ensureStarted() {
        if (track != null) return
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, CHANNEL, ENCODING)
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(CHANNEL)
                    .setEncoding(ENCODING)
                    .build(),
            )
            .setBufferSizeInBytes(max(minBuffer, sampleRate * 2 * BUFFER_MS / 1000))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        if (t.state != AudioTrack.STATE_INITIALIZED) {
            t.release()
            return
        }
        track = t
        running = true
        thread = thread(name = "audio-out") { loop(t) }
    }

    private fun loop(t: AudioTrack) {
        while (running) {
            val chunk = try {
                queue.poll(POLL_MS, TimeUnit.MILLISECONDS)
            } catch (e: InterruptedException) {
                return
            } ?: continue
            val gen = generation
            var offset = 0
            while (offset < chunk.size && running && gen == generation) {
                // Blocking write. It returns early when stop() pauses the track.
                val n = t.write(chunk, offset, chunk.size - offset)
                if (n <= 0) break
                offset += n
                synchronized(this) { if (gen == generation) framesWritten += n / 2 }
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 24000
        private const val CHANNEL = AudioFormat.CHANNEL_OUT_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        private const val BUFFER_MS = 200
        private const val POLL_MS = 100L

        // The web schedules a chunk at least 20 ms ahead of the audio clock.
        private const val LEAD_NANOS = 20_000_000L

        // Far above the track buffer (BUFFER_MS) plus any HAL output latency.
        private const val STALL_NANOS = 1_000_000_000L
    }
}
