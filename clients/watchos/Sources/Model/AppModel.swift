import Combine
import Foundation

/// The one object behind the UI. It owns the server socket, the Live
/// session and the audio engine, and relays between them per
/// agent-kit/docs/PROTOCOL.md "Live session wiring (client side)".
///
/// Push to talk only: `pressTalk` opens a turn with `activityStart`,
/// `releaseTalk` closes it with `activityEnd`. No gate runs on the watch.
@MainActor
final class AppModel: ObservableObject {
    enum State { case idle, listening, speaking, working }

    static let shared = AppModel()

    @Published private(set) var state: State = .idle
    /// Spoken lines, oldest first. The only text the screen shows.
    @Published private(set) var feed: [String] = []
    @Published private(set) var connected = false

    private let socket = ServerSocket()
    private let audio = AudioEngine()
    private var live: LiveSession?
    private var liveReady = false
    private var openingLive = false
    private var voiceHeld = false
    private var micAllowed: Bool?

    // Turn state.
    private var talking = false
    private var turnOpen = false
    private var pendingAudio: [Data] = []
    private var pendingEnd = false
    private var pendingEvents: [String] = []
    private var awaitingReply = false
    private var speaking = false
    private var jobsRunning = Set<String>()

    // Feed lines under construction (indices into `feed`).
    private var userLine: Int?
    private var agentLine: Int?

    // Session bookkeeping.
    private var resumptionHandle: String?
    private var idleCloseSeconds: TimeInterval = Config.idleCloseSeconds
    private var idleWork: DispatchWorkItem?
    private var sentAudioBytes = 0
    private var receivedAudioBytes = 0
    private var pushToken: String?
    private var pushSent = false

    private let feedLimit = 20
    private let pendingAudioLimit = 1500  // 30 s of 20 ms chunks

    private init() {
        socket.onMessage = { [weak self] message in self?.handleServer(message) }
        socket.onOpen = { [weak self] in self?.connected = true }
        socket.onClose = { [weak self] in
            guard let self else { return }
            self.connected = false
            self.pushSent = false
            self.voiceHeld = false
            self.closeLive(reason: "socket_closed", report: false)
        }
        audio.onChunk = { [weak self] chunk in onMain { self?.handleChunk(chunk) } }
        audio.onPlaybackDrained = { [weak self] in onMain { self?.playbackDrained() } }
    }

    // MARK: - Intents

    func connect() {
        socket.connect()
    }

    func pressTalk() {
        guard !talking else { return }
        talking = true
        // The Talk button is the manual barge-in: playback stops at once.
        if speaking {
            audio.flushPlayback()
            speaking = false
        }
        awaitingReply = false
        finishAgentLine()
        finishUserLine()
        cancelIdle()
        if !voiceHeld, connected { socket.send(["type": "voice.claim"]) }
        audio.setCapturing(true)
        if liveReady, let live {
            live.sendActivityStart()
            turnOpen = true
        } else {
            openLive()
        }
        updateState()
    }

    func releaseTalk() {
        guard talking else { return }
        talking = false
        if let rest = audio.setCapturing(false) { handleChunk(rest) }
        if liveReady, let live, turnOpen {
            live.sendActivityEnd()
            turnOpen = false
            awaitingReply = true
        } else if !liveReady {
            pendingEnd = true
            awaitingReply = true
        }
        updateState()
        touchIdle()
    }

    /// Stops the voice now. Jobs keep running (design spec, barge-in).
    func stop() {
        audio.flushPlayback()
        speaking = false
        awaitingReply = false
        if talking { releaseTalk() }
        finishAgentLine()
        updateState()
        touchIdle()
    }

    func answerApproval(_ approvalId: String, approved: Bool) {
        socket.connect()
        socket.send(["type": "approval.answer", "approval_id": approvalId, "approved": approved])
        Notifier.remove(id: "approval-\(approvalId)")
    }

    /// APNs device token, hex. Sent as `push.register` on every connection.
    func registerPush(token: String) {
        pushToken = token
        pushSent = false
        sendPushIfNeeded()
    }

    // MARK: - Server messages (S2C)

