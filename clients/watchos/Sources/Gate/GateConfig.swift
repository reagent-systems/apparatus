import Foundation

/// The [gate] table of config/apparatus.toml, as the server sends it in
/// `ready.gate` (the same table as `GET /config/gate`). Port of
/// web/src/config.ts. The defaults equal that table and are fallbacks only:
/// the watch holds no thresholds of its own.
struct GateConfig: Equatable {
    var vadEnergyThreshold: Double = 0.015
    var vadHangoverMs: Double = 240
    var minSpeechMs: Double = 300
    var silenceCompleteMs: Double = 500
    var silenceIncompleteMs: Double = 2500
    var bargeinMinVoiceMs: Double = 300
    var bargeinMinWords: Double = 2
    var bargeinStopMs: Double = 200
    var speakerCheck: Bool = false
    var speakerMatchThreshold: Double = 0.75

    static let defaults = GateConfig()

    /// The server table over the defaults. A missing or mistyped field keeps
    /// its default, as `mergeGate` does on the web: a number field takes a
    /// JSON number only, the boolean field a JSON boolean only.
    static func merged(_ table: [String: Any]?) -> GateConfig {
        var c = GateConfig()
        guard let table else { return c }
        func number(_ key: String, _ apply: (Double) -> Void) {
            if let v = JSONScalar.number(table[key]) { apply(v) }
        }
        number("vad_energy_threshold") { c.vadEnergyThreshold = $0 }
        number("vad_hangover_ms") { c.vadHangoverMs = $0 }
        number("min_speech_ms") { c.minSpeechMs = $0 }
        number("silence_complete_ms") { c.silenceCompleteMs = $0 }
        number("silence_incomplete_ms") { c.silenceIncompleteMs = $0 }
        number("bargein_min_voice_ms") { c.bargeinMinVoiceMs = $0 }
        number("bargein_min_words") { c.bargeinMinWords = $0 }
        number("bargein_stop_ms") { c.bargeinStopMs = $0 }
        number("speaker_match_threshold") { c.speakerMatchThreshold = $0 }
        if let v = JSONScalar.bool(table["speaker_check"]) { c.speakerCheck = v }
        return c
    }
}

/// JSONSerialization hands numbers and booleans back as NSNumber, and
/// `as? Double` accepts a boolean. A JSON boolean is the NSNumber whose
/// objCType is "c" (CFBoolean on Apple platforms, __NSCFBoolean in
/// swift-corelibs-foundation); JSON numbers come back as "q", "i" or "d".
enum JSONScalar {
    static func isBoolean(_ value: Any) -> Bool {
        guard let n = value as? NSNumber else { return false }
        return String(cString: n.objCType) == "c"
    }

    static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, !isBoolean(n) else { return nil }
        return n.doubleValue
    }

    static func bool(_ value: Any?) -> Bool? {
        guard let n = value as? NSNumber, isBoolean(n) else { return nil }
        return n.boolValue
    }
}
