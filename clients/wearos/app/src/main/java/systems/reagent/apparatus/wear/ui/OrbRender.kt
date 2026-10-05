// Pure: the orb's render decision from the voice state. Port of web/src/orb-state.ts
// `orbRender`; OrbRenderTest mirrors web/test/orb-state.test.ts.

package systems.reagent.apparatus.wear.ui

import systems.reagent.apparatus.wear.ui.orb.engine.OrbAnimation

enum class OrbState { Idle, Connecting, Listening, Speaking, Working }

data class OrbRender(
    val animation: OrbAnimation,
    /** Multiplier on the preset's baked speed. */
    val speed: Double,
    val paused: Boolean,
    /** Another device holds the voice session. */
    val dimmed: Boolean,
)

val ANIMATION: Map<OrbState, OrbAnimation> = mapOf(
    OrbState.Idle to OrbAnimation.Breathing,
    OrbState.Connecting to OrbAnimation.Connecting,
    OrbState.Listening to OrbAnimation.Listening,
    OrbState.Speaking to OrbAnimation.Composing,
    OrbState.Working to OrbAnimation.Working,
)

const val NORMAL_SPEED = 1.0

/** No call: the Live session is shut and the microphone is off. */
const val SLOW_SPEED = 0.5

/**
 * Precedence: `connecting` (the server socket is down) shows as is; a watch that does not hold
 * the voice session is paused and dimmed; a running job shows `working` even with no call open;
 * otherwise no call breathes slowly.
 *
 * [held]: no other device holds the voice session. [live]: a Live session is open.
 */
fun orbRender(state: OrbState, held: Boolean, live: Boolean, reducedMotion: Boolean = false): OrbRender {
    var animation = ANIMATION.getValue(state)
    var speed = NORMAL_SPEED
    if (state != OrbState.Connecting && state != OrbState.Working && held && !live) {
        animation = OrbAnimation.Breathing
        speed = SLOW_SPEED
    }
    return OrbRender(animation, speed, paused = !held || reducedMotion, dimmed = !held)
}
