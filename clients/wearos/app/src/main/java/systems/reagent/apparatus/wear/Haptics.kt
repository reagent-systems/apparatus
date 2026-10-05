package systems.reagent.apparatus.wear

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** The two call haptics: a click when the call starts, a double click when it ends. */
class Haptics(context: Context) {

    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }

    fun callStarted() = play(VibrationEffect.EFFECT_CLICK)

    fun callEnded() = play(VibrationEffect.EFFECT_DOUBLE_CLICK)

    private fun play(effect: Int) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        v.vibrate(VibrationEffect.createPredefined(effect))
    }
}
