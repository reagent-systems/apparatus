package systems.reagent.apparatus.wear.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import systems.reagent.apparatus.wear.SessionHub

/**
 * FCM entry point. Runs without the activity.
 *
 * The server sends `notification {title, body}` plus a string `data` map. `data.type` (or
 * `data.kind`) names the event with the S2C type (`handoff.requested`, `approval.requested`,
 * `job.done`, ...). Without a known type, the title and body are shown as they are.
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        SessionHub.onPushToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"] ?: data["kind"] ?: ""
        val title = message.notification?.title
        val body = message.notification?.body
        when {
            type.startsWith("handoff.ended") -> Notifier.cancelHandoff(this)
            type.startsWith("handoff") -> Notifier.handoff(this, data["reason"] ?: body)
            type.startsWith("approval.ended") -> data["approval_id"]?.let { Notifier.cancelApproval(this, it) }
            type.startsWith("approval") -> {
                val approvalId = data["approval_id"] ?: return
                Notifier.approval(this, approvalId, data["action"] ?: title.orEmpty(), data["details"] ?: body.orEmpty())
            }
            type.startsWith("job") -> Notifier.jobDone(this, data["say"] ?: body ?: return)
            title != null || body != null -> Notifier.plain(this, title, body)
        }
    }
}
