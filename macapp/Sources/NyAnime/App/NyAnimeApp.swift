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
