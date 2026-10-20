import XCTest
@testable import NyAnimeCore

/// Collects progress reported from a background executor.
///
/// The downloader invokes its callback off the calling thread, so the array
/// needs a lock; capturing a bare `var` trips the concurrency checker.
private final class ProgressCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [DownloadProgress] = []

    func append(_ progress: DownloadProgress) {
        lock.lock()
        stored.append(progress)
        lock.unlock()
    }

    var updates: [DownloadProgress] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

/// Tests that talk to the real API and CDN.
///
/// Skipped by default so the suite stays hermetic. Run with:
///   NYANIME_LIVE_TESTS=1 swift test --filter LiveTests
final class LiveTests: XCTestCase {

    /// A single long-lived fetcher shared by every live test.
    ///
    /// Foundation's URLSession is backed by libcurl on Linux, and tearing an
    /// ephemeral session down while a multi handle is still unwinding trips an
    /// assertion (`_MultiHandle deallocated with non-zero retain count`). Holding
    /// one session for the lifetime of the process avoids that teardown race and
    /// also mirrors how the app uses a single shared session. macOS uses the
    /// native URLSession and is unaffected either way.
    private static let sharedFetcher = StreamFetcher()

    private var fetcher: StreamFetcher { Self.sharedFetcher }

    private var enabled: Bool {
        ProcessInfo.processInfo.environment["NYANIME_LIVE_TESTS"] == "1"
    }

    private func requireLive() throws {
        try XCTSkipUnless(enabled, "Set NYANIME_LIVE_TESTS=1 to run live API tests.")
    }

    func testHomeFeedDecodesRealPayload() async throws {
        try requireLive()
        let feed = try await AnimeAPI().home()

        XCTAssertFalse(feed.trending.isEmpty, "expected a trending list")
        XCTAssertFalse(feed.genres.isEmpty, "expected genres")
        let first = try XCTUnwrap(feed.trending.first)
        XCTAssertFalse(first.title.isEmpty)
        XCTAssertFalse(first.numericId.isEmpty, "every entry needs a numeric id for routing")
        XCTAssertNotNil(first.posterURL)
    }

    func testSearchAndInfoResolveToStreamableAnime() async throws {
        try requireLive()
        let api = AnimeAPI()

        let results = try await api.search(keyword: "frieren")
        XCTAssertFalse(results.isEmpty, "search returned nothing")

        let hit = try XCTUnwrap(results.first)
        let detail = try await api.info(id: hit.id)
        let resolved = try XCTUnwrap(detail, "info returned nothing for \(hit.id)")
        XCTAssertFalse(resolved.anime.title.isEmpty)
        XCTAssertNotNil(resolved.totalEpisodes)

        let episodes = try await api.episodes(id: hit.id)
        XCTAssertFalse(episodes.isEmpty, "no episodes for \(hit.id)")
        let episode = try XCTUnwrap(episodes.first)
        XCTAssertFalse(episode.key.isEmpty, "episode is missing its stream key")
    }

    func testBrowsePaginationReportsMorePages() async throws {
        try requireLive()
        let page = try await AnimeAPI().browse(route: "genre/action", page: 1)
        XCTAssertFalse(page.items.isEmpty)
        // Regression guard: category routes send `totalPages`, not `totalPage`.
        // Reading the wrong key left pagination stuck on page 1.
        XCTAssertGreaterThan(page.totalPages, 1, "totalPages was not read from the category route")
        XCTAssertTrue(page.hasNextPage)
    }

    func testFilterPaginationUsesSnakeCaseField() async throws {
        try requireLive()
        // /api/filter is the one route that sends `totalPage`.
        let page = try await AnimeAPI().filter(FilterParams(keyword: "naruto"))
        XCTAssertFalse(page.items.isEmpty)
        XCTAssertGreaterThanOrEqual(page.totalPages, 1)
    }

    func testResolveDirectStreamAndParseRealPlaylists() async throws {
        try requireLive()
        let api = AnimeAPI()

        let episodes = try await api.episodes(id: "sousou-no-frieren-74575")
        let episode = try XCTUnwrap(episodes.first)

        let source = try await api.stream(
            episodeKey: episode.key,
            server: "Vidplay",
            type: .sub
        )
        let resolved = try XCTUnwrap(source, "no stream source")
        XCTAssertTrue(resolved.isDirect, "Vidplay should offer a direct HLS link")
        let masterURL = try XCTUnwrap(resolved.fileURL)

        let fetcher = self.fetcher
        let playlist = try await fetcher.mediaPlaylist(for: masterURL)

        XCTAssertFalse(playlist.segments.isEmpty)
        XCTAssertGreaterThan(playlist.duration, 60, "expected a full episode, not a clip")
        // The CDN serves unencrypted MPEG-TS, so this must be downloadable.
        XCTAssertTrue(playlist.isDownloadable, "live stream unexpectedly needs encryption handling")
        XCTAssertTrue(playlist.segments.allSatisfy { $0.scheme == "https" })
    }

    func testDownloadRealSegmentsToDisk() async throws {
        try requireLive()
        let api = AnimeAPI()
        let fetcher = self.fetcher

        let episodes = try await api.episodes(id: "sousou-no-frieren-74575")
        let episode = try XCTUnwrap(episodes.first)
        let source = try await api.stream(episodeKey: episode.key, server: "Vidplay", type: .sub)
        let masterURL = try XCTUnwrap(try XCTUnwrap(source).fileURL)

        let full = try await fetcher.mediaPlaylist(for: masterURL, preferredHeight: 720)

        // Exercise the real download path without fetching an entire episode.
        let slice = HLSMediaPlaylist(
            url: full.url,
            segments: Array(full.segments.prefix(4)),
            durations: Array(full.durations.prefix(4)),
            isEncrypted: full.isEncrypted,
            hasByteRanges: full.hasByteRanges
        )

        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("nyanime-live-\(UUID().uuidString).ts")
        defer { try? FileManager.default.removeItem(at: destination) }

        let collector = ProgressCollector()
        let downloader = SegmentDownloader(fetcher: fetcher, concurrency: 2)
        let bytes = try await downloader.download(playlist: slice, to: destination) { progress in
            collector.append(progress)
        }

        let updates = collector.updates
        XCTAssertGreaterThan(bytes, 100_000, "downloaded data looks too small")
        XCTAssertFalse(updates.isEmpty, "no progress was reported")
        XCTAssertEqual(updates.last?.completedSegments, 4)

        // Every MPEG-TS packet starts with the 0x47 sync byte; a wrong or
        // error-page response would not.
        let data = try Data(contentsOf: destination)
        XCTAssertEqual(data.count, Int(bytes))
        XCTAssertEqual(data[0], 0x47, "output is not MPEG-TS")
    }

    func testQualityCapSelectsRealLowerRendition() async throws {
        try requireLive()
        let api = AnimeAPI()
        let fetcher = self.fetcher

        let episodes = try await api.episodes(id: "sousou-no-frieren-74575")
        let episode = try XCTUnwrap(episodes.first)
        let source = try await api.stream(episodeKey: episode.key, server: "Vidplay", type: .sub)
        let masterURL = try XCTUnwrap(try XCTUnwrap(source).fileURL)

        let master = try await fetcher.text(from: masterURL)
        let variants = try HLSParser.parseMaster(master, baseURL: masterURL)
        XCTAssertFalse(variants.isEmpty)

        let capped = fetcher.selectVariant(from: variants, preferredHeight: 480)
        XCTAssertLessThanOrEqual(capped.height, 480)
    }
}
