package systems.reagent.apparatus.wear.push

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import systems.reagent.apparatus.wear.SessionHub

/** Approve or Deny from an approval notification. Sends `approval.answer` or queues it. */
class ApprovalReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val approvalId = intent.getStringExtra(EXTRA_APPROVAL_ID) ?: return
        val approved = intent.getBooleanExtra(EXTRA_APPROVED, false)
        SessionHub.answerApproval(context, approvalId, approved)
        Notifier.cancelApproval(context, approvalId)
    }

    companion object {
        private const val ACTION = "systems.reagent.apparatus.wear.APPROVAL"
        private const val EXTRA_APPROVAL_ID = "approval_id"
        private const val EXTRA_APPROVED = "approved"

        fun intent(context: Context, approvalId: String, approved: Boolean): PendingIntent {
            // A distinct action per (id, answer) keeps the two PendingIntents apart.
            val intent = Intent(context, ApprovalReceiver::class.java)
                .setAction("$ACTION.$approvalId.$approved")
                .putExtra(EXTRA_APPROVAL_ID, approvalId)
                .putExtra(EXTRA_APPROVED, approved)
            val requestCode = (approvalId.hashCode() and 0x3fffffff) * 2 + (if (approved) 1 else 0)
            return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
    }
}
