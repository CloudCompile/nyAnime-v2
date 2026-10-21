import Foundation

/// One rendition offered by a master playlist.
public struct HLSVariant: Sendable, Hashable {
    public let url: URL
    public let bandwidth: Int
    public let width: Int
    public let height: Int

    public init(url: URL, bandwidth: Int, width: Int, height: Int) {
        self.url = url
        self.bandwidth = bandwidth
        self.width = width
        self.height = height
    }

    /// Label for a quality picker, e.g. `720p`.
    public var qualityLabel: String {
        height > 0 ? "\(height)p" : (bandwidth > 0 ? "\(bandwidth / 1000)kbps" : "Auto")
    }
}

/// A media playlist's segment list.
public struct HLSMediaPlaylist: Sendable {
    public let url: URL
    public let segments: [URL]
    public let durations: [Double]
    public let isEncrypted: Bool
    public let hasByteRanges: Bool

    public var duration: Double { durations.reduce(0, +) }
    public var isComplete: Bool { !segments.isEmpty }

    public init(
        url: URL,
        segments: [URL],
        durations: [Double],
        isEncrypted: Bool,
        hasByteRanges: Bool
    ) {
        self.url = url
        self.segments = segments
        self.durations = durations
        self.isEncrypted = isEncrypted
        self.hasByteRanges = hasByteRanges
    }

    /// Downloadable only when the segments are plain, complete files. Encrypted
    /// or byte-range playlists need a real demuxer, so those are streamed only.
    public var isDownloadable: Bool { !isEncrypted && !hasByteRanges }
}

public enum HLSParseError: Error, LocalizedError {
    case noVariants
    case noSegments

    public var errorDescription: String? {
        switch self {
        case .noVariants: return "The stream offered no playable qualities."
        case .noSegments: return "The stream playlist contained no segments."
        }
    }
}

/// Parser for the two playlist kinds this CDN serves.
///
/// The CDN labels playlists `image/jpeg` and its media playlists have no
/// `.m3u8` in the path, so a playlist is recognised by its body starting with
/// `#EXTM3U`, never by content type or extension.
public enum HLSParser {
    public static func looksLikePlaylist(_ data: Data) -> Bool {
        let head = String(decoding: data.prefix(64), as: UTF8.self)
            .replacingOccurrences(of: "\u{FEFF}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return head.hasPrefix("#EXTM3U")
    }

    /// Parse a master playlist into its renditions, best quality first.
    public static func parseMaster(_ text: String, baseURL: URL) throws -> [HLSVariant] {
        var variants: [HLSVariant] = []
        let lines = text.split(whereSeparator: \.isNewline)

        for (index, rawLine) in lines.enumerated() {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("#EXT-X-STREAM-INF") else { continue }
            guard index + 1 < lines.count else { continue }
            let uri = lines[index + 1].trimmingCharacters(in: .whitespaces)
            guard !uri.isEmpty, !uri.hasPrefix("#") else { continue }
            guard let url = URL(string: uri, relativeTo: baseURL)?.absoluteURL else { continue }

            let attributes = parseAttributes(line)
            var width = 0
            var height = 0
            if let resolution = attributes["RESOLUTION"] {
                let parts = resolution.split(separator: "x")
                if parts.count == 2 {
                    width = Int(parts[0]) ?? 0
                    height = Int(parts[1]) ?? 0
                }
            }
            variants.append(
                HLSVariant(
                    url: url,
                    bandwidth: Int(attributes["BANDWIDTH"] ?? "") ?? 0,
                    width: width,
                    height: height
                )
            )
        }

        guard !variants.isEmpty else { throw HLSParseError.noVariants }
        return variants.sorted { lhs, rhs in
            lhs.height != rhs.height ? lhs.height > rhs.height : lhs.bandwidth > rhs.bandwidth
        }
    }

    /// Parse a media playlist into its segment URLs and durations.
    public static func parseMedia(_ text: String, baseURL: URL) throws -> HLSMediaPlaylist {
        var segments: [URL] = []
        var durations: [Double] = []
        var pendingDuration: Double?
        var isEncrypted = false
        var hasByteRanges = false

        for rawLine in text.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }

            if line.hasPrefix("#EXTINF:") {
                let value = line
                    .dropFirst("#EXTINF:".count)
                    .split(separator: ",").first.map(String.init) ?? ""
                pendingDuration = Double(value) ?? 0
                continue
            }
            if line.hasPrefix("#EXT-X-KEY") {
                // A METHOD of NONE means the following segments are clear.
                let attributes = parseAttributes(line)
                if (attributes["METHOD"] ?? "NONE").uppercased() != "NONE" { isEncrypted = true }
                continue
            }
            if line.hasPrefix("#EXT-X-BYTERANGE") {
                hasByteRanges = true
                continue
            }
            if line.hasPrefix("#") { continue }

            guard let url = URL(string: line, relativeTo: baseURL)?.absoluteURL else { continue }
            segments.append(url)
            // A segment with no preceding EXTINF still counts; use 0 so the
            // arrays stay aligned.
            durations.append(pendingDuration ?? 0)
            pendingDuration = nil
        }

        guard !segments.isEmpty else { throw HLSParseError.noSegments }
        return HLSMediaPlaylist(
            url: baseURL,
            segments: segments,
            durations: durations,
            isEncrypted: isEncrypted,
            hasByteRanges: hasByteRanges
        )
    }

    /// Rewrite a playlist so every child URI is absolute against `baseURL`.
    /// Native playback resolves relative URIs on its own, but the downloader
    /// needs explicit URLs.
    public static func absolutize(_ text: String, baseURL: URL) -> String {
        text.split(whereSeparator: \.isNewline).map { rawLine -> String in
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { return line }
            if trimmed.hasPrefix("#") {
                return line.replacingOccurrences(
                    of: #"URI="([^"]+)""#,
                    with: "URI=\"$1\"",
                    options: .regularExpression
                )
            }
            return URL(string: trimmed, relativeTo: baseURL)?.absoluteURL.absoluteString ?? line
        }.joined(separator: "\n")
    }

    /// Pull `KEY=VALUE` pairs out of a tag line, tolerating quoted values.
    private static func parseAttributes(_ line: String) -> [String: String] {
        guard let colon = line.firstIndex(of: ":") else { return [:] }
        let body = line[line.index(after: colon)...]
        var attributes: [String: String] = [:]

        for pair in splitAttributes(body) {
            guard let equals = pair.firstIndex(of: "=") else { continue }
            let key = pair[..<equals].trimmingCharacters(in: .whitespaces)
            let value = pair[pair.index(after: equals)...]
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            attributes[key.uppercased()] = value
        }
        return attributes
    }

    /// Split on commas that are not inside quotes.
    private static func splitAttributes(_ body: Substring) -> [String] {
        var parts: [String] = []
        var current = ""
        var inQuotes = false
        for character in body {
            if character == "\"" { inQuotes.toggle() }
            if character == "," && !inQuotes {
                parts.append(current)
                current = ""
                continue
            }
            current.append(character)
        }
        if !current.isEmpty { parts.append(current) }
        return parts
    }
}
