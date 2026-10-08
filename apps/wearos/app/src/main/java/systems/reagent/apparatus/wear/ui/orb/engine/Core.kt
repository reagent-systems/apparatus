// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887, src/engine/core.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.
//
// Pure geometry, no Android. A port must stay numerically equal to the JS engine:
// OrbGoldenTest replays the upstream golden frames within their tolerance.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** `white` is the paper-theme ink in [0, 1]; a dark substrate mirrors it at paint time. */
class Dot(
    val x: Double,
    val y: Double,
    val z: Double,
    var r: Double,
    val white: Double,
    val a: Double = 1.0,
)

/** A stroked edge between two projected points (the `connecting` web). */
class Line(
    val x1: Double,
    val y1: Double,
    val x2: Double,
    val y2: Double,
    val white: Double,
    val a: Double = 1.0,
    val w: Double,
)

/** One instant: `dots` in draw order (z ascending, radii clamped); `lines` draw first. */
class OrbFrame(val dots: List<Dot>, val lines: List<Line>)

/** Draw options of a resolved preset: the engine's knobs by name. */
typealias ModeOpts = Map<String, Double>

/** (size, t, opts) -> frame. */
typealias ModeFrame = (size: Double, t: Double, opts: ModeOpts) -> OrbFrame

/** The time a static frame shows (reduced motion): raw engine time, as the web draws it. */
const val STATIC_FRAME_T = 0.6

internal fun lerp(a: Double, b: Double, f: Double): Double = a + (b - a) * f

internal fun frac(x: Double): Double = x - floor(x)

/** JS `Math.round`: halves round up. `kotlin.math.round` rounds halves to even. */
internal fun jsRound(x: Double): Double = Math.round(x).toDouble()

/** Value noise on a 2D lattice. */
internal fun vnoise(x: Double, y: Double): Double {
    val xi = floor(x)
    val yi = floor(y)
    var fx = x - xi
    var fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    val a = hashD(xi, yi)
    val b = hashD(xi + 1, yi)
    val c = hashD(xi, yi + 1)
    val d = hashD(xi + 1, yi + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Deterministic hash in [0, 1). */
internal fun hashD(a: Double, b: Double): Double {
    val h = sin(a * 12.9898 + b * 78.233) * 43758.5453
    return h - floor(h)
}

internal fun hashD(a: Int, b: Double): Double = hashD(a.toDouble(), b)

/** Stable directions on a unit sphere (Fibonacci lattice), written into [out]. */
internal fun fibDir(i: Int, n: Double, out: DoubleArray) {
    val golden = Math.PI * (3 - sqrt(5.0))
    val y = 1 - (2 * (i + 0.5)) / n
    val rad = sqrt(1 - y * y)
    val a = i * golden
    out[0] = rad * cos(a)
    out[1] = y
    out[2] = rad * sin(a)
}

/** Shortest signed angular distance, wrapped to (-pi, pi]. */
internal fun angleDelta(a: Double, b: Double): Double = atan2(sin(a - b), cos(a - b))

/**
 * Spin + tilt + orthographic projection. [project] writes the result to [x], [y], [z]
 * instead of returning a tuple, so a frame allocates no boxes per point.
 */
internal class Projector(yaw: Double, tilt: Double, private val cx: Double, private val cy: Double, private val scale: Double) {
    private val st = sin(tilt)
    private val ct = cos(tilt)
    private val sy = sin(yaw)
    private val cyw = cos(yaw)

    var x = 0.0
        private set
    var y = 0.0
        private set
    var z = 0.0
        private set

    fun project(px: Double, py: Double, pz: Double) {
        val x1 = px * cyw + pz * sy
        val z1 = -px * sy + pz * cyw
        val y1 = py * ct - z1 * st
        val z2 = py * st + z1 * ct
        x = cx + x1 * scale
        y = cy - y1 * scale
        z = z2
    }
}

// The JS comparator is `a.z - b.z` under a stable sort: -0 and +0 compare equal, which
// Double.compareTo does not do.
private val BY_DEPTH = Comparator<Dot> { a, b ->
    val d = a.z - b.z
    if (d < 0) -1 else if (d > 0) 1 else 0
}

/** Drop invisible marks, clamp radii to the mode's floor, z-sort far to near (stable). */
internal fun finalizeFrame(dots: MutableList<Dot>, lines: List<Line>, rMin: Double = 0.3): OrbFrame {
    val visible = ArrayList<Dot>(dots.size)
    for (d in dots) {
        if (d.a < 0.02) continue
        d.r = max(rMin, d.r)
        visible.add(d)
    }
    visible.sortWith(BY_DEPTH)
    return OrbFrame(visible, lines.filter { it.a >= 0.02 })
}

/** Dot radii were tuned for a 300 pt frame; sub-linear scaling keeps small orbs legible. */
internal fun radiusScale(size: Double, pow: Double): Double = (size / 300).pow(pow)

/** The JS `o.key ?? fallback`. */
internal fun ModeOpts.num(key: String, fallback: Double): Double = this[key] ?: fallback
