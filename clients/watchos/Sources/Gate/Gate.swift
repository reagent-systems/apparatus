import Foundation

/// The voice gate in open-mic mode. Port of the open-mic path of
/// web/src/gate/gate.ts: it decides what audio leaves the watch and when a
/// turn ends. Pure: no audio framework, no clock; time is frames processed.
///
/// Order per frame: VAD -> minimum duration -> barge-in bar (while the model
/// speaks) -> speaker check -> turn detector. Echo cancellation runs before
/// this, in the audio session's voiceChat mode.
///
/// Parity with the web gate is proven by clients/shared/gate-vectors.json
/// (Tests/GateVectorTests.swift), not by reading. The web's push-to-talk
/// path, wake word and decision log have no use on the watch and are not
/// ported.
enum SpeechEndReason: String {
    case complete
    case incomplete
    case manualStop = "manual_stop"
    case maxDuration = "max_duration"
}

enum DropReason: String {
    case tooShort = "too_short"
    case bargeinRejected = "bargein_rejected"
    case speakerMismatch = "speaker_mismatch"
    case manualStop = "manual_stop"
}

enum GateEvent {
    case speechStart
    case audio(PCMFrame)
    case speechEnd(SpeechEndReason)
    case bargeIn(voiceMs: Double, words: Int)
    case drop(DropReason, voiceMs: Double)
}

enum GateState: String {
    case idle
    case pending
    case speaking
    case rejected
}

/// Speaker check: drop speech that is not the enrolled user. The watch has
/// no enrollment, so it runs `NoSpeakerCheck` (web/src/gate/speaker.ts).
protocol SpeakerCheck {
    var enabled: Bool { get }
    func matches(_ samples: [Int16]) -> Bool
}

struct NoSpeakerCheck: SpeakerCheck {
    let enabled = false
    func matches(_ samples: [Int16]) -> Bool { true }
}

/// While the model speaks, the bar to interrupt it is higher: enough voice
/// time and enough words. Both limits are inclusive. Port of
/// web/src/gate/bargein.ts.
struct BargeInRule {
    let minVoiceMs: Double
    let minWords: Double

    func allows(voiceMs: Double, words: Int) -> Bool {
        voiceMs >= minVoiceMs && Double(words) >= minWords
    }
}

final class VoiceGate {
    let config: GateConfig
    let sampleRate: Double
    /// Called for every event, in order, on the caller's thread.
    var onEvent: ((GateEvent) -> Void)?

    private let isModelSpeaking: () -> Bool
    private let vad: EnergyVad
    private let turn: TurnDetector
    private let bargein: BargeInRule
    private let words = EnergyBurstWordEstimator()
    private let transcriptWords = TranscriptWordCounter()
    private let speaker: SpeakerCheck
    private let maxPendingMs: Double
    private let maxTurnMs: Double

    private(set) var state: GateState = .idle
    private var buffer: [PCMFrame] = []
    private var voiceMs = 0.0
    private var pendingMs = 0.0
    private var turnMs = 0.0
    /// Time in ms, derived from frames processed.
    private(set) var now = 0.0

    /// `maxPendingMs` and `maxTurnMs` are the web gate's constructor
    /// defaults; the web passes neither, so neither does the watch.
    init(config: GateConfig,
         sampleRate: Double = 16000,
         isModelSpeaking: @escaping () -> Bool = { false },
         speakerCheck: SpeakerCheck = NoSpeakerCheck(),
         maxPendingMs: Double = 3000,
         maxTurnMs: Double = 120_000) {
        self.config = config
        self.sampleRate = sampleRate
        self.isModelSpeaking = isModelSpeaking
        vad = EnergyVad(threshold: config.vadEnergyThreshold, hangoverMs: config.vadHangoverMs, sampleRate: sampleRate)
        turn = TurnDetector(silenceCompleteMs: config.silenceCompleteMs, silenceIncompleteMs: config.silenceIncompleteMs)
        bargein = BargeInRule(minVoiceMs: config.bargeinMinVoiceMs, minWords: config.bargeinMinWords)
        speaker = speakerCheck
        self.maxPendingMs = maxPendingMs
        self.maxTurnMs = maxTurnMs
    }

    /// True between speechStart and speechEnd.
    var isOpen: Bool { state == .speaking }

    /// Latest interim transcript of the open turn, from Live inputTranscription.
    func setTranscript(_ text: String) {
        turn.setTranscript(text)
        transcriptWords.setText(text)
    }

    /// Hang-up. Ends any open turn and clears any candidate.
    func stopAll() {
        if state == .speaking {
            endTurn(.manualStop)
        } else if state == .pending {
            drop(.manualStop)
        }
        reset()
    }

    /// One 20 ms frame of microphone audio, 16 kHz mono.
    func pushFrame(_ frame: PCMFrame) {
        let frameMs = (Double(frame.samples.count) / sampleRate) * 1000
        now += frameMs
        let v = vad.process(frame.samples)

        switch state {
        case .speaking:
            emit(.audio(frame))
            turnMs += frameMs
            // Silence counts from the last raw voiced frame, not from the end
            // of the hangover, so the limits in the config mean what they say.
            if let end = turn.update(voiced: v.raw, frameMs: frameMs) {
                endTurn(end == .complete ? .complete : .incomplete)
            } else if turnMs >= maxTurnMs {
                endTurn(.maxDuration)
            }
            return

        case .rejected:
            if !v.active { reset() }
            return

        case .idle:
            guard v.raw else { return }
            state = .pending
            buffer = []
            voiceMs = 0
            pendingMs = 0
            words.reset()
            transcriptWords.reset()

        case .pending:
            break
        }

        // pending: a candidate segment, buffered on the device
        buffer.append(frame)
        pendingMs += frameMs
        if v.raw { voiceMs += frameMs }
        words.push(voiced: v.raw, frameMs: frameMs)

        if !v.active {
            drop(voiceMs < config.minSpeechMs ? .tooShort : .bargeinRejected)
            reset()
            return
        }
        if voiceMs < config.minSpeechMs { return }

        if isModelSpeaking() {
            let count = max(words.count(), transcriptWords.count())
            if !bargein.allows(voiceMs: voiceMs, words: count) {
                if pendingMs >= maxPendingMs {
                    drop(.bargeinRejected)
                    state = .rejected
                    buffer = []
                }
                return
            }
            emit(.bargeIn(voiceMs: voiceMs, words: count))
        }

        if speaker.enabled && !speaker.matches(buffer.flatMap(\.samples)) {
            drop(.speakerMismatch)
            state = .rejected
            buffer = []
            return
        }

        confirm()
    }

    // MARK: - Internals

    private func confirm() {
        let buffered = buffer
        buffer = []
        state = .speaking
        turnMs = 0
        turn.start()
        transcriptWords.reset()
        emit(.speechStart)
        for f in buffered { emit(.audio(f)) }
    }

    private func endTurn(_ reason: SpeechEndReason) {
        emit(.speechEnd(reason))
        reset()
    }

    private func drop(_ reason: DropReason) {
        emit(.drop(reason, voiceMs: voiceMs))
    }

    private func reset() {
        state = .idle
        buffer = []
        voiceMs = 0
        pendingMs = 0
        turnMs = 0
        words.reset()
    }

    private func emit(_ event: GateEvent) {
        onEvent?(event)
    }
}
