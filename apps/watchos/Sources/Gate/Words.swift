import Foundation

/// Word counts for the barge-in rule. Port of apps/web/src/gate/words.ts.
///
/// Before a turn is confirmed no audio has left the device, so no transcript
/// exists yet. The energy-burst estimator guesses from the energy contour:
/// one voiced burst between two dips is one word. The transcript counter
/// counts words in the interim transcript once one arrives; the gate takes
/// the larger of the two.
final class EnergyBurstWordEstimator {
    /// A burst shorter than this is noise, not a word.
    let minBurstMs: Double
    /// A dip shorter than this is inside a word.
    let minDipMs: Double
    private var inBurst = false
    private var burstMs = 0.0
    private var dipMs = 0.0
    private var counted = false
    private var words = 0

    init(minBurstMs: Double = 40, minDipMs: Double = 40) {
        self.minBurstMs = minBurstMs
        self.minDipMs = minDipMs
    }

    /// One frame: `voiced` is the raw VAD decision for it.
    func push(voiced: Bool, frameMs: Double) {
        if voiced {
            if !inBurst {
                inBurst = true
                burstMs = 0
                counted = false
            }
            dipMs = 0
            burstMs += frameMs
            if !counted && burstMs >= minBurstMs {
                counted = true
                words += 1
            }
            return
        }
        guard inBurst else { return }
        dipMs += frameMs
        if dipMs >= minDipMs {
            inBurst = false
            dipMs = 0
        }
    }

    func count() -> Int {
        words
    }

    func reset() {
        inBurst = false
        burstMs = 0
        dipMs = 0
        counted = false
        words = 0
    }
}

/// Tokens with at least one letter or digit.
func countWords(_ text: String) -> Int {
    JSText.split(text).filter { token in token.unicodeScalars.contains(where: JSText.isLetterOrNumber) }.count
}

final class TranscriptWordCounter {
    private var text = ""

    func setText(_ text: String) {
        self.text = text
    }

    func count() -> Int {
        countWords(text)
    }

    func reset() {
        text = ""
    }
}

/// The JavaScript string rules the web gate leans on, so the port reads text
/// exactly as the web does: `\s` and `trim()` use ECMAScript's WhiteSpace and
/// LineTerminator set (which differs from Foundation's at U+0085 and
/// U+FEFF), and `\p{L}` / `\p{N}` are the Unicode letter and number
/// categories.
enum JSText {
    static func isSpace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A,
             0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    static func isLetterOrNumber(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    /// `text.trim()`.
    static func trim(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        guard let first = scalars.firstIndex(where: { !isSpace($0) }),
              let last = scalars.lastIndex(where: { !isSpace($0) }) else { return "" }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[first...last])
        return String(out)
    }

    /// `text.split(/\s+/)`: empty tokens at either end are kept, as in JS.
    static func split(_ text: String) -> [String] {
        var tokens: [String] = []
        var current = String.UnicodeScalarView()
        var lastWasSpace = false
        for s in text.unicodeScalars {
            if isSpace(s) {
                if !lastWasSpace {
                    tokens.append(String(current))
                    current = String.UnicodeScalarView()
                }
                lastWasSpace = true
            } else {
                current.append(s)
                lastWasSpace = false
            }
        }
        tokens.append(String(current))
        return tokens
    }
}
