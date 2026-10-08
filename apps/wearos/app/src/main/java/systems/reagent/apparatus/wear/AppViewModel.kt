package systems.reagent.apparatus.wear

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONException
import org.json.JSONObject
import systems.reagent.apparatus.wear.audio.AudioIn
import systems.reagent.apparatus.wear.audio.AudioOut
import systems.reagent.apparatus.wear.audio.CallAudio
import systems.reagent.apparatus.wear.audio.ReplyLatch
import systems.reagent.apparatus.wear.gate.Gate
import systems.reagent.apparatus.wear.gate.GateConfig
import systems.reagent.apparatus.wear.gate.GateEvent
import systems.reagent.apparatus.wear.net.INPUT_RATE
import systems.reagent.apparatus.wear.net.LiveEvent
import systems.reagent.apparatus.wear.net.LiveSession
import systems.reagent.apparatus.wear.net.Messages
import systems.reagent.apparatus.wear.net.OUTPUT_RATE
import systems.reagent.apparatus.wear.net.S2C
import systems.reagent.apparatus.wear.net.ServerSocket
import systems.reagent.apparatus.wear.net.TokenClient
import systems.reagent.apparatus.wear.net.str
import systems.reagent.apparatus.wear.net.withHandle
import systems.reagent.apparatus.wear.push.Notifier
import systems.reagent.apparatus.wear.secure.SecureStore
import systems.reagent.apparatus.wear.ui.OrbState

data class UiState(
    val state: OrbState = OrbState.Connecting,
    /** No other device holds the voice session. */
    val held: Boolean = true,
    /** A Live session is open. */
    val live: Boolean = false,
    /** A call is on. The value of the one toggle on the screen. */
    val inCall: Boolean = false,
)

