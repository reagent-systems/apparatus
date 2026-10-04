import Foundation

/// One voice-model function call from `toolCall.functionCalls[]`.
struct LiveFunctionCall {
    let id: String
    let name: String
    let args: [String: Any]
}

/// `usageMetadata`, flattened.
struct LiveUsage {
    let inputTokens: Int
    let outputTokens: Int
}

/// One Gemini Live server message, flattened. One frame can carry several.
enum LiveEvent {
    case setupComplete
    /// pcm16le mono at `sampleRate`.
    case audio(Data, sampleRate: Double)
    case interrupted
    case turnComplete
    case inputTranscription(String, finished: Bool)
    case outputTranscription(String, finished: Bool)
    case toolCall([LiveFunctionCall])
    case toolCallCancellation([String])
    case usage(LiveUsage)
    case resumption(handle: String?, resumable: Bool)
    case goAway(timeLeftMilliseconds: Int?)
    case closed(reason: String)
}

/// The direct WebSocket to Gemini Live with an ephemeral token.
/// Call every method on the main actor; events arrive on it.
///
/// The endpoint is a constant on purpose (design spec, Security rule 9).
@MainActor
final class LiveSession: NSObject, URLSessionWebSocketDelegate {
    // Ephemeral tokens use the v1alpha "Constrained" method with the token
    // in `access_token`; the google-genai SDKs build the same URL
    // (js-genai src/live.ts). Confirm against
    // https://ai.google.dev/gemini-api/docs/ephemeral-tokens before release.
    static let endpoint =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"

    var onEvent: (@MainActor (LiveEvent) -> Void)?
    private(set) var isReady = false

    private let setupMessage: [String: Any]
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var closed = false

