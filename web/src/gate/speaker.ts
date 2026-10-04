// Speaker check: drop speech that is not the enrolled user.
//
// Off unless `gate.speaker_check` is true. The voice profile is biometric
// data: it is written only to the storage object handed in (localStorage on
// the web), never sent, and only with an explicit consent flag. The profile
// holds an embedding, not audio.

export interface SpeakerCheck {
  readonly enabled: boolean;
  /** `samples` is the buffered start of a speech segment, PCM16 at 16 kHz. */
  matches(samples: Int16Array): boolean;
}

export class NoSpeakerCheck implements SpeakerCheck {
  readonly enabled = false;
  matches(): boolean {
    return true;
  }
}

export interface Embedder {
  readonly dims: number;
  embed(samples: Int16Array): Float32Array;
}

export type SpeakerProfile = {
  version: 1;
  dims: number;
  embedding: number[];
  enrolled_at: string;
};

export interface EnrollmentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ENROLLMENT_KEY = "apparatus.speaker.profile";

export class ConsentRequired extends Error {
  constructor() {
    super("speaker enrollment needs consent");
    this.name = "ConsentRequired";
  }
}

export class EnrollmentStore {
  private readonly storage: EnrollmentStorage;
  private readonly key: string;

  constructor(storage: EnrollmentStorage, key: string = ENROLLMENT_KEY) {
    this.storage = storage;
    this.key = key;
  }

  save(profile: SpeakerProfile, consent: boolean): void {
    if (consent !== true) throw new ConsentRequired();
    this.storage.setItem(this.key, JSON.stringify(profile));
  }

  load(): SpeakerProfile | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as Partial<SpeakerProfile>;
      if (obj.version !== 1 || !Array.isArray(obj.embedding) || typeof obj.dims !== "number") return null;
      return obj as SpeakerProfile;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Record the user once, with consent, and store the embedding on the device. */
export function enrollSpeaker(
  samples: Int16Array,
  consent: boolean,
  deps: { embedder: Embedder; store: EnrollmentStore },
): SpeakerProfile {
  if (consent !== true) throw new ConsentRequired();
  const emb = deps.embedder.embed(samples);
  const profile: SpeakerProfile = {
    version: 1,
    dims: emb.length,
    embedding: Array.from(emb),
    enrolled_at: new Date().toISOString(),
  };
  deps.store.save(profile, consent);
  return profile;
}

export type EmbeddingSpeakerCheckOptions = {
  embedder: Embedder;
  profile: SpeakerProfile | null;
  threshold: number;
};

// A real speaker model (an ECAPA or WavLM style embedder in ONNX) slots in
// as `Embedder`. With no profile enrolled the check lets speech through, so
// a user who turns the flag on before enrolling is not locked out.
export class EmbeddingSpeakerCheck implements SpeakerCheck {
  readonly enabled = true;
  readonly threshold: number;
  private readonly embedder: Embedder;
  private profile: SpeakerProfile | null;
  lastScore = 0;

  constructor(opts: EmbeddingSpeakerCheckOptions) {
    this.embedder = opts.embedder;
    this.profile = opts.profile;
    this.threshold = opts.threshold;
  }

  setProfile(profile: SpeakerProfile | null): void {
    this.profile = profile;
  }

  get ready(): boolean {
    return this.profile !== null;
  }

  matches(samples: Int16Array): boolean {
    if (!this.profile) return true;
    const emb = this.embedder.embed(samples);
    this.lastScore = cosine(emb, this.profile.embedding);
    return this.lastScore >= this.threshold;
  }
}

// Stand-in embedder: a few time-domain statistics. It separates nothing
// reliably and exists so the pipeline runs end to end. Replace it.
export class StubEmbedder implements Embedder {
  readonly dims = 4;

  embed(samples: Int16Array): Float32Array {
    const n = samples.length;
    if (n === 0) return new Float32Array(this.dims);
    let sumSq = 0;
    let crossings = 0;
    let sumAbsDiff = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[i] / 32768;
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));
      if (i > 0) {
        if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings += 1;
        sumAbsDiff += Math.abs(v - samples[i - 1] / 32768);
      }
    }
    return new Float32Array([Math.sqrt(sumSq / n), crossings / n, sumAbsDiff / n, peak]);
  }
}
