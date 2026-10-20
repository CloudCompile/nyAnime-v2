# Repository guide

NyAnime is two clients for one backend:

- a Vite + React SPA at the repository root, deployed to Vercel;
- a native SwiftUI macOS app under `macapp/`.

Both talk to `https://animeapi.cjhauser.me`, an Express service
(`CloudCompile/animeapiapi`) that fronts the aniwaves.ru catalogue.

## The one thing to understand first

The catalogue API is CORS-open, so clients call it directly. **The stream CDN is
not.** It pins `Access-Control-Allow-Origin: https://play.echovideo.ru`, which
means:

- Browsers cannot read a playlist or segment directly, so the SPA routes
  everything through a proxy.
- AVFoundation ignores CORS, so the macOS app plays the CDN URL directly.

Segments are MPEG-TS in both cases. The CDN rotates through numbered subdomains
(`ru-cdn1`, `ru-ri-cdn3`, ...), so allow-lists match on domain suffix, never on
an exact hostname.

Catalogue entries carry two ids and the API accepts them inconsistently:
`id` is the slug (`frieren-beyond-journeys-end-74575`) and `data_id` is the
numeric upstream id (`74575`). `/api/info` **only** resolves slugs, while
`/api/episodes/:id`, `/api/servers/:id` and `/api/stream` accept either. A
numeric id passed to `/api/info` returns `200` with `data: null` — not an
error — so the failure is silent. The web app routes by numeric id and
translates through `resolveSlug` before calling `/api/info`; the macOS app
routes by slug directly.

## Web app

```sh
npm ci
npm run dev              # Vite dev server on :8080
npm run build            # production bundle
npx tsc --noEmit         # type-check
npm run lint             # eslint; must stay at zero errors
npm run verify:download  # end-to-end download + transmux check against the real API
npm run verify:playback  # headless Chromium: real HLS playback through the proxy
npm run verify:web-download  # headless Chromium: click through to a file on disk
```

The two browser harnesses need a running dev server and a Chromium binary
(`CHROME_PATH`, default `/usr/bin/chromium`); pass `NYANIME_URL` to point them
elsewhere.

Key modules:

- `src/services/animeApiService.ts` — the API client. Base URL is overridable
  with `VITE_ANIME_API_URL`.
- `src/lib/streamProxy.ts` — shared proxy logic. Rewrites manifests so every
  child URI points back through the proxy. Used by **both** `api/stream.ts`
  (Vercel edge function) and `worker/index.ts` (Cloudflare Worker); keep them
  byte-for-byte consistent.
- `src/lib/download/` — client-side downloader. Segments are fetched
  sequentially and streamed to disk via a File System Access handle or a Blob
  fallback, never buffered whole in memory.
- `vite-plugins/streamProxy.ts` — serves `/api/stream` in dev so the production
  path is exercised locally.

Deployment notes: `vercel.json` holds the SPA rewrite. It excludes `api/`,
`assets/` and anything with a file extension, so the edge function is not
swallowed by the catch-all. `api/stream.ts` must stay on the edge runtime and
must not import Node builtins.

## macOS app

```sh
cd macapp
swift build
swift test                              # 26 tests; 7 live ones skipped
NYANIME_LIVE_TESTS=1 swift test         # hit the real API and download segments
swift run nyanime-verify <anime-id> 3   # headless pipeline check
./scripts/bundle-app.sh release         # build/NyAnime.app
```

The app is built for a **2017 MacBook Pro**, which constrains the design:

- **macOS 13 Ventura floor.** Declared in `Package.swift` and in the bundle's
  `LSMinimumSystemVersion`. Anything newer must be wrapped — see
  `ContentUnavailableViewCompat`.
- **Low idle RAM.** No polling timers anywhere. Downloads use structured
  concurrency with a bounded worker window, so peak memory is a few segments
  rather than a whole episode.
- **Intel GPU.** Flat lists and system materials only; no heavy blur, 3D or
  background video.
- **Universal binary.** GitHub's macOS runners are Apple Silicon but the target
  Mac is Intel, so CI builds `--arch x86_64 --arch arm64` and asserts the
  result contains `x86_64`.

`NyAnimeCore` is deliberately platform-agnostic and builds on Linux, which lets
CI run its tests on a cheap runner. The SwiftUI target is appended to the
manifest only under `#if os(macOS)`.

The bundle is ad-hoc signed. A downloaded copy is quarantined by Gatekeeper
until the user allows it once, or runs `xattr -dr com.apple.quarantine`.
Removing that step needs a Developer ID signature and notarization.

## CI

`.github/workflows/ci.yml` has three jobs: web (type-check, lint, build), core
(Swift on Linux), and mac (build, test, bundle a universal app, upload the
artifact).
