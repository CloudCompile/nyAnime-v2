import SwiftUI
import NyAnimeCore

struct RootView: View {
    @EnvironmentObject private var state: AppState

    enum Tab: String, CaseIterable, Identifiable {
        case home = "Home"
        case browse = "Browse"
        case library = "Library"
        case search = "Search"

        var id: String { rawValue }

        var symbol: String {
            switch self {
            case .home: return "house"
            case .browse: return "square.grid.2x2"
            case .library: return "arrow.down.circle"
            case .search: return "magnifyingglass"
            }
        }
    }

    @State private var selection: Tab = .home
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            List(Tab.allCases, selection: $selection) { tab in
                Label(tab.rawValue, systemImage: tab.symbol)
                    .tag(tab)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 150, ideal: 170, max: 200)
            .scrollContentBackground(.hidden)
            .background {
                LiquidGlassBackground(cornerRadius: 0) {
                    Color.animeDark.opacity(0.35)
                }
            }
        } detail: {
            // `navigationDestination(for:)` and `NavigationLink(value:)` need a
            // NavigationStack ancestor; NavigationSplitView does not provide one,
            // so the detail column owns it.
            NavigationStack {
                switch selection {
                case .home: HomeView()
                case .browse: BrowseView()
                case .library: LibraryView()
                case .search: SearchView()
                }
            }
        }
        .navigationTitle("NyAnime")
        .background(Color.animeDarker)
    }
}
