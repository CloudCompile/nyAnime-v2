// swift-tools-version:5.9
import PackageDescription

// The core library and the verification harness build everywhere, so the
// downloader and parsers can be compiled and tested on CI (including Linux).
// The SwiftUI app target is macOS-only because it links AppKit, AVKit and
// SwiftUI, none of which exist on Linux.
var targets: [Target] = [
    .target(name: "NyAnimeCore"),
    .executableTarget(name: "nyanime-verify", dependencies: ["NyAnimeCore"]),
    .testTarget(name: "NyAnimeCoreTests", dependencies: ["NyAnimeCore"]),
]

#if os(macOS)
targets.append(
    .executableTarget(
        name: "NyAnime",
        dependencies: ["NyAnimeCore"],
        path: "Sources/NyAnime"
    )
)
#endif

let package = Package(
    name: "NyAnime",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "NyAnimeCore", targets: ["NyAnimeCore"]),
        .executable(name: "nyanime-verify", targets: ["nyanime-verify"]),
    ],
    targets: targets
)
