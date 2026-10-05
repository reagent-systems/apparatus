package systems.reagent.apparatus.wear.audio

/**
 * Port of web/src/live/reply-latch.ts. A barge-in silences the rest of the agent's reply:
 * playback stops at once, but the Live session keeps sending the reply's audio until the turn
 * ends; without the latch that audio would play again. Called from the capture thread (a
 * barge-in) and the main thread (Live events).
 */
class ReplyLatch {
    private var replying = false
    private var muted = false

    /** One audio chunk of the reply arrived. True when it may play. */
    @Synchronized
    fun audio(): Boolean {
        replying = true
        return !muted
    }

    /** The user interrupted. Mutes the reply only while one is still arriving. */
    @Synchronized
    fun interrupt() {
        if (replying) muted = true
    }

    /** `generationComplete`, `turnComplete`, `interrupted` or a closed session: the reply is over. */
    @Synchronized
    fun end() {
        replying = false
        muted = false
    }
}
