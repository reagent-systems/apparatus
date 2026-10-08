import XCTest
@testable import ApparatusWatch

/// Replays packages/gate-vectors/gate-vectors.json through the Swift gate and
/// asserts the exact event list the web gate produced. The file's `replay`
/// rules are implemented here as written; see its header.
final class GateVectorTests: XCTestCase {
    private func loadVectors() throws -> [String: Any] {
        // The test bundle carries a copy (project.yml); a plain `swift test`
        // reads the repository file next to this one.
        let url = Bundle(for: Self.self).url(forResource: "gate-vectors", withExtension: "json")
            ?? URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // watchos
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // the repository root
            .appendingPathComponent("packages/gate-vectors/gate-vectors.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return try XCTUnwrap(object as? [String: Any])
    }

    /// One frame of the vectors' square wave: sample k is +q when
    /// k % 80 < 40, else -q.
    private func makeFrame(_ q: Int, samples: Int) -> PCMFrame {
        PCMFrame((0..<samples).map { k in Int16(k % 80 < 40 ? q : -q) })
    }

    func testReplaysEveryScenario() throws {
        let vectors = try loadVectors()
        let audio = try XCTUnwrap(vectors["audio"] as? [String: Any])
        let frameSamples = try XCTUnwrap(JSONScalar.number(audio["frame_samples"])).toInt
        let frameMs = try XCTUnwrap(JSONScalar.number(audio["frame_ms"]))
        let sampleRate = try XCTUnwrap(JSONScalar.number(audio["sample_rate"]))
        let gateInfo = try XCTUnwrap(vectors["gate"] as? [String: Any])
        XCTAssertEqual(gateInfo["mode"] as? String, "open_mic")
        let maxPendingMs = try XCTUnwrap(JSONScalar.number(gateInfo["max_pending_ms"]))
        let maxTurnMs = try XCTUnwrap(JSONScalar.number(gateInfo["max_turn_ms"]))
        let scenarios = try XCTUnwrap(vectors["scenarios"] as? [[String: Any]])
        XCTAssertFalse(scenarios.isEmpty)

        var totalEvents = 0
        for scenario in scenarios {
            let name = scenario["name"] as? String ?? "?"
            let config = GateConfig.merged(scenario["config"] as? [String: Any])
            let input = try XCTUnwrap(scenario["input"] as? [String: Any], name)
            let segments = try XCTUnwrap(input["segments"] as? [[String: Any]], name)
            let speakingIntervals = (input["model_speaking"] as? [[String: Any]] ?? []).map {
                (JSONScalar.number($0["from_ms"]) ?? 0, JSONScalar.number($0["to_ms"]) ?? 0)
            }
            let steps = input["steps"] as? [[String: Any]] ?? []

            var current = 0
            let gate = VoiceGate(
                config: config,
                sampleRate: sampleRate,
                isModelSpeaking: {
                    let t = Double(current) * frameMs
                    return speakingIntervals.contains { $0.0 <= t && t < $0.1 }
                },
                maxPendingMs: maxPendingMs,
                maxTurnMs: maxTurnMs
            )

            var index: [ObjectIdentifier: Int] = [:]
            var pushed = 0
            var got: [Recorded] = []
            gate.onEvent = { event in
                let at = pushed
                let tMs = gate.now.rounded()
                switch event {
                case .audio(let frame):
                    guard let i = index[ObjectIdentifier(frame)] else {
                        XCTFail("\(name): audio frame not from the input")
                        return
                    }
                    if case .audio(let a, let t, let first, let n)? = got.last, first + n == i {
                        got[got.count - 1] = .audio(at: a, tMs: t, firstFrame: first, frames: n + 1)
                    } else {
                        got.append(.audio(at: at, tMs: tMs, firstFrame: i, frames: 1))
                    }
                case .speechStart:
                    got.append(.speechStart(at: at, tMs: tMs, forced: false))
                case .speechEnd(let reason):
                    got.append(.speechEnd(at: at, tMs: tMs, reason: reason.rawValue))
                case .bargeIn(let voiceMs, let words):
                    got.append(.bargeIn(at: at, tMs: tMs, voiceMs: voiceMs, words: words))
                case .drop(let reason, let voiceMs):
                    got.append(.drop(at: at, tMs: tMs, reason: reason.rawValue, voiceMs: voiceMs))
                }
            }

            func applySteps(_ frameIndex: Int) {
                for step in steps where JSONScalar.number(step["before_frame"])?.toInt == frameIndex {
                    switch step["op"] as? String {
                    case "transcript": gate.setTranscript(step["text"] as? String ?? "")
                    case "stop": gate.stopAll()
                    default: XCTFail("\(name): unknown step \(step)")
                    }
                }
            }

            for segment in segments {
                let ms = try XCTUnwrap(JSONScalar.number(segment["ms"]), name)
                let q = try XCTUnwrap(JSONScalar.number(segment["q"]), name).toInt
                for _ in 0..<Int(ms / frameMs) {
                    applySteps(current)
                    let frame = makeFrame(q, samples: frameSamples)
                    index[ObjectIdentifier(frame)] = current
                    pushed = current + 1
                    gate.pushFrame(frame)
                    current += 1
                }
            }
            applySteps(current)

            XCTAssertEqual(current, JSONScalar.number(input["frames"])?.toInt, "\(name): frame count")
            let expected = try XCTUnwrap(scenario["events"] as? [[String: Any]], name).map(Recorded.init(json:))
            XCTAssertEqual(got, expected, "\(name): events")
            XCTAssertEqual(gate.state.rawValue, scenario["end_state"] as? String, "\(name): end state")
            totalEvents += expected.count
        }
        print("gate vectors: \(scenarios.count) scenarios, \(totalEvents) events replayed")
    }

    func testMergeKeepsDefaultsForMissingOrMistypedFields() throws {
        let table = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(#"{"vad_energy_threshold": 0.05, "min_speech_ms": "300", "speaker_check": 1, "bargein_min_words": true}"#.utf8)
        ) as? [String: Any])
        let c = GateConfig.merged(table)
        XCTAssertEqual(c.vadEnergyThreshold, 0.05)
        XCTAssertEqual(c.minSpeechMs, GateConfig.defaults.minSpeechMs)
        XCTAssertEqual(c.speakerCheck, false)
        XCTAssertEqual(c.bargeinMinWords, GateConfig.defaults.bargeinMinWords)
        let flag = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(#"{"speaker_check": true}"#.utf8)) as? [String: Any])
        XCTAssertEqual(GateConfig.merged(flag).speakerCheck, true)
        XCTAssertEqual(GateConfig.merged(nil), GateConfig.defaults)
    }

    func testHeuristicCompletenessReadsTextLikeTheWeb() {
        let model = HeuristicCompleteness()
        XCTAssertTrue(model.isComplete(""))
        XCTAssertTrue(model.isComplete("   "))
        XCTAssertFalse(model.isComplete("Book a flight to"))
        XCTAssertTrue(model.isComplete("Book a flight to Paris."))
        XCTAssertTrue(model.isComplete("Is it ready?\")"))
        XCTAssertFalse(model.isComplete("Well,"))
        XCTAssertFalse(model.isComplete("and then..."))
        XCTAssertFalse(model.isComplete("so \u{2014}"))
        XCTAssertFalse(model.isComplete("I'M"))
        XCTAssertFalse(model.isComplete("call (the"))
        XCTAssertTrue(model.isComplete("Paris"))
        XCTAssertTrue(model.isComplete("---!"))
        // U+0085 is not JS whitespace and JS `$` matches only at the end.
        XCTAssertTrue(model.isComplete("Well,\u{85}"))
        XCTAssertFalse(model.isComplete("Book a flight to.\u{85}"))
        XCTAssertTrue(model.isComplete("so \u{2014}\u{85}"))
        XCTAssertEqual(countWords("  two words\u{FEFF}here -- "), 3)
        XCTAssertEqual(JSText.split(" a  b "), ["", "a", "b", ""])
    }
}

/// One vector event, as the file writes it.
private enum Recorded: Equatable {
    case speechStart(at: Int, tMs: Double, forced: Bool)
    case audio(at: Int, tMs: Double, firstFrame: Int, frames: Int)
    case speechEnd(at: Int, tMs: Double, reason: String)
    case bargeIn(at: Int, tMs: Double, voiceMs: Double, words: Int)
    case drop(at: Int, tMs: Double, reason: String, voiceMs: Double)

    init(json e: [String: Any]) {
        let at = JSONScalar.number(e["at"])?.toInt ?? -1
        let t = JSONScalar.number(e["t_ms"]) ?? -1
        switch e["kind"] as? String {
        case "speechStart":
            self = .speechStart(at: at, tMs: t, forced: JSONScalar.bool(e["forced"]) ?? true)
        case "audio":
            self = .audio(at: at, tMs: t, firstFrame: JSONScalar.number(e["first_frame"])?.toInt ?? -1,
                          frames: JSONScalar.number(e["frames"])?.toInt ?? -1)
        case "speechEnd":
            self = .speechEnd(at: at, tMs: t, reason: e["reason"] as? String ?? "?")
        case "bargeIn":
            self = .bargeIn(at: at, tMs: t, voiceMs: JSONScalar.number(e["voice_ms"]) ?? -1,
                            words: JSONScalar.number(e["words"])?.toInt ?? -1)
        default:
            self = .drop(at: at, tMs: t, reason: e["reason"] as? String ?? "?",
                         voiceMs: JSONScalar.number(e["voice_ms"]) ?? -1)
        }
    }
}

private extension Double {
    var toInt: Int { Int(self) }
}
