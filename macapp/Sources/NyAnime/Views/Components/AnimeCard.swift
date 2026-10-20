import SwiftUI
import NyAnimeCore

/// Remote poster with a placeholder.
///
/// Uses `AsyncImage`, which hands caching to `URLCache`. There is no custom
/// image pipeline and no decoding of full-size artwork, so memory stays low
/// while scrolling a long grid.
struct PosterImage: View {
    let url: URL?
    var width: CGFloat
    var height: CGFloat

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: nil)) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            case .empty:
                Rectangle().fill(Color.secondary.opacity(0.15))
            case .failure:
                Rectangle()
                    .fill(Color.secondary.opacity(0.15))
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundStyle(.tertiary)
                    )
            @unknown default:
                Rectangle().fill(Color.secondary.opacity(0.15))
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A poster tile in a grid or row.
///
/// Deliberately flat: no shadows, no blur, no gradient overlays that would
/// force offscreen compositing on Intel integrated graphics.
struct AnimeCard: View {
    let anime: Anime
    var width: CGFloat = 140

    private var height: CGFloat { width * 1.4 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PosterImage(url: anime.posterURL, width: width, height: height)

            Text(anime.title)
                .font(.caption)
                .lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.leading)
                .foregroundStyle(.primary)

            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: width, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var subtitle: String? {
        if let count = anime.episodeCount, count > 0 {
            return "\(count) episodes"
        }
        if let type = anime.showType, !type.isEmpty, type != "Unknown" {
            return type
        }
        return nil
    }
}

/// A horizontal, lazily-built row of posters.
struct AnimeRow: View {
    let title: String
    let items: [Anime]

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .padding(.horizontal)

                // Lazy so only visible posters are created and loaded.
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(items) { anime in
                            NavigationLink(value: anime.id) {
                                AnimeCard(anime: anime)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}
