package systems.reagent.apparatus.wear

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import systems.reagent.apparatus.wear.net.Messages
import systems.reagent.apparatus.wear.net.ServerSocket
import systems.reagent.apparatus.wear.secure.SecureStore

/**
 * Process-wide handles that components outside the view model need: the push service and
 * the approval receiver run without an activity.
 */
object SessionHub {

    /** The server socket after `ready`; null while no session is open. Set by the view model. */
    @Volatile var socket: ServerSocket? = null

    /** The latest FCM registration token, or null when Firebase is not configured. */
    @Volatile var pushToken: String? = null

    /** Sends the answer on the open socket, or keeps it for the next `ready`. */
    fun answerApproval(context: Context, approvalId: String, approved: Boolean) {
        val message = Messages.approvalAnswer(approvalId, approved)
        val open = socket
        if (open != null && open.isOpen && open.send(message)) return
        val store = SecureStore.of(context)
        val queue = pending(store).put(message)
        store.set(SecureStore.KEY_PENDING_APPROVALS, queue.toString())
    }

    /** Sends the answers given while no socket was open. */
    fun flushPending(context: Context, socket: ServerSocket) {
        val store = SecureStore.of(context)
        val queue = pending(store)
        if (queue.length() == 0) return
        for (i in 0 until queue.length()) {
            val message: JSONObject = queue.optJSONObject(i) ?: continue
            if (!socket.send(message)) return
        }
        store.delete(SecureStore.KEY_PENDING_APPROVALS)
    }

    fun onPushToken(token: String) {
        pushToken = token
        socket?.takeIf { it.isOpen }?.send(Messages.pushRegister(token))
    }

    private fun pending(store: SecureStore): JSONArray = try {
        JSONArray(store.get(SecureStore.KEY_PENDING_APPROVALS) ?: "[]")
    } catch (e: JSONException) {
        JSONArray()
    }
}
