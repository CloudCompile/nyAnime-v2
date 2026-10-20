import Foundation
#if canImport(FoundationNetworking)
// On Linux, URLSession lives in FoundationNetworking. Importing it
// conditionally lets the package build and test on both platforms.
import FoundationNetworking
#endif

public enum AnimeAPIError: Error, LocalizedError {
    case badStatus(Int)
    case notJSON
    case apiMessage(String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case let .badStatus(code): return "The anime API returned HTTP \(code)."
        case .notJSON: return "The anime API returned a response that was not JSON."
        case let .apiMessage(message): return message
        case let .transport(message): return "Could not reach the anime API: \(message)"
        }
    }
}

/// A tiny in-memory cache with a per-entry lifetime.
///
/// The catalogue changes slowly, and every screen would otherwise re-fetch the
/// same listings. Entries are also dropped under memory pressure, which matters
/// on a machine where the app must stay small.
public actor ResponseCache {
    private struct Entry {
        let value: JSONValue
        let expires: Date
    }

    private var entries: [String: Entry] = [:]
    private var order: [String] = []
    private let limit: Int

    public init(limit: Int = 120) {
        self.limit = limit
    }

    func value(for key: String) -> JSONValue? {
        guard let entry = entries[key] else { return nil }
        if entry.expires < Date() {
            entries[key] = nil
            order.removeAll { $0 == key }
            return nil
        }
        return entry.value
    }

    func store(_ value: JSONValue, for key: String, lifetime: TimeInterval) {
        if entries[key] == nil {
            order.append(key)
            // Evict oldest-first once over the limit, so the cache cannot grow
            // without bound during a long browsing session.
            while order.count > limit {
                let oldest = order.removeFirst()
                entries[oldest] = nil
            }
        }
        entries[key] = Entry(value: value, expires: Date().addingTimeInterval(lifetime))
    }

    public func removeAll() {
        entries.removeAll()
        order.removeAll()
    }
}

/// Client for the animeapi instance fronting the aniwaves catalogue.
public final class AnimeAPI: @unchecked Sendable {
    public static let defaultBaseURL = URL(string: "https://animeapi.cjhauser.me")!

    public let baseURL: URL
    private let session: URLSession
    private let cache: ResponseCache

    public init(
        baseURL: URL = AnimeAPI.defaultBaseURL,
        session: URLSession? = nil,
        cache: ResponseCache = ResponseCache()
    ) {
        self.baseURL = baseURL
        self.cache = cache
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            // A small connection pool and short timeouts keep the app from
            // holding sockets or threads open while idle.
            configuration.httpMaximumConnectionsPerHost = 4
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 60
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
    }

    // MARK: - Endpoints

    public func home() async throws -> HomeFeed {
        let results = try await get("/api/")
        return HomeFeed(
            spotlights: results["spotlights"].arrayValue.compactMap(Anime.decode),
            trending: results["trending"].arrayValue.compactMap(Anime.decode),
            topAiring: results["topAiring"].arrayValue.compactMap(Anime.decode),
            mostPopular: results["mostPopular"].arrayValue.compactMap(Anime.decode),
            mostFavorite: results["mostFavorite"].arrayValue.compactMap(Anime.decode),
            latestCompleted: results["latestCompleted"].arrayValue.compactMap(Anime.decode),
            latestEpisode: results["latestEpisode"].arrayValue.compactMap(Anime.decode),
            genres: results["genres"].arrayValue.map(\.stringValue).filter { !$0.isEmpty }
        )
    }

    public func topTen() async throws -> [Anime] {
        let results = try await get("/api/top-ten")
        return results["today"].arrayValue.compactMap(Anime.decode)
    }

    public func search(keyword: String) async throws -> [Anime] {
        let query = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        let results = try await get("/api/search", ["keyword": query])
        return dedupe(results["data"].arrayValue.compactMap(Anime.decode))
    }

    public func suggest(keyword: String) async throws -> [Anime] {
        let query = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        let results = try await get("/api/search/suggest", ["keyword": query])
        return dedupe(results.arrayValue.compactMap(Anime.decode))
    }

    /// Browse a category route such as `genre/action`, `top-airing` or `movie`.
    public func browse(route: String, page: Int = 1) async throws -> ListPage {
        let results = try await get("/api/\(route)", ["page": String(page)])
        return listPage(from: results, requestedPage: page)
    }

    public func filter(_ params: FilterParams) async throws -> ListPage {
        var query: [String: String] = ["page": String(params.page)]
        if let keyword = params.keyword, !keyword.isEmpty { query["keyword"] = keyword }
        if let genre = params.genre, !genre.isEmpty { query["genres"] = genre }
        if let year = params.year, !year.isEmpty { query["sy"] = year }
        if let season = params.season, !season.isEmpty { query["season"] = season }
        if let type = params.type, !type.isEmpty { query["type"] = type }
        if let status = params.status, !status.isEmpty { query["status"] = status }
        let results = try await get("/api/filter", query)
        return listPage(from: results, requestedPage: params.page)
    }

    public func info(id: String) async throws -> AnimeDetail? {
        let results = try await get("/api/info", ["id": id])
        return AnimeDetail.decode(results, fallbackId: id)
    }

    public func episodes(id: String) async throws -> [Episode] {
        let results = try await get("/api/episodes/\(id)")
        return results["episodes"].arrayValue.compactMap(Episode.decode)
    }

    public func servers(episodeKey: String) async throws -> [StreamServer] {
        let results = try await get("/api/servers/\(episodeKey)")
        return results.arrayValue.compactMap(StreamServer.decode)
    }

