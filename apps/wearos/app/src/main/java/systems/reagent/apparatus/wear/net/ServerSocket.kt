package systems.reagent.apparatus.wear.net

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.URLEncoder
import kotlin.math.min
import kotlin.random.Random
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONException
import org.json.JSONObject

/**
 * The one authenticated socket to the session server (`/ws/client`).
 *
 * Reconnects with exponential backoff while [connect] is in effect and sends a
 * protocol `ping` every 20 s. Listener callbacks run on OkHttp threads.
 */
class ServerSocket(
    private val client: OkHttpClient,
    serverOrigin: String,
    private val auth: () -> String,
    private val listener: Listener,
) {
    interface Listener {
        fun onOpen()
        fun onMessage(message: JSONObject)
        fun onClosed()
    }

    private val wsOrigin = toWsOrigin(serverOrigin)
    private val handler = Handler(Looper.getMainLooper())

    @Volatile private var socket: WebSocket? = null
    @Volatile private var wanted = false
    @Volatile private var attempt = 0

    @Volatile var isOpen: Boolean = false
        private set

    private val pingTask = object : Runnable {
        override fun run() {
            if (send(Messages.ping())) handler.postDelayed(this, PING_MS)
        }
    }
    private val reconnectTask = Runnable { if (wanted && socket == null) open() }

    fun connect() {
        if (wanted) return
        wanted = true
        attempt = 0
        open()
    }

    fun close() {
        wanted = false
        handler.removeCallbacks(reconnectTask)
        handler.removeCallbacks(pingTask)
        isOpen = false
        val current = socket
        socket = null
        current?.close(NORMAL_CLOSE, "closed")
    }

    /** Enqueues one message. False when no socket is open. */
    fun send(message: JSONObject): Boolean = socket?.send(message.toString()) ?: false

    private fun open() {
        val url = "$wsOrigin/ws/client?auth=${URLEncoder.encode(auth(), "UTF-8")}&device=$DEVICE"
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempt = 0
                isOpen = true
                handler.removeCallbacks(pingTask)
                handler.postDelayed(pingTask, PING_MS)
                listener.onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) = deliver(text)

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = deliver(bytes.utf8())

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "server socket: ${t.message ?: t.javaClass.simpleName}")
                lost(webSocket)
            }
        })
    }

    private fun deliver(text: String) {
        val message = try {
            JSONObject(text)
        } catch (e: JSONException) {
            Log.w(TAG, "server sent non-JSON")
            return
        }
        listener.onMessage(message)
    }

    private fun lost(webSocket: WebSocket) {
        // A socket replaced by close() or a newer open() has nothing to report.
        if (socket !== webSocket) return
        socket = null
        isOpen = false
        handler.removeCallbacks(pingTask)
        listener.onClosed()
        if (!wanted) return
        val delay = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl min(attempt, 5)) + Random.nextLong(0, JITTER_MS)
        attempt++
        handler.postDelayed(reconnectTask, delay)
    }

    private companion object {
        const val TAG = "ServerSocket"
        const val NORMAL_CLOSE = 1000
        const val PING_MS = 20_000L
        const val BASE_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L
        const val JITTER_MS = 500L
    }
}