    private func handleServer(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        switch type {
        case "ready":
            if let n = JSON.int((message["live"] as? [String: Any])?["idle_close_seconds"]), n > 0 {
                idleCloseSeconds = TimeInterval(n)
            }
            sendPushIfNeeded()
            socket.send(["type": "voice.claim"])

        case "voice.granted":
            voiceHeld = true
            openLive()

        case "voice.revoked":
            voiceHeld = false
            closeLive(reason: "revoked", report: true)

        case "transcript":
            // Lines from the device that holds the voice. Ours come from Live.
            if !voiceHeld, let text = message["text"] as? String { appendLine(text) }

        case "job.started":
            if let id = message["job_id"] as? String { jobsRunning.insert(id) }
            updateState()

        case "job.done":
            if let id = message["job_id"] as? String { jobsRunning.remove(id) }
            if !voiceHeld, let say = message["say"] as? String { appendLine(say) }
            updateState()

        case "handoff.requested":
            // No screen for the VM on a watch: notification only.
            if let id = message["handoff_id"] as? String { Notifier.handoff(id: id) }

        case "handoff.ended":
            if let id = message["handoff_id"] as? String { Notifier.remove(id: "handoff-\(id)") }

        case "approval.requested":
            if let id = message["approval_id"] as? String {
                Notifier.approval(id: id,
                                  action: message["action"] as? String ?? "",
                                  details: message["details"] as? String ?? "")
            }

        case "approval.ended":
            if let id = message["approval_id"] as? String { Notifier.remove(id: "approval-\(id)") }

        case "tool.result":
            guard let callId = message["call_id"] as? String, let name = message["name"] as? String else { break }
            live?.sendToolResponse(id: callId, name: name,
                                   response: message["response"] as? [String: Any] ?? [:],
                                   scheduling: message["scheduling"] as? String)

        default:
            break  // show, credits, signal, error, pong, job.progress
        }

        if voiceHeld, let voice = message["voice"] as? String, !voice.isEmpty {
            speakEvent(voice)
        }
    }

    private func speakEvent(_ text: String) {
        if liveReady, let live {
            live.sendEventTurn(text)
            awaitingReply = true
            updateState()
        } else {
            pendingEvents.append(text)
            openLive()
        }
        touchIdle()
    }

    private func sendPushIfNeeded() {
        guard let pushToken, connected, !pushSent else { return }
        pushSent = true
        socket.send(["type": "push.register", "platform": "apns", "token": pushToken])
    }

    // MARK: - Live session

    private func openLive() {
        guard voiceHeld, live == nil, !openingLive else { return }
        openingLive = true
        Task { [weak self] in
            guard let self else { return }
            if self.micAllowed == nil { self.micAllowed = await AudioEngine.requestPermission() }
            do {
                let token = try await TokenClient.fetch()
                guard self.voiceHeld, self.live == nil else {
                    self.openingLive = false
                    return
                }
                if let seconds = token.idleCloseSeconds { self.idleCloseSeconds = seconds }
                var setup = token.setup
                if let handle = self.resumptionHandle ?? token.resumptionHandle {
                    setup = LiveSession.injectResumption(handle, into: setup)
                }
                let session = LiveSession(setup: setup)
                session.onEvent = { [weak self] event in self?.handleLive(event) }
                self.live = session
                self.startAudio()
                session.connect(token: token.token)
            } catch {
                self.openingLive = false
                self.dropPendingTurn()
                self.updateState()
            }
        }
    }

    private func startAudio() {
        guard micAllowed == true, !audio.isRunning else { return }
        try? audio.start()
    }

    private func closeLive(reason: String, report: Bool) {
        openingLive = false
        liveReady = false
        turnOpen = false
        dropPendingTurn()
        pendingEvents.removeAll()
        cancelIdle()
        if let session = live {
            live = nil
            session.onEvent = nil
            session.close(reason: reason)
            if report { socket.send(["type": "live.closed", "reason": reason]) }
        }
        audio.stop()
        speaking = false
        awaitingReply = false
        finishAgentLine()
        finishUserLine()
        updateState()
    }

    private func dropPendingTurn() {
        pendingAudio.removeAll()
        pendingEnd = false
        if talking {
            talking = false
            audio.setCapturing(false)
        }
    }

