import ThinkingOrbsKit
import XCTest
@testable import ApparatusWatch

/// The cases of apps/web/test/orb-state.test.ts, plus the low-power display.
final class OrbRenderTests: XCTestCase {
    func testEveryVoiceStateMapsToItsAnimation() {
        let expected: [OrbVoiceState: OrbAnimation] = [
            .idle: .breathing,
            .connecting: .connecting,
            .listening: .listening,
            .speaking: .composing,
            .working: .working,
        ]
        for state in OrbVoiceState.allCases {
            XCTAssertEqual(OrbAnimation(state), expected[state])
            let r = orbRender(OrbInput(state: state, held: true, live: true))
            XCTAssertEqual(r.animation, expected[state])
            XCTAssertEqual(r.speed, OrbRender.normalSpeed)
            XCTAssertFalse(r.paused)
            XCTAssertFalse(r.dimmed)
            XCTAssertFalse(r.still)
        }
    }

    func testAnimationNamesAreTheLibrarysStateNames() {
        let all: [OrbAnimation] = [.breathing, .connecting, .listening, .composing, .working]
        XCTAssertEqual(all.map(\.rawValue), ["breathing", "connecting", "listening", "composing", "working"])
        for animation in all {
            XCTAssertNotNil(ThinkingOrbsKit.OrbState(rawValue: animation.rawValue), animation.rawValue)
        }
    }

    func testAnotherDeviceHoldsTheVoice() {
        let r = orbRender(OrbInput(state: .listening, held: false, live: false))
        XCTAssertEqual(r.animation, .listening)
        XCTAssertTrue(r.paused)
        XCTAssertTrue(r.dimmed)
        XCTAssertFalse(r.still)
    }

    func testNoCallBreathesSlowly() {
        for state in [OrbVoiceState.idle, .listening, .speaking] {
            let r = orbRender(OrbInput(state: state, held: true, live: false))
            XCTAssertEqual(r.animation, .breathing)
            XCTAssertEqual(r.speed, OrbRender.slowSpeed)
            XCTAssertFalse(r.paused)
            XCTAssertFalse(r.dimmed)
        }
    }

    func testConnectingAndWorkingShowWithNoCall() {
        XCTAssertEqual(orbRender(OrbInput(state: .connecting, held: true, live: false)).animation, .connecting)
        let working = orbRender(OrbInput(state: .working, held: true, live: false))
        XCTAssertEqual(working.animation, .working)
        XCTAssertEqual(working.speed, OrbRender.normalSpeed)
    }

    func testReducedMotionDrawsTheStaticFrameWithoutDimming() {
        let r = orbRender(OrbInput(state: .speaking, held: true, live: true, reducedMotion: true))
        XCTAssertEqual(r.animation, .composing)
        XCTAssertTrue(r.paused)
        XCTAssertTrue(r.still)
        XCTAssertFalse(r.dimmed)
    }

    func testLowPowerDisplayDrawsTheStaticFrame() {
        let r = orbRender(OrbInput(state: .listening, held: true, live: true, lowPower: true))
        XCTAssertEqual(r.animation, .listening)
        XCTAssertTrue(r.still)
        XCTAssertFalse(r.dimmed)
        let other = orbRender(OrbInput(state: .idle, held: false, live: false, lowPower: true))
        XCTAssertTrue(other.still)
        XCTAssertTrue(other.dimmed)
    }
}
