// The Compose binding of the thinking-orbs engine: the 64 px preset, drawn at any diameter.
//
// The clock is the frame clock, like the web's requestAnimationFrame loop: t = seconds *
// preset speed * speed. The geometry is computed at the preset size and scaled inside the
// Canvas, so the dots stay vector-sharp at watch size (the web's 128 px orb is the 64 preset
// at scale 2). Ink follows the library's dark theme: light dots for a black screen.

package systems.reagent.apparatus.wear.ui.orb

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.max
import kotlin.math.min
import systems.reagent.apparatus.wear.ui.orb.engine.OrbAnimation
import systems.reagent.apparatus.wear.ui.orb.engine.OrbFrame
import systems.reagent.apparatus.wear.ui.orb.engine.STATIC_FRAME_T
import systems.reagent.apparatus.wear.ui.orb.engine.resolvePreset

/** The tuned preset the watch draws, scaled to the diameter. */
const val ORB_PRESET_PX = 64

/**
 * [paused] holds the frame of the instant it paused, as the web does. [staticFrame] (reduced
 * motion, ambient) draws the library's one static frame at t = 0.6 and wins over [paused].
 */
@Composable
fun ThinkingOrb(
    animation: OrbAnimation,
    modifier: Modifier = Modifier,
    speed: Double = 1.0,
    paused: Boolean = false,
    staticFrame: Boolean = false,
) {
    val preset = remember(animation) { resolvePreset(animation, ORB_PRESET_PX) }
    val effSpeed = preset.speed * speed
    val t = remember { mutableDoubleStateOf(STATIC_FRAME_T) }
    LaunchedEffect(preset, effSpeed, paused, staticFrame) {
        if (staticFrame) {
            t.doubleValue = STATIC_FRAME_T
            return@LaunchedEffect
        }
        // Choreographer frame times share System.nanoTime's base.
        t.doubleValue = System.nanoTime() / 1e9 * effSpeed
        if (paused) return@LaunchedEffect
        while (true) {
            withFrameNanos { nanos -> t.doubleValue = nanos / 1e9 * effSpeed }
        }
    }
    Canvas(modifier) {
        // Reading t here invalidates only the draw phase, never the composition.
        paint(preset.frame(ORB_PRESET_PX.toDouble(), t.doubleValue), size.minDimension / ORB_PRESET_PX)
    }
}

/** Lines first, so nodes sit on their edges; dots are already in draw order. */
private fun DrawScope.paint(frame: OrbFrame, zoom: Float) {
    val ox = (size.width - ORB_PRESET_PX * zoom) / 2
    val oy = (size.height - ORB_PRESET_PX * zoom) / 2
    for (l in frame.lines) {
        drawLine(
            color = ink(l.white, l.a),
            start = Offset(ox + l.x1.toFloat() * zoom, oy + l.y1.toFloat() * zoom),
            end = Offset(ox + l.x2.toFloat() * zoom, oy + l.y2.toFloat() * zoom),
            strokeWidth = l.w.toFloat() * zoom,
        )
    }
    for (d in frame.dots) {
        drawCircle(
            color = ink(d.white, d.a),
            radius = d.r.toFloat() * zoom,
            center = Offset(ox + d.x.toFloat() * zoom, oy + d.y.toFloat() * zoom),
        )
    }
}

/** The library's dark-theme ink: grey = round((1 - white) * 255), white clamped to [0, 1]. */
internal fun ink(white: Double, alpha: Double): Color {
    val w = min(1.0, max(0.0, white))
    val g = Math.round((1 - w) * 255) / 255f
    return Color(red = g, green = g, blue = g, alpha = min(1.0, max(0.0, alpha)).toFloat())
}
