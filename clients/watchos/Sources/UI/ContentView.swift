import SwiftUI

/// The whole screen: the thinking orb on black, nothing else. A tap anywhere
/// starts or ends the call. The orb is the one accessible element, a toggle
/// named "Call"; VoiceOver's double tap toggles the call.
struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    /// The orb's diameter as a share of the screen's shorter side.
    private let orbShare = 0.8

    var body: some View {
        GeometryReader { geometry in
            let render = orbRender(OrbInput(
                state: model.orbState,
                held: !model.otherHoldsVoice,
                live: model.inCall,
                reducedMotion: reduceMotion,
                lowPower: isLuminanceReduced
            ))
            ZStack {
                Color.black
                OrbView(render: render, diameter: min(geometry.size.width, geometry.size.height) * orbShare)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Call")
                    .accessibilityValue(model.inCall ? "On" : "Off")
                    .accessibilityAddTraits(.isToggle)
                    .accessibilityAction { model.toggleCall() }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .contentShape(Rectangle())
            .onTapGesture { model.toggleCall() }
        }
        .ignoresSafeArea()
        .background(Color.black)
        .onAppear { model.connect() }
    }
}
