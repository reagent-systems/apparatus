package systems.reagent.apparatus.wear.net

import android.util.Base64
import android.util.Log
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

const val INPUT_RATE = 16000
const val OUTPUT_RATE = 24000

class FunctionCall(val id: String, val name: String, val args: JSONObject)

/** One Gemini Live server message, flattened. One message can carry several of these. */
sealed interface LiveEvent {
    data object SetupComplete : LiveEvent
    class Audio(val pcm: ByteArray, val sampleRate: Int) : LiveEvent
    class Text(val text: String) : LiveEvent
    data object Interrupted : LiveEvent
    data object TurnComplete : LiveEvent
    data object GenerationComplete : LiveEvent
    class InputTranscription(val text: String, val finished: Boolean) : LiveEvent
    class OutputTranscription(val text: String, val finished: Boolean) : LiveEvent
    class ToolCall(val calls: List<FunctionCall>) : LiveEvent
    class ToolCallCancellation(val ids: List<String>) : LiveEvent
    class Usage(val promptTokens: Int, val responseTokens: Int) : LiveEvent
    class Resumption(val newHandle: String?, val resumable: Boolean) : LiveEvent
    class GoAway(val timeLeftMs: Long?) : LiveEvent
    /** The socket is gone. Not sent after a local [LiveSession.close]. */
    class Closed(val reason: String) : LiveEvent
}

/**
 * One WebSocket to Gemini Live, opened with an ephemeral token from the session server. Port of
 * apps/web/src/live/session.ts.
 *
 * The first message is the `setup` message from `POST /token`, sent verbatim. Realtime input
 * sent before `setupComplete` is queued (bounded), so a turn that starts during connect is not
 * lost. Sends are safe from any thread; events arrive on OkHttp threads. Wire shapes are
 * camelCase JSON as in apps/web/src/live/messages.ts.
 */
