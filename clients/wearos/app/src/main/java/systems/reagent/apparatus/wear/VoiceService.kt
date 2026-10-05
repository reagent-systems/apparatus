package systems.reagent.apparatus.wear

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import systems.reagent.apparatus.wear.push.Notifier

/**
 * Foreground service with the microphone type. It holds the process and the microphone for the
 * whole call, so the call keeps running with the wrist down and the screen off. It owns no
 * state; the view model starts it when a call starts (the app is in front then, which Android
 * 14 requires for a microphone service) and stops it on hang-up.
 */
class VoiceService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            startForeground(Notifier.ID_SESSION, Notifier.session(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } catch (e: Exception) {
            // SecurityException without RECORD_AUDIO, or a foreground start refused from the background.
            Log.w(TAG, "foreground start refused: ${e.message}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "VoiceService"

        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, VoiceService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "start refused: ${e.message}")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, VoiceService::class.java))
        }
    }
}
