import AVKit
import SwiftUI

struct PlayerView: NSViewRepresentable {
    let player: AVPlayer
    var controlsStyle: AVPlayerViewControlsStyle = .inline
    var showsFullScreenToggleButton: Bool = true

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = controlsStyle
        view.showsFullScreenToggleButton = showsFullScreenToggleButton
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
    }
}