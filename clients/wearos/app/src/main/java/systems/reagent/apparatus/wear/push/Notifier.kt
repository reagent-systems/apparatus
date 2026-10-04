package systems.reagent.apparatus.wear.push

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import systems.reagent.apparatus.wear.MainActivity
import systems.reagent.apparatus.wear.R

/**
 * The watch shows output as notifications only (design spec, Clients and UI).
 *
 * Handoff: one line that sends the user to another device. Approval: the action and its
 * details with Approve and Deny. Job done: the spoken `say` text.
 */
object Notifier {

    const val CHANNEL_ALERTS = "alerts"
    const val CHANNEL_SESSION = "session"

    const val ID_HANDOFF = 1
    const val ID_SESSION = 2
    const val ID_JOB = 3
    private const val ID_APPROVAL_BASE = 1000
    private const val ID_APPROVAL_RANGE = 100_000

    fun handoff(context: Context, reason: String?) {
        val builder = alert(context).setContentTitle(context.getString(R.string.continue_on_another_device))
        if (!reason.isNullOrBlank()) builder.setContentText(reason)
        post(context, ID_HANDOFF, builder.build())
    }

    fun cancelHandoff(context: Context) {
        NotificationManagerCompat.from(context).cancel(ID_HANDOFF)
    }

    fun approval(context: Context, approvalId: String, action: String, details: String) {
        val notification = alert(context)
            .setContentTitle(action.ifBlank { context.getString(R.string.app_name) })
            .setContentText(details)
            .setStyle(NotificationCompat.BigTextStyle().bigText(details))
            .addAction(0, context.getString(R.string.approve), ApprovalReceiver.intent(context, approvalId, true))
            .addAction(0, context.getString(R.string.deny), ApprovalReceiver.intent(context, approvalId, false))
            .build()
        post(context, approvalNotificationId(approvalId), notification)
    }

    fun cancelApproval(context: Context, approvalId: String) {
        NotificationManagerCompat.from(context).cancel(approvalNotificationId(approvalId))
    }

    fun jobDone(context: Context, say: String) {
        post(context, ID_JOB, alert(context).setContentTitle(say).setStyle(NotificationCompat.BigTextStyle().bigText(say)).build())
    }

    fun plain(context: Context, title: String?, body: String?) {
        val builder = alert(context)
        if (!title.isNullOrBlank()) builder.setContentTitle(title)
        if (!body.isNullOrBlank()) builder.setContentText(body)
        post(context, ID_JOB, builder.build())
    }

    /** The ongoing notification that [systems.reagent.apparatus.wear.VoiceService] needs. */
    fun session(context: Context): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, CHANNEL_SESSION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(launch(context))
            .build()
    }

    private fun alert(context: Context): NotificationCompat.Builder =
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 150))
            .setContentIntent(launch(context))

    private fun launch(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun ensureChannels(context: Context) {
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ALERTS, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName(context.getString(R.string.channel_alerts))
                .setVibrationEnabled(true)
                .build(),
        )
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_SESSION, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName(context.getString(R.string.channel_session))
                .setShowBadge(false)
                .build(),
        )
    }

    private fun post(context: Context, id: Int, notification: Notification) {
        ensureChannels(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call.
        }
    }

    private fun approvalNotificationId(approvalId: String): Int =
        ID_APPROVAL_BASE + (approvalId.hashCode() and 0x7fffffff) % ID_APPROVAL_RANGE
}
