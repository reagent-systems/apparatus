// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887, src/engine/web.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Web: a constellation wires itself. `connecting`. Nodes drift on the sphere under value
 * noise; close pairs grow an edge; packets run between re-picked node pairs.
 */
val frameWeb: ModeFrame = { size, t, o ->
    val cx = size / 2
    val cy = size / 2
    val r = (size / 2) * 0.8 * o.num("spread", 1.0)
    // The projector carries the radius as its scale, so node vectors stay unit length and
    // the distances below are in unit-sphere space.
    val pt = Projector(t * 0.12, 0.32, cx, cy, r)
    val rs = radiusScale(size, o.num("rsPow", 0.6))

    val nodeCount = o.num("nodeN", 30.0)
    val thr = o.num("thr", 0.72)
    val nodeR = o.num("nodeR", 1.4)
    val nodeRDepth = o.num("nodeRDepth", 1.8)

    val n = nodeCount.toInt()
    val nodes = Array(n) { DoubleArray(3) }
    val d = DoubleArray(3)
    for (i in 0 until n) {
        fibDir(i, nodeCount, d)
        val x = d[0] + 0.3 * (vnoise(i * 0.31 + 9, t * 0.24) - 0.5) * 2
        val y = d[1] + 0.3 * (vnoise(i * 0.53 + 27, t * 0.21) - 0.5) * 2
        val z = d[2] + 0.3 * (vnoise(i * 0.77 + 55, t * 0.27) - 0.5) * 2
        val l = sqrt(x * x + y * y + z * z)
        nodes[i][0] = x / l
        nodes[i][1] = y / l
        nodes[i][2] = z / l
    }

    val lines = ArrayList<Line>()
    val dots = ArrayList<Dot>()

    for (i in 0 until n) {
        for (j in i + 1 until n) {
            val dx = nodes[i][0] - nodes[j][0]
            val dy = nodes[i][1] - nodes[j][1]
            val dz = nodes[i][2] - nodes[j][2]
            val dist = sqrt(dx * dx + dy * dy + dz * dz)
            if (dist >= thr) continue
            pt.project(nodes[i][0], nodes[i][1], nodes[i][2])
            val x1 = pt.x
            val y1 = pt.y
            val z1 = pt.z
            pt.project(nodes[j][0], nodes[j][1], nodes[j][2])
            val depth = ((z1 + pt.z) / 2 + 1) / 2
            lines.add(
                Line(
                    x1 = x1,
                    y1 = y1,
                    x2 = pt.x,
                    y2 = pt.y,
                    white = 0.42,
                    a = (1 - dist / thr) * (0.3 + 0.55 * depth),
                    w = max(0.6, o.num("lineW", 0.8) * rs),
                ),
            )
        }
    }

    for (i in 0 until n) {
        pt.project(nodes[i][0], nodes[i][1], nodes[i][2])
        val depth = (pt.z + 1) / 2
        val pulse = 1 + 0.25 * sin(t * 1.4 + i * 2.7)
        dots.add(
            Dot(
                x = pt.x,
                y = pt.y,
                z = pt.z,
                r = (nodeR + nodeRDepth * depth) * pulse * rs,
                white = 0.55 - 0.45 * depth,
            ),
        )
    }

    val signals = o.num("signals", 5.0)
    var s = 0
    while (s < signals) {
        val seg = floor(t * 0.55 + s * 7.31)
        val a = floor(hashD(seg, s * 3.1 + 1.7) * nodeCount).toInt()
        val b = floor(hashD(seg, s * 5.7 + 4.2) * nodeCount).toInt()
        if (a == b) {
            s++
            continue
        }
        val f = frac(t * 0.55 + s * 7.31)
        val x = lerp(nodes[a][0], nodes[b][0], f)
        val y = lerp(nodes[a][1], nodes[b][1], f)
        val z = lerp(nodes[a][2], nodes[b][2], f)
        val l = max(1e-6, sqrt(x * x + y * y + z * z))
        pt.project(x / l, y / l, z / l)
        val depth = (pt.z + 1) / 2
        dots.add(
            Dot(
                x = pt.x,
                y = pt.y,
                z = pt.z,
                r = (nodeR * 1.5 + nodeRDepth * depth) * rs,
                white = 0.05,
                a = 0.5 + 0.5 * depth,
            ),
        )
        s++
    }

    finalizeFrame(dots, lines, o.num("rMin", 0.3))
}
