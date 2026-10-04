package systems.reagent.apparatus.wear

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONException
import org.json.JSONObject
import systems.reagent.apparatus.wear.audio.AudioIn
import systems.reagent.apparatus.wear.audio.AudioOut
import systems.reagent.apparatus.wear.net.LiveEvent
import systems.reagent.apparatus.wear.net.LiveSession
import systems.reagent.apparatus.wear.net.Messages
import systems.reagent.apparatus.wear.net.S2C
import systems.reagent.apparatus.wear.net.ServerSocket
import systems.reagent.apparatus.wear.net.TokenClient
import systems.reagent.apparatus.wear.net.str
import systems.reagent.apparatus.wear.push.Notifier
import systems.reagent.apparatus.wear.secure.SecureStore

enum class OrbState { Idle, Listening, Speaking, Working }

enum class Speaker { User, Agent }

class FeedLine(val id: Long, val speaker: Speaker, val text: String)

data class UiState(
    val orb: OrbState = OrbState.Idle,
    /** Spoken lines, oldest first. */
    val feed: List<FeedLine> = emptyList(),
    /** The line being spoken or transcribed now. */
    val partial: FeedLine? = null,
    /** Microphone level 0..1 while listening. */
    val level: Float = 0f,
    /** True when the Live session accepts audio. */
    val live: Boolean = false,
)

/**
 * The watch session: one socket to the session server, one Live session while this device
 * holds the voice, push to talk. All state changes run on the main thread; audio frames and
 * socket callbacks are posted there, except microphone frames, which go to the Live socket
 * from the capture thread.
 */
