import Foundation

/// A catalogue entry. `id` is the slug the API routes are keyed by
/// (`sousou-no-frieren-74575`); `dataId` is the numeric upstream id.
public struct Anime: Sendable, Identifiable, Hashable {
    public let id: String
    public let dataId: String
    public let title: String
    public let japaneseTitle: String?
    public let posterURL: URL?
    public let showType: String?
    public let subEpisodes: Int?
    public let dubEpisodes: Int?
    public let episodeCount: Int?
    public let rating: String?
    public let description: String?

    public init(
        id: String,
        dataId: String = "",
        title: String,
        japaneseTitle: String? = nil,
        posterURL: URL? = nil,
        showType: String? = nil,
        subEpisodes: Int? = nil,
        dubEpisodes: Int? = nil,
        episodeCount: Int? = nil,
        rating: String? = nil,
        description: String? = nil
    ) {
        self.id = id
        self.dataId = dataId
        self.title = title
        self.japaneseTitle = japaneseTitle
        self.posterURL = posterURL
        self.showType = showType
        self.subEpisodes = subEpisodes
        self.dubEpisodes = dubEpisodes
        self.episodeCount = episodeCount
        self.rating = rating
        self.description = description
    }

    /// The numeric id the stream and episode routes accept.
    public var numericId: String {
        if !dataId.isEmpty { return dataId }
        // Fall back to the trailing digits of the slug.
        let digits = id.reversed().prefix { $0.isNumber }.reversed()
        return String(digits)
    }

    /// Decode a catalogue row. Fields arrive in two shapes: `tvInfo` on list
    /// rows and flat keys on search results, so both are read.
    public static func decode(_ value: JSONValue) -> Anime? {
        let id = value["id"].stringValue
        guard !id.isEmpty else { return nil }

        let info = value["tvInfo"]
        let poster = value["poster"].stringOrNil ?? value["image"].stringOrNil
        let episodesField = value["episodes"].stringValue

        return Anime(
            id: id,
            dataId: value["data_id"].stringValue.isEmpty
                ? value["dataId"].stringValue
                : value["data_id"].stringValue,
            title: value["title"].stringOrNil ?? value["name"].stringValue,
            japaneseTitle: value["japanese_title"].stringOrNil,
            posterURL: poster.flatMap(URL.init(string:)),
            showType: info["showType"].stringOrNil ?? value["showType"].stringOrNil,
            subEpisodes: info["sub"].intOrNil,
            dubEpisodes: info["dub"].intOrNil,
            episodeCount: episodesField.isEmpty
                ? info["eps"].intOrNil
                : lastNumber(in: episodesField),
            rating: value["rating"].stringOrNil,
            description: value["description"].stringOrNil
        )
    }
}

/// Full detail payload for one anime.
public struct AnimeDetail: Sendable {
    public let anime: Anime
    public let genres: [String]
    public let studios: [String]
    public let producers: [String]
    public let status: String?
    public let duration: String?
    public let aired: String?
    public let premiered: String?
    public let country: [String]
    public let type: String?
    public let score: String?
    public let totalEpisodes: Int?
    public let recommendations: [Anime]
    public let related: [Anime]
    public let popular: [Anime]

    public init(
        anime: Anime,
        genres: [String] = [],
        studios: [String] = [],
        producers: [String] = [],
        status: String? = nil,
        duration: String? = nil,
        aired: String? = nil,
        premiered: String? = nil,
        country: [String] = [],
        type: String? = nil,
        score: String? = nil,
        totalEpisodes: Int? = nil,
        recommendations: [Anime] = [],
        related: [Anime] = [],
        popular: [Anime] = []
    ) {
        self.anime = anime
        self.genres = genres
        self.studios = studios
        self.producers = producers
        self.status = status
        self.duration = duration
        self.aired = aired
        self.premiered = premiered
        self.country = country
        self.type = type
        self.score = score
        self.totalEpisodes = totalEpisodes
        self.recommendations = recommendations
        self.related = related
        self.popular = popular
    }

