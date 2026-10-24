import SwiftUI
import NyAnimeCore

@main
struct NyAnimeApp: App {
    @StateObject private var state = AppState()
    @StateObject private var playback = PlaybackController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .environmentObject(playback)
                .preferredColorScheme(.dark)
                .tint(Color(red: 0.545, green: 0.361, blue: 0.965))
                // A fixed, modest minimum keeps the layout simple and cheap to
                // render on integrated graphics.
                .frame(minWidth: 900, minHeight: 600)
        }
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Playback") {
                Button("Play/Pause") { playback.togglePlayPause() }
                    .keyboardShortcut(.space, modifiers: [])
                Button("Back 10s") { playback.skip(by: -10) }
                    .keyboardShortcut(.leftArrow, modifiers: [])
                Button("Forward 10s") { playback.skip(by: 10) }
                    .keyboardShortcut(.rightArrow, modifiers: [])
            }
        }
    }
}
