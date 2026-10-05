import Foundation

/// Build-time constants. There is no settings screen and no runtime
/// override: the server origin comes from the Info.plist, the Live
/// endpoint is a constant in LiveSession (design spec, Security rule 9).
enum Config {
    static let device = "watch"

    /// Info.plist `ApparatusServerOrigin`, set from APPARATUS_SERVER_ORIGIN
    /// in Config/Base.xcconfig. Empty or malformed falls back to localhost.
    static let serverOrigin: URL = {
        let fallback = URL(string: "http://localhost:8080")!
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "ApparatusServerOrigin") as? String else {
            return fallback
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme, url.host != nil,
              scheme == "http" || scheme == "https" else {
            return fallback
        }
        return url
    }()

    /// The same origin with a WebSocket scheme.
    static let socketOrigin: URL = {
        var parts = URLComponents(url: serverOrigin, resolvingAgainstBaseURL: false)!
        parts.scheme = serverOrigin.scheme == "https" ? "wss" : "ws"
        return parts.url!
    }()

    /// Bearer value for /token and /ws/client. Keychain account "auth";
    /// absent means development mode.
    static var auth: String { Keychain.get("auth") ?? "dev" }

    // Live audio formats. The server's [live] table holds the same values.
    static let liveInputRate: Double = 16000
    static let liveOutputRate: Double = 24000
    static let chunkMilliseconds = 20

    // Fallback for `ready.live.idle_close_seconds` (config/apparatus.toml).
    // The gate thresholds come from `ready.gate`; see Gate/GateConfig.swift.
    static let idleCloseSeconds: TimeInterval = 120
}