    public static func decode(_ payload: JSONValue, fallbackId: String) -> AnimeDetail? {
        let data = payload["data"]
        guard case .object = data else { return nil }
        let info = data["animeInfo"]
        let tvInfo = info["tvInfo"]
        let episodesField = info["Episodes"].stringValue

        let base = Anime(
            id: data["id"].stringValue.isEmpty ? fallbackId : data["id"].stringValue,
            dataId: data["data_id"].stringValue.isEmpty
                ? data["dataId"].stringValue
                : data["data_id"].stringValue,
            title: data["title"].stringValue,
            japaneseTitle: data["japanese_title"].stringOrNil,
            posterURL: (data["poster"].stringOrNil).flatMap(URL.init(string:)),
            showType: data["showType"].stringOrNil ?? info["Type"].stringOrNil,
            subEpisodes: tvInfo["sub"].intOrNil,
            dubEpisodes: tvInfo["dub"].intOrNil,
            episodeCount: lastNumber(in: episodesField),
            rating: info["Scores"].stringOrNil,
            description: info["Overview"].stringOrNil
        )

        let total = lastNumber(in: episodesField)
        let premiered = info["Premiered"].arrayValue.first?.stringOrNil

        return AnimeDetail(
            anime: base,
            genres: info["Genre"].arrayValue.map(\.stringValue).filter { !$0.isEmpty },
            studios: info["Studios"].arrayValue.map(\.stringValue).filter { !$0.isEmpty },
            producers: info["Producers"].arrayValue.map(\.stringValue).filter { !$0.isEmpty },
            status: info["Status"].stringOrNil,
            duration: info["Duration"].stringOrNil,
            aired: info["Date aired"].stringOrNil,
            premiered: premiered,
            country: info["Country"].arrayValue.map(\.stringValue).filter { !$0.isEmpty },
            type: info["Type"].stringOrNil,
            score: info["Scores"].stringOrNil,
            totalEpisodes: total,
            recommendations: data["recommended_data"].arrayValue.compactMap(Anime.decode),
            related: data["related_data"].flattened.compactMap(Anime.decode),
            popular: data["popular_data"].arrayValue.compactMap(Anime.decode)
        )
    }
}

/// One episode of an anime.
public struct Episode: Sendable, Identifiable, Hashable {
    /// Composite key the stream route expects, e.g. `74575_1`.
    public let key: String
    /// Full id as returned by the API, e.g. `sousou-no-frieren-74575?ep=74575_1`.
    public let id: String
    public let number: Int
    public let title: String
    public let japaneseTitle: String?
    public let isFiller: Bool
    public let hasSub: Bool
    public let hasDub: Bool

    public init(
        key: String,
        id: String,
        number: Int,
        title: String,
        japaneseTitle: String? = nil,
        isFiller: Bool = false,
        hasSub: Bool = true,
        hasDub: Bool = false
    ) {
        self.key = key
        self.id = id
        self.number = number
        self.title = title
        self.japaneseTitle = japaneseTitle
        self.isFiller = isFiller
        self.hasSub = hasSub
        self.hasDub = hasDub
    }

    public static func decode(_ value: JSONValue) -> Episode? {
        let fullId = value["id"].stringValue
        guard !fullId.isEmpty else { return nil }
        // The API appends `?ep=<dataId>_<n>`; the stream route wants just that part.
        let key = fullId.contains("?ep=")
            ? String(fullId.split(separator: "?ep=").last ?? "")
            : fullId
        guard !key.isEmpty else { return nil }
        let number = value["episode_no"].intValue
        let title = value["title"].stringOrNil ?? "Episode \(number)"
        return Episode(
            key: key,
            id: fullId,
            number: number,
            title: title,
            japaneseTitle: value["japanese_title"].stringOrNil,
            isFiller: value["filler"].boolValue,
            hasSub: value["subbed"].isNull ? true : value["subbed"].boolValue,
            hasDub: value["dubbed"].boolValue
        )
    }
}

/// A mirror offered for an episode.
public struct StreamServer: Sendable, Identifiable, Hashable {
    public enum Kind: String, Sendable, CaseIterable {
        case sub, dub

        /// Display order for a server picker.
        public static let pickerOrder: [Kind] = [.sub, .dub]
    }

    public let kind: Kind
    public let name: String
    public let dataId: Int
    public let serverId: Int

    public var id: String { "\(kind.rawValue)-\(serverId)-\(name)" }

