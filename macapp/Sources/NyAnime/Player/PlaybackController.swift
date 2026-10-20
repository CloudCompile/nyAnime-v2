import AVFoundation
import AVKit
import Combine
import Foundation
import NyAnimeCore

/// Wraps `AVPlayer` for the SwiftUI layer.
///
/// Playback is handled entirely by AVFoundation, so there is no web view and no
/// JavaScript runtime in the app. The periodic time observer is the only timer
/// in the app, and it is removed whenever playback stops, so an idle window
/// schedules no work at all.
@MainActor
final class PlaybackController: ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published var volume: Double = 1 {
        didSet { player.volume = Float(volume) }
    }

    let player = AVPlayer()

    private var timeObserver: Any?
    private var statusCancellable: AnyCancellable?
    private var rateCancellable: AnyCancellable?
    /// Called with the latest position so progress can be persisted.
    private var onProgress: ((Double) -> Void)?

    init() {
        player.actionAtItemEnd = .pause
        // Do not keep a video output pipeline alive for audio-only or paused
        // playback; this keeps GPU work near zero while paused.
        player.automaticallyWaitsToMinimizeStalling = true

        rateCancellable = player.publisher(for: \.rate)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] rate in
                // The sink closure is not main-actor isolated, so hop back
                // explicitly rather than assuming the queue.
                Task { @MainActor [weak self] in
                    self?.isPlaying = rate > 0
                }
            }
    }

    // MARK: - Loading

    /// Start playing an HLS stream.
    func load(url: URL, startAt: Double = 0, onProgress: ((Double) -> Void)? = nil) {
        self.onProgress = onProgress
        currentTime = startAt
        duration = 0

        // Request headers for AVPlayer. `AVURLAssetHTTPHeaderFieldsKey` is the
        // documented-for-private-use key; it is the only way to attach headers to
        // native playback. The CDN serves without them today, so playback works
        // either way, but this keeps it working if the referer is enforced.
        let options: [String: Any] = [
            "AVURLAssetHTTPHeaderFieldsKey": StreamFetcher.playbackHeaders
        ]
        let asset = AVURLAsset(url: url, options: options)
        let item = AVPlayerItem(asset: asset)

        statusCancellable = item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    switch status {
                    case .readyToPlay:
                        self.duration = item.duration.seconds.isFinite ? item.duration.seconds : 0
                        if startAt > 0 { self.seek(to: startAt) }
                        self.play()
                    case .failed:
                        // The item's error is surfaced by the view, which reads
                        // `player.currentItem?.error`.
                        break
                    default:
                        break
                    }
                }
            }

        player.replaceCurrentItem(with: item)
        installTimeObserver()
    }

    func stop() {
        saveProgress()
        player.replaceCurrentItem(with: nil)
        removeTimeObserver()
        isPlaying = false
        statusCancellable = nil
        onProgress = nil
    }

    // MARK: - Transport

    func play() {
        // Re-assert the audio session behaviour is left to the system; nothing
        // to configure on macOS.
        player.play()
    }

    func pause() {
        player.pause()
        saveProgress()
    }

    func togglePlayPause() {
        isPlaying ? pause() : play()
    }

    func skip(by seconds: Double) {
        seek(to: currentTime + seconds)
    }

    func seek(to seconds: Double) {
        let clamped = max(0, duration > 0 ? min(seconds, duration) : seconds)
        // Zero tolerance avoids decoding every intermediate frame while scrubbing,
        // which is expensive on integrated graphics.
        player.seek(
            to: CMTime(seconds: clamped, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        currentTime = clamped
    }

    // MARK: - Time observation

    private func installTimeObserver() {
        removeTimeObserver()
        // One update per second is enough for a progress bar and keeps the
        // main thread free.
        let interval = CMTime(seconds: 1, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            let seconds = time.seconds
            guard seconds.isFinite else { return }
            // The observer block is not main-actor isolated even though it runs
            // on the main queue, so hop explicitly.
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.currentTime = seconds
                if self.duration == 0, let itemDuration = self.player.currentItem?.duration.seconds,
                   itemDuration.isFinite, itemDuration > 0 {
                    self.duration = itemDuration
                }
                // Persist at most once a second while playing.
                if self.isPlaying { self.onProgress?(seconds) }
            }
        }
    }

    private func removeTimeObserver() {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
    }

    private func saveProgress() {
        if currentTime > 0 { onProgress?(currentTime) }
    }
}