class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val app: Context get() = getApplication<Application>()

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val store = SecureStore.of(application)
    private val tokens = TokenClient(http, BuildConfig.SERVER_ORIGIN)
    private val server = ServerSocket(http, BuildConfig.SERVER_ORIGIN, { auth() }, object : ServerSocket.Listener {
        override fun onOpen() = onMain {
            server.send(Messages.hello())
            server.send(Messages.voiceClaim())
        }

        override fun onMessage(message: JSONObject) = onMain { handleServer(message) }

        override fun onClosed() = onMain { SessionHub.socket = null }
    })

    private val audioIn = AudioIn { frame, level -> onFrame(frame, level) }
    private val audioOut = AudioOut {
        onMain {
            playing = false
            recompute()
        }
    }

    @Volatile private var live: LiveSession? = null
    private var liveReady = false
    private var liveOpening = false
    private var liveRetries = 0
    private var holdsVoice = false
    private var serviceRunning = false
    private var pushRequested = false

    @Volatile private var talking = false
    private var playing = false
    /** True from the first model output of a turn until `turnComplete` or `interrupted`. */
    private var turnOpen = false
    /** Drop model audio for the rest of the current turn (after Stop or a barge-in). */
    private var discardAudio = false
    private val jobs = HashSet<String>()

    private var resumptionHandle: String? = null
    private val audioInMs = AtomicLong(0)
    private var audioOutMs = 0L

    private val userText = StringBuilder()
    private val agentText = StringBuilder()
    private var nextLineId = 1L

    fun connect() = server.connect()

    /** Talk is pressed: open the activity and stream the microphone. */
    fun pressTalk() {
        if (talking) return
        val session = live ?: return
        if (!liveReady) return
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
        // Barge-in, manual path: silence now. The server answers the new activity with `interrupted`.
        if (playing) {
            audioOut.stop()
            playing = false
            if (turnOpen) discardAudio = true
        }
        session.activityStart()
        if (!audioIn.start()) {
            session.activityEnd()
            return
        }
        talking = true
        if (!serviceRunning) {
            VoiceService.start(app)
            serviceRunning = true
        }
        recompute()
    }

    /** Talk is released: close the activity. The model answers. */
    fun releaseTalk() {
        if (!talking) return
        talking = false
        audioIn.stop()
        live?.activityEnd()
        _ui.update { it.copy(level = 0f) }
        recompute()
    }

    /** Stop always works: silence, and drop the rest of the current turn. Jobs keep running. */
    fun stop() {
        if (talking) releaseTalk()
        audioOut.stop()
        playing = false
        if (turnOpen) discardAudio = true
        recompute()
    }

    override fun onCleared() {
        talking = false
        audioIn.stop()
        audioOut.release()
        live?.close("app closed")
        live = null
        server.close()
        SessionHub.socket = null
        stopService()
    }

    // ---- server socket -----------------------------------------------------

    private fun handleServer(m: JSONObject) {
        when (m.str("type")) {
            S2C.READY -> {
                SessionHub.socket = server
                SessionHub.flushPending(app, server)
                registerPush()
            }
            S2C.VOICE_GRANTED -> {
                holdsVoice = true
                openLive()
            }
            S2C.VOICE_REVOKED -> {
                holdsVoice = false
                tearDownLive("revoked")
            }
            S2C.TRANSCRIPT -> if (!holdsVoice) {
                m.str("text")?.let { addLine(if (m.str("role") == "user") Speaker.User else Speaker.Agent, it) }
            }
            S2C.JOB_STARTED -> {
                m.str("job_id")?.let(jobs::add)
                recompute()
            }
            S2C.JOB_DONE -> {
                m.str("job_id")?.let(jobs::remove)
                // The voice holder hears `say` and sees it in the output transcription.
                if (!holdsVoice) m.str("say")?.let { addLine(Speaker.Agent, it) }
                recompute()
            }
            S2C.HANDOFF_REQUESTED -> Notifier.handoff(app, m.str("reason"))
            S2C.HANDOFF_ENDED -> Notifier.cancelHandoff(app)
            S2C.APPROVAL_REQUESTED -> m.str("approval_id")?.let {
                Notifier.approval(app, it, m.str("action").orEmpty(), m.str("details").orEmpty())
            }
            S2C.APPROVAL_ENDED -> m.str("approval_id")?.let { Notifier.cancelApproval(app, it) }
            S2C.TOOL_RESULT -> live?.sendToolResponse(
                m.str("call_id").orEmpty(),
                m.str("name").orEmpty(),
                m.optJSONObject("response") ?: JSONObject(),
                m.str("scheduling") ?: "WHEN_IDLE",
            )
            S2C.ERROR -> Log.w(TAG, "server error ${m.str("code")}: ${m.str("message")}")
        }
        // Any S2C message may carry `voice`. The voice holder speaks it as an event turn.
        val voice = m.str("voice")
        if (!voice.isNullOrBlank() && holdsVoice && liveReady) live?.sendEventTurn(voice)
    }

    private fun registerPush() {
        SessionHub.pushToken?.let {
            server.send(Messages.pushRegister(it))
            return
        }
        if (pushRequested) return
        pushRequested = true
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token -> if (!token.isNullOrEmpty()) SessionHub.onPushToken(token) }
                .addOnFailureListener { e -> Log.w(TAG, "fcm token: ${e.message}") }
        } catch (e: IllegalStateException) {
            // No google-services.json: Firebase is not initialized. The app runs without push.
            Log.i(TAG, "push off: ${e.message}")
        }
    }

    // ---- live session ------------------------------------------------------

    private fun openLive() {
        if (live != null || liveOpening || !holdsVoice) return
        liveOpening = true
        viewModelScope.launch {
            val token = try {
                tokens.fetch(auth())
            } catch (e: IOException) {
                tokenFailed(e)
                return@launch
            } catch (e: JSONException) {
                tokenFailed(e)
                return@launch
            }
            liveOpening = false
            if (!holdsVoice || live != null) return@launch
            // The setup goes verbatim, except for the resumption handle, which continues the
            // conversation after a goAway or a reconnect. The newest handle wins.
            val setup = token.setup
            val handle = resumptionHandle ?: token.resumptionHandle
            if (handle != null) {
                val resumption = setup.optJSONObject("sessionResumption")
                    ?: JSONObject().also { setup.put("sessionResumption", it) }
                resumption.put("handle", handle)
            }
            lateinit var session: LiveSession
            session = LiveSession(http, token.token, setup) { event -> onMain { onLive(session, event) } }
            live = session
            session.open()
        }
    }

    private fun tokenFailed(e: Exception) {
        Log.w(TAG, "token: ${e.message}")
        liveOpening = false
        retryLive()
    }

    private fun retryLive() {
        if (!holdsVoice) return
        val wait = min(MAX_LIVE_RETRY_MS, LIVE_RETRY_MS shl min(liveRetries, 4))
        liveRetries++
        viewModelScope.launch {
            delay(wait)
            openLive()
        }
    }

    private fun onLive(session: LiveSession, event: LiveEvent) {
        if (session !== live) return // A retired session.
        when (event) {
            is LiveEvent.SetupComplete -> {
                liveReady = true
                liveRetries = 0
                _ui.update { it.copy(live = true) }
            }
            is LiveEvent.Audio -> {
                turnOpen = true
                if (discardAudio) return
                audioOut.write(event.pcm)
                audioOutMs += event.pcm.size * 1000L / (2 * event.sampleRate)
                if (!playing) {
                    playing = true
                    recompute()
                }
            }
            is LiveEvent.Interrupted -> {
                audioOut.stop()
                playing = false
                turnOpen = false
                discardAudio = false
                commitAgent()
                recompute()
            }
            is LiveEvent.TurnComplete -> {
                turnOpen = false
                discardAudio = false
                audioOut.endOfTurn()
                commitUser()
                commitAgent()
            }
            is LiveEvent.InputTranscription -> {
                userText.append(event.text)
                showPartial(Speaker.User, userText)
                server.send(Messages.transcript("user", event.text, event.finished))
                if (event.finished) commitUser()
            }
            is LiveEvent.OutputTranscription -> {
                turnOpen = true
                if (userText.isNotEmpty()) commitUser()
                agentText.append(event.text)
                showPartial(Speaker.Agent, agentText)
                server.send(Messages.transcript("agent", event.text, event.finished))
            }
            is LiveEvent.ToolCall -> for (call in event.calls) {
                server.send(Messages.toolCall(call.id, call.name, call.args))
            }
            is LiveEvent.Usage -> {
                server.send(Messages.liveUsage(audioInMs.getAndSet(0), audioOutMs, event.promptTokens, event.responseTokens))
                audioOutMs = 0
            }
            is LiveEvent.Resumption -> event.newHandle?.let {
                resumptionHandle = it
                server.send(Messages.liveResumption(it))
            }
            is LiveEvent.GoAway -> rotateLive()
            is LiveEvent.Closed -> {
                tearDownLive(event.reason)
                retryLive()
            }
            is LiveEvent.Text, is LiveEvent.GenerationComplete, is LiveEvent.ToolCallCancellation -> Unit
        }
    }

    /** `goAway`: open a new session with the stored handle, then drop the old one. */
    private fun rotateLive() {
        val old = live
        live = null
        liveReady = false
        _ui.update { it.copy(live = false) }
        openLive()
        old?.close("goAway")
    }

    private fun tearDownLive(reason: String) {
        val old = live
        live = null
        liveReady = false
        liveOpening = false
        old?.close(reason)
        if (talking) releaseTalk()
        audioOut.stop()
        playing = false
        turnOpen = false
        discardAudio = false
        commitUser()
        commitAgent()
        _ui.update { it.copy(live = false) }
        server.send(Messages.liveClosed(reason))
        stopService()
        recompute()
    }

    private fun stopService() {
        if (!serviceRunning) return
        serviceRunning = false
        VoiceService.stop(app)
    }

    // ---- audio -------------------------------------------------------------

    /** Capture thread. */
    private fun onFrame(frame: ByteArray, level: Float) {
        if (!talking) return
        live?.sendAudio(frame)
        audioInMs.addAndGet(AudioIn.FRAME_MS.toLong())
        val shown = min(1f, level * LEVEL_GAIN)
        _ui.update { if (it.level == shown) it else it.copy(level = shown) }
    }

    // ---- feed and state ----------------------------------------------------

    private fun recompute() {
        val orb = when {
            talking -> OrbState.Listening
            playing -> OrbState.Speaking
            jobs.isNotEmpty() -> OrbState.Working
            else -> OrbState.Idle
        }
        _ui.update { if (it.orb == orb) it else it.copy(orb = orb) }
    }

    private fun addLine(speaker: Speaker, text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        val line = FeedLine(nextLineId++, speaker, trimmed)
        _ui.update { it.copy(feed = (it.feed + line).takeLast(MAX_LINES)) }
    }

    private fun showPartial(speaker: Speaker, text: StringBuilder) {
        val trimmed = text.toString().trim()
        _ui.update { it.copy(partial = if (trimmed.isEmpty()) null else FeedLine(PARTIAL_ID, speaker, trimmed)) }
    }

    private fun commitUser() = commit(Speaker.User, userText)

    private fun commitAgent() = commit(Speaker.Agent, agentText)

    private fun commit(speaker: Speaker, text: StringBuilder) {
        if (text.isEmpty()) return
        addLine(speaker, text.toString())
        text.setLength(0)
        _ui.update { if (it.partial?.speaker == speaker) it.copy(partial = null) else it }
    }

    private fun auth(): String = store.get(SecureStore.KEY_AUTH, SecureStore.DEFAULT_AUTH)

    private fun onMain(block: () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val TAG = "AppViewModel"
        const val MAX_LINES = 12
        const val PARTIAL_ID = 0L
        const val LEVEL_GAIN = 4f
        const val LIVE_RETRY_MS = 2_000L
        const val MAX_LIVE_RETRY_MS = 30_000L
    }
}