    public init(kind: Kind, name: String, dataId: Int, serverId: Int) {
        self.kind = kind
        self.name = name
        self.dataId = dataId
        self.serverId = serverId
    }

    public static func decode(_ value: JSONValue) -> StreamServer? {
        let name = value["serverName"].stringValue.isEmpty
            ? value["server_name"].stringValue
            : value["serverName"].stringValue
        guard !name.isEmpty else { return nil }
        let kind = value["type"].stringValue.lowercased() == "dub" ? Kind.dub : Kind.sub
        return StreamServer(
            kind: kind,
            name: name,
            dataId: value["data_id"].intValue,
            serverId: value["server_id"].intValue
        )
    }
}

/// A resolved playback source.
public struct StreamSource: Sendable {
    /// Direct HLS master playlist, when the server offers one.
    public let fileURL: URL?
    /// Embed URL, when the server only offers an iframe.
    public let embedURL: URL?
    public let server: String
    public let type: String
    public let intro: [Double]
    public let outro: [Double]
    public let servers: [StreamServer]

    public init(
        fileURL: URL?,
        embedURL: URL?,
        server: String,
        type: String,
        intro: [Double] = [],
        outro: [Double] = [],
        servers: [StreamServer] = []
    ) {
        self.fileURL = fileURL
        self.embedURL = embedURL
        self.server = server
        self.type = type
        self.intro = intro
        self.outro = outro
        self.servers = servers
    }

    public var isDirect: Bool { fileURL != nil }

    public static func decode(_ payload: JSONValue) -> StreamSource? {
        let link = payload["streamingLink"]
        guard case .object = link else { return nil }
        let file = link["link"]["file"].stringOrNil
        let iframe = link["iframe"].stringOrNil
        return StreamSource(
            fileURL: file.flatMap(URL.init(string:)),
            embedURL: iframe.flatMap(URL.init(string:)),
            server: link["server"].stringValue,
            type: link["type"].stringValue,
            intro: link["intro"].arrayValue.map(\.intValue).map(Double.init),
            outro: link["outro"].arrayValue.map(\.intValue).map(Double.init),
            servers: payload["servers"].arrayValue.compactMap(StreamServer.decode)
        )
    }
}

/// One page of a paginated listing.
public struct ListPage: Sendable {
    public let items: [Anime]
    public let currentPage: Int
    public let totalPages: Int
    public let hasNextPage: Bool

    public init(items: [Anime], currentPage: Int, totalPages: Int, hasNextPage: Bool) {
        self.items = items
        self.currentPage = currentPage
        self.totalPages = totalPages
        self.hasNextPage = hasNextPage
    }
}

/// The landing payload.
public struct HomeFeed: Sendable {
    public let spotlights: [Anime]
    public let trending: [Anime]
    public let topAiring: [Anime]
    public let mostPopular: [Anime]
    public let mostFavorite: [Anime]
    public let latestCompleted: [Anime]
    public let latestEpisode: [Anime]
    public let genres: [String]

    public init(
        spotlights: [Anime] = [],
        trending: [Anime] = [],
        topAiring: [Anime] = [],
        mostPopular: [Anime] = [],
        mostFavorite: [Anime] = [],
        latestCompleted: [Anime] = [],
        latestEpisode: [Anime] = [],
        genres: [String] = []
    ) {
        self.spotlights = spotlights
        self.trending = trending
        self.topAiring = topAiring
        self.mostPopular = mostPopular
        self.mostFavorite = mostFavorite
        self.latestCompleted = latestCompleted
        self.latestEpisode = latestEpisode
        self.genres = genres
    }
}

extension JSONValue {
    var isNull: Bool {
        if case .null = self { return true }
        return false
    }
}

/// Read the trailing number from a field like `"28 / 28"` or `"Episodes: 12"`.
///
/// The separator is padded in the real payload (`"28 / 28"`), so the token is
/// trimmed before conversion — `Int(" 28")` is `nil`, which would silently drop
/// the episode count.
func lastNumber(in text: String) -> Int? {
    let token = text.split(separator: "/").last.map(String.init) ?? text
    let trimmed = token.trimmingCharacters(in: .whitespaces)
    if let value = Int(trimmed) { return value }
    return token.split(whereSeparator: { !$0.isNumber }).last.flatMap { Int($0) }
}
