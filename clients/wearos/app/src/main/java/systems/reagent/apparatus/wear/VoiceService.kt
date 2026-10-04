package systems.reagent.apparatus.wear

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import systems.reagent.apparatus.wear.push.Notifier

/**
 * Foreground service with the microphone type. It holds the process and the audio path while
 * the screen is off during a voice turn. It owns no state; the view model starts and stops it.
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
