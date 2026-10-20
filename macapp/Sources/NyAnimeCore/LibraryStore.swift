import Foundation

/// One finished download on disk.
public struct DownloadRecord: Sendable, Codable, Identifiable, Hashable {
    public let id: String
    public let animeId: String
    public let animeTitle: String
    public let posterURL: String?
    public let episodeKey: String
    public let episodeNumber: Int
    public let episodeTitle: String
    public let format: DownloadFormat
    public let quality: String
    public let fileName: String
    public let bytes: Int64
    public let createdAt: Date

    public init(
        id: String,
        animeId: String,
        animeTitle: String,
        posterURL: String?,
        episodeKey: String,
        episodeNumber: Int,
        episodeTitle: String,
        format: DownloadFormat,
        quality: String,
        fileName: String,
        bytes: Int64,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.animeId = animeId
        self.animeTitle = animeTitle
        self.posterURL = posterURL
        self.episodeKey = episodeKey
        self.episodeNumber = episodeNumber
        self.episodeTitle = episodeTitle
        self.format = format
        self.quality = quality
        self.fileName = fileName
        self.bytes = bytes
        self.createdAt = createdAt
    }

    /// Stable identity for an episode + format, so re-downloading replaces
    /// rather than duplicates.
    public static func identifier(episodeKey: String, format: DownloadFormat) -> String {
        "\(episodeKey)-\(format.rawValue)"
    }
}

/// Persisted state: downloads and playback positions.
///
/// Kept as one small JSON file written atomically. There is no database and no
/// long-lived handle, so the app holds no file descriptors or background timers
/// while idle.
public actor LibraryStore {
    private let fileURL: URL
    private let directory: URL

    private var records: [DownloadRecord] = []
    private var progress: [String: Double] = [:]
    private var loaded = false

    public init(directory: URL? = nil) {
        let base = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NyAnime", isDirectory: true)
        self.directory = base
        self.fileURL = base.appendingPathComponent("library.json")
    }

    /// Where downloaded media lives.
    public nonisolated var mediaDirectory: URL {
        directory.appendingPathComponent("Downloads", isDirectory: true)
    }

    private struct Persisted: Codable {
        var records: [DownloadRecord]
        var progress: [String: Double]
    }

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode(Persisted.self, from: data) else {
            return
        }
        records = decoded.records
        progress = decoded.progress
    }

    private func persist() {
        let payload = Persisted(records: records, progress: progress)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(payload) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Atomic so a crash mid-write cannot corrupt the library.
        try? data.write(to: fileURL, options: .atomic)
    }

    // MARK: - Downloads

    public func all() -> [DownloadRecord] {
        loadIfNeeded()
        return records.sorted { $0.createdAt > $1.createdAt }
    }

    public func add(_ record: DownloadRecord) {
        loadIfNeeded()
        records.removeAll { $0.id == record.id }
        records.append(record)
        persist()
    }

    public func remove(id: String) {
        loadIfNeeded()
        guard let record = records.first(where: { $0.id == id }) else { return }
        try? FileManager.default.removeItem(at: fileURL(for: record))
        records.removeAll { $0.id == id }
        persist()
    }

    public func fileURL(for record: DownloadRecord) -> URL {
        mediaDirectory.appendingPathComponent(record.fileName)
    }

    public nonisolated func fileURL(fileName: String) -> URL {
        mediaDirectory.appendingPathComponent(fileName)
    }

    /// Delete every download, including files on disk.
    public func removeAll() {
        loadIfNeeded()
        for record in records {
            try? FileManager.default.removeItem(at: fileURL(for: record))
        }
        records.removeAll()
        persist()
    }

    // MARK: - Playback progress

    public func position(for episodeKey: String) -> Double {
        loadIfNeeded()
        return progress[episodeKey] ?? 0
    }

    public func setPosition(_ seconds: Double, for episodeKey: String) {
        loadIfNeeded()
        // Ignore the opening seconds so a briefly opened episode does not look
        // like it was watched.
        progress[episodeKey] = seconds < 5 ? 0 : seconds
        persist()
    }

    /// Every stored position, for a continue-watching list.
    public func allProgress() -> [String: Double] {
        loadIfNeeded()
        return progress
    }
}
