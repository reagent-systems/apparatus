package systems.reagent.apparatus.wear.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * Streaming playback of 24 kHz mono PCM16.
 *
 * [write] queues a chunk; a writer thread feeds the track. [stop] pauses and flushes at once
 * and drops every queued chunk, so a barge-in is silent within one write call. [onDrained]
 * fires once after [endOfTurn] when the queue has run dry.
 */
class AudioOut(
    private val sampleRate: Int = SAMPLE_RATE,
    private val onDrained: () -> Unit,
) {
    private val queue = LinkedBlockingQueue<ByteArray>()
    private var track: AudioTrack? = null
    private var thread: Thread? = null

    @Volatile private var running = false
    @Volatile private var generation = 0
    @Volatile private var endPending = false

    @Synchronized
    fun write(pcm: ByteArray) {
        ensureStarted()
        val t = track ?: return
        if (t.playState != AudioTrack.PLAYSTATE_PLAYING) t.play()
        queue.offer(pcm)
    }

    /** The model turn is over: report [onDrained] when the queued audio has been written. */
    fun endOfTurn() {
        endPending = true
    }

    /** Silence now. Queued and in-flight chunks are dropped. */
    @Synchronized
    fun stop() {
        generation++
        endPending = false
        queue.clear()
        val t = track ?: return
        if (t.playState == AudioTrack.PLAYSTATE_PLAYING) {
            t.pause()
            t.flush()
        }
    }

    @Synchronized
    fun release() {
        running = false
        generation++
        endPending = false
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
            }
            if (chunk == null) {
                if (endPending && queue.isEmpty()) {
                    endPending = false
                    onDrained()
                }
                continue
            }
            val gen = generation
            var offset = 0
            while (offset < chunk.size && running && gen == generation) {
                // Blocking write. It returns early when stop() pauses the track.
                val n = t.write(chunk, offset, chunk.size - offset)
                if (n <= 0) break
                offset += n
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 24000
        private const val CHANNEL = AudioFormat.CHANNEL_OUT_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        private const val BUFFER_MS = 200
        private const val POLL_MS = 100L
    }
}
