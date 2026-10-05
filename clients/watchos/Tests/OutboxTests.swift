import XCTest
@testable import ApparatusWatch

final class OutboxTests: XCTestCase {
    private func types(_ outbox: Outbox) -> [String] {
        outbox.messages.map { $0["type"] as? String ?? "" }
    }

    func testAFullQueueOfReportsStillTakesTheClaim() {
        var outbox = Outbox(limit: 4)
        for _ in 0..<10 {
            outbox.append(["type": "transcript", "role": "user", "text": "hi", "final": true])
            outbox.append(["type": "live.usage", "audio_in_ms": 20])
        }
        outbox.append(["type": "voice.release"])
        outbox.append(["type": "live.closed", "reason": "user"])
        outbox.append(["type": "voice.claim"])
        XCTAssertEqual(types(outbox), ["live.usage", "voice.release", "live.closed", "voice.claim"])
    }

    func testControlMessagesAreNeverDropped() {
        var outbox = Outbox(limit: 2)
        for _ in 0..<5 { outbox.append(["type": "voice.claim"]) }
        outbox.append(["type": "transcript", "role": "user", "text": "x", "final": true])
        XCTAssertEqual(types(outbox), Array(repeating: "voice.claim", count: 5))
    }

    func testInterimTranscriptsPingsAndStaleHandlesAreNotQueued() {
        var outbox = Outbox(limit: 8)
        outbox.append(["type": "transcript", "role": "agent", "text": "par", "final": false])
        outbox.append(["type": "ping"])
        outbox.append(["type": "live.resumption", "handle": "a"])
        outbox.append(["type": "live.resumption", "handle": "b"])
        XCTAssertEqual(types(outbox), ["live.resumption"])
        XCTAssertEqual(outbox.messages.first?["handle"] as? String, "b")
    }

    func testDrainEmptiesInOrder() {
        var outbox = Outbox(limit: 8)
        outbox.append(["type": "voice.release"])
        outbox.append(["type": "approval.answer", "approval_id": "a1", "approved": true])
        XCTAssertEqual(outbox.drain().map { $0["type"] as? String ?? "" }, ["voice.release", "approval.answer"])
        XCTAssertTrue(outbox.messages.isEmpty)
    }
}
