// Turn detection: two silence limits, chosen by a completeness model.
//
// The default model is a heuristic over the latest transcript text. A model
// such as Smart Turn or the LiveKit turn detector implements
// `CompletenessModel`; an audio model updates its state from `observe` and
// answers from it in `isComplete`.

export interface CompletenessModel {
  /** Does the utterance so far look finished? */
  isComplete(transcript: string): boolean;
  /** Optional: see every frame of the open turn. */
  observe?(frame: Int16Array | Float32Array): void;
  reset?(): void;
}

// A sentence that ends on one of these is not finished.
export const INCOMPLETE_TAIL_WORDS: ReadonlySet<string> = new Set([
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
]);

const TERMINAL = /[.!?]["')\]]*$/;
const TRAILING_OPEN = /[,;:\-–—]$|\.\.\.$|…$/;

export class HeuristicCompleteness implements CompletenessModel {
  isComplete(transcript: string): boolean {
    const text = transcript.trim();
    // No words yet: nothing says the user is mid-sentence. Fast limit.
    if (text.length === 0) return true;
    if (TRAILING_OPEN.test(text)) return false;
    if (TERMINAL.test(text)) return true;
    const words = text.toLowerCase().split(/\s+/);
    const last = words[words.length - 1].replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
    if (last.length === 0) return true;
    return !INCOMPLETE_TAIL_WORDS.has(last);
  }
}

export type TurnConfig = { silenceCompleteMs: number; silenceIncompleteMs: number };

export type TurnEnd = "complete" | "incomplete";

export class TurnDetector {
  readonly cfg: TurnConfig;
  readonly model: CompletenessModel;
  private transcript = "";
  private silence = 0;

  constructor(cfg: TurnConfig, model: CompletenessModel = new HeuristicCompleteness()) {
    this.cfg = cfg;
    this.model = model;
  }

  /** Call at speech start. */
  start(): void {
    this.transcript = "";
    this.silence = 0;
    this.model.reset?.();
  }

  setTranscript(text: string): void {
    this.transcript = text;
  }

  get transcriptText(): string {
    return this.transcript;
  }

  get silenceMs(): number {
    return this.silence;
  }

  observe(frame: Int16Array | Float32Array): void {
    this.model.observe?.(frame);
  }

  /** One frame of the open turn. Returns the end reason once the silence
   *  reaches the limit the completeness model selects, else null. */
  update(voiced: boolean, frameMs: number): TurnEnd | null {
    if (voiced) {
      this.silence = 0;
      return null;
    }
    this.silence += frameMs;
    const complete = this.model.isComplete(this.transcript);
    const limit = complete ? this.cfg.silenceCompleteMs : this.cfg.silenceIncompleteMs;
    if (this.silence + 1e-6 >= limit) return complete ? "complete" : "incomplete";
    return null;
  }
}
