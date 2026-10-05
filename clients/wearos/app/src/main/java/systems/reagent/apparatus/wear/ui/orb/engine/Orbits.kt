// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887, src/engine/orbits.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** Orbits: particles on tilted orbits, ghost paths behind them. `working`. */
val frameOrbits: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.82
    val pt = Projector(t * 0.12, 0.3, cx, cy, 1.0)
    val rs = radiusScale(size, o.num("rsPow", 0.6))

    val dots = ArrayList<Dot>()
    val orbitN = o.num("orbitN", 12.0)
    val ghostN = o.num("ghostN", 40.0)
    val particles = o.num("particles", 3.0)

    var orb = 0
    while (orb < orbitN) {
        val h1 = hashD(orb, 1.7)
        val h2 = hashD(orb, 5.2)
        val h3 = hashD(orb, 8.9)
        val ro = r * (0.45 + 0.52 * h1)
        val th = h1 * 2 * Math.PI
        val phi = acos(2 * h2 - 1)
        // orbit plane basis (u, v perpendicular to the normal n)
        val nx = sin(phi) * cos(th)
        val ny = cos(phi)
        val nz = sin(phi) * sin(th)
        var ux = -ny
        var uy = nx
        val uz = 0.0
        val ul = max(1e-6, sqrt(ux * ux + uy * uy))
        ux /= ul
        uy /= ul
        val vx = ny * uz - nz * uy
        val vy = nz * ux - nx * uz
        val vz = nx * uy - ny * ux
        val speed = (0.25 + 0.55 * h3) * (if (h3 > 0.5) 1 else -1)

        var k = 0
        while (k < ghostN) {
            val a = (k / ghostN) * 2 * Math.PI
            pt.project(
                (ux * cos(a) + vx * sin(a)) * ro,
                (uy * cos(a) + vy * sin(a)) * ro,
                (uz * cos(a) + vz * sin(a)) * ro,
            )
            val depth = (pt.z / ro + 1) / 2
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = pt.z,
                    r = o.num("ghostR", 0.9) * rs,
                    white = 0.72,
                    a = o.num("ghostA", 0.5) * (0.4 + 0.6 * depth),
                ),
            )
            k++
        }
        var m = 0
        while (m < particles) {
            val a = t * speed + (m / particles) * 2 * Math.PI + h2 * 6
            pt.project(
                (ux * cos(a) + vx * sin(a)) * ro,
                (uy * cos(a) + vy * sin(a)) * ro,
                (uz * cos(a) + vz * sin(a)) * ro,
            )
            val depth = (pt.z / ro + 1) / 2
            dots.add(
                Dot(
                    x = pt.x,
                    y = pt.y,
                    z = pt.z,
                    r = (o.num("partR", 1.2) + o.num("partRDepth", 1.6) * depth) * rs,
                    white = 0.3 - 0.22 * depth,
                ),
            )
            m++
        }
        orb++
    }
    finalizeFrame(dots, emptyList(), o.num("rMin", 0.3))
}
