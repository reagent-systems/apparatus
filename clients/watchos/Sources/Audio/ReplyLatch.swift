/// Port of web/src/live/reply-latch.ts. A barge-in silences the rest of the
/// agent's reply: playback stops at once, but the Live session keeps sending
/// the reply's audio until the turn ends; without the latch that audio would
/// play again. Pure; AppModel calls it on the main actor.
struct ReplyLatch {
    private var replying = false
    private(set) var muted = false

    /// One audio chunk of the reply arrived. True when it may play.
    mutating func audio() -> Bool {
        replying = true
        return !muted
    }

    /// The user interrupted. Mutes the reply only while one is still arriving.
    mutating func interrupt() {
        if replying { muted = true }
    }

    /// `generationComplete`, `turnComplete`, `interrupted` or a closed
    /// session: the reply is over.
    mutating func end() {
        replying = false
        muted = false
    }
}
