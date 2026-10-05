// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887, src/engine/morph.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A closed outline parameterised by arc length, f in [0, 1), written into the 2-slot [out]. */
private fun interface Path {
    fun at(f: Double, out: DoubleArray)
}

private fun smoothE(x: Double): Double = x * x * (3 - 2 * x)

private fun polyPath(vararg verts: DoubleArray): Path {
    val v = verts.size
    val lengths = DoubleArray(v)
    var total = 0.0
    for (i in 0 until v) {
        val a = verts[i]
        val b = verts[(i + 1) % v]
        lengths[i] = hypot(b[0] - a[0], b[1] - a[1])
        total += lengths[i]
    }
    return Path { f, out ->
        var target = f * total
        var i = 0
        while (target > lengths[i] && i < v - 1) {
            target -= lengths[i]
            i++
        }
        val a = verts[i]
        val b = verts[(i + 1) % v]
        val ff = if (lengths[i] != 0.0) min(1.0, target / lengths[i]) else 0.0
        out[0] = a[0] + (b[0] - a[0]) * ff
        out[1] = a[1] + (b[1] - a[1]) * ff
    }
}

private val CIRCLE = Path { f, out ->
    val a = -Math.PI / 2 + f * 2 * Math.PI
    out[0] = cos(a) * 0.24
    out[1] = sin(a) * 0.24
}
private val TRIANGLE = polyPath(
    doubleArrayOf(0.0, -0.26),
    doubleArrayOf(0.24, 0.16),
    doubleArrayOf(-0.24, 0.16),
)

// A 5-vertex walk, so the path starts at top centre like the other shapes.
private val SQUARE = polyPath(
    doubleArrayOf(0.0, -0.2),
    doubleArrayOf(0.2, -0.2),
    doubleArrayOf(0.2, 0.2),
    doubleArrayOf(-0.2, 0.2),
    doubleArrayOf(-0.2, -0.2),
)
private val CYCLE = arrayOf(CIRCLE, TRIANGLE, SQUARE)

private fun morphN(d: Double): Int = max(6.0, jsRound(34 * d)).toInt()

private const val HOLD = 1.4
private const val MORPH = 0.9
private const val SEG = HOLD + MORPH
private const val SAMPLES = 160

/** Morph: a dotted outline cycling circle, triangle, square. `shaping`. */
val frameMorph: ModeFrame = { size, t, o ->
    val shapes = CYCLE.size
    val tc = t % (SEG * shapes)
    val shape = o["shape"]
    val held = if (shape != null && shape >= 0 && shape < shapes) floor(shape).toInt() else -1
    val k = if (held >= 0) held else floor(tc / SEG).toInt()
    val local = if (held >= 0) t % SEG else tc - k * SEG
    val m = if (held >= 0) 0.0 else if (local > HOLD) smoothE((local - HOLD) / MORPH) else 0.0
    val sprd = o.num("spread", 1.0)

    val pA = CYCLE[k]
    val pB = if (held >= 0) pA else CYCLE[(k + 1) % shapes]
    val ptsX = DoubleArray(SAMPLES)
    val ptsY = DoubleArray(SAMPLES)
    val a = DoubleArray(2)
    val b = DoubleArray(2)
    for (i in 0 until SAMPLES) {
        val f = i.toDouble() / SAMPLES
        pA.at(f, a)
        pB.at(f, b)
        ptsX[i] = (a[0] + (b[0] - a[0]) * m) * sprd
        ptsY[i] = (a[1] + (b[1] - a[1]) * m) * sprd
    }
    val lengths = DoubleArray(SAMPLES)
    var total = 0.0
    for (i in 0 until SAMPLES) {
        val j = (i + 1) % SAMPLES
        lengths[i] = hypot(ptsX[j] - ptsX[i], ptsY[j] - ptsY[i])
        total += lengths[i]
    }

    // The radius depends only on rDot; the count sets the gaps.
    val n = morphN(o.num("iconD", 1.0))
    val re = o.num("rDot", 0.021) * 1.35 * sprd
    val pulse = 1 + 0.02 * sin(local * 3.1)

    val dots = ArrayList<Dot>(n)
    val c2 = size / 2
    var seg = 0
    var acc = 0.0
    for (k2 in 0 until n) {
        val target = (k2.toDouble() / n) * total
        while (acc + lengths[seg] < target && seg < SAMPLES - 1) {
            acc += lengths[seg]
            seg++
        }
        val next = (seg + 1) % SAMPLES
        val f = if (lengths[seg] != 0.0) min(1.0, (target - acc) / lengths[seg]) else 0.0
        val x = (ptsX[seg] + (ptsX[next] - ptsX[seg]) * f) * pulse
        val y = (ptsY[seg] + (ptsY[next] - ptsY[seg]) * f) * pulse
        dots.add(Dot(x = c2 + x * size, y = c2 + y * size, z = 0.0, r = max(0.35, re * size), white = 0.1))
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}
