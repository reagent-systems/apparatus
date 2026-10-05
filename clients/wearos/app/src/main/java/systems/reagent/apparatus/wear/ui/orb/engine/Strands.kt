// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887,
// src/engine/braid.ts and src/engine/ribbon.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** The faint sphere of dots behind braid and ribbon. */
private fun ghostSphere(dots: MutableList<Dot>, ghostN: Double, r: Double, rs: Double, pt: Projector) {
    val d = DoubleArray(3)
    var i = 0
    while (i < ghostN) {
        fibDir(i, ghostN, d)
        pt.project(d[0] * r, d[1] * r, d[2] * r)
        val depth = (pt.z / r + 1) / 2
        dots.add(Dot(x = pt.x, y = pt.y, z = pt.z, r = 0.8 * rs, white = 0.78, a = 0.1 + 0.22 * depth))
        i++
    }
}

/** Braid: three strands plait around the sphere. `weaving`. */
val frameBraid: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.76
    val pt = Projector(t * 0.4, 0.3, cx, cy, 1.0)
    val rs = radiusScale(size, o.num("rsPow", 0.6))

    val dots = ArrayList<Dot>()
    ghostSphere(dots, o.num("ghostN", 150.0), r, rs, pt)

    val strandN = o.num("strandN", 52.0)
    val turns = o.num("turns", 3.0)
    for (s in 0 until 3) {
        val phase = (s / 3.0) * 2 * Math.PI
        var i = 0
        while (i < strandN) {
            // u walks pole to pole; the frac() drift slides the whole strand along
            val u = (frac(i / strandN + t * 0.045) * 2 - 1) * 0.96
            val surf = sqrt(max(0.0, 1 - u * u))
            val endFade = min(1.0, (1 - abs(u)) / 0.1)
            val a = u * Math.PI * turns + phase
            // radial breathing: the strands trade places, the over/under of a plait
            val weave = 1 + 0.075 * sin(u * Math.PI * turns * 2 + phase * 2 + t * 0.8)
            val rr = surf * r * weave
            pt.project(cos(a) * rr, u * r * weave, sin(a) * rr)
            val depth = (pt.z / r + 1) / 2
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = pt.z,
                    r = (o.num("rBase", 1.2) + o.num("rDepth", 1.8) * depth) * rs,
                    white = 0.55 - 0.45 * depth,
                    a = endFade * (0.45 + 0.55 * depth),
                ),
            )
            i++
        }
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}

/**
 * Ribbon: an undulating sash of parallel strands on a great circle. `composing`.
 * With `faceOn` the same geometry is a face-on ring whose radius undulates: `breathing`.
 */
val frameRibbon: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.78
    val spin = o.num("spin", 1.0)
    val camTilt = 0.3
    val pt = Projector(t * 0.1 * spin, camTilt, cx, cy, 1.0)
    val rs = radiusScale(size, o.num("rsPow", 0.6))
    val faceOn = o.num("faceOn", 0.0) != 0.0

    val dots = ArrayList<Dot>()
    ghostSphere(dots, o.num("ghostN", 150.0), r, rs, pt)

    val ya = t * 0.24 * spin
    val ta = if (faceOn) -camTilt else 0.55 + 0.3 * sin(t * 0.18) * spin
    val ux = cos(ya)
    val uy = 0.0
    val uz = sin(ya)
    val vx = -uz * sin(ta)
    val vy = cos(ta)
    val vz = ux * sin(ta)
    val nx = uy * vz - uz * vy
    val ny = uz * vx - ux * vz
    val nz = ux * vy - uy * vx

    // Face-on lobes swell past R, so the base radius comes in by most of the wobble amplitude.
    val wobMul = o.num("wobMul", 1.0)
    val wobAmp = 0.23 * wobMul
    val baseR = if (faceOn) r / (1 + 0.85 * wobAmp) else r

    val baseLanes = o.num("lanes", 5.0)
    val segs = o.num("segs", 88.0)
    val lanes = max(1.0, jsRound(baseLanes * o.num("bandMul", 1.0)))
    var w = 0
    while (w < lanes) {
        val laneOff = (w - (lanes - 1) / 2) * 0.075
        val edge = abs(w - (lanes - 1) / 2) / max(1.0, (lanes - 1) / 2)
        var k = 0
        while (k < segs) {
            val a = (k / segs) * 2 * Math.PI
            val wob = (0.16 * sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * sin(a * 5 + t * 1.1)) * wobMul
            val radial = if (faceOn) 1 + wob else 1.0
            val off = if (faceOn) laneOff else laneOff + wob
            val x = ux * cos(a) + vx * sin(a) + nx * off
            val y = uy * cos(a) + vy * sin(a) + ny * off
            val z = uz * cos(a) + vz * sin(a) + nz * off
            val l = sqrt(x * x + y * y + z * z)
            val rr = baseR * radial
            pt.project((x / l) * rr, (y / l) * rr, (z / l) * rr)
            val depth = (pt.z / r + 1) / 2
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = pt.z,
                    r = (o.num("rBase", 1.1) + o.num("rDepth", 1.7) * depth) * (1 - 0.25 * edge) * rs,
                    white = 0.52 - 0.44 * depth + 0.18 * edge,
                    a = 0.4 + 0.6 * depth,
                ),
            )
            k++
        }
        w++
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}
