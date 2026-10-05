package systems.reagent.apparatus.wear.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import systems.reagent.apparatus.wear.ui.orb.engine.OrbAnimation

/** Mirrors web/test/orb-state.test.ts. */
class OrbRenderTest {

    @Test
    fun everyVoiceStateMapsToItsThinkingOrbsAnimation() {
        val expected = mapOf(
            OrbState.Idle to "breathing",
            OrbState.Connecting to "connecting",
            OrbState.Listening to "listening",
            OrbState.Speaking to "composing",
            OrbState.Working to "working",
        )
        for ((state, wire) in expected) {
            assertEquals(wire, ANIMATION.getValue(state).wire)
            assertEquals(OrbRender(OrbAnimation.of(wire)!!, NORMAL_SPEED, paused = false, dimmed = false), orbRender(state, held = true, live = true))
        }
    }

    @Test
    fun anotherDeviceHoldsTheVoiceSessionPausedAndDimmed() {
        val r = orbRender(OrbState.Listening, held = false, live = false)
        assertEquals(OrbAnimation.Listening, r.animation)
        assertEquals(true, r.paused)
        assertEquals(true, r.dimmed)
    }

    @Test
    fun noCallBreathesSlowly() {
        for (state in listOf(OrbState.Idle, OrbState.Listening, OrbState.Speaking)) {
            assertEquals(OrbRender(OrbAnimation.Breathing, SLOW_SPEED, paused = false, dimmed = false), orbRender(state, held = true, live = false))
        }
    }

    @Test
    fun connectingAndWorkingShowWithNoCall() {
        assertEquals(OrbAnimation.Connecting, orbRender(OrbState.Connecting, held = true, live = false).animation)
        val working = orbRender(OrbState.Working, held = true, live = false)
        assertEquals(OrbAnimation.Working, working.animation)
        assertEquals(NORMAL_SPEED, working.speed, 0.0)
    }

    @Test
    fun reducedMotionPausesWithoutDimming() {
        val r = orbRender(OrbState.Speaking, held = true, live = true, reducedMotion = true)
        assertEquals(OrbAnimation.Composing, r.animation)
        assertEquals(true, r.paused)
        assertEquals(false, r.dimmed)
    }
}
