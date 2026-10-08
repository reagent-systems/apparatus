// Ported from thinking-orbs 0.3.2 (MIT, Copyright (c) 2026 Jakub Antalik),
// github.com/Jakubantalik/Libraries.dev packages/thinking-orbs at 0d44887,
// src/engine/profiles.ts, src/presets.ts and src/engine/registry.ts.
// License text: app/src/main/resources/META-INF/thinking-orbs-LICENSE.txt.
//
// Base profiles, the per-(state, size) tunings, and the scalers that apply them.

package systems.reagent.apparatus.wear.ui.orb.engine

import kotlin.math.max
import kotlin.math.sqrt

/** The nine shipped animations, by the library's state names. */
enum class OrbAnimation(val wire: String) {
    Working("working"),
    Searching("searching"),
    Solving("solving"),
    Listening("listening"),
    Connecting("connecting"),
    Weaving("weaving"),
    Composing("composing"),
    Breathing("breathing"),
    Shaping("shaping"),
    ;

    companion object {
        fun of(wire: String): OrbAnimation? = entries.firstOrNull { it.wire == wire }
    }
}

enum class ModeKey(val wire: String, val frame: ModeFrame) {
    Orbits("orbits", frameOrbits),
    Globe("globe", frameGlobe),
    Rubik("rubik", frameRubik),
    Wave("wave", frameWave),
    Web("web", frameWeb),
    Braid("braid", frameBraid),
    Ribbon("ribbon", frameRibbon),
    // ring shares ribbon's geometry; the `faceOn` profile flag switches it
    Ring("ring", frameRibbon),
    Morph("morph", frameMorph),
}

val STATE_TO_MODE: Map<OrbAnimation, ModeKey> = mapOf(
    OrbAnimation.Working to ModeKey.Orbits,
    OrbAnimation.Searching to ModeKey.Globe,
    OrbAnimation.Solving to ModeKey.Rubik,
    OrbAnimation.Listening to ModeKey.Wave,
    OrbAnimation.Connecting to ModeKey.Web,
    OrbAnimation.Weaving to ModeKey.Braid,
    OrbAnimation.Composing to ModeKey.Ribbon,
    OrbAnimation.Breathing to ModeKey.Ring,
    OrbAnimation.Shaping to ModeKey.Morph,
)

// 2-D lattices come in pairs: each side takes sqrt(scale), so the total count scales by
// `scale`. Flat lists scale linearly. `iconD` sets the morph outline's sampling density.
private val COUNT_PAIRS = listOf("latRings" to "lonDensity", "rings" to "lonDensity", "lanes" to "segs")
private val COUNT_KEYS = listOf("orbitN", "ghostN", "nodeN", "strandN", "signals")
private val ICON_DENSITY_KEYS = listOf("iconD")
private val RADIUS_KEYS = listOf("rBase", "rDepth", "rActive", "rDot", "ghostR", "partR", "partRDepth", "nodeR", "nodeRDepth")

fun scaleCounts(opts: ModeOpts, scale: Double): ModeOpts {
    val out = LinkedHashMap(opts)
    val done = HashSet<String>()
    val rt = sqrt(scale)
    for ((a, b) in COUNT_PAIRS) {
        val va = out[a]
        val vb = out[b]
        if (va != null && vb != null && a !in done && b !in done) {
            out[a] = max(2.0, jsRound(va * rt))
            out[b] = max(2.0, jsRound(vb * rt))
            done.add(a)
            done.add(b)
        }
    }
    for (k in COUNT_KEYS) {
        val v = out[k]
        // 0 means the mode opted out of that layer (ring has no ghost sphere): keep it 0.
        if (v != null && v != 0.0 && k !in done) out[k] = max(1.0, jsRound(v * scale))
    }
    for (k in ICON_DENSITY_KEYS) {
        val v = out[k]
        if (v != null) out[k] = max(0.02, v * scale)
    }
    return out
}

fun scaleRadii(opts: ModeOpts, scale: Double): ModeOpts {
    val out = LinkedHashMap(opts)
    for (k in RADIUS_KEYS) {
        val v = out[k]
        if (v != null) out[k] = v * scale
    }
    // Spacing-derived radii (the morph outline) read the multiplier itself.
    out["rSizeMul"] = (out["rSizeMul"] ?: 1.0) * scale
    return out
}

/** Base (fine) profiles per mode, before preset multipliers. */
val BASE_PROFILES: Map<ModeKey, ModeOpts> = mapOf(
    ModeKey.Globe to linkedMapOf(
        "latRings" to 17.0, "lonDensity" to 44.0, "rBase" to 0.6, "rDepth" to 1.7, "rBoost" to 1.0,
        "inkFar" to 0.62, "inkSpan" to 0.54, "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Orbits to linkedMapOf(
        "orbitN" to 12.0, "ghostN" to 40.0, "ghostR" to 0.9, "ghostA" to 0.5, "particles" to 3.0,
        "partR" to 1.2, "partRDepth" to 1.6, "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Rubik to linkedMapOf(
        "latRings" to 15.0, "lonDensity" to 40.0, "moveCount" to 14.0, "rBase" to 0.6, "rDepth" to 1.7,
        "rActive" to 0.3, "inkFar" to 0.62, "inkSpan" to 0.54, "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Wave to linkedMapOf(
        "rings" to 15.0, "lonDensity" to 40.0, "rBase" to 0.6, "rDepth" to 1.7, "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Web to linkedMapOf(
        "nodeN" to 30.0, "thr" to 0.72, "signals" to 5.0, "nodeR" to 1.4, "nodeRDepth" to 1.8,
        "lineW" to 0.8, "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Braid to linkedMapOf(
        "strandN" to 52.0, "turns" to 3.0, "ghostN" to 150.0, "rBase" to 1.2, "rDepth" to 1.8,
        "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Ribbon to linkedMapOf(
        "lanes" to 5.0, "segs" to 88.0, "ghostN" to 150.0, "rBase" to 1.1, "rDepth" to 1.7,
        "rsPow" to 0.6, "rMin" to 0.3,
    ),
    // ring: face-on, the undulation on the radius, no ghost sphere behind it
    ModeKey.Ring to linkedMapOf(
        "lanes" to 5.0, "segs" to 88.0, "ghostN" to 0.0, "faceOn" to 1.0, "rBase" to 1.1, "rDepth" to 1.7,
        "rsPow" to 0.6, "rMin" to 0.3,
    ),
    ModeKey.Morph to linkedMapOf("rDot" to 0.021, "iconD" to 1.0, "rMin" to 0.25),
)

