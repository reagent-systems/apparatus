import XCTest
@testable import ApparatusWatch

/// Mirrors apps/web/test/reply-latch.test.ts.
final class ReplyLatchTests: XCTestCase {
    func testABargeInMutesTheRestOfTheReply() {
        var latch = ReplyLatch()
        XCTAssertTrue(latch.audio())
        latch.interrupt()
        XCTAssertFalse(latch.audio())
        latch.end()
        XCTAssertTrue(latch.audio())
    }

    func testABargeInWithNoReplyArrivingMutesNothing() {
        var latch = ReplyLatch()
        latch.interrupt()
        XCTAssertTrue(latch.audio())
    }
}
