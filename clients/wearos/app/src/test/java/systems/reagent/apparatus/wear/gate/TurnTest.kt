package systems.reagent.apparatus.wear.gate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The completeness heuristic reads text as web/src/gate/turn.ts does (node 22). */
class TurnTest {

    @Test
    fun heuristicCompletenessReadsTextLikeTheWeb() {
        val model = HeuristicCompleteness
        assertTrue(model.isComplete(""))
        assertTrue(model.isComplete("   "))
        assertFalse(model.isComplete("Book a flight to"))
        assertTrue(model.isComplete("Book a flight to Paris."))
        assertTrue(model.isComplete("Is it ready?\")"))
        assertFalse(model.isComplete("Well,"))
        assertFalse(model.isComplete("and then..."))
        assertFalse(model.isComplete("so —"))
        assertFalse(model.isComplete("I'M"))
        assertFalse(model.isComplete("call (the"))
        assertTrue(model.isComplete("Paris"))
        assertTrue(model.isComplete("---!"))
    }

    /** JS `$` (no m flag) matches only at the end; U+0085 is not JS whitespace, so trim keeps it. */
    @Test
    fun aTrailingNextLineIsTextNotAnEnd() {
        val model = HeuristicCompleteness
        assertTrue(model.isComplete("Well,\u0085"))
        assertFalse(model.isComplete("Book a flight to.\u0085"))
        assertTrue(model.isComplete("so —\u0085"))
        assertEquals("a \u0085", jsTrim(" a \u0085"))
    }

    @Test
    fun theSilenceLimitFollowsTheTranscript() {
        val turn = TurnDetector(silenceCompleteMs = 500.0, silenceIncompleteMs = 2500.0)
        turn.start()
        turn.setTranscript("Well,\u0085")
        var end: TurnEnd? = null
        var ms = 0.0
        while (end == null) {
            ms += 20.0
            end = turn.update(voiced = false, frameMs = 20.0)
        }
        assertEquals(TurnEnd.Complete, end)
        assertEquals(500.0, ms, 1e-9)
    }
}