class LiveSession(
    private val client: OkHttpClient,
    private val onEvent: (LiveEvent) -> Unit,
) {
    private val lock = Any()
    private var socket: WebSocket? = null
    private var ready = false
    private var closed = false
    private val queue = ArrayDeque<String>()
    private val finished = AtomicBoolean(false)

    /** PCM16 bytes sent and received since the last [takeAudioBytes]. */
    private val bytesIn = AtomicLong(0)
    private val bytesOut = AtomicLong(0)

    val setupDone: Boolean get() = synchronized(lock) { ready }

    /** [setup] is the complete first message (`{"setup": {...}}`), sent verbatim. */
    fun connect(token: String, setup: JSONObject) {
        val request = Request.Builder().url("$ENDPOINT?access_token=${URLEncoder.encode(token, "UTF-8")}").build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(setup.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) = deliver(text)

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = deliver(bytes.utf8())

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                finish("closed $code ${reason.ifEmpty { "-" }}")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val http = response?.code?.let { " http $it" } ?: ""
                finish("failure ${t.message ?: t.javaClass.simpleName}$http")
            }
        })
        synchronized(lock) {
            if (closed) {
                ws.cancel()
                return
            }
            socket = ws
        }
    }

    /** One gate frame: 16 kHz mono PCM16, sent little-endian. */
    fun sendAudio(frame: ShortArray) {
        val bytes = ByteArray(frame.size * 2)
        for (i in frame.indices) {
            val s = frame[i].toInt()
            bytes[2 * i] = s.toByte()
            bytes[2 * i + 1] = (s shr 8).toByte()
        }
        bytesIn.addAndGet(bytes.size.toLong())
        val audio = JSONObject()
            .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            .put("mimeType", "audio/pcm;rate=$INPUT_RATE")
        enqueue(JSONObject().put("realtimeInput", JSONObject().put("audio", audio)))
    }

    fun activityStart() = enqueue(JSONObject().put("realtimeInput", JSONObject().put("activityStart", JSONObject())))

    fun activityEnd() = enqueue(JSONObject().put("realtimeInput", JSONObject().put("activityEnd", JSONObject())))

    /** The answer to a relayed tool call, with the scheduling the server chose. */
    fun sendToolResponse(callId: String, name: String, response: JSONObject, scheduling: String) {
        val functionResponse = JSONObject()
            .put("id", callId)
            .put("name", name)
            .put("response", response)
            .put("scheduling", scheduling)
        val toolResponse = JSONObject().put("functionResponses", JSONArray().put(functionResponse))
        enqueue(JSONObject().put("toolResponse", toolResponse))
    }

    /** An S2C `voice` string as a user turn: `<event>text</event>`, turn complete. */
    fun sendEventTurn(voiceText: String) {
        val safe = voiceText.replace(Regex("(?i)</event>"), "")
        val turn = JSONObject()
            .put("role", "user")
            .put("parts", JSONArray().put(JSONObject().put("text", "<event>$safe</event>")))
        val content = JSONObject().put("turns", JSONArray().put(turn)).put("turnComplete", true)
        enqueue(JSONObject().put("clientContent", content))
    }

    /** Audio byte counts since the last call, for `live.usage`. */
    fun takeAudioBytes(): Pair<Long, Long> = bytesIn.getAndSet(0) to bytesOut.getAndSet(0)

    /** Closes the socket. No [LiveEvent.Closed] follows a local close. */
    fun close(reason: String) {
        finished.set(true)
        val current = synchronized(lock) {
            closed = true
            ready = false
            queue.clear()
            socket.also { socket = null }
        }
        current?.close(NORMAL_CLOSE, reason.take(MAX_CLOSE_REASON))
    }

    private fun enqueue(message: JSONObject) {
        val text = message.toString()
        synchronized(lock) {
            if (closed) return
            val ws = socket
            if (ready && ws != null) {
                ws.send(text)
                return
            }
            if (queue.size >= MAX_QUEUE) queue.removeFirst()
            queue.addLast(text)
        }
    }

    private fun deliver(text: String) {
        val json = try {
            JSONObject(text)
        } catch (e: JSONException) {
            Log.w(TAG, "live sent non-JSON")
            return
        }
        for (event in parseServerMessage(json)) {
            when (event) {
                is LiveEvent.SetupComplete -> synchronized(lock) {
                    ready = true
                    val ws = socket
                    while (ws != null && queue.isNotEmpty()) ws.send(queue.removeFirst())
                }
                is LiveEvent.Audio -> bytesOut.addAndGet(event.pcm.size.toLong())
                else -> Unit
            }
            onEvent(event)
        }
    }

    private fun finish(reason: String) {
        if (!finished.compareAndSet(false, true)) return
        synchronized(lock) {
            socket = null
            ready = false
        }
        onEvent(LiveEvent.Closed(reason))
    }

    companion object {
        private const val TAG = "LiveSession"
        private const val NORMAL_CLOSE = 1000
        private const val MAX_CLOSE_REASON = 120

        // 30 s of 20 ms frames: the most a slow connect may hold back.
        private const val MAX_QUEUE = 1500

        // Confirm the path and the query parameter name against the current Gemini Live API
        // docs (ai.google.dev/api/live) before the paid tier. The "Constrained" method is the
        // one that accepts an ephemeral token.
        const val ENDPOINT =
            "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
    }
}

/**
 * The setup message with a resumption handle, like the web `withHandle`: the handle goes into
 * `setup.sessionResumption` unless the server already put one there. Returns a new object.
 */
fun withHandle(setup: JSONObject, handle: String?): JSONObject {
    if (handle == null) return setup
    val inner = setup.optJSONObject("setup") ?: return setup
    val out = JSONObject(setup.toString())
    val outInner = out.getJSONObject("setup")
    val existing = inner.optJSONObject("sessionResumption")
    val resumption = if (existing != null) JSONObject(existing.toString()) else JSONObject()
    if (resumption.opt("handle") !is String) resumption.put("handle", handle)
    outInner.put("sessionResumption", resumption)
    return out
}

/** `audio/pcm;rate=24000` -> 24000. Falls back to the Live output rate. */
fun parseMimeRate(mimeType: String): Int =
    Regex("rate=(\\d+)").find(mimeType)?.groupValues?.get(1)?.toIntOrNull() ?: OUTPUT_RATE

