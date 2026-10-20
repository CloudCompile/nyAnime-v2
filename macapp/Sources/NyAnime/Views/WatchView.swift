import AVKit
import SwiftUI
import NyAnimeCore

/// Watch screen: native playback, server selection, and downloads.
struct WatchView: View {
    let anime: Anime
    let episodes: [Episode]
    @State private var episode: Episode

    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var playback: PlaybackController

    @State private var servers: [StreamServer] = []
    @State private var selectedServer: StreamServer?
    @State private var source: StreamSource?
    @State private var status: LoadStatus = .idle
    @State private var showEpisodeList = false
    @State private var downloadFormat: DownloadFormat = .mp4
    @State private var downloadQuality: Int = 720

    private enum LoadStatus: Equatable {
        case idle, loading, ready, iframeOnly, failed(String)
    }

    init(anime: Anime, episodes: [Episode], startEpisode: Episode) {
        self.anime = anime
        self.episodes = episodes
        _episode = State(initialValue: startEpisode)
    }

    var body: some View {
        VStack(spacing: 0) {
            playerArea
            controls
            Divider()
            downloadBar
        }
        .navigationTitle("\(anime.title) — Episode \(episode.number)")
        .task(id: episode.key) { await loadServers() }
        .task(id: selectedServer?.id) { await loadStream() }
        .onDisappear { playback.stop() }
    }

    // MARK: - Player

    @ViewBuilder
    private var playerArea: some View {
        ZStack {
            Color.black

            switch status {
            case .ready:
                // AVKit's VideoPlayer drives the same AVPlayer instance the
                // controller owns, so the toolbar and keyboard shortcuts stay in
                // sync with it.
                VideoPlayer(player: playback.player)
            case .loading:
                ProgressView().controlSize(.large).tint(.white)
            case .idle:
                Color.clear
            case .iframeOnly:
                VStack(spacing: 12) {
                    Image(systemName: "rectangle.on.rectangle.slash")
                        .font(.system(size: 36))
                        .foregroundStyle(.white.opacity(0.7))
                    Text("This server only offers an embedded player.")
                        .foregroundStyle(.white.opacity(0.85))
                    if let embed = source?.embedURL {
                        Link("Open in Browser", destination: embed)
                            .buttonStyle(.borderedProminent)
                    }
                    Text("Pick another server below for in-app playback.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            case let .failed(message):
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 36))
                        .foregroundStyle(.orange)
                    Text(message)
                        .foregroundStyle(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                    Button("Retry") {
                        Task { await loadStream() }
                    }
                }
            }
        }
        .frame(minHeight: 340)
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
    }

    // MARK: - Transport and server controls

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Button {
                    step(by: -1)
                } label: {
                    Label("Previous", systemImage: "backward.end.fill")
                }
                .disabled(previousEpisode == nil)

                Button {
                    playback.togglePlayPause()
                } label: {
                    Label(playback.isPlaying ? "Pause" : "Play",
                          systemImage: playback.isPlaying ? "pause.fill" : "play.fill")
                }
                .disabled(status != .ready)

                Button {
                    step(by: 1)
                } label: {
                    Label("Next", systemImage: "forward.end.fill")
                }
                .disabled(nextEpisode == nil)

                Spacer()

