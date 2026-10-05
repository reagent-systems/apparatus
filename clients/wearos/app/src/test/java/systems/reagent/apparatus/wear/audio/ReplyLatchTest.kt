package systems.reagent.apparatus.wear.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors web/test/reply-latch.test.ts. */
class ReplyLatchTest {

    @Test
    fun aBargeInMutesTheRestOfTheReply() {
        val latch = ReplyLatch()
        assertTrue(latch.audio())
        latch.interrupt()
        assertFalse(latch.audio())
        latch.end()
        assertTrue(latch.audio())
    }

    @Test
    fun aBargeInWithNoReplyArrivingMutesNothing() {
        val latch = ReplyLatch()
        latch.interrupt()
        assertTrue(latch.audio())
    }
}
