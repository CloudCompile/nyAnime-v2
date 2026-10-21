import SwiftUI
import NyAnimeCore

struct DetailView: View {
    let animeId: String

    @EnvironmentObject private var state: AppState
    @State private var detail: AnimeDetail?
    @State private var episodes: [Episode] = []
    @State private var error: String?
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView().controlSize(.large)
            } else if let detail {
                content(detail)
            } else {
                ContentUnavailableViewCompat(
                    title: "Could not load this anime",
                    message: error ?? "The API returned no data.",
                    systemImage: "exclamationmark.triangle"
                )
            }
        }
        .navigationTitle(detail?.anime.title ?? "Loading")
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ detail: AnimeDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(detail)
                if !detail.genres.isEmpty { genres(detail.genres) }
                episodesSection(detail)
                if !detail.related.isEmpty {
                    AnimeRow(title: "Related", items: detail.related)
                }
                if !detail.recommendations.isEmpty {
                    AnimeRow(title: "Recommended", items: detail.recommendations)
                }
            }
            .padding(.vertical)
        }
    }

    private func header(_ detail: AnimeDetail) -> some View {
        HStack(alignment: .top, spacing: 20) {
            PosterImage(url: detail.anime.posterURL, width: 180, height: 250)

            VStack(alignment: .leading, spacing: 8) {
                Text(detail.anime.title)
                    .font(.title.weight(.bold))
                    .lineLimit(3)

                if let japanese = detail.anime.japaneseTitle, !japanese.isEmpty {
                    Text(japanese).font(.subheadline).foregroundStyle(.secondary)
                }

                HStack(spacing: 14) {
                    if let score = detail.score { fact("star.fill", score) }
                    if let type = detail.type { fact("tv", type) }
                    if let total = detail.totalEpisodes { fact("number", "\(total) eps") }
                    if let status = detail.status { fact("circle.fill", status) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let aired = detail.aired {
                    Text(aired).font(.caption).foregroundStyle(.secondary)
                }
                if !detail.studios.isEmpty {
                    Text("Studio: \(detail.studios.joined(separator: ", "))")
                        .font(.caption).foregroundStyle(.secondary)
                }

                if let description = detail.anime.description, !description.isEmpty {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(6)
                }

                if let first = episodes.first {
                    NavigationLink {
                        WatchView(anime: detail.anime, episodes: episodes, startEpisode: first)
                    } label: {
                        Label("Watch Episode 1", systemImage: "play.fill")
                    }
                    .controlSize(.large)
                    .buttonStyle(.borderedProminent)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
    }

    private func fact(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol)
    }

    private func genres(_ genres: [String]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(genres, id: \.self) { genre in
                    Text(genre)
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
            }
            .padding(.horizontal)
        }
    }

    private func episodesSection(_ detail: AnimeDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Episodes").font(.title3.weight(.semibold)).padding(.horizontal)

            if episodes.isEmpty {
                Text("No episodes available.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(episodes) { episode in
                        NavigationLink {
                            WatchView(anime: detail.anime, episodes: episodes, startEpisode: episode)
                        } label: {
                            EpisodeRow(
                                episode: episode,
                                watchedFraction: watchedFraction(episode)
                            )
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading)
                    }
                }
            }
        }
    }

    private func watchedFraction(_ episode: Episode) -> Double? {
        let position = state.positions[episode.key] ?? 0
        return position > 0 ? position : nil
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            async let detailTask = state.api.info(id: animeId)
            async let episodesTask = state.api.episodes(id: animeId)
            detail = try await detailTask
            episodes = try await episodesTask
            if detail == nil { error = "The API returned no data for this title." }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct EpisodeRow: View {
    let episode: Episode
    let watchedFraction: Double?

    var body: some View {
        HStack(spacing: 12) {
            Text("\(episode.number)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)

            VStack(alignment: .leading, spacing: 2) {
                Text(episode.title)
                    .font(.callout)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    if episode.isFiller {
                        Text("Filler").font(.caption2).foregroundStyle(.orange)
                    }
                    if episode.hasSub { Text("SUB").font(.caption2).foregroundStyle(.secondary) }
                    if episode.hasDub { Text("DUB").font(.caption2).foregroundStyle(.secondary) }
                    if let watchedFraction {
                        Text("Resume \(formatted(watchedFraction))")
                            .font(.caption2)
                            .foregroundStyle(.blue)
                    }
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func formatted(_ seconds: Double) -> String {
        let total = Int(seconds)
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return String(format: "%d:%02d", minutes, secs)
    }
}
