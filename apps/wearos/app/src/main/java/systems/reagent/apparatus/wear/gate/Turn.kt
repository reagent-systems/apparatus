// Port of apps/web/src/gate/turn.ts. Turn detection: two silence limits, chosen by a heuristic
// completeness check over the latest transcript text.

package systems.reagent.apparatus.wear.gate

/** A sentence that ends on one of these is not finished. Same list as the web. */
val INCOMPLETE_TAIL_WORDS: Set<String> = setOf(
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
)

// JavaScript's `\s` (and what String.prototype.trim strips). Java's `\s` is ASCII only.
private const val JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
internal val JS_WHITESPACE = Regex("[$JS_SPACE]+")

// `\z`, not `$`: a Java `$` also matches before a final line terminator, U+0085 among them,
// which JavaScript's `$` (no m flag) does not, and which JS trim keeps.
private val JS_TRIM = Regex("^[$JS_SPACE]+|[$JS_SPACE]+\\z")
private val TERMINAL = Regex("[.!?][\"')\\]]*\\z")
private val TRAILING_OPEN = Regex("[,;:\\-–—]\\z|\\.\\.\\.\\z|…\\z")
private val EDGE_PUNCTUATION = Regex("^[^\\p{L}\\p{N}']+|[^\\p{L}\\p{N}']+\\z")

internal fun jsTrim(text: String): String = text.replace(JS_TRIM, "")

object HeuristicCompleteness {
    /** Does the utterance so far look finished? */
    fun isComplete(transcript: String): Boolean {
        val text = jsTrim(transcript)
        // No words yet: nothing says the user is mid-sentence. Fast limit.
        if (text.isEmpty()) return true
        if (TRAILING_OPEN.containsMatchIn(text)) return false
        if (TERMINAL.containsMatchIn(text)) return true
        val words = text.lowercase().split(JS_WHITESPACE)
        val last = words.last().replace(EDGE_PUNCTUATION, "")
        if (last.isEmpty()) return true
        return last !in INCOMPLETE_TAIL_WORDS
    }
}

enum class TurnEnd { Complete, Incomplete }

class TurnDetector(private val silenceCompleteMs: Double, private val silenceIncompleteMs: Double) {
    private var transcript = ""
    private var silence = 0.0

    /** Call at speech start. */
    fun start() {
        transcript = ""
        silence = 0.0
    }

    fun setTranscript(text: String) {
        transcript = text
    }

    /** One frame of the open turn: the end reason once the silence reaches the selected limit. */
    fun update(voiced: Boolean, frameMs: Double): TurnEnd? {
        if (voiced) {
            silence = 0.0
            return null
        }
        silence += frameMs
        val complete = HeuristicCompleteness.isComplete(transcript)
        val limit = if (complete) silenceCompleteMs else silenceIncompleteMs
        if (silence + 1e-6 >= limit) return if (complete) TurnEnd.Complete else TurnEnd.Incomplete
        return null
    }
}
