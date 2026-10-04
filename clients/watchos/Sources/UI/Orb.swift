import SwiftUI

/// The one state indicator: a circle. Color names the state, motion names
/// activity. No text (design spec, UI rules).
struct Orb: View {
    let state: AppModel.State
    let connected: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: state == .idle)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            ZStack {
                Circle()
                    .fill(color.opacity(0.25))
                    .scaleEffect(haloScale(at: t))
                Circle()
                    .fill(color)
                    .scaleEffect(coreScale(at: t))
            }
            .opacity(connected ? 1 : 0.35)
            .animation(.easeInOut(duration: 0.25), value: state)
            .animation(.easeInOut(duration: 0.4), value: connected)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private var color: Color {
        switch state {
        case .idle: return Color(white: 0.55)
        case .listening: return .green
        case .speaking: return .blue
        case .working: return .orange
        }
    }

    private func coreScale(at t: TimeInterval) -> CGFloat {
        switch state {
        case .idle: return 0.7
        case .listening: return 0.78 + 0.07 * CGFloat(sin(t * 2 * .pi * 1.2))
        case .speaking: return 0.72 + 0.12 * CGFloat(abs(sin(t * 2 * .pi * 2.4)))
        case .working: return 0.7 + 0.03 * CGFloat(sin(t * 2 * .pi * 0.8))
        }
    }

    private func haloScale(at t: TimeInterval) -> CGFloat {
        switch state {
        case .idle: return 0.7
        case .listening: return 0.9 + 0.1 * CGFloat(sin(t * 2 * .pi * 1.2 + .pi / 2))
        case .speaking: return 0.85 + 0.15 * CGFloat(abs(sin(t * 2 * .pi * 1.2)))
        case .working: return 0.8 + 0.2 * CGFloat((sin(t * 2 * .pi * 0.8) + 1) / 2)
        }
    }
}
