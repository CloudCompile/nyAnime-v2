import SwiftUI
import NyAnimeCore

/// Browsable categories, mapped to the API's route names.
enum BrowseCategory: String, CaseIterable, Identifiable {
    case topAiring = "Top Airing"
    case mostPopular = "Most Popular"
    case latestEpisode = "Latest Episodes"
    case recentlyAdded = "Recently Added"
    case latestCompleted = "Completed"
    case movie = "Movies"
    case tv = "TV Series"
    case ona = "ONA"
    case topUpcoming = "Upcoming"

    var id: String { rawValue }

    /// The route segment under `/api/`.
    var route: String {
        switch self {
        case .topAiring: return "top-airing"
        case .mostPopular: return "most-popular"
        case .latestEpisode: return "latest-episode"
        case .recentlyAdded: return "recently-added"
        case .latestCompleted: return "latest-completed"
        case .movie: return "movie"
        case .tv: return "tv"
        case .ona: return "ona"
        case .topUpcoming: return "top-upcoming"
        }
    }
}

struct BrowseView: View {
    @EnvironmentObject private var state: AppState

    @State private var category: BrowseCategory = .topAiring
    @State private var genre: String?
    @State private var items: [Anime] = []
    @State private var page = 1
    @State private var totalPages = 1
    @State private var isLoading = false
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 140, maximum: 180), spacing: 16)]

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            Divider()
            content
        }
        .navigationDestination(for: String.self) { DetailView(animeId: $0) }
        .task(id: "\(category.route)-\(genre ?? "")") { await reload() }
    }

    private var filterBar: some View {
        HStack(spacing: 12) {
            Picker("Category", selection: $category) {
                ForEach(BrowseCategory.allCases) { Text($0.rawValue).tag($0) }
            }
            .frame(maxWidth: 220)

            Picker("Genre", selection: $genre) {
                Text("All Genres").tag(String?.none)
                ForEach(state.homeFeed?.genres ?? [], id: \.self) { name in
                    Text(name).tag(String?.some(name))
                }
            }
            .frame(maxWidth: 200)

            Spacer()

            if isLoading { ProgressView().controlSize(.small) }
        }
        .padding()
    }

    @ViewBuilder
    private var content: some View {
        if let error {
            ContentUnavailableViewCompat(
                title: "Could not load this category",
                message: error,
                systemImage: "wifi.exclamationmark"
            )
        } else if items.isEmpty && isLoading {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 18) {
                    ForEach(items) { anime in
                        NavigationLink(value: anime.id) {
                            AnimeCard(anime: anime)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()

                if page < totalPages {
                    Button {
                        Task { await load(page: page + 1, append: true) }
                    } label: {
                        if isLoading { ProgressView() } else { Text("Load More") }
                    }
                    .controlSize(.large)
                    .padding(.bottom)
                }
            }
        }
    }

    private func reload() async {
        await load(page: 1, append: false)
    }

    private func load(page requestedPage: Int, append: Bool) async {
        isLoading = true
        error = nil
        do {
            let result: ListPage
            if let genre {
                result = try await state.api.filter(
                    FilterParams(genre: genre, page: requestedPage)
                )
            } else {
                result = try await state.api.browse(route: category.route, page: requestedPage)
            }
            items = append ? items + result.items : result.items
            page = result.currentPage
            totalPages = result.totalPages
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct SearchView: View {
    @EnvironmentObject private var state: AppState

    private let columns = [GridItem(.adaptive(minimum: 140, maximum: 180), spacing: 16)]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search anime…", text: $state.searchText)
                    .textFieldStyle(.plain)
                    .onChange(of: state.searchText) { newValue in
                        state.search(newValue)
                    }
                if state.isSearching {
                    ProgressView().controlSize(.small)
                }
                if !state.searchText.isEmpty {
                    Button {
                        state.searchText = ""
                        state.search("")
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .background {
                LiquidGlassBackground(cornerRadius: 8) {
                    Color.animeGray.opacity(0.35)
                }
            }
            .padding()

            Divider()

            if state.searchText.isEmpty {
                ContentUnavailableViewCompat(
                    title: "Search the catalogue",
                    message: "Type a title to search the animeapi catalogue.",
                    systemImage: "magnifyingglass"
                )
            } else if state.searchResults.isEmpty && !state.isSearching {
                ContentUnavailableViewCompat(
                    title: "No results",
                    message: "Nothing matched “\(state.searchText)”.",
                    systemImage: "questionmark.circle"
                )
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(state.searchResults) { anime in
                            NavigationLink(value: anime.id) {
                                AnimeCard(anime: anime)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationDestination(for: String.self) { DetailView(animeId: $0) }
    }
}
