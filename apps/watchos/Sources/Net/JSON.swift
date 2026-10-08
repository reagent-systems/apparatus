import Foundation

/// JSONSerialization wrappers. Every wire message on both sockets is one
/// JSON object; the app keeps them as `[String: Any]` and reads fields by
/// name, so no Codable models and no third-party dependency.
enum JSON {
    static func encode(_ object: Any) -> Data? {
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        return try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
    }

    static func encodeString(_ object: Any) -> String? {
        encode(object).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func decode(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func decode(_ text: String) -> [String: Any]? {
        decode(Data(text.utf8))
    }

    /// Integer from a JSON number in any of its Foundation shapes.
    static func int(_ value: Any?) -> Int? {
        switch value {
        case let n as Int: return n
        case let n as NSNumber: return n.intValue
        case let s as String: return Int(s)
        default: return nil
        }
    }
}

/// Runs `body` on the main actor from any thread, in FIFO order.
/// Network and audio callbacks use it to reach the main-actor model.
func onMain(_ body: @escaping @MainActor () -> Void) {
    DispatchQueue.main.async {
        MainActor.assumeIsolated(body)
    }
}