                Text(timeLabel)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)

                Spacer()

                Button {
                    showEpisodeList.toggle()
                } label: {
                    Label("Episodes", systemImage: "list.bullet")
                }
                .popover(isPresented: $showEpisodeList, arrowEdge: .bottom) {
                    episodeListPopover
                }
            }

            if !servers.isEmpty {
                HStack(spacing: 8) {
                    Text("Server").font(.caption).foregroundStyle(.secondary)

                    // Grouped by sub/dub, then by mirror.
                    Picker("", selection: serverBinding) {
                        ForEach(StreamServer.Kind.pickerOrder, id: \.self) { kind in
                            let matching = servers.filter { $0.kind == kind }
                            if !matching.isEmpty {
                                Section(kind.rawValue.uppercased()) {
                                    ForEach(matching) { server in
                                        Text(server.name).tag(Optional(server))
                                    }
                                }
                            }
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 260)

                    Spacer()
                }
            }
        }
        .padding()
    }

    private var episodeListPopover: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(episodes) { candidate in
                    Button {
                        episode = candidate
                        showEpisodeList = false
                    } label: {
                        HStack {
                            Text("\(candidate.number). \(candidate.title)")
                                .lineLimit(1)
                            Spacer()
                            if candidate.key == episode.key {
                                Image(systemName: "checkmark")
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(width: 320, height: 360)
    }

    // MARK: - Download bar

    private var downloadBar: some View {
        HStack(spacing: 12) {
            Text("Download").font(.callout.weight(.medium))

            Picker("", selection: $downloadFormat) {
                ForEach(DownloadFormat.allCases) { format in
                    Text(format.rawValue.uppercased()).tag(format)
                }
            }
            .labelsHidden()
            .frame(width: 90)

            Picker("", selection: $downloadQuality) {
                Text("1080p").tag(1080)
                Text("720p").tag(720)
                Text("480p").tag(480)
            }
            .labelsHidden()
            .frame(width: 100)

            if let fraction = state.progress[episode.key] {
                ProgressView(value: fraction)
                    .frame(maxWidth: 160)
                Text("\(Int(fraction * 100))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Button("Cancel") { state.cancelDownload(episodeKey: episode.key) }
            } else {
                Button {
                    guard let source else { return }
                    Task {
                        await state.download(
                            anime: anime,
                            episode: episode,
                            source: source,
                            format: downloadFormat,
                            quality: downloadQuality
                        )
                    }
                } label: {
                    Label("Download Episode", systemImage: "arrow.down.circle")
                }
                .disabled(source?.isDirect != true || status != .ready)
            }

            Spacer()

            Text("Streams are 720p in practice; the closest available quality is used.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
    }

    // MARK: - Data

    private var serverBinding: Binding<StreamServer?> {
        Binding(
            get: { selectedServer },
            set: { selectedServer = $0 }
        )
    }

    private var previousEpisode: Episode? {
        guard let index = episodes.firstIndex(where: { $0.key == episode.key }), index > 0 else { return nil }
        return episodes[index - 1]
    }

    private var nextEpisode: Episode? {
        guard let index = episodes.firstIndex(where: { $0.key == episode.key }),
              index + 1 < episodes.count else { return nil }
        return episodes[index + 1]
    }

    private var timeLabel: String {
        "\(clock(playback.currentTime)) / \(clock(playback.duration))"
    }

    private func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, secs)
            : String(format: "%d:%02d", minutes, secs)
    }

    private func step(by offset: Int) {
        let target = offset < 0 ? previousEpisode : nextEpisode
        guard let target else { return }
        playback.stop()
        episode = target
    }

    private func loadServers() async {
        playback.stop()
        source = nil
        status = .loading
        servers = []
        selectedServer = nil
        do {
            let all = try await state.api.servers(episodeKey: episode.key)
            servers = all
            // Prefer a server known to expose a direct HLS link, so playback
            // starts in-app rather than in an embedded player.
            selectedServer = all.first { $0.name == "Vidplay" } ?? all.first
            if all.isEmpty { status = .failed("No servers were offered for this episode.") }
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func loadStream() async {
        guard let server = selectedServer else { return }
        status = .loading
        source = nil
        playback.stop()
        do {
            let resolved = try await state.api.stream(
                episodeKey: episode.key,
                server: server.name,
                type: server.kind
            )
            source = resolved

            guard let resolved else {
                status = .failed("The API returned no stream for this server.")
                return
            }
            guard let masterURL = resolved.fileURL else {
                status = .iframeOnly
                return
            }

            let resumeAt = state.positions[episode.key] ?? 0
            status = .ready
            playback.load(url: masterURL, startAt: resumeAt) { position in
                Task { await state.recordPosition(position, for: episode.key) }
            }
        } catch {
            status = .failed(error.localizedDescription)
        }
    }
}
