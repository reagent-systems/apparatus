/// The C2S messages that wait while the server socket is closed. Pure.
///
/// Bounded by `limit`, and the bound never costs a control message (a voice
/// claim or release, `live.closed`, an approval answer): a lost
/// `voice.claim` leaves a call with the microphone open and no Live session.
/// Interim transcripts are not kept (the final one follows), a newer
/// `live.resumption` replaces the queued one, and when the queue is full the
/// oldest report (transcript, usage, resumption) makes room. Control
/// messages come from taps and answers, so they cannot outgrow the queue.
struct Outbox {
    let limit: Int
    private(set) var messages: [[String: Any]] = []

    init(limit: Int) {
        self.limit = limit
    }

    mutating func append(_ message: [String: Any]) {
        let type = Self.type(message)
        if type == "ping" { return }
        if type == "transcript", message["final"] as? Bool == false { return }
        if type == "live.resumption" { messages.removeAll { Self.type($0) == "live.resumption" } }
        if messages.count >= limit, let oldest = messages.firstIndex(where: Self.isReport) {
            messages.remove(at: oldest)
        }
        if messages.count < limit || !Self.isReport(message) { messages.append(message) }
    }

    /// Everything queued, oldest first; the queue is empty after.
    mutating func drain() -> [[String: Any]] {
        defer { messages.removeAll() }
        return messages
    }

    private static func type(_ message: [String: Any]) -> String {
        message["type"] as? String ?? ""
    }

    private static func isReport(_ message: [String: Any]) -> Bool {
        ["transcript", "live.usage", "live.resumption"].contains(type(message))
    }
}
