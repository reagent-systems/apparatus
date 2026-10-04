import SwiftUI

/// Orb, feed, Talk, Stop. The two button titles are the only text the app
/// owns; every other line on screen was spoken.
struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var talkPressed = false

    var body: some View {
        VStack(spacing: 4) {
            Orb(state: model.state, connected: model.connected)
                .frame(height: 48)
                .padding(.top, 2)

            List(Array(model.feed.suffix(8).enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.footnote)
                    .lineLimit(3)
                    .listRowInsets(EdgeInsets(top: 2, leading: 4, bottom: 2, trailing: 4))
            }
            .listStyle(.plain)
            .frame(maxHeight: .infinity)

            HStack(spacing: 6) {
                talkButton
                stopButton
            }
        }
        .onAppear { model.connect() }
    }

    /// Press and hold. A zero-distance drag reports the touch down and the
    /// touch up, so the turn opens and closes with the finger.
    private var talkButton: some View {
        Text("Talk")
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Color.green.opacity(talkPressed ? 0.9 : 0.35), in: Capsule())
            .contentShape(Capsule())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { _ in
                        guard !talkPressed else { return }
                        talkPressed = true
                        model.pressTalk()
                    }
                    .onEnded { _ in
                        talkPressed = false
                        model.releaseTalk()
                    }
            )
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Talk")
    }

    private var stopButton: some View {
        Button("Stop") { model.stop() }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 40)
            .buttonStyle(.plain)
            .background(Color.red.opacity(0.35), in: Capsule())
            .contentShape(Capsule())
            .accessibilityLabel("Stop")
    }
}