/** A protobuf Duration as JSON (`"12.5s"` or `{seconds, nanos}`) to milliseconds. */
fun parseDurationMs(value: Any?): Long? = when (value) {
    is String -> Regex("^(-?\\d+(?:\\.\\d+)?)s$").find(value.trim())
        ?.groupValues?.get(1)?.toDoubleOrNull()?.let { Math.round(it * 1000) }
    is JSONObject -> {
        val seconds = value.opt("seconds").let { (it as? String)?.toDoubleOrNull() ?: (it as? Number)?.toDouble() ?: 0.0 }
        val nanos = (value.opt("nanos") as? Number)?.toDouble() ?: 0.0
        Math.round(seconds * 1000 + nanos / 1e6)
    }
    is Number -> Math.round(value.toDouble() * 1000)
    else -> null
}

/** Flattens one Live server message into events, in wire order. Mirrors apps/web/src/live/messages.ts. */
fun parseServerMessage(json: JSONObject): List<LiveEvent> {
    val events = ArrayList<LiveEvent>(4)

    if (json.has("setupComplete")) events += LiveEvent.SetupComplete

    json.optJSONObject("serverContent")?.let { sc ->
        if (sc.optBoolean("interrupted")) events += LiveEvent.Interrupted
        sc.optJSONObject("modelTurn")?.optJSONArray("parts")?.let { parts ->
            for (i in 0 until parts.length()) {
                val part = parts.optJSONObject(i) ?: continue
                val inline = part.optJSONObject("inlineData")
                val data = inline?.str("data")
                if (inline != null && data != null) {
                    val mimeType = inline.str("mimeType") ?: "audio/pcm;rate=$OUTPUT_RATE"
                    val pcm = try {
                        Base64.decode(data, Base64.DEFAULT)
                    } catch (e: IllegalArgumentException) {
                        continue
                    }
                    events += LiveEvent.Audio(pcm, parseMimeRate(mimeType))
                } else {
                    part.str("text")?.let { events += LiveEvent.Text(it) }
                }
            }
        }
        sc.optJSONObject("inputTranscription")?.let { t ->
            t.str("text")?.let { events += LiveEvent.InputTranscription(it, t.optBoolean("finished")) }
        }
        sc.optJSONObject("outputTranscription")?.let { t ->
            t.str("text")?.let { events += LiveEvent.OutputTranscription(it, t.optBoolean("finished")) }
        }
        if (sc.optBoolean("generationComplete")) events += LiveEvent.GenerationComplete
        if (sc.optBoolean("turnComplete")) events += LiveEvent.TurnComplete
    }

    json.optJSONObject("toolCall")?.optJSONArray("functionCalls")?.let { array ->
        val calls = ArrayList<FunctionCall>(array.length())
        for (i in 0 until array.length()) {
            val call = array.optJSONObject(i) ?: continue
            val name = call.str("name") ?: continue
            calls += FunctionCall(call.str("id").orEmpty(), name, call.optJSONObject("args") ?: JSONObject())
        }
        events += LiveEvent.ToolCall(calls)
    }

    json.optJSONObject("toolCallCancellation")?.optJSONArray("ids")?.let { array ->
        val ids = ArrayList<String>(array.length())
        for (i in 0 until array.length()) (array.opt(i) as? String)?.let(ids::add)
        events += LiveEvent.ToolCallCancellation(ids)
    }

    json.optJSONObject("usageMetadata")?.let { um ->
        val prompt = um.optInt("promptTokenCount")
        val response = if (um.has("responseTokenCount")) um.optInt("responseTokenCount") else um.optInt("candidatesTokenCount")
        events += LiveEvent.Usage(prompt, response)
    }

    json.optJSONObject("sessionResumptionUpdate")?.let { s ->
        events += LiveEvent.Resumption(s.str("newHandle")?.takeIf { it.isNotEmpty() }, s.optBoolean("resumable"))
    }

    json.optJSONObject("goAway")?.let { g ->
        events += LiveEvent.GoAway(parseDurationMs(g.opt("timeLeft")))
    }

    return events
}
