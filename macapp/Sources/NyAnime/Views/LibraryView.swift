import AppKit
import AVKit
import SwiftUI
import NyAnimeCore

/// Downloaded episodes, playable offline.
struct LibraryView: View {
    @EnvironmentObject private var state: AppState
    @State private var playing: DownloadRecord?

    var body: some View {
        Group {
            if state.downloads.isEmpty {
                ContentUnavailableViewCompat(
                    title: "No downloads yet",
                    message: "Episodes you download appear here and play without a connection.",
                    systemImage: "arrow.down.circle"
                )
            } else {
                List {
                    ForEach(state.downloads) { record in
                        DownloadRow(record: record) {
                            play(record)
                        } onReveal: {
                            reveal(record)
                        } onDelete: {
                            Task { await state.deleteDownload(record) }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("Library")
        .toolbar {
            if !state.downloads.isEmpty {
                Button("Open Downloads Folder") {
                    NSWorkspace.shared.open(state.library.mediaDirectory)
                }
            }
        }
        .sheet(item: $playing) { record in
            OfflinePlayerSheet(record: record)
                .environmentObject(state)
        }
        .task { await state.refreshLibrary() }
    }

    private func play(_ record: DownloadRecord) {
        let url = state.library.mediaDirectory.appendingPathComponent(record.fileName)
        guard FileManager.default.fileExists(atPath: url.path) else {
            // The record outlived its file; drop it rather than failing silently.
            Task { await state.deleteDownload(record) }
            return
        }
        playing = record
    }

    private func reveal(_ record: DownloadRecord) {
        let url = state.library.mediaDirectory.appendingPathComponent(record.fileName)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}

struct DownloadRow: View {
    let record: DownloadRecord
    let onPlay: () -> Void
    let onReveal: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            PosterImage(url: record.posterURL.flatMap(URL.init(string:)), width: 40, height: 56)

            VStack(alignment: .leading, spacing: 2) {
                Text(record.animeTitle).font(.callout.weight(.medium)).lineLimit(1)
                Text("Episode \(record.episodeNumber) — \(record.episodeTitle)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(record.format.rawValue.uppercased()) · \(record.quality) · \(byteText)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 0)

            Button {
                onPlay()
            } label: {
                Image(systemName: "play.circle.fill").font(.title2)
            }
            .buttonStyle(.plain)

            Menu {
                Button("Show in Finder", action: onReveal)
                Button("Delete", role: .destructive, action: onDelete)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .frame(width: 24)
        }
        .padding(.vertical, 4)
    }

    private var byteText: String {
        ByteCountFormatter.string(fromByteCount: record.bytes, countStyle: .file)
    }
}

/// Plays a downloaded file from disk.
struct OfflinePlayerSheet: View {
    let record: DownloadRecord
    @EnvironmentObject private var state: AppState
    @StateObject private var playback = PlaybackController()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            PlayerView(player: playback.player)
                .frame(minHeight: 380)

            HStack {
                Button {
                    playback.togglePlayPause()
                } label: {
                    Label(playback.isPlaying ? "Pause" : "Play",
                          systemImage: playback.isPlaying ? "pause.fill" : "play.fill")
                }

                Slider(
                    value: Binding(
                        get: { playback.duration > 0 ? playback.currentTime / playback.duration : 0 },
                        set: { playback.seek(to: $0 * playback.duration) }
                    )
                )

                Text(clock)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)

                Button("Done") { dismiss() }
            }
            .padding()
        }
        .frame(minWidth: 720, minHeight: 500)
        .onAppear {
            let url = state.library.mediaDirectory.appendingPathComponent(record.fileName)
            playback.load(url: url)
        }
        .onDisappear { playback.stop() }
    }

    private var clock: String {
        func format(_ seconds: Double) -> String {
            guard seconds.isFinite, seconds >= 0 else { return "0:00" }
            let total = Int(seconds)
            return String(format: "%d:%02d", total / 60, total % 60)
        }
        return "\(format(playback.currentTime)) / \(format(playback.duration))"
    }
}
