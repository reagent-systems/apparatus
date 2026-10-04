import Foundation

/// Answer of `POST /token`. `setup` is the complete first Live message,
/// `{"setup": {...}}`, sent verbatim. The client never holds a prompt or
/// a model name of its own.
struct LiveToken {
    let token: String
    let model: String
    let setup: [String: Any]
    let expiresAt: Date?
    let resumptionHandle: String?
    /// `live.idle_close_seconds` from config/apparatus.toml, when sent.
    let idleCloseSeconds: TimeInterval?
}

enum TokenError: Error {
    case http(Int)
    case shape
}

enum TokenClient {
    static func fetch() async throws -> LiveToken {
        var request = URLRequest(url: Config.serverOrigin.appendingPathComponent("token"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(Config.auth)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw TokenError.http(code) }
        guard let object = JSON.decode(data),
              let token = object["token"] as? String, !token.isEmpty,
              let setup = object["setup"] as? [String: Any], setup["setup"] is [String: Any]
        else { throw TokenError.shape }

        return LiveToken(
            token: token,
            model: object["model"] as? String ?? "",
            setup: setup,
            expiresAt: (object["expires_at"] as? String).flatMap(parseDate),
            resumptionHandle: nonEmpty(object["resumption_handle"] as? String),
            idleCloseSeconds: idleClose(object)
        )
    }

    /// Accepts `idle_close_seconds` at the top level or under `live`.
    private static func idleClose(_ object: [String: Any]) -> TimeInterval? {
        let live = object["live"] as? [String: Any]
        guard let n = JSON.int(object["idle_close_seconds"]) ?? JSON.int(live?["idle_close_seconds"]), n > 0 else {
            return nil
        }
        return TimeInterval(n)
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s
    }

    /// RFC 3339 with or without fractional seconds.
    private static func parseDate(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: text) { return d }
        return ISO8601DateFormatter().date(from: text)
    }
}