/** `count` and `size` multiply the base profile; `speed` multiplies the clock. */
class Preset(val speed: Double, val count: Double, val size: Double, val extra: ModeOpts = emptyMap())

/** Sizes in px: 64 and 20 are hand-tuned; 32 is interpolated upstream. */
val PRESETS: Map<ModeKey, Map<Int, Preset>> = mapOf(
    ModeKey.Orbits to mapOf(
        64 to Preset(1.885, 1.0, 1.0),
        32 to Preset(2.9072, 0.4251, 1.6849),
        20 to Preset(3.9, 0.238, 2.4),
    ),
    ModeKey.Globe to mapOf(
        64 to Preset(2.015, 0.42, 1.15, mapOf("scanMul" to 4.08, "dimBase" to 0.45)),
        32 to Preset(2.3803, 0.1839, 1.4769, mapOf("scanMul" to 4.2301, "dimBase" to 0.45)),
        20 to Preset(2.665, 0.105, 1.75, mapOf("scanMul" to 4.335, "dimBase" to 0.45)),
    ),
    ModeKey.Rubik to mapOf(
        64 to Preset(1.82, 0.35, 1.05),
        32 to Preset(1.8964, 0.1537, 1.4951),
        20 to Preset(1.95, 0.088, 1.9),
    ),
    ModeKey.Wave to mapOf(
        64 to Preset(4.388, 0.341, 1.0),
        32 to Preset(4.1512, 0.169, 1.3232),
        20 to Preset(3.998, 0.105, 1.6),
    ),
    ModeKey.Web to mapOf(
        64 to Preset(3.315, 1.35, 0.95),
        32 to Preset(5.0104, 0.4942, 1.2571),
        20 to Preset(6.63, 0.25, 1.52),
    ),
    ModeKey.Braid to mapOf(
        64 to Preset(1.625, 0.5, 1.0),
        32 to Preset(2.2234, 0.2056, 1.2011),
        20 to Preset(2.75, 0.1125, 1.36),
    ),
    ModeKey.Ribbon to mapOf(
        64 to Preset(2.34, 0.25, 0.85, mapOf("spin" to 0.0, "bandMul" to 3.9, "wobMul" to 1.0)),
        32 to Preset(2.7776, 0.0969, 0.9766, mapOf("spin" to 0.0, "bandMul" to 4.49, "wobMul" to 1.0)),
        20 to Preset(3.12, 0.051, 1.073, mapOf("spin" to 0.0, "bandMul" to 4.94, "wobMul" to 1.0)),
    ),
    ModeKey.Ring to mapOf(
        64 to Preset(3.24, 0.25, 0.956, mapOf("spin" to 0.0, "bandMul" to 3.627, "wobMul" to 0.368)),
        32 to Preset(3.5517, 0.0678, 1.31, mapOf("spin" to 0.0, "bandMul" to 3.8265, "wobMul" to 0.4751)),
        20 to Preset(3.78, 0.028, 1.622, mapOf("spin" to 0.0, "bandMul" to 3.968, "wobMul" to 0.565)),
    ),
    ModeKey.Morph to mapOf(
        64 to Preset(2.405, 0.702, 0.395, mapOf("spread" to 1.45)),
        32 to Preset(2.2057, 0.5937, 0.6916, mapOf("spread" to 1.45)),
        20 to Preset(2.08, 0.53, 1.011, mapOf("spread" to 1.45)),
    ),
)

class Resolved(val mode: ModeKey, val speed: Double, val opts: ModeOpts) {
    fun frame(size: Double, t: Double): OrbFrame = mode.frame(size, t, opts)
}

private val cache = HashMap<Pair<OrbAnimation, Int>, Resolved>()

/** Resolves a (state, size) pair to its mode and fully scaled draw options. Sizes: 64, 32, 20. */
fun resolvePreset(state: OrbAnimation, size: Int): Resolved = synchronized(cache) {
    cache.getOrPut(state to size) {
        val mode = STATE_TO_MODE.getValue(state)
        val preset = PRESETS.getValue(mode).getValue(size)
        var opts: ModeOpts = LinkedHashMap(BASE_PROFILES.getValue(mode))
        if (preset.count != 1.0) opts = scaleCounts(opts, preset.count)
        if (preset.size != 1.0) opts = scaleRadii(opts, preset.size)
        if (preset.extra.isNotEmpty()) opts = LinkedHashMap(opts).apply { putAll(preset.extra) }
        Resolved(mode, preset.speed, opts)
    }
}
