package systems.reagent.apparatus.wear.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager

/**
 * The audio session of a call: voice-call focus and MODE_IN_COMMUNICATION, so the platform
 * runs its call processing (echo cancellation against the call output) while the speaker
 * plays and the microphone is open. [onLost] runs on the main thread when another app takes
 * the audio for good (a phone call, an alarm that does not give it back).
 */
class CallAudio(context: Context, private val onLost: () -> Unit) {

    private val manager: AudioManager = context.getSystemService(AudioManager::class.java)
    private var request: AudioFocusRequest? = null

    /** False when the system refuses voice-call focus (for example during a phone call). */
    fun acquire(): Boolean {
        if (request != null) return true
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener { change -> if (change == AudioManager.AUDIOFOCUS_LOSS) onLost() }
            .build()
        if (manager.requestAudioFocus(req) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return false
        request = req
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        return true
    }

    fun release() {
        val req = request ?: return
        request = null
        manager.mode = AudioManager.MODE_NORMAL
        manager.abandonAudioFocusRequest(req)
    }
}