/**
 * The watch session: one socket to the session server and, during a call, one Live session
 * with the microphone open (full duplex) behind the voice gate. A call is a phone call: tap to
 * start, tap to hang up. Port of apps/web/src/voice.ts with the call as the only voice control.
 *
 * Threads: state lives on the main thread. Microphone frames run through the gate on the
 * capture thread under [gateLock]; gate events send to the Live socket from that thread (the
 * socket is thread-safe) and post everything else to the main thread.
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
    private val server: ServerSocket = ServerSocket(http, BuildConfig.SERVER_ORIGIN, { auth() }, object : ServerSocket.Listener {
        // The watch claims the voice session when a call starts, not on connect.
        override fun onOpen() = onMain { server.send(Messages.hello(wantsVoice = false)) }

        override fun onMessage(message: JSONObject) = onMain { handleServer(message) }

        override fun onClosed() = onMain {
            connected = false
            SessionHub.socket = null
            publish()
        }
    })

    private val audioIn = AudioIn(::onFrame)
    private val audioOut = AudioOut()
    private val callAudio = CallAudio(application) { onMain { endCall("audio_focus_lost") } }
    private val haptics = Haptics(application)
    private val reply = ReplyLatch()

    // ---- server state ----
    private var connected = false
    private var deviceId: String? = null
    /** The device that holds the voice session, as far as the server has told this watch. */
    private var voiceHolder: String? = null
    private val holds: Boolean get() = deviceId != null && voiceHolder == deviceId
    /** `voice.claim` sent on this connection, `voice.granted` not yet seen. */
    private var claimSent = false
    private var pushRequested = false
    private val jobs = HashSet<String>()

    // ---- gate: created at the first `ready`, on the server's table ----
    private val gateLock = Any()
    @Volatile private var gate: Gate? = null
    private var idleCloseMs = DEFAULT_IDLE_CLOSE_MS

    // ---- the call ----
    private var inCall = false
    /** This call has held the voice session. Another holder after a reconnect then took it. */
    private var callHeldVoice = false
    @Volatile private var live: LiveSession? = null
    /** The replacement opened on `goAway`, until it takes over. */
    private var next: LiveSession? = null
    private var resumptionHandle: String? = null
    private var idleJob: Job? = null
    private var swapJob: Job? = null
    private var tickJob: Job? = null
    private var userText = ""
    private var agentText = ""

    fun connect() = server.connect()

    /** The tap. The caller has checked RECORD_AUDIO before a call starts. */
    fun toggleCall() = if (inCall) endCall("user") else startCall()

    /**
     * Not in a call: claim the voice session when another device holds it, open the Live
     * session and the microphone, play the agent. The foreground service starts here, while
     * the app is in front, so the call keeps running with the screen off.
     */
    fun startCall() {
        if (inCall) return
        inCall = true
        callHeldVoice = false
        haptics.callStarted()
        VoiceService.start(app)
        if (!callAudio.acquire()) {
            endCall("audio_focus_refused")
            return
        }
        // The orb follows the gate and the playback clock while a call runs, as the web polls.
        tickJob = viewModelScope.launch {
            while (true) {
                delay(TICK_MS)
                publish()
            }
        }
        touchIdle()
        advanceCall()
        publish()
    }

    /**
     * Hang up: end any open turn, stop playback, close the Live session, release the
     * microphone and the audio session, and give the voice session back.
     */
    fun endCall() = endCall("user")

    override fun onCleared() {
        endCall("app closed")
        server.close()
        SessionHub.socket = null
    }

    /** The next step of a call that waits on the server: the claim, then Live and the microphone. */
    private fun advanceCall() {
        if (!inCall) return
        if (!holds) {
            if (connected && !claimSent) claimSent = server.send(Messages.voiceClaim())
            return
        }
        callHeldVoice = true
        ensureLive()
        if (!audioIn.running && !audioIn.start()) endCall("microphone_unavailable")
    }

    private fun endCall(reason: String) {
        if (!inCall) return
        inCall = false
        // A claim still in flight is released too: the server handles this socket's messages in
        // order, so the release lands after the claim and frees what the claim takes.
        val claimPending = claimSent
        claimSent = false
        tickJob?.cancel()
        tickJob = null
        idleJob?.cancel()
        idleJob = null
        swapJob?.cancel()
        swapJob = null
        audioIn.stop()
        // An open turn ends here with activityEnd, before the socket closes.
        synchronized(gateLock) { gate?.stopAll() }
        audioOut.release()
        reply.end()
        next?.close(reason)
        next = null
        val session = live
        live = null
        if (session != null) {
            session.close(reason)
            server.send(Messages.liveClosed(reason))
        }
        callAudio.release()
        if (holds || claimPending) {
            server.send(Messages.voiceRelease())
            if (holds) voiceHolder = null
        }
        userText = ""
        agentText = ""
        VoiceService.stop(app)
        haptics.callEnded()
        publish()
    }

    // ---- server socket -----------------------------------------------------

    private fun handleServer(m: JSONObject) {
        when (m.str("type")) {
            S2C.READY -> {
                connected = true
                deviceId = m.str("device_id")
                voiceHolder = m.str("voice_holder")
                claimSent = false
                if (gate == null) {
                    val config = GateConfig.merge(m.optJSONObject("gate"))
                    synchronized(gateLock) {
                        gate = Gate(config = config, isModelSpeaking = audioOut::isSpeaking, listener = ::onGate)
                    }
                }
                (m.optJSONObject("live")?.opt("idle_close_seconds") as? Number)?.let {
                    idleCloseMs = (it.toDouble() * 1000).roundToLong()
                }
                jobs.clear()
                m.optJSONArray("jobs")?.let { list ->
                    for (i in 0 until list.length()) list.optJSONObject(i)?.str("job_id")?.let(jobs::add)
                }
                SessionHub.socket = server
                SessionHub.flushPending(app, server)
                registerPush()
                // The server freed this watch's voice session when the socket dropped. Another
                // holder now means another device took it meanwhile: the call ends, as on
                // `voice.revoked`. A call that never held it claims it, as a tap does.
                val other = voiceHolder != null && !holds
                if (inCall && other && callHeldVoice) endCall("revoked") else advanceCall()
            }
            S2C.VOICE_GRANTED -> {
                voiceHolder = deviceId
                claimSent = false
                if (inCall) {
                    advanceCall()
                } else {
                    // Granted after a hang-up: give it straight back.
                    server.send(Messages.voiceRelease())
                    voiceHolder = null
                }
            }
            S2C.VOICE_REVOKED -> {
                voiceHolder = m.str("by")
                claimSent = false
                endCall("revoked")
            }
            S2C.JOB_STARTED -> {
                m.str("job_id")?.let(jobs::add)
                if (live != null) touchIdle()
            }
            S2C.JOB_PROGRESS -> if (live != null) touchIdle()
            S2C.JOB_DONE -> {
                m.str("job_id")?.let(jobs::remove)
                if (live != null) touchIdle()
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
        val session = live
        if (!voice.isNullOrBlank() && holds && session != null) {
            session.sendEventTurn(voice)
            touchIdle()
        }
        publish()
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

    // ---- gate --------------------------------------------------------------

    /** Capture thread. */
    private fun onFrame(frame: ShortArray) {
        synchronized(gateLock) { gate?.pushFrame(frame) }
    }

    /** Under [gateLock], on the capture thread (or the main thread for a hang-up). */
    private fun onGate(e: GateEvent) {
        when (e) {
            GateEvent.SpeechStart -> {
                live?.activityStart()
                onMain {
                    userText = ""
                    touchIdle()
                    publish()
                }
            }
            is GateEvent.Audio -> live?.sendAudio(e.frame)
            is GateEvent.SpeechEnd -> {
                live?.activityEnd()
                onMain {
                    touchIdle()
                    if (next?.setupDone == true) swap()
                    publish()
                }
            }
            // Talking over the agent: silence it now, within bargein_stop_ms, and keep the rest
            // of its reply silent. The activityStart that follows makes the model stop.
            is GateEvent.BargeIn -> {
                reply.interrupt()
                audioOut.stop()
            }
            is GateEvent.Drop -> Unit
        }
    }

    private fun gateOpen(): Boolean = synchronized(gateLock) { gate?.open == true }

    // ---- live session ------------------------------------------------------

    private fun ensureLive() {
        if (live != null || !holds) return
        val session = createSession()
        live = session
        openSession(session)
    }

    private fun createSession(): LiveSession {
        lateinit var session: LiveSession
        session = LiveSession(http) { event -> onMain { onLive(session, event) } }
        return session
    }

    private fun openSession(session: LiveSession) {
        viewModelScope.launch {
            val token = try {
                tokens.fetch(auth())
            } catch (e: IOException) {
                Log.w(TAG, "token: ${e.message}")
                null
            } catch (e: JSONException) {
                Log.w(TAG, "token: ${e.message}")
                null
            }
            if (session !== live && session !== next) return@launch
            if (token == null) {
                session.close("token_failed")
                if (session === live) {
                    live = null
                    server.send(Messages.liveClosed("token_failed"))
                    endCall("token_failed")
                } else {
                    next = null
                }
                return@launch
            }
            session.connect(token.token, withHandle(token.setup, resumptionHandle ?: token.resumptionHandle))
        }
    }

    private fun onLive(session: LiveSession, event: LiveEvent) {
        if (session !== live && session !== next) return // A retired session.
        when (event) {
            is LiveEvent.SetupComplete -> if (session === next && !gateOpen()) swap()
            is LiveEvent.Audio -> if (session === live && reply.audio()) audioOut.write(event.pcm)
            is LiveEvent.Interrupted -> {
                audioOut.stop()
                reply.end()
            }
            is LiveEvent.GenerationComplete -> if (session === live) reply.end()
            is LiveEvent.TurnComplete -> {
                if (session === live) reply.end()
                if (agentText.isNotEmpty()) {
                    relayTranscript("agent", agentText, true)
                    agentText = ""
                }
                if (userText.isNotEmpty()) {
                    relayTranscript("user", userText, true)
                    userText = ""
                }
            }
            is LiveEvent.InputTranscription -> {
                userText += event.text
                val text = userText
                synchronized(gateLock) { gate?.setTranscript(text) }
                relayTranscript("user", text, event.finished)
                if (event.finished) userText = ""
            }
            is LiveEvent.OutputTranscription -> {
                agentText += event.text
                relayTranscript("agent", agentText, event.finished)
                if (event.finished) agentText = ""
            }
            is LiveEvent.ToolCall -> {
                for (call in event.calls) server.send(Messages.toolCall(call.id, call.name, call.args))
                touchIdle()
            }
            is LiveEvent.Usage -> {
                val (inBytes, outBytes) = session.takeAudioBytes()
                server.send(
                    Messages.liveUsage(bytesToMs(inBytes, INPUT_RATE), bytesToMs(outBytes, OUTPUT_RATE), event.promptTokens, event.responseTokens),
                )
            }
            is LiveEvent.Resumption -> event.newHandle?.let {
                resumptionHandle = it
                server.send(Messages.liveResumption(it))
            }
            is LiveEvent.GoAway -> if (session === live) prepareNext(event.timeLeftMs)
            is LiveEvent.Closed -> onLiveClosed(session, event.reason)
            is LiveEvent.Text, is LiveEvent.ToolCallCancellation -> Unit
        }
        publish()
    }

    /** A Live session closed by itself (idle, error, server drop): the call ends with it. */
    private fun onLiveClosed(session: LiveSession, reason: String) {
        if (session === live) {
            live = null
            server.send(Messages.liveClosed(reason))
            val promoted = next
            if (promoted != null) {
                live = promoted
                next = null
            } else {
                endCall(reason)
            }
        } else if (session === next) {
            next = null
        }
    }

    private fun relayTranscript(role: String, text: String, final: Boolean) {
        server.send(Messages.transcript(role, text, final))
    }

    /** `goAway`: open the replacement now; switch when it is ready and no turn is open, or 1 s before the old one ends. */
    private fun prepareNext(timeLeftMs: Long?) {
        if (next != null || live == null) return
        val session = createSession()
        next = session
        openSession(session)
        swapJob?.cancel()
        val wait = if (timeLeftMs == null) GOAWAY_DEFAULT_WAIT_MS else max(0L, timeLeftMs - 1000)
        swapJob = viewModelScope.launch {
            delay(wait)
            swap()
        }
    }

    private fun swap() {
        val replacement = next ?: return
        swapJob?.cancel()
        swapJob = null
        val old = live
        live = replacement
        next = null
        old?.close("goAway")
    }

    // ---- idle --------------------------------------------------------------

    private fun touchIdle() {
        if (!inCall) return
        idleJob?.cancel()
        idleJob = viewModelScope.launch {
            delay(idleCloseMs)
            onIdle()
        }
    }

    private fun onIdle() {
        if (gateOpen() || audioOut.isSpeaking()) {
            touchIdle()
            return
        }
        endCall("idle")
    }

    // ---- state -------------------------------------------------------------

    /** Same precedence as apps/web/src/App.tsx: connecting, listening, speaking, working, idle. */
    private fun publish() {
        val state = when {
            !connected -> OrbState.Connecting
            gateOpen() -> OrbState.Listening
            audioOut.isSpeaking() -> OrbState.Speaking
            jobs.isNotEmpty() -> OrbState.Working
            else -> OrbState.Idle
        }
        val holder = voiceHolder
        _ui.value = UiState(
            state = state,
            held = holder == null || holder == deviceId,
            live = live != null,
            inCall = inCall,
        )
    }

    private fun auth(): String = store.get(SecureStore.KEY_AUTH, SecureStore.DEFAULT_AUTH)

    /** Always a post, never inline: callers hold the gate lock or run on OkHttp threads. */
    private fun onMain(block: () -> Unit) {
        viewModelScope.launch(Dispatchers.Main) { block() }
    }

    private companion object {
        const val TAG = "AppViewModel"
        const val TICK_MS = 100L
        const val DEFAULT_IDLE_CLOSE_MS = 120_000L
        const val GOAWAY_DEFAULT_WAIT_MS = 5_000L

        fun bytesToMs(bytes: Long, sampleRate: Int): Long = (bytes.toDouble() / (sampleRate * 2) * 1000).roundToLong()
    }
}
