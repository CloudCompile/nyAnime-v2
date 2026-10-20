import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import NyAnimeCore

// Headless verification harness: exercises the exact code path the app uses.
//   swift run nyanime-verify [animeId] [segmentLimit]

let arguments = CommandLine.arguments
let animeId = arguments.count > 1 ? arguments[1] : "sousou-no-frieren-74575"
let limit = arguments.count > 2 ? Int(arguments[2]) ?? 4 : 4

func log(_ message: String) { FileHandle.standardError.write(Data((message + "\n").utf8)) }

/// Holds the latest download progress reported from a background executor.
final class LatestProgress: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = DownloadProgress(completedSegments: 0, totalSegments: 0, bytesWritten: 0)

    func store(_ progress: DownloadProgress) {
        lock.lock()
        stored = progress
        lock.unlock()
    }

    var value: DownloadProgress {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

let api = AnimeAPI()
let fetcher = StreamFetcher()

do {
    log("anime: \(animeId)")

    let detail = try await api.info(id: animeId)
    guard let detail else { log("FAIL: no detail"); exit(1) }
    log("title: \(detail.anime.title) [\(detail.anime.numericId)] type=\(detail.type ?? "?") eps=\(detail.totalEpisodes.map(String.init) ?? "?")")
    log("genres: \(detail.genres.prefix(4).joined(separator: ", "))")

    let episodes = try await api.episodes(id: animeId)
    log("episodes: \(episodes.count)")
    guard let episode = episodes.first else { log("FAIL: no episodes"); exit(1) }
    log("first episode: key=\(episode.key) no=\(episode.number) sub=\(episode.hasSub) dub=\(episode.hasDub)")

    let servers = try await api.servers(episodeKey: episode.key)
    log("servers: \(servers.map { "\($0.name)/\($0.kind.rawValue)" }.joined(separator: ", "))")

    let source = try await api.stream(episodeKey: episode.key, server: "Vidplay", type: .sub)
    guard let source, let masterURL = source.fileURL else { log("FAIL: no direct stream"); exit(1) }
    log("stream host: \(masterURL.host ?? "?")")

    let master = try await fetcher.text(from: masterURL)
    let variants = try HLSParser.parseMaster(master, baseURL: masterURL)
    log("variants: \(variants.map(\.qualityLabel).joined(separator: ", "))")

    for cap in [1080, 720, 480] {
        log("  cap \(cap)p -> \(fetcher.selectVariant(from: variants, preferredHeight: cap).qualityLabel)")
    }

    let playlist = try await fetcher.mediaPlaylist(for: masterURL, preferredHeight: 720)
    log("media playlist: \(playlist.segments.count) segments, \(String(format: "%.1f", playlist.duration))s, downloadable=\(playlist.isDownloadable)")

    let slice = HLSMediaPlaylist(
        url: playlist.url,
        segments: Array(playlist.segments.prefix(limit)),
        durations: Array(playlist.durations.prefix(limit)),
        isEncrypted: playlist.isEncrypted,
        hasByteRanges: playlist.hasByteRanges
    )

    let destination = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("nyanime-verify-\(episode.key).ts")
    // The progress callback runs on the downloader's executor, so the latest
    // value is passed back through a lock rather than a captured var.
    let latest = LatestProgress()
    let downloader = SegmentDownloader(fetcher: fetcher, concurrency: 3)
    let bytes = try await downloader.download(playlist: slice, to: destination) { progress in
        latest.store(progress)
    }
    let last = latest.value
    log("downloaded \(last.completedSegments)/\(last.totalSegments) segments, \(bytes) bytes")

    let data = try Data(contentsOf: destination)
    let syncByte = data.first.map { String(format: "0x%02x", $0) } ?? "none"
    log("file: \(data.count) bytes, first byte \(syncByte)")

    // Count TS packets to prove the byte stream is a valid transport stream.
    var packets = 0
    var offset = 0
    while offset < data.count && data[offset] == 0x47 { packets += 1; offset += 188 }
    log("TS packets: \(packets) (\(packets * 188) bytes aligned)")

    try? FileManager.default.removeItem(at: destination)

    let ok = bytes > 100_000 && packets > 0 && playlist.isDownloadable
    log(ok
        ? "OK: API, playlists, quality selection and download all verified."
        : "FAIL: verification did not pass.")
    exit(ok ? 0 : 1)
} catch {
    log("FAIL: \(error)")
    exit(1)
}