    private func handleLive(_ event: LiveEvent) {
        switch event {
        case .setupComplete:
            liveReady = true
            openingLive = false
            flushPendingTurn()
            for text in pendingEvents { live?.sendEventTurn(text) }
            if !pendingEvents.isEmpty { awaitingReply = true }
            pendingEvents.removeAll()
            updateState()
            touchIdle()

        case .audio(let pcm, let rate):
            receivedAudioBytes += pcm.count
            awaitingReply = false
            speaking = true
            audio.play(pcm16: pcm, sampleRate: rate)
            updateState()
            touchIdle()

        case .interrupted:
            audio.flushPlayback()
            speaking = false
            awaitingReply = false
            finishAgentLine()
            updateState()

        case .turnComplete:
            awaitingReply = false
            finishAgentLine()
            finishUserLine()
            updateState()
            touchIdle()

        case .inputTranscription(let text, let finished):
            appendUser(text, finished: finished)

        case .outputTranscription(let text, let finished):
            appendAgent(text, finished: finished)

        case .toolCall(let calls):
            for call in calls {
                socket.send(["type": "tool.call", "call_id": call.id, "name": call.name, "args": call.args])
            }
            touchIdle()

        case .toolCallCancellation:
            break

        case .usage(let usage):
            socket.send([
                "type": "live.usage",
                "audio_in_ms": sentAudioBytes * 1000 / (Int(Config.liveInputRate) * 2),
                "audio_out_ms": receivedAudioBytes * 1000 / (Int(Config.liveOutputRate) * 2),
                "input_tokens": usage.inputTokens,
                "output_tokens": usage.outputTokens,
            ])
            sentAudioBytes = 0
            receivedAudioBytes = 0

        case .resumption(let handle, _):
            if let handle {
                resumptionHandle = handle
                socket.send(["type": "live.resumption", "handle": handle])
            }

        case .goAway:
            // Fresh token, same handle, before the server closes the socket.
            closeLive(reason: "go_away", report: true)
            openLive()

        case .closed(let reason):
            closeLive(reason: reason, report: true)
        }
    }

    /// Audio captured before `setupComplete` goes out as one turn.
    private func flushPendingTurn() {
        guard let live, liveReady else { return }
        guard talking || pendingEnd || !pendingAudio.isEmpty else { return }
        live.sendActivityStart()
        turnOpen = true
        for chunk in pendingAudio { live.sendAudio(chunk) }
        pendingAudio.removeAll()
        if pendingEnd {
            live.sendActivityEnd()
            turnOpen = false
            pendingEnd = false
            awaitingReply = true
        }
    }

    private func handleChunk(_ chunk: Data) {
        sentAudioBytes += chunk.count
        if liveReady, let live {
            if !turnOpen {
                live.sendActivityStart()
                turnOpen = true
            }
            live.sendAudio(chunk)
        } else if pendingAudio.count < pendingAudioLimit {
            pendingAudio.append(chunk)
        }
    }

    private func playbackDrained() {
        speaking = false
        updateState()
        touchIdle()
    }

    // MARK: - Idle close (config [live] idle_close_seconds)

    private func touchIdle() {
        cancelIdle()
        guard live != nil else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.idleWork = nil
                guard !self.talking, !self.speaking, !self.awaitingReply, self.jobsRunning.isEmpty else {
                    self.touchIdle()
                    return
                }
                self.closeLive(reason: "idle", report: true)
            }
        }
        idleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + idleCloseSeconds, execute: work)
    }

    private func cancelIdle() {
        idleWork?.cancel()
        idleWork = nil
    }

    // MARK: - Feed

    private func updateState() {
        if talking {
            state = .listening
        } else if speaking {
            state = .speaking
        } else if awaitingReply || !jobsRunning.isEmpty {
            state = .working
        } else {
            state = .idle
        }
    }

    private func appendLine(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        feed.append(trimmed)
        trimFeed()
    }

    private func appendUser(_ fragment: String, finished: Bool) {
        userLine = extend(line: userLine, with: fragment)
        if finished { finishUserLine() }
    }

    private func appendAgent(_ fragment: String, finished: Bool) {
        agentLine = extend(line: agentLine, with: fragment)
        if finished { finishAgentLine() }
    }

    /// Adds a transcription fragment to the line at `index`, or starts one.
    private func extend(line index: Int?, with fragment: String) -> Int? {
        guard !fragment.isEmpty else { return index }
        if let index, feed.indices.contains(index) {
            feed[index] += fragment
            return index
        }
        let trimmed = fragment.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        feed.append(trimmed)
        trimFeed()
        return feed.count - 1
    }

    private func finishUserLine() {
        guard let index = userLine else { return }
        userLine = nil
        relayTranscript(role: "user", index: index)
    }

    private func finishAgentLine() {
        guard let index = agentLine else { return }
        agentLine = nil
        relayTranscript(role: "agent", index: index)
    }

    private func relayTranscript(role: String, index: Int) {
        guard feed.indices.contains(index) else { return }
        let text = feed[index].trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            feed.remove(at: index)
            return
        }
        feed[index] = text
        socket.send(["type": "transcript", "role": role, "text": text, "final": true])
    }

    private func trimFeed() {
        let overflow = feed.count - feedLimit
        guard overflow > 0 else { return }
        feed.removeFirst(overflow)
        if let u = userLine { userLine = u - overflow >= 0 ? u - overflow : nil }
        if let a = agentLine { agentLine = a - overflow >= 0 ? a - overflow : nil }
    }
}
