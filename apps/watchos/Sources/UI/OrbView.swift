import SwiftUI
import ThinkingOrbsKit

/// The thinking orb from ThinkingOrbsKit (Vendor/ThinkingOrbsKit, the Swift
/// port of thinking-orbs, the library the web client draws its orb with).
/// The 64 preset in its dark theme, light dots on black, drawn at `diameter`
/// points: the kit scales the vectors inside its Canvas, so the dots stay
/// sharp at any size.
///
/// The clock is this view's, so it can do what the web's canvas does:
/// `paused` holds the frame on screen, `still` draws the library's static
/// frame. The kit takes the instant through `orbFrozenTime`, in raw engine
/// seconds: wall-clock seconds times the preset's speed times `speed`, the
/// same product thinking-orbs uses.
struct OrbView: View {
    let render: OrbRender
    let diameter: Double

    var body: some View {
        let state = ThinkingOrbsKit.OrbState(rawValue: render.animation.rawValue) ?? .breathing
        let engineSpeed = resolvePreset(state, .px64).speed * render.speed
        Group {
            if render.still {
                orb(state).orbFrozenTime(OrbRender.staticFrameT)
            } else {
                TimelineView(.animation(minimumInterval: nil, paused: render.paused)) { timeline in
                    orb(state).orbFrozenTime(timeline.date.timeIntervalSinceReferenceDate * engineSpeed)
                }
            }
        }
        .opacity(render.dimmed ? OrbRender.dimmedOpacity : 1)
    }

    private func orb(_ state: ThinkingOrbsKit.OrbState) -> some View {
        ThinkingOrb(state: state, size: .px64, theme: .dark, speed: render.speed, displaySize: diameter)
    }
}
