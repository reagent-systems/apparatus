import Foundation

/// Turn detection: two silence limits, chosen by a completeness model.
/// Port of web/src/gate/turn.ts.
protocol CompletenessModel {
    /// Does the utterance so far look finished?
    func isComplete(_ transcript: String) -> Bool
}

/// A sentence that ends on one of these is not finished. The same list as
/// `INCOMPLETE_TAIL_WORDS` in web/src/gate/turn.ts.
let incompleteTailWords: Set<String> = [
    // prepositions
    "to", "for", "with", "from", "at", "in", "on", "of", "by", "about", "into", "onto",
    "over", "under", "through", "between", "after", "before", "until", "than", "via",
    "toward", "towards", "across", "against", "without", "within", "upon", "per",
    // conjunctions
    "and", "or", "but", "so", "because", "if", "when", "while", "although", "though",
    "nor", "yet", "that", "which", "who", "whom", "whose", "whether", "unless", "since",
    "then", "as",
    // articles and determiners
    "a", "an", "the", "my", "your", "his", "her", "its", "our", "their", "this", "these",
    "those", "some", "any", "every", "each", "no",
    // fillers
    "um", "uh", "uhm", "er", "erm", "ah", "eh", "hmm", "hm", "mm", "like", "uhh", "umm",
    // auxiliaries and lead-ins that promise more
    "i", "i'm", "i'd", "i'll", "i've", "is", "are", "was", "were", "be", "been", "am",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must", "do",
    "does", "did", "have", "has", "had", "not", "very", "really", "also", "just", "please",
    "let", "let's", "want", "need", "go", "get", "make", "called", "named", "say", "says",
    "it's", "there's", "here's", "what's", "that's",
]

/// The web's two regular expressions, written out:
/// TERMINAL `/[.!?]["')\]]*$/` and TRAILING_OPEN `/[,;:\-–—]$|\.\.\.$|…$/`.
struct HeuristicCompleteness: CompletenessModel {
    func isComplete(_ transcript: String) -> Bool {
        let text = JSText.trim(transcript)
        // No words yet: nothing says the user is mid-sentence. Fast limit.
        if text.isEmpty { return true }
        let scalars = Array(text.unicodeScalars)
        if Self.trailingOpen(scalars) { return false }
        if Self.terminal(scalars) { return true }
        let words = JSText.split(text.lowercased())
        let last = Self.stripEdges(words[words.count - 1])
        if last.isEmpty { return true }
        return !incompleteTailWords.contains(last)
    }

    private static func trailingOpen(_ s: [Unicode.Scalar]) -> Bool {
        guard let last = s.last else { return false }
        if [",", ";", ":", "-", "\u{2013}", "\u{2014}", "\u{2026}"].contains(last) { return true }
        return s.count >= 3 && s.suffix(3).allSatisfy { $0 == "." }
    }

    private static func terminal(_ s: [Unicode.Scalar]) -> Bool {
        var i = s.count - 1
        while i >= 0, ["\"", "'", ")", "]"].contains(s[i]) { i -= 1 }
        return i >= 0 && [".", "!", "?"].contains(s[i])
    }

    /// `/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu` replaced with "".
    private static func stripEdges(_ word: String) -> String {
        let keep: (Unicode.Scalar) -> Bool = { JSText.isLetterOrNumber($0) || $0 == "'" }
        let scalars = Array(word.unicodeScalars)
        guard let first = scalars.firstIndex(where: keep), let last = scalars.lastIndex(where: keep) else { return "" }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[first...last])
        return String(out)
    }
}

enum TurnEnd: String {
    case complete
    case incomplete
}

final class TurnDetector {
    let silenceCompleteMs: Double
    let silenceIncompleteMs: Double
    let model: CompletenessModel
    private var transcript = ""
    private var silence = 0.0

    init(silenceCompleteMs: Double, silenceIncompleteMs: Double, model: CompletenessModel = HeuristicCompleteness()) {
        self.silenceCompleteMs = silenceCompleteMs
        self.silenceIncompleteMs = silenceIncompleteMs
        self.model = model
    }

    /// Call at speech start.
    func start() {
        transcript = ""
        silence = 0
    }

    func setTranscript(_ text: String) {
        transcript = text
    }

    /// One frame of the open turn. Returns the end reason once the silence
    /// reaches the limit the completeness model selects, else nil.
    func update(voiced: Bool, frameMs: Double) -> TurnEnd? {
        if voiced {
            silence = 0
            return nil
        }
        silence += frameMs
        let complete = model.isComplete(transcript)
        let limit = complete ? silenceCompleteMs : silenceIncompleteMs
        if silence + 1e-6 >= limit { return complete ? .complete : .incomplete }
        return nil
    }
}
