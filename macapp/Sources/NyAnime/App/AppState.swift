import SwiftUI

/// The single source of truth for the app.
///
/// One observable object shared through the environment. It deliberately holds
/// only cheap values: view state, the catalogue cache, and download progress.
/// Nothing here polls on a timer, so an idle window costs no CPU.
@MainActor
final class AppState: ObservableObject {
    @Published var homeFeed: HomeFeed?
    @Published var homeError: String?
    @Published var isLoadingHome = false
    @Published var searchText = ""
    @Published var searchResults: [Anime] = []
    @Published var isSearching = false
    @Published var downloads: [DownloadRecord] = []
    @Published var progress: [String: Double] = [:]
    @Published var positions: [String: Double] = [:]

    let api = AnimeAPI()
    let library = LibraryStore()
    let fetcher = StreamFetcher()

    private let downloader = SegmentDownloader()

    /// In-flight downloads, so one can be cancelled.
    private var activeDownloads: [String: Task<Void, Never>] = [:]
    /// Debounce handle for search-as-you-type.
    private var searchTask: Task<Void, Never>?

    init() {
        Task {
            await refreshLibrary()
            await loadHome()
        }
    }

    // MARK: - Home

    func loadHome(force: Bool = false) async {
        if homeFeed != nil && !force { return }
        isLoadingHome = true
        homeError = nil
        do {
            homeFeed = try await api.home()
        } catch {
            homeError = error.localizedDescription
        }
        isLoadingHome = false
    }

    // MARK: - Search

    /// Debounced so typing does not fire a request per keystroke.
    func search(_ query: String) {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchResults = []
            isSearching = false
            return
        }
        isSearching = true
        searchTask = Task { [weak self] in
            // Cancel-safe pause; nothing spins while waiting.
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self else { return }
            let results = (try? await self.api.search(keyword: trimmed)) ?? []
            guard !Task.isCancelled else { return }
            self.searchResults = results
            self.isSearching = false
        }
    }

    // MARK: - Library

    func refreshLibrary() async {
        downloads = await library.all()
        positions = await library.allProgress()
    }

    func recordPosition(_ seconds: Double, for episodeKey: String) async {
        await library.setPosition(seconds, for: episodeKey)
        positions = await library.allProgress()
    }

    func deleteDownload(_ record: DownloadRecord) async {
        await library.remove(id: record.id)
        await refreshLibrary()
    }

    // MARK: - Downloads

    func isDownloading(_ key: String) -> Bool {
        activeDownloads[DownloadRecord.identifier(episodeKey: key, format: .mp4)] != nil
            || activeDownloads[DownloadRecord.identifier(episodeKey: key, format: .ts)] != nil
    }

    /// Download an episode to disk. `format` selects the raw transport stream or
    /// the same stream saved as `.mp4`; the bytes are MPEG-TS either way, which
    /// QuickTime and VLC both open.
    func download(
        anime: Anime,
        episode: Episode,
        source: StreamSource,
        format: DownloadFormat,
        quality: Int?
    ) async {
        guard let masterURL = source.fileURL else { return }
        let id = DownloadRecord.identifier(episodeKey: episode.key, format: format)
        guard activeDownloads[id] == nil else { return }

        let task = Task { [weak self] in
            guard let self else { return }
            defer { self.activeDownloads[id] = nil }
            do {
                let resolved = try await self.fetcher.resolve(
                    masterURL: masterURL,
                    preferredHeight: quality
                )
                let fileName = "\(anime.id)-\(episode.key).\(format.rawValue)"
                let destination = self.library.mediaDirectory.appendingPathComponent(fileName)

                let bytes = try await self.downloader.download(
                    playlist: resolved.playlist,
                    to: destination
                ) { progress in
                    Task { @MainActor in
                        self.progress[episode.key] = progress.fraction
                    }
                }

                let record = DownloadRecord(
                    id: id,
                    animeId: anime.id,
                    animeTitle: anime.title,
                    posterURL: anime.posterURL?.absoluteString,
                    episodeKey: episode.key,
                    episodeNumber: episode.number,
                    episodeTitle: episode.title,
                    format: format,
                    quality: resolved.qualityLabel,
                    fileName: fileName,
                    bytes: bytes
                )
                await self.library.add(record)
                await self.refreshLibrary()
                self.progress[episode.key] = nil
            } catch is CancellationError {
                self.progress[episode.key] = nil
            } catch {
                self.progress[episode.key] = nil
                self.homeError = error.localizedDescription
            }
        }
        activeDownloads[id] = task
    }

    func cancelDownload(episodeKey: String) {
        for format in DownloadFormat.allCases {
            let id = DownloadRecord.identifier(episodeKey: episodeKey, format: format)
            activeDownloads[id]?.cancel()
            activeDownloads[id] = nil
        }
        progress[episodeKey] = nil
    }
}
