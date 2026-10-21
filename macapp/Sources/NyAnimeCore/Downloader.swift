import Foundation
#if canImport(FoundationNetworking)
// On Linux, URLSession lives in FoundationNetworking. Importing it
// conditionally lets the package build and test on both platforms.
import FoundationNetworking
#endif

public enum DownloadFormat: String, Sendable, Codable, CaseIterable, Identifiable {
    case mp4
    case ts

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .mp4: return "MP4 (playable in QuickTime)"
        case .ts: return "TS (raw stream)"
        }
    }
}

public struct DownloadProgress: Sendable {
    public let completedSegments: Int
    public let totalSegments: Int
    public let bytesWritten: Int64

    public init(completedSegments: Int, totalSegments: Int, bytesWritten: Int64) {
        self.completedSegments = completedSegments
        self.totalSegments = totalSegments
        self.bytesWritten = bytesWritten
    }

    public var fraction: Double {
        guard totalSegments > 0 else { return 0 }
        return min(1, Double(completedSegments) / Double(totalSegments))
    }
}

public enum DownloadError: Error, LocalizedError {
    case cancelled
    case segmentFailed(index: Int, status: Int)
    case notDownloadable(String)
    case writeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .cancelled: return "The download was cancelled."
        case let .segmentFailed(index, status): return "Segment \(index) failed with HTTP \(status)."
        case let .notDownloadable(reason): return reason
        case let .writeFailed(reason): return "Could not write the download: \(reason)"
        }
    }
}

/// Fetches stream resources with the headers the CDN expects.
public struct StreamFetcher: Sendable {
    public static let referer = "https://play.echovideo.ru/"
    public static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36"

    /// Headers to hand to AVURLAsset so native playback matches what the
    /// downloader sends. The CDN currently serves without them, but they keep
    /// playback working if it starts enforcing the referer.
    public static var playbackHeaders: [String: String] {
        [
            "Referer": referer,
            "Origin": "https://play.echovideo.ru",
            "User-Agent": userAgent,
        ]
    }

    private let session: URLSession

    public init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpMaximumConnectionsPerHost = 6
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 300
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
    }

    public func data(from url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue(Self.referer, forHTTPHeaderField: "Referer")
        request.setValue("https://play.echovideo.ru", forHTTPHeaderField: "Origin")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw AnimeAPIError.badStatus(http.statusCode)
        }
        return data
    }

    public func text(from url: URL) async throws -> String {
        let data = try await data(from: url)
        return String(decoding: data, as: UTF8.self)
    }

    /// Resolve the master playlist to a media playlist, choosing the best
    /// rendition at or below `preferredHeight` when given.
    public func mediaPlaylist(for masterURL: URL, preferredHeight: Int? = nil) async throws -> HLSMediaPlaylist {
        try await resolve(masterURL: masterURL, preferredHeight: preferredHeight).playlist
    }

    /// Like `mediaPlaylist(for:preferredHeight:)` but also reports which
    /// rendition was chosen, so callers do not have to fetch the master twice.
    public func resolve(masterURL: URL, preferredHeight: Int?) async throws -> ResolvedStream {
        let masterText = try await text(from: masterURL)
        guard HLSParser.looksLikePlaylist(Data(masterText.utf8)) else {
            throw HLSParseError.noVariants
        }

        // A master playlist lists renditions; a media playlist lists segments.
        if masterText.contains("#EXT-X-STREAM-INF") {
            let variants = try HLSParser.parseMaster(masterText, baseURL: masterURL)
            let chosen = selectVariant(from: variants, preferredHeight: preferredHeight)
            let mediaText = try await text(from: chosen.url)
            let playlist = try HLSParser.parseMedia(mediaText, baseURL: chosen.url)
            return ResolvedStream(variant: chosen, playlist: playlist)
        }
        let playlist = try HLSParser.parseMedia(masterText, baseURL: masterURL)
        return ResolvedStream(variant: nil, playlist: playlist)
    }

    /// Highest quality not exceeding `preferredHeight`, else the highest
    /// available — the same rule the web app uses.
    public func selectVariant(from variants: [HLSVariant], preferredHeight: Int?) -> HLSVariant {
        guard let preferredHeight else { return variants[0] }
        let capped = variants.filter { $0.height > 0 && $0.height <= preferredHeight }
        return capped.max { $0.height < $1.height } ?? variants[0]
    }
}

