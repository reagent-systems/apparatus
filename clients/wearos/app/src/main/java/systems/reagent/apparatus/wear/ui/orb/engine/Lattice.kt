// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887, src/engine/lattice.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.
//
// The sphere-lattice modes: globe (searching), rubik (solving) and wave (listening).

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

private class Move(val axis: Int, val lo: Double, val hi: Double, val ang: Double)

private class SolveCycle(val amount: DoubleArray, val active: Int)

/** Rapid eased moves scramble, then replay in reverse so everything clicks back to solved. */
private fun solveCycle(time: Double, count: Int, slotDur: Double, rest: Double): SolveCycle {
    val cyc = 2 * count * slotDur + rest
    val tc = time % cyc
    val amount = DoubleArray(count)
    var active = -1
    if (tc < 2 * count * slotDur) {
        val slot = floor(tc / slotDur).toInt()
        val p = (tc - slot * slotDur) / slotDur
        val cl = min(1.0, p / 0.7)
        val ep = 1 - (1 - cl).pow(3)
        if (slot < count) {
            for (i in 0 until slot) amount[i] = 1.0
            amount[slot] = ep
            active = slot
        } else {
            val u = 2 * count - 1 - slot
            for (i in 0 until u) amount[i] = 1.0
            amount[u] = 1 - ep
            active = u
        }
    }
    return SolveCycle(amount, active)
}

/** Applies the moves to (x, y, z) in [p]; returns true when the point is in the active band. */
private fun applyMoves(p: DoubleArray, moves: List<Move>, sc: SolveCycle): Boolean {
    var x = p[0]
    var y = p[1]
    var z = p[2]
    var inActive = false
    for (i in moves.indices) {
        if (sc.amount[i] <= 0) continue
        val mv = moves[i]
        val coord = when (mv.axis) {
            0 -> x
            1 -> y
            else -> z
        }
        if (coord < mv.lo || coord >= mv.hi) continue
        if (i == sc.active) inActive = true
        val a = mv.ang * sc.amount[i]
        val ca = cos(a)
        val sa = sin(a)
        when (mv.axis) {
            0 -> {
                val y2 = y * ca - z * sa
                z = y * sa + z * ca
                y = y2
            }
            1 -> {
                val x2 = x * ca + z * sa
                z = -x * sa + z * ca
                x = x2
            }
            else -> {
                val x2 = x * ca - y * sa
                y = x * sa + y * ca
                x = x2
            }
        }
    }
    p[0] = x
    p[1] = y
    p[2] = z
    return inActive
}

private fun makeMoves(count: Int): List<Move> = List(count) { i ->
    val axis = min(2.0, floor(hashD(i, 2.3) * 3)).toInt()
    val lo = -1.0 + 0.5 * min(3.0, floor(hashD(i, 5.9) * 4))
    val dir = if (hashD(i, 7.7) < 0.5) 1 else -1
    Move(axis, lo, lo + 0.5, (dir * Math.PI) / 2)
}

/** Globe: a lat/long field, a scan meridian sweeps. `searching`. */
val frameGlobe: ModeFrame = { size, t, o ->
    val spin = 0.5
    val cx = size / 2
    val cy = size / 2
    val radius = (size / 2) * 0.82
    val tilt = 0.4 + 0.06 * sin(t * 0.35)
    val pt = Projector(t * spin, tilt, cx, cy, radius)
    val scan = t * (spin + (1.7 - spin) * o.num("scanMul", 1.0))
    val rs = radiusScale(size, o.num("rsPow", 0.6))
    val dimBase = o.num("dimBase", 1.0)

    val dots = ArrayList<Dot>()
    val latRings = o.num("latRings", 17.0)
    val lonDensity = o.num("lonDensity", 44.0)
    var li = 0
    while (li <= latRings) {
        val lat = -Math.PI / 2 + (li / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity))
        var lj = 0
        while (lj < lonCount) {
            val lon = (lj / lonCount) * 2 * Math.PI
            pt.project(cosLat * cos(lon), sinLat, cosLat * sin(lon))
            val z = pt.z
            val depth = (z + 1) / 2
            val d = angleDelta(lon + t * spin, scan)
            val boost = exp(-(d * d) / 0.18) * max(0.0, z)
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = z,
                    r = (o.num("rBase", 0.6) + o.num("rDepth", 1.7) * depth + o.num("rBoost", 1.0) * boost) * rs,
                    white = o.num("inkFar", 0.62) - o.num("inkSpan", 0.54) * depth,
                    a = dimBase + (1 - dimBase) * min(1.0, boost),
                ),
            )
            lj++
        }
        li++
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}

/** Rubik: bands twist in quarter turns, scramble then solve. `solving`. */
val frameRubik: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.82
    val pt = Projector(t * 0.55, 0.35 + 0.1 * sin(t * 0.9), cx, cy, r)
    val rs = radiusScale(size, o.num("rsPow", 0.6))
    val moveCount = o.num("moveCount", 14.0).toInt()
    val moves = makeMoves(moveCount)
    val sc = solveCycle(t, moveCount, 0.42, 1.2)

    val dots = ArrayList<Dot>()
    val latRings = o.num("latRings", 15.0)
    val lonDensity = o.num("lonDensity", 40.0)
    val p = DoubleArray(3)
    var li = 0
    while (li <= latRings) {
        val lat = -Math.PI / 2 + (li / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity))
        var lj = 0
        while (lj < lonCount) {
            val lon = (lj / lonCount) * 2 * Math.PI
            p[0] = cosLat * cos(lon)
            p[1] = sinLat
            p[2] = cosLat * sin(lon)
            val inActive = applyMoves(p, moves, sc)
            pt.project(p[0], p[1], p[2])
            val zr = pt.z
            val depth = (zr + 1) / 2
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = zr,
                    r = (o.num("rBase", 0.6) + o.num("rDepth", 1.7) * depth + (if (inActive) o.num("rActive", 0.3) else 0.0)) * rs,
                    white = o.num("inkFar", 0.62) - o.num("inkSpan", 0.54) * depth - (if (inActive) 0.14 else 0.0),
                ),
            )
            lj++
        }
        li++
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}

/** Wave: a waveform rolls through the rings. `listening`. */
val frameWave: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.874
    val pt = Projector(t * 0.18, 0.38, cx, cy, 1.0)
    val rs = radiusScale(size, o.num("rsPow", 0.6))

    val dots = ArrayList<Dot>()
    val rings = o.num("rings", 15.0)
    val lonDensity = o.num("lonDensity", 40.0)
    var ri = 0
    while (ri <= rings) {
        val lat = -Math.PI / 2 + (ri / rings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val w = 0.62 * sin(t * 2.1 - ri * 0.52) + 0.38 * sin(t * 1.27 + ri * 0.83)
        val rr = r * (0.88 + 0.105 * w)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity))
        var lj = 0
        while (lj < lonCount) {
            val lon = (lj / lonCount) * 2 * Math.PI
            pt.project(cosLat * cos(lon) * rr, sinLat * rr, cosLat * sin(lon) * rr)
            val z = pt.z
            val depth = (z / r + 1) / 2
            val crest = max(0.0, w)
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = z,
                    r = (o.num("rBase", 0.6) + o.num("rDepth", 1.7) * depth) * (1 + 0.4 * crest) * rs,
                    white = 0.66 - 0.56 * depth - 0.1 * crest,
                ),
            )
            lj++
        }
        ri++
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}
