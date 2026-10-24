import SwiftUI
import NyAnimeCore

struct HomeView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Group {
            if let feed = state.homeFeed {
                content(feed)
            } else if let error = state.homeError {
                ContentUnavailableViewCompat(
                    title: "Could not load the catalogue",
                    message: error,
                    systemImage: "wifi.exclamationmark"
                ) {
                    Button("Try Again") {
                        Task { await state.loadHome(force: true) }
                    }
                }
            } else {
                ProgressView().controlSize(.large)
            }
        }
        .navigationDestination(for: String.self) { animeId in
            DetailView(animeId: animeId)
        }
        .task { await state.loadHome() }
    }

    @ViewBuilder
    private func content(_ feed: HomeFeed) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let spotlight = feed.spotlights.first {
                    SpotlightCard(anime: spotlight)
                }
                AnimeRow(title: "Trending Now", items: feed.trending)
                AnimeRow(title: "Top Airing", items: feed.topAiring)
                AnimeRow(title: "Most Popular", items: feed.mostPopular)
                AnimeRow(title: "Latest Episodes", items: feed.latestEpisode)
                AnimeRow(title: "Most Favorited", items: feed.mostFavorite)
                AnimeRow(title: "Latest Completed", items: feed.latestCompleted)
            }
            .padding(.vertical)
        }
    }
}

/// The large hero card at the top of the home screen, styled like the web app's
/// hero spotlight: poster as a backdrop with a gradient fade and a title block.
struct SpotlightCard: View {
    let anime: Anime

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // Backdrop poster
            if let url = anime.posterURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        Color.animeDarker
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 320)
                .clipped()
                .overlay(
                    LinearGradient(
                        colors: [
                            Color.animeDarker.opacity(0.2),
                            Color.animeDarker.opacity(0.95),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            } else {
                Color.animeDarker.frame(height: 320)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Spotlight")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.animePurple)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.08), in: Capsule())

                Text(anime.title)
                    .font(.title.weight(.bold))
                    .lineLimit(2)
                    .foregroundStyle(.white)

                if let description = anime.description, !description.isEmpty {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.75))
                        .lineLimit(3)
                }

                HStack(spacing: 10) {
                    NavigationLink(value: anime.id) {
                        Label("More Info", systemImage: "info.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.animePurple)
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal)
    }
}

/// `ContentUnavailableView` is macOS 14+; this keeps the app on macOS 13.
struct ContentUnavailableViewCompat<Actions: View>: View {
    let title: String
    let message: String
    let systemImage: String
    let actions: Actions

    init(
        title: String,
        message: String,
        systemImage: String,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            actions
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension ContentUnavailableViewCompat where Actions == EmptyView {
    init(title: String, message: String, systemImage: String) {
        self.init(title: title, message: message, systemImage: systemImage) { EmptyView() }
    }
}