/// A resolved rendition and its segment list.
public struct ResolvedStream: Sendable {
    public let variant: HLSVariant?
    public let playlist: HLSMediaPlaylist

    public init(variant: HLSVariant?, playlist: HLSMediaPlaylist) {
        self.variant = variant
        self.playlist = playlist
    }

    /// Quality label for the resolved rendition.
    public var qualityLabel: String { variant?.qualityLabel ?? "Auto" }
}

/// Downloads a media playlist to a single file.
///
/// Segments are fetched a small window at a time and written in order, so peak
/// memory stays around `concurrency` segments rather than the whole episode. An
/// hour-long episode is ~150 segments; buffering them all would cost hundreds of
/// megabytes, which is exactly the kind of pressure this app must avoid.
public struct SegmentDownloader: Sendable {
    private let fetcher: StreamFetcher
    private let concurrency: Int
    private let maxAttempts: Int

    public init(fetcher: StreamFetcher = StreamFetcher(), concurrency: Int = 4, maxAttempts: Int = 3) {
        self.fetcher = fetcher
        self.concurrency = max(1, concurrency)
        self.maxAttempts = max(1, maxAttempts)
    }

    /// Download every segment to `destination`, reporting progress as it goes.
    @discardableResult
    public func download(
        playlist: HLSMediaPlaylist,
        to destination: URL,
        onProgress: (@Sendable (DownloadProgress) -> Void)? = nil
    ) async throws -> Int64 {
        guard playlist.isDownloadable else {
            throw DownloadError.notDownloadable(
                playlist.isEncrypted
                    ? "This stream is encrypted, so it can only be played, not downloaded."
                    : "This stream uses byte ranges, so it can only be played, not downloaded."
            )
        }

        let fileManager = FileManager.default
        try? fileManager.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        // A partially written file from an earlier attempt must not be appended to.
        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }
        guard fileManager.createFile(atPath: destination.path, contents: nil) else {
            throw DownloadError.writeFailed("Could not create \(destination.lastPathComponent).")
        }

        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }

        var written: Int64 = 0
        var completed = 0
        let total = playlist.segments.count

        // A sliding window keeps memory bounded while still overlapping I/O.
        for windowStart in stride(from: 0, to: total, by: concurrency) {
            try Task.checkCancellation()
            let windowEnd = min(windowStart + concurrency, total)

            let parts = try await withThrowingTaskGroup(of: (Int, Data).self) { group in
                for index in windowStart..<windowEnd {
                    let url = playlist.segments[index]
                    group.addTask {
                        let data = try await fetchWithRetry(url, index: index)
                        return (index, data)
                    }
                }
                // Collect, then re-order, so writes always follow playlist order.
                var collected: [(Int, Data)] = []
                for try await result in group { collected.append(result) }
                return collected.sorted { $0.0 < $1.0 }
            }

            for (_, data) in parts {
                try Task.checkCancellation()
                try handle.write(contentsOf: data)
                written += Int64(data.count)
                completed += 1
            }

            onProgress?(DownloadProgress(
                completedSegments: completed,
                totalSegments: total,
                bytesWritten: written
            ))
        }

        return written
    }

    private func fetchWithRetry(_ url: URL, index: Int) async throws -> Data {
        var lastError: Error = DownloadError.segmentFailed(index: index, status: 0)
        for attempt in 1...maxAttempts {
            do {
                return try await fetcher.data(from: url)
            } catch let error as AnimeAPIError {
                lastError = error
                if case .badStatus(let code) = error, code == 404 { throw error }
            } catch {
                lastError = error
            }
            guard attempt < maxAttempts else { break }
            // Back off without spinning: a suspending sleep, not a poll loop.
            let delay = UInt64(250_000_000) * UInt64(attempt)
            try await Task.sleep(nanoseconds: delay)
        }
        throw lastError
    }
}
