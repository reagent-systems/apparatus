import Foundation

/// Pure: the orb's render decision from the voice state. Port of
/// web/src/orb-state.ts (`orbRender`), plus the watch's low-power display.
/// No SwiftUI; `OrbView` hands the result to ThinkingOrbsKit. Tested in
/// Tests/OrbRenderTests.swift.
enum OrbVoiceState: String, CaseIterable {
    case idle, connecting, listening, speaking, working
}

/// The thinking-orbs animations the orb uses. Raw values are the library's
/// state names.
enum OrbAnimation: String {
    case breathing, connecting, listening, composing, working

    init(_ state: OrbVoiceState) {
        switch state {
        case .idle: self = .breathing
        case .connecting: self = .connecting
        case .listening: self = .listening
        case .speaking: self = .composing
        case .working: self = .working
        }
    }
}

struct OrbInput {
    var state: OrbVoiceState
    /// No other device holds the voice session.
    var held: Bool
    /// A Live session is open: a call is on.
    var live: Bool
    /// The viewer asked for reduced motion.
    var reducedMotion = false
    /// watchOS dims the screen (Always On, wrist down): isLuminanceReduced.
    var lowPower = false
}

struct OrbRender: Equatable {
    static let normalSpeed = 1.0
    /// Idle-closed: no call, the microphone is off.
    static let slowSpeed = 0.5
    /// Opacity of the dimmed orb (another device holds the voice session).
    static let dimmedOpacity = 0.35
    /// Engine time of the library's static frame: the web draws `frame(0.6)`
    /// under reduced motion, in raw engine seconds.
    static let staticFrameT = 0.6

    var animation: OrbAnimation
    /// Multiplier on the preset's baked speed.
    var speed: Double
    /// The clock stops: the frame on screen stays.
    var paused: Bool
    /// Another device holds the voice session.
    var dimmed: Bool
    /// Draw the library's static frame (`staticFrameT`), not a moving one.
    var still: Bool
}

/// Precedence, as on the web: `connecting` (the server socket is down) shows
/// as is; a device that does not hold the voice session is paused and
/// dimmed; a running job shows `working` even with no call; otherwise no
/// call breathes slowly. Reduced motion and the low-power display draw the
/// static frame.
func orbRender(_ input: OrbInput) -> OrbRender {
    var animation = OrbAnimation(input.state)
    var speed = OrbRender.normalSpeed
    if input.state != .connecting && input.state != .working && input.held && !input.live {
        animation = .breathing
        speed = OrbRender.slowSpeed
    }
    let still = input.reducedMotion || input.lowPower
    return OrbRender(animation: animation, speed: speed, paused: !input.held || still,
                     dimmed: !input.held, still: still)
}
