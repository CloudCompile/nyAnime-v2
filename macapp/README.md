# NyAnime for macOS

A native SwiftUI client for [animeapi.cjhauser.me](https://animeapi.cjhauser.me),
with HLS playback and offline downloads.

## Why native, and not Electron

The target machine is a 2017 MacBook Pro, which changes the design:

- **macOS 13 Ventura is the floor.** It is the newest release that MacBook
  officially runs. `Package.swift` declares `.macOS(.v13)`, and any newer API is
  wrapped rather than called directly (see `ContentUnavailableViewCompat`).
- **Idle RAM stays near zero.** SwiftUI plus AVFoundation share the system's
  frameworks, so a launched window costs a few tens of MB rather than the
  several hundred an Electron shell adds.
- **No busy waiting.** Downloads use structured concurrency with a bounded
  worker pool, so there are no polling timers or spinning threads. Progress is
  reported only when a segment completes.
- **Simple rendering.** Flat lists, system materials and no heavy blur, 3D, or
  background video, which keeps the Intel integrated GPU cool and quiet.

## Layout

```
Sources/NyAnimeCore/   Platform-agnostic library: API client, HLS parsing,
                       segment downloader, on-disk library. Builds on Linux too.
Sources/NyAnime/       SwiftUI app (macOS only): views, player, app state.
Sources/nyanime-verify Headless harness that exercises the real API end to end.
Tests/NyAnimeCoreTests Parsing tests plus opt-in live tests.
scripts/bundle-app.sh  Assembles build/NyAnime.app from the SwiftPM binary.
```

## Building

```sh
swift build            # core + verification harness
swift test             # 26 tests; live tests are skipped unless enabled
./scripts/bundle-app.sh release   # produces build/NyAnime.app
```

To run the live tests, which hit the real API and download real segments:

```sh
NYANIME_LIVE_TESTS=1 swift test --filter LiveTests
```

`nyanime-verify` is useful for checking the whole pipeline without a GUI:

```sh
swift run nyanime-verify sousou-no-frieren-74575 3
```

## Distribution

GitHub's macOS runners are Apple Silicon, but the target Mac is Intel, so CI
builds a **universal binary** (`swift build --arch x86_64 --arch arm64`). The
workflow uploads `NyAnime.app` as an artifact.

The bundle is ad-hoc signed, so a downloaded copy is quarantined by Gatekeeper.
Either right-click and choose Open once, or run `xattr -dr com.apple.quarantine
NyAnime.app`. Shipping without that prompt needs a paid Developer ID signature
and notarization.

## How streaming works

The catalogue API is CORS-open, so it is called directly. The stream CDN is not:
it pins `Access-Control-Allow-Origin` to `https://play.echovideo.ru`, which
blocks browsers but not AVFoundation. So:

- **Playback** points AVPlayer at the CDN URL directly. A `Referer` header is
  attached via `AVURLAssetHTTPHeaderFieldsKey` as a precaution.
- **Downloads** fetch segments through `StreamFetcher`, which sends the same
  headers, then concatenate them into the chosen container.

Encrypted streams and byte-range playlists are detected and rejected for
download rather than producing a corrupt file.
