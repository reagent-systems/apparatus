package systems.reagent.apparatus.wear.ui

// The watch GIF and the watch strip for the README, rendered by Paparazzi
// from the real Wear OS screen (App.kt `Screen`). tools/media copies this file
// into a scratch copy of clients/wearos; it is not part of the app's tests.
//
// One render over time: the app's Screen with the UiState of a short call.
// The state follows the Compose frame clock, which Paparazzi drives with
// fixed frame times, so the orb engine runs on the same clock as the switch
// between states. No text, no buttons: the screen has none.

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.platform.ComposeView
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams
import com.android.resources.Density
import org.junit.Rule
import org.junit.Test
import systems.reagent.apparatus.wear.UiState

class MediaWatchTest {
    companion object {
        /**
         * Each state's share of the call, in ms from the first frame: no call, a
         * tap starts it, listening, speaking, working, a tap hangs up. The tail
         * is no call again, so tools/media can end the loop on a breathing frame
         * that matches the first one.
         */
        val CALL: List<Pair<Long, UiState>> = listOf(
            0L to UiState(state = OrbState.Idle, held = true, live = false, inCall = false),
            800L to UiState(state = OrbState.Listening, held = true, live = true, inCall = true),
            1700L to UiState(state = OrbState.Speaking, held = true, live = true, inCall = true),
            2600L to UiState(state = OrbState.Working, held = true, live = true, inCall = true),
            3500L to UiState(state = OrbState.Idle, held = true, live = false, inCall = false),
        )
        const val END_MS = 7000L
        const val FPS = 15
    }

    // The Android Studio "Wear OS Large Round" AVD: 454 px, hdpi.
    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.WEAR_OS_SMALL_ROUND.copy(
            screenWidth = 454, screenHeight = 454, xdpi = 240, ydpi = 240, density = Density.HIGH,
        ),
        renderingMode = SessionParams.RenderingMode.NORMAL,
        showSystemUi = false,
    )

    @Composable
    private fun Call() {
        var ms by remember { mutableLongStateOf(0L) }
        LaunchedEffect(Unit) {
            val t0 = withFrameMillis { it }
            while (true) withFrameMillis { ms = it - t0 }
        }
        val ui = CALL.last { it.first <= ms }.second
        Screen(ui, staticFrame = false, onToggleCall = {})
    }

    /**
     * The hero: a job runs while another device (the desktop) holds the voice
     * session, so the watch is not in a call: working, paused and dimmed
     * (orbRender: held = false), as App.kt draws it.
     */
    @Test
    fun heldElsewhere() {
        val view = ComposeView(paparazzi.context).apply {
            setContent { Screen(UiState(state = OrbState.Working, held = false, live = false, inCall = false), staticFrame = false, onToggleCall = {}) }
        }
        paparazzi.snapshot(view, "media-held-elsewhere")
    }

    @Test
    fun call() {
        val view = ComposeView(paparazzi.context).apply { setContent { Call() } }
        // One extra frame at the start: the clock's first frame sets t0.
        paparazzi.gif(view, "media-call", start = 0L, end = END_MS + 1000L / FPS, fps = FPS)
    }
}