    /// Resolve a playable stream for an episode.
    ///
    /// When no server is named the API picks the *first* entry in the upstream
    /// list, which is often `DatSaV`. That one usually answers with an embed
    /// page rather than a manifest, so the default frequently resolves to
    /// something AVPlayer cannot play. Ask for the default, and if it comes back
    /// embed-only walk the alternatives in preference order. An explicit choice
    /// is honoured as-is.
    public func stream(
        episodeKey: String,
        server: String? = nil,
        type: StreamServer.Kind? = nil,
        fallback: Bool = false
    ) async throws -> StreamSource? {
        if let server {
            return try await requestStream(
                episodeKey: episodeKey, server: server, type: type, fallback: fallback
            )
        }

        let first = try await requestStream(
            episodeKey: episodeKey, server: nil, type: type, fallback: fallback
        )
        guard let first else { return nil }
        if first.fileURL != nil { return first }

        for candidate in Self.rank(first.servers, excluding: first.server) {
            let next = try await requestStream(
                episodeKey: episodeKey, server: candidate.name, type: type, fallback: fallback
            )
            if let next, next.fileURL != nil { return next }
        }
        return first
    }

    private func requestStream(
        episodeKey: String,
        server: String?,
        type: StreamServer.Kind?,
        fallback: Bool
    ) async throws -> StreamSource? {
        var query: [String: String] = ["id": episodeKey]
        if let server { query["server"] = server }
        if let type { query["type"] = type.rawValue }
        let path = fallback ? "/api/stream/fallback" : "/api/stream"
        let results = try await get(path, query, cacheLifetime: 60)
        return StreamSource.decode(results)
    }

    /// Servers that return a direct manifest, best first. Unlisted names sort
    /// last so a new upstream server is still tried.
    ///
    /// Not filtered by track type: the upstream list labels every entry `sub`
    /// (newer ones `ssub`) whatever the episode actually offers, so filtering
    /// would discard the working candidates for a dub.
    public static func rank(_ servers: [StreamServer], excluding: String? = nil) -> [StreamServer] {
        let preference = ["Vidplay", "MyCloud", "DatSaV", "BYFMS", "DGHG"]
        func position(of server: StreamServer) -> Int {
            preference.firstIndex(of: server.name) ?? preference.count
        }
        return servers
            .filter { $0.name != excluding }
            .sorted { position(of: $0) < position(of: $1) }
    }

    public func randomId() async throws -> String {
        let results = try await get("/api/random/id")
        if case let .string(value) = results { return value }
        return results["id"].stringValue
    }

    public func topSearch() async throws -> [(title: String, id: String)] {
        let results = try await get("/api/top-search")
        return results.arrayValue.compactMap { row in
            let title = row["title"].stringValue
            guard let id = row["link"].stringValue.split(separator: "/").last.map(String.init),
                  !title.isEmpty else { return nil }
            return (title, id)
        }
    }

    // MARK: - Transport

    private func listPage(from results: JSONValue, requestedPage: Int) -> ListPage {
        let currentPage = results["currentPage"].intValue == 0
            ? requestedPage
            : results["currentPage"].intValue
        // Category routes return `totalPages`; `/api/filter` returns `totalPage`.
        let totalPages = results["totalPages"].intValue == 0
            ? max(results["totalPage"].intValue, 1)
            : results["totalPages"].intValue
        let hasNext: Bool
        if case .bool(let value) = results["hasNextPage"] {
            hasNext = value
        } else {
            hasNext = currentPage < totalPages
        }
        return ListPage(
            items: dedupe(results["data"].arrayValue.compactMap(Anime.decode)),
            currentPage: currentPage,
            totalPages: totalPages,
            hasNextPage: hasNext
        )
    }

    /// Fetch and unwrap the `{success, results}` envelope.
    private func get(
        _ path: String,
        _ query: [String: String] = [:],
        cacheLifetime: TimeInterval = 300
    ) async throws -> JSONValue {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else {
            throw AnimeAPIError.transport("Malformed request for \(path).")
        }

        let key = url.absoluteString
        if let cached = await cache.value(for: key) {
            return try unwrap(cached)
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("NyAnime-macOS/1.0", forHTTPHeaderField: "User-Agent")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AnimeAPIError.transport(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw AnimeAPIError.badStatus(http.statusCode)
        }

        let payload: JSONValue
        do {
            payload = try JSONValue.parse(data)
        } catch {
            throw AnimeAPIError.notJSON
        }

        let results = try unwrap(payload)
        await cache.store(payload, for: key, lifetime: cacheLifetime)
        return results
    }

    /// Return the `results` value, surfacing the API's own error message.
    private func unwrap(_ payload: JSONValue) throws -> JSONValue {
        if case .bool(false) = payload["success"] {
            throw AnimeAPIError.apiMessage(payload["message"].stringOrNil ?? "The anime API reported a failure.")
        }
        return payload["results"]
    }

    private func dedupe(_ items: [Anime]) -> [Anime] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.id).inserted }
    }
}

public struct FilterParams: Sendable {
    public var keyword: String?
    public var genre: String?
    public var year: String?
    public var season: String?
    public var type: String?
    public var status: String?
    public var page: Int

    public init(
        keyword: String? = nil,
        genre: String? = nil,
        year: String? = nil,
        season: String? = nil,
        type: String? = nil,
        status: String? = nil,
        page: Int = 1
    ) {
        self.keyword = keyword
        self.genre = genre
        self.year = year
        self.season = season
        self.type = type
        self.status = status
        self.page = page
    }
}