    /// `setup` is the full `{"setup": {...}}` object from `POST /token`.
    init(setup: [String: Any]) {
        setupMessage = setup
        super.init()
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    /// `setup` with `setup.sessionResumption.handle` set, so a new socket
    /// continues the old conversation. Other setup fields stay as sent.
    static func injectResumption(_ handle: String, into message: [String: Any]) -> [String: Any] {
        var outer = message
        var inner = outer["setup"] as? [String: Any] ?? [:]
        var resumption = inner["sessionResumption"] as? [String: Any] ?? [:]
        resumption["handle"] = handle
        inner["sessionResumption"] = resumption
        outer["setup"] = inner
        return outer
    }

    func connect(token: String) {
        guard task == nil, !closed else { return }
        var parts = URLComponents(string: Self.endpoint)!
        parts.queryItems = [URLQueryItem(name: "access_token", value: token)]
        let newTask = session.webSocketTask(with: parts.url!)
        task = newTask
        newTask.resume()
        receive(on: newTask)
    }

    func close(reason: String) {
        finish(reason: reason, notify: false)
    }

    // MARK: - Client messages

    /// 16 kHz pcm16le mono, one chunk.
    func sendAudio(_ pcm: Data) {
        guard isReady else { return }
        send([
            "realtimeInput": [
                "audio": [
                    "data": pcm.base64EncodedString(),
                    "mimeType": "audio/pcm;rate=\(Int(Config.liveInputRate))",
                ],
            ],
        ])
    }

    func sendActivityStart() {
        guard isReady else { return }
        send(["realtimeInput": ["activityStart": [String: Any]()]])
    }

    func sendActivityEnd() {
        guard isReady else { return }
        send(["realtimeInput": ["activityEnd": [String: Any]()]])
    }

    /// `S2C.tool.result` back into the session with its scheduling
    /// (INTERRUPT, WHEN_IDLE or SILENT).
    func sendToolResponse(id: String, name: String, response: [String: Any], scheduling: String?) {
        guard isReady else { return }
        var item: [String: Any] = ["id": id, "name": name, "response": response]
        if let scheduling, !scheduling.isEmpty { item["scheduling"] = scheduling }
        send(["toolResponse": ["functionResponses": [item]]])
    }

    /// An S2C `voice` string as a user turn: `<event>text</event>`.
    func sendEventTurn(_ text: String) {
        guard isReady else { return }
        let safe = text.replacingOccurrences(of: "</event>", with: "", options: .caseInsensitive)
        send([
            "clientContent": [
                "turns": [["role": "user", "parts": [["text": "<event>\(safe)</event>"]]]],
                "turnComplete": true,
            ],
        ])
    }

    private func send(_ message: [String: Any]) {
        guard let task, let text = JSON.encodeString(message) else { return }
        task.send(.string(text)) { [weak self] error in
            guard error != nil else { return }
            onMain { self?.finish(reason: "send_failed", notify: true) }
        }
    }

    // MARK: - Server messages

    private func receive(on socketTask: URLSessionWebSocketTask) {
        socketTask.receive { [weak self] result in
            onMain {
                guard let self, self.task === socketTask else { return }
                switch result {
                case .failure:
                    self.finish(reason: "receive_failed", notify: true)
                case .success(let frame):
                    var data: Data?
                    switch frame {
                    case .string(let s): data = Data(s.utf8)
                    case .data(let d): data = d
                    @unknown default: data = nil
                    }
                    if let data, let object = JSON.decode(data) {
                        for event in Self.parse(object) { self.deliver(event) }
                    }
                    self.receive(on: socketTask)
                }
            }
        }
    }

    private func deliver(_ event: LiveEvent) {
        if case .setupComplete = event { isReady = true }
        onEvent?(event)
    }

    private func opened(_ socketTask: URLSessionWebSocketTask) {
        guard socketTask === task, let text = JSON.encodeString(setupMessage) else { return }
        socketTask.send(.string(text)) { [weak self] error in
            guard error != nil else { return }
            onMain { self?.finish(reason: "setup_failed", notify: true) }
        }
    }

    private func finish(reason: String, notify: Bool) {
        guard !closed else { return }
        closed = true
        isReady = false
        let current = task
        task = nil
        current?.cancel(with: .normalClosure, reason: nil)
        if notify { onEvent?(.closed(reason: reason)) }
    }

    /// One server message to events. Mirrors web/src/live/messages.ts.
    static func parse(_ json: [String: Any]) -> [LiveEvent] {
        var events: [LiveEvent] = []

        if json["setupComplete"] != nil { events.append(.setupComplete) }

        if let content = json["serverContent"] as? [String: Any] {
            if content["interrupted"] as? Bool == true { events.append(.interrupted) }
            if let turn = content["modelTurn"] as? [String: Any],
               let parts = turn["parts"] as? [[String: Any]] {
                for part in parts {
                    guard let inline = part["inlineData"] as? [String: Any],
                          let encoded = inline["data"] as? String,
                          let bytes = Data(base64Encoded: encoded, options: [.ignoreUnknownCharacters])
                    else { continue }
                    let mime = inline["mimeType"] as? String ?? ""
                    events.append(.audio(bytes, sampleRate: sampleRate(of: mime)))
                }
            }
            if let t = content["inputTranscription"] as? [String: Any], let text = t["text"] as? String {
                events.append(.inputTranscription(text, finished: t["finished"] as? Bool == true))
            }
            if let t = content["outputTranscription"] as? [String: Any], let text = t["text"] as? String {
                events.append(.outputTranscription(text, finished: t["finished"] as? Bool == true))
            }
            if content["turnComplete"] as? Bool == true { events.append(.turnComplete) }
        }

        if let toolCall = json["toolCall"] as? [String: Any],
           let calls = toolCall["functionCalls"] as? [[String: Any]] {
            let parsed = calls.compactMap { call -> LiveFunctionCall? in
                guard let name = call["name"] as? String else { return nil }
                return LiveFunctionCall(id: call["id"] as? String ?? "",
                                        name: name,
                                        args: call["args"] as? [String: Any] ?? [:])
            }
            events.append(.toolCall(parsed))
        }

        if let cancel = json["toolCallCancellation"] as? [String: Any],
           let ids = cancel["ids"] as? [String] {
            events.append(.toolCallCancellation(ids))
        }

        if let usage = json["usageMetadata"] as? [String: Any] {
            let input = JSON.int(usage["promptTokenCount"]) ?? 0
            let output = JSON.int(usage["responseTokenCount"]) ?? JSON.int(usage["candidatesTokenCount"]) ?? 0
            events.append(.usage(LiveUsage(inputTokens: input, outputTokens: output)))
        }

        if let update = json["sessionResumptionUpdate"] as? [String: Any] {
            let handle = update["newHandle"] as? String
            events.append(.resumption(handle: (handle?.isEmpty == false) ? handle : nil,
                                      resumable: update["resumable"] as? Bool == true))
        }

        if let goAway = json["goAway"] as? [String: Any] {
            events.append(.goAway(timeLeftMilliseconds: durationMilliseconds(goAway["timeLeft"])))
        }

        return events
    }

    /// `audio/pcm;rate=24000` -> 24000. Default: the Live output rate.
    static func sampleRate(of mimeType: String) -> Double {
        guard let range = mimeType.range(of: "rate=") else { return Config.liveOutputRate }
        let digits = mimeType[range.upperBound...].prefix { $0.isNumber }
        return Double(digits) ?? Config.liveOutputRate
    }

    /// A protobuf Duration as JSON: `"12.5s"`, `{seconds, nanos}` or a number.
    static func durationMilliseconds(_ value: Any?) -> Int? {
        switch value {
        case let s as String:
            guard s.hasSuffix("s"), let seconds = Double(s.dropLast()) else { return nil }
            return Int((seconds * 1000).rounded())
        case let n as NSNumber:
            return Int((n.doubleValue * 1000).rounded())
        case let d as [String: Any]:
            let seconds = JSON.int(d["seconds"]) ?? 0
            let nanos = JSON.int(d["nanos"]) ?? 0
            return seconds * 1000 + nanos / 1_000_000
        default:
            return nil
        }
    }

    // MARK: - URLSessionWebSocketDelegate (URLSession queue)

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        onMain { self.opened(webSocketTask) }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onMain {
            guard webSocketTask === self.task else { return }
            self.finish(reason: "closed_\(closeCode.rawValue)", notify: true)
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        onMain {
            guard let socketTask = task as? URLSessionWebSocketTask, socketTask === self.task else { return }
            self.finish(reason: error == nil ? "completed" : "error", notify: true)
        }
    }
}
