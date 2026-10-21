import XCTest
@testable import NyAnimeCore

/// Unit tests for parsing and coercion, using payload shapes copied from the
/// live API.
final class ParsingTests: XCTestCase {

    func testJSONCoercion() throws {
        let json = #"""
        {"string":"12","number":12,"float":12.0,"bool":true,"false":false,
         "empty":"","nested":{"a":[1,2]},"ratio":"Episodes: 12 / 24"}
        """#.data(using: .utf8)!

        let value = try JSONValue.parse(json)
        XCTAssertEqual(value["string"].intValue, 12)
        XCTAssertEqual(value["number"].intValue, 12)
        XCTAssertEqual(value["float"].intValue, 12)
        XCTAssertEqual(value["bool"].boolValue, true)
        XCTAssertEqual(value["false"].boolValue, false)
        XCTAssertEqual(value["empty"].stringOrNil, nil)
        XCTAssertEqual(value["nested"]["a"][1].intValue, 2)
        XCTAssertEqual(value["ratio"].intValue, 24)
        XCTAssertTrue(value["missing"].isNull)
    }

    func testEpisodeCountParsesPaddedSeparator() throws {
        // Regression: the real payload sends "28 / 28" with spaces around the
        // slash. Splitting on "/" and calling Int() on the raw token yields nil.
        XCTAssertEqual(lastNumber(in: "28 / 28"), 28)
        XCTAssertEqual(lastNumber(in: "12/24"), 24)
        XCTAssertEqual(lastNumber(in: "Episodes: 12"), 12)
        XCTAssertEqual(lastNumber(in: "10"), 10)
        XCTAssertNil(lastNumber(in: ""))
        XCTAssertNil(lastNumber(in: "unknown"))

        let json = #"""
        {"data":{"id":"a-1","title":"A","animeInfo":{"Episodes":"28 / 28","Type":"TV"}}}
        """#.data(using: .utf8)!
        let payload = try JSONValue.parse(json)
        let detail = try XCTUnwrap(AnimeDetail.decode(payload, fallbackId: "a-1"))
        XCTAssertEqual(detail.totalEpisodes, 28)
    }

    func testAnimeDecodesTvInfoShape() throws {
        // Shape returned by /api/trending and /api/genre/*.
        let json = #"""
        {"id":"dark-machine-the-animation-82820","data_id":82820,
         "poster":"https://static.aniwaves.ru/resources/thumbnails/200x280/100/a.jpg",
         "title":"Dark Machine: The Animation","japanese_title":"Dark Machine",
         "tvInfo":{"showType":"TV","sub":"24","dub":"0"}}
        """#.data(using: .utf8)!

        let anime = try XCTUnwrap(Anime.decode(try JSONValue.parse(json)))
        XCTAssertEqual(anime.id, "dark-machine-the-animation-82820")
        XCTAssertEqual(anime.dataId, "82820")
        XCTAssertEqual(anime.numericId, "82820")
        XCTAssertEqual(anime.title, "Dark Machine: The Animation")
        XCTAssertEqual(anime.showType, "TV")
        XCTAssertEqual(anime.subEpisodes, 24)
        XCTAssertEqual(anime.posterURL?.host, "static.aniwaves.ru")
    }

    func testAnimeDecodesFlatShape() throws {
        // Shape returned by /api/search/suggest, with no tvInfo.
        let json = #"""
        {"id":"sousou-no-frieren-2nd-season-82499","data_id":"82499",
         "poster":"https://static.aniwaves.ru/x.jpg","title":"Frieren S2",
         "showType":"Unknown","duration":"24 min/ep","episodes":"10"}
        """#.data(using: .utf8)!

        let anime = try XCTUnwrap(Anime.decode(try JSONValue.parse(json)))
        XCTAssertEqual(anime.dataId, "82499")
        XCTAssertEqual(anime.showType, "Unknown")
        XCTAssertEqual(anime.episodeCount, 10)
    }

    func testNumericIdFallsBackToSlug() {
        let anime = Anime(id: "one-piece-81553", title: "One Piece")
        XCTAssertEqual(anime.numericId, "81553")
    }

    func testEpisodeExtractsStreamKey() throws {
        // The episode route wants the `?ep=` portion as the stream key.
        let json = #"""
        {"id":"sousou-no-frieren-74575?ep=74575_1","title":"The Journey's End",
         "japanese_title":"Sousou no Frieren","episode_no":1,"filler":false,
         "subbed":true,"dubbed":true}
        """#.data(using: .utf8)!

        let episode = try XCTUnwrap(Episode.decode(try JSONValue.parse(json)))
        XCTAssertEqual(episode.key, "74575_1")
        XCTAssertEqual(episode.number, 1)
        XCTAssertEqual(episode.title, "The Journey's End")
        XCTAssertTrue(episode.hasSub)
        XCTAssertTrue(episode.hasDub)
        XCTAssertFalse(episode.isFiller)
    }

    func testEpisodeRejectsMissingId() throws {
        let json = #"{"title":"No id"}"#.data(using: .utf8)!
        XCTAssertNil(Episode.decode(try JSONValue.parse(json)))
    }

    func testStreamSourceDecodesDirectLink() throws {
        let json = #"""
        {"streamingLink":{"link":{"file":"https://px.dpopdrop89.store/cdn/abc?t.m3u8&v.m3u8"},
         "server":"Vidplay","type":"sub","intro":[10,25],"outro":[1300,1320]},
         "servers":[{"serverName":"Vidplay","data_id":74575,"server_id":1,"type":"sub"},
                    {"serverName":"BYFMS","data_id":74575,"server_id":2,"type":"sub"}]}
        """#.data(using: .utf8)!

        let source = try XCTUnwrap(StreamSource.decode(try JSONValue.parse(json)))
        XCTAssertTrue(source.isDirect)
        XCTAssertEqual(source.fileURL?.host, "px.dpopdrop89.store")
        XCTAssertEqual(source.intro, [10, 25])
        XCTAssertEqual(source.servers.count, 2)
        XCTAssertEqual(source.servers[0].name, "Vidplay")
    }

    func testStreamSourceDecodesIframeOnly() throws {
        let json = #"""
        {"streamingLink":{"iframe":"https://embed.example/abc","server":"BYFMS","type":"dub"}}
        """#.data(using: .utf8)!

        let source = try XCTUnwrap(StreamSource.decode(try JSONValue.parse(json)))
        XCTAssertFalse(source.isDirect)
        XCTAssertEqual(source.embedURL?.host, "embed.example")
    }
}

final class HLSParsingTests: XCTestCase {

    func testParsesMasterAndSortsByQuality() throws {
        let master = #"""
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-STREAM-INF:BANDWIDTH=671066,RESOLUTION=1280x720
        /cdn/720/index.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1920x1080
        https://cdn.example.com/cdn/1080/index.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=854x480
        /cdn/480/index.m3u8
        """#

        let base = URL(string: "https://ru-ri-cdn3.echovideo.to/cdn/abc?t.m3u8")!
        let variants = try HLSParser.parseMaster(master, baseURL: base)

        XCTAssertEqual(variants.count, 3)
        // Sorted best-first.
        XCTAssertEqual(variants.map(\.height), [1080, 720, 480])
        XCTAssertEqual(variants[0].qualityLabel, "1080p")
        // Relative URIs resolve against the master's origin.
        XCTAssertEqual(variants[1].url.absoluteString, "https://ru-ri-cdn3.echovideo.to/cdn/720/index.m3u8")
        XCTAssertEqual(variants[0].url.absoluteString, "https://cdn.example.com/cdn/1080/index.m3u8")
    }

    func testParsesMediaPlaylist() throws {
        let media = #"""
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:10
        #EXTINF:10.0,
        /cdn/seg0.ts
        #EXTINF:10.0,
        /cdn/seg1.ts
        #EXTINF:9.5,
        https://other.example.com/seg2.ts
        #EXT-X-ENDLIST
        """#

        let base = URL(string: "https://ru-cdn2.echovideo.to/cdn/abc")!
        let playlist = try HLSParser.parseMedia(media, baseURL: base)

        XCTAssertEqual(playlist.segments.count, 3)
        XCTAssertEqual(playlist.duration, 29.5, accuracy: 0.01)
        XCTAssertTrue(playlist.isDownloadable)
        XCTAssertFalse(playlist.isEncrypted)
        XCTAssertEqual(playlist.segments[2].host, "other.example.com")
    }

    func testDetectsEncryptionAndByteRanges() throws {
        let media = #"""
        #EXTM3U
        #EXT-X-KEY:METHOD=AES-128,URI="https://key.example/k"
        #EXTINF:10.0,
        seg0.ts
        #EXT-X-BYTERANGE:1000@0
        #EXTINF:10.0,
        seg1.ts
        """#

        let playlist = try HLSParser.parseMedia(media, baseURL: URL(string: "https://x.example/a")!)
        XCTAssertTrue(playlist.isEncrypted)
        XCTAssertTrue(playlist.hasByteRanges)
        // Encrypted or byte-ranged streams must not be offered for download.
        XCTAssertFalse(playlist.isDownloadable)
    }

    func testIgnoresMethodNoneKey() throws {
        let media = #"""
        #EXTM3U
        #EXT-X-KEY:METHOD=NONE
        #EXTINF:10.0,
        seg0.ts
        """#
        let playlist = try HLSParser.parseMedia(media, baseURL: URL(string: "https://x.example/a")!)
        XCTAssertFalse(playlist.isEncrypted)
        XCTAssertTrue(playlist.isDownloadable)
    }

    func testPlaylistSniffingIgnoresContentType() {
        // The CDN serves playlists as image/jpeg, so detection is body-based.
        XCTAssertTrue(HLSParser.looksLikePlaylist(Data("#EXTM3U\n#EXTINF:1,\na.ts".utf8)))
        XCTAssertTrue(HLSParser.looksLikePlaylist(Data("\u{FEFF}#EXTM3U".utf8)))
        XCTAssertFalse(HLSParser.looksLikePlaylist(Data([0x47, 0x40, 0x11, 0x10])))
    }

    func testRejectsPlaylistWithoutSegments() {
        XCTAssertThrowsError(
            try HLSParser.parseMedia("#EXTM3U\n#EXT-X-ENDLIST", baseURL: URL(string: "https://x.example/a")!)
        )
    }

    func testVariantSelectionPrefersClosestBelowCap() throws {
        let master = #"""
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1920x1080
        a.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720
        b.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=854x480
        c.m3u8
        """#
        let variants = try HLSParser.parseMaster(master, baseURL: URL(string: "https://x.example/m")!)
        let fetcher = StreamFetcher()

        // 720p cap picks 720p, not 1080p.
        XCTAssertEqual(fetcher.selectVariant(from: variants, preferredHeight: 720).height, 720)
        // A 900p cap still picks 720p, the highest at or below it.
        XCTAssertEqual(fetcher.selectVariant(from: variants, preferredHeight: 900).height, 720)
        // No cap keeps the best available.
        XCTAssertEqual(fetcher.selectVariant(from: variants, preferredHeight: nil).height, 1080)
        // A cap below everything falls back to the best available.
        XCTAssertEqual(fetcher.selectVariant(from: variants, preferredHeight: 240).height, 1080)
    }
}

final class LibraryStoreTests: XCTestCase {

    func testRecordsPersistAndDelete() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nyanime-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = LibraryStore(directory: directory)
        let record = DownloadRecord(
            id: "74575_1-mp4",
            animeId: "sousou-no-frieren-74575",
            animeTitle: "Frieren",
            posterURL: nil,
            episodeKey: "74575_1",
            episodeNumber: 1,
            episodeTitle: "The Journey's End",
            format: .mp4,
            quality: "720p",
            fileName: "frieren-1.mp4",
            bytes: 1024
        )
        await store.add(record)

        // A fresh store reading the same directory must see the record.
        let reloaded = LibraryStore(directory: directory)
        let records = await reloaded.all()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].episodeKey, "74575_1")
        XCTAssertEqual(records[0].format, .mp4)

        await reloaded.remove(id: record.id)
        let remaining = await reloaded.all()
        XCTAssertTrue(remaining.isEmpty)
    }

    func testReDownloadReplacesRatherThanDuplicates() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nyanime-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = LibraryStore(directory: directory)
        let id = DownloadRecord.identifier(episodeKey: "74575_1", format: .mp4)
        func record(bytes: Int64) -> DownloadRecord {
            DownloadRecord(
                id: id, animeId: "a", animeTitle: "A", posterURL: nil,
                episodeKey: "74575_1", episodeNumber: 1, episodeTitle: "E1",
                format: .mp4, quality: "720p", fileName: "e1.mp4", bytes: bytes
            )
        }

        await store.add(record(bytes: 100))
        await store.add(record(bytes: 200))

        let records = await store.all()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].bytes, 200)
    }

    func testPositionIgnoresOpeningSeconds() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nyanime-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = LibraryStore(directory: directory)
        await store.setPosition(3, for: "74575_1")
        let early = await store.position(for: "74575_1")
        XCTAssertEqual(early, 0)

        await store.setPosition(120, for: "74575_1")
        let later = await store.position(for: "74575_1")
        XCTAssertEqual(later, 120)
    }

    // MARK: - Server preference

    private func server(_ name: String, kind: StreamServer.Kind = .sub) -> StreamServer {
        StreamServer(kind: kind, name: name, dataId: 1, serverId: 1)
    }

    /// The upstream list is ordered with `DatSaV` first, which is the whole
    /// reason playback used to resolve to an embed-only server by default.
    func testRankPrefersDirectStreamServersOverUpstreamOrder() {
        let upstream = ["DatSaV", "BYFMS", "DGHG", "Vidplay"].map { server($0) }
        let ranked = AnimeAPI.rank(upstream).map(\.name)
        XCTAssertEqual(ranked.first, "Vidplay")
    }

    func testRankPutsUnknownServersLastButKeepsThem() {
        let ranked = AnimeAPI.rank([server("BrandNew"), server("Vidplay")]).map(\.name)
        XCTAssertEqual(ranked, ["Vidplay", "BrandNew"])
    }

    func testRankExcludesTheServerAlreadyTried() {
        let ranked = AnimeAPI.rank([server("DatSaV"), server("Vidplay")], excluding: "DatSaV")
        XCTAssertEqual(ranked.map(\.name), ["Vidplay"])
    }

    /// The upstream list labels every entry `sub`, including ones that serve a
    /// dub, so ranking must not filter on the track kind or it would discard
    /// the only working candidate.
    func testRankKeepsCandidatesRegardlessOfTrackKind() {
        let ranked = AnimeAPI.rank([server("Vidplay", kind: .dub), server("DatSaV", kind: .sub)])
        XCTAssertEqual(ranked.map(\.name), ["Vidplay", "DatSaV"])
    }
}
