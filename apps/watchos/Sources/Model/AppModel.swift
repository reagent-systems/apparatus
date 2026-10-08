import Combine
import Foundation
import WatchKit

/// The one object behind the screen. It owns the server socket, the Live
/// session, the audio engine and the voice gate, and relays between them per
/// agent-kit/docs/PROTOCOL.md "Live session wiring (client side)".
///
/// A call is a phone call through the watch: `toggleCall` starts one (claim
/// the voice session, open Live, open the microphone for the whole call) or
/// hangs up (end any turn, stop playback, close Live, release the microphone,
/// the audio session and the voice claim). While the call runs the gate
/// (Gate/Gate.swift, open-mic mode, thresholds from `ready.gate`) decides
/// every turn: `activityStart` / `activityEnd` go out from its events, and
/// voice that clears its barge-in bar stops the agent's playback. The Live
/// setup from `/token` keeps automatic activity detection off.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    /// The orb's voice state, mapped as in apps/web/src/App.tsx.
    @Published private(set) var orbState: OrbVoiceState = .connecting
    @Published private(set) var inCall = false
    /// Another device holds the voice session.
    @Published private(set) var otherHoldsVoice = false

    private let socket = ServerSocket()
    private let audio = AudioEngine()
    /// Built at the first `ready` from its `gate` table, as on the web.
    private var gate: VoiceGate?
    private var live: LiveSession?
    private var liveReady = false
    private var openingLive = false
    private var connected = false
    /// `ready` seen on the open socket. A claim goes out only then.
    private var serverReady = false
    private var deviceId: String?
    private var voiceHolder: String?
    /// `voice.claim` sent for this call, `voice.granted` not yet seen.
    private var claimPending = false
    /// This call has held the voice session. Another holder after a
    /// reconnect then took it.
    private var callHeldVoice = false
    private var micAllowed: Bool?
    /// Mutes the rest of a reply the user talked over.
    private var reply = ReplyLatch()

    /// Gate output and event turns from before `setupComplete`.
    private var liveQueue: [LiveOut] = []
    private var pendingEvents: [String] = []
    private var jobsRunning = Set<String>()
    private var userText = ""
    private var agentText = ""

    private var resumptionHandle: String?
    private var idleCloseSeconds: TimeInterval = Config.idleCloseSeconds
    private var idleWork: DispatchWorkItem?
    private var sentAudioBytes = 0
    private var receivedAudioBytes = 0
    private var pushToken: String?
    private var pushSent = false

    private let queuedAudioLimit = 1500  // 30 s of 20 ms frames

    private enum LiveOut {
        case activityStart
        case audio(Data)
        case activityEnd
    }

    private var holdsVoice: Bool { deviceId != nil && voiceHolder == deviceId }

    private init() {
        socket.onMessage = { [weak self] message in self?.handleServer(message) }
        socket.onOpen = { [weak self] in
            self?.connected = true
            self?.updateOrb()
        }
        socket.onClose = { [weak self] in
            guard let self else { return }
            self.connected = false
            self.serverReady = false
            self.pushSent = false
            // The server frees the voice session of a device that drops; the
            // next `ready` says who holds it. A call keeps running meanwhile:
            // Live is a direct socket, and C2S messages wait in the outbox.
            self.voiceHolder = nil
            self.claimPending = false
            self.updateOrb()
        }
        audio.onChunk = { [weak self] chunk in onMain { self?.handleChunk(chunk) } }
        audio.onPlaybackDrained = { [weak self] in onMain { self?.playbackDrained() } }
    }

    // MARK: - Intents

    func connect() {
        socket.connect()
    }

    /// The one gesture: a tap anywhere starts or ends the call.
    func toggleCall() {
        if inCall {
            endCall(reason: "user")
        } else {
            startCall()
        }
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

    // MARK: - The call

    private func startCall() {
        // A tap before the first `ready` (or with the server unreachable)
        // starts the call too: the claim goes out at `ready`, and the gate,
        // built there from `ready.gate`, takes the microphone from then on.
        guard !inCall else { return }
        inCall = true
        callHeldVoice = false
        WKInterfaceDevice.current().play(.start)
        if holdsVoice {
            callHeldVoice = true
            openLive()
        } else {
            claimVoice()
        }
        Task { [weak self] in
            guard let self else { return }
            if self.micAllowed == nil { self.micAllowed = await AudioEngine.requestPermission() }
            // Asked on the first call, not at launch, so the first screen is
            // the orb alone. Approvals arrive as alerts from then on.
            await Notifier.requestAuthorizationOnce()
            guard self.inCall else { return }
            guard self.micAllowed == true else {
                self.endCall(reason: "microphone_denied")
                return
            }
            do {
                try self.audio.start()
            } catch {
                self.endCall(reason: "audio_failed")
            }
        }
        touchIdle()
        updateOrb()
    }

    /// `voice.claim`, on a socket that has seen `ready`. Before that the
    /// claim waits for the `ready` handler, which knows who holds the voice
    /// session; a claim queued in the outbox would go out unchecked.
    private func claimVoice() {
        guard serverReady, !claimPending else { return }
        claimPending = true
        socket.send(["type": "voice.claim"])
    }

    /// Hang-up, by the user or because the call cannot go on. Every resource
    /// the call took is released here.
    private func endCall(reason: String, releaseVoice: Bool = true) {
        guard inCall else { return }
        inCall = false
        // A turn still open ends here; its activityEnd goes out before close.
        gate?.stopAll()
        closeLive(reason: reason)
        audio.stop()
        reply.end()
        liveQueue.removeAll()
        pendingEvents.removeAll()
        userText = ""
        agentText = ""
        if releaseVoice && (holdsVoice || claimPending) {
            socket.send(["type": "voice.release"])
            if holdsVoice { voiceHolder = nil }
        }
        claimPending = false
        cancelIdle()
        WKInterfaceDevice.current().play(.stop)
        updateOrb()
    }

    // MARK: - Server messages (S2C)

    private func handleServer(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        switch type {
        case "ready":
            serverReady = true
            // A new connection: no claim of this watch is in flight on it.
            claimPending = false
            deviceId = message["device_id"] as? String
            voiceHolder = message["voice_holder"] as? String
            if let n = JSONScalar.number((message["live"] as? [String: Any])?["idle_close_seconds"]), n > 0 {
                idleCloseSeconds = n
            }
            if gate == nil { makeGate(GateConfig.merged(message["gate"] as? [String: Any])) }
            let jobs = message["jobs"] as? [[String: Any]] ?? []
            jobsRunning = Set(jobs.compactMap { $0["job_id"] as? String })
            sendPushIfNeeded()
            if inCall && holdsVoice {
                callHeldVoice = true
                openLive()
            } else if inCall {
                // The server freed this watch's voice session when the socket
                // dropped. Another holder now means another device took it
                // meanwhile: the call ends, as on `voice.revoked`. A call that
                // never held it claims it, as the tap would have.
                if voiceHolder != nil && callHeldVoice {
                    endCall(reason: "revoked", releaseVoice: false)
                } else {
                    claimVoice()
                }
            }

        case "voice.granted":
            claimPending = false
            voiceHolder = deviceId
            if inCall {
                callHeldVoice = true
                openLive()
            } else {
                // Granted after a hang-up: give it straight back.
                socket.send(["type": "voice.release"])
                voiceHolder = nil
            }

        case "voice.revoked":
            voiceHolder = message["by"] as? String
            claimPending = false
            endCall(reason: "revoked", releaseVoice: false)

        case "job.started":
            if let id = message["job_id"] as? String { jobsRunning.insert(id) }
            if live != nil { touchIdle() }

        case "job.progress":
            if live != nil { touchIdle() }

        case "job.done":
            if let id = message["job_id"] as? String { jobsRunning.remove(id) }
            if live != nil { touchIdle() }

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
            break  // transcript, show, credits, signal, control, error, pong
        }

        // Only a call speaks events; with no call open they are dropped, as
        // on the web.
        if inCall, holdsVoice, let voice = message["voice"] as? String, !voice.isEmpty {
            speakEvent(voice)
        }
        updateOrb()
    }

    private func speakEvent(_ text: String) {
        if liveReady, let live {
            live.sendEventTurn(text)
        } else {
            pendingEvents.append(text)
        }
        touchIdle()
    }

    private func sendPushIfNeeded() {
        guard let pushToken, connected, !pushSent else { return }
        pushSent = true
        socket.send(["type": "push.register", "platform": "apns", "token": pushToken])
    }

    // MARK: - Gate

    private func makeGate(_ config: GateConfig) {
        let gate = VoiceGate(config: config, isModelSpeaking: { [audio] in audio.isSpeaking })
        gate.onEvent = { [weak self] event in self?.handleGate(event) }
        self.gate = gate
    }

    /// Frames before the first `ready` (no gate yet) are dropped.
    private func handleChunk(_ chunk: Data) {
        guard inCall, let gate else { return }
        gate.pushFrame(PCMFrame(pcm16le: chunk))
    }

    private func handleGate(_ event: GateEvent) {
        switch event {
        case .speechStart:
            userText = ""
            sendLive(.activityStart)
            touchIdle()
            updateOrb()
        case .audio(let frame):
            sendLive(.audio(frame.pcm16le))
        case .speechEnd:
            sendLive(.activityEnd)
            touchIdle()
            updateOrb()
        case .bargeIn:
            // Voice cleared the barge-in bar while the agent spoke: playback
            // stops now, inside gate.bargein_stop_ms, and the rest of the
            // reply, still in flight until `interrupted`, stays silent.
            reply.interrupt()
            audio.flushPlayback()
            updateOrb()
        case .drop:
            break
        }
    }

    private func sendLive(_ item: LiveOut) {
        if liveReady, let live {
            send(item, to: live)
            return
        }
        guard inCall else { return }
        if case .audio = item, liveQueue.count >= queuedAudioLimit { return }
        liveQueue.append(item)
    }

    private func send(_ item: LiveOut, to live: LiveSession) {
        switch item {
        case .activityStart: live.sendActivityStart()
        case .activityEnd: live.sendActivityEnd()
        case .audio(let pcm):
            sentAudioBytes += pcm.count
            live.sendAudio(pcm)
        }
    }

    // MARK: - Live session

    private func openLive() {
        guard inCall, holdsVoice, live == nil, !openingLive else { return }
        openingLive = true
        Task { [weak self] in
            guard let self else { return }
            do {
                let token = try await TokenClient.fetch()
                self.openingLive = false
                guard self.inCall, self.holdsVoice, self.live == nil else { return }
                if let seconds = token.idleCloseSeconds { self.idleCloseSeconds = seconds }
                var setup = token.setup
                if let handle = self.resumptionHandle ?? token.resumptionHandle {
                    setup = LiveSession.injectResumption(handle, into: setup)
                }
                let session = LiveSession(setup: setup)
                session.onEvent = { [weak self] event in self?.handleLive(event) }
                self.live = session
                session.connect(token: token.token)
                self.touchIdle()
            } catch {
                self.openingLive = false
                self.socket.send(["type": "live.closed", "reason": "token_failed"])
                self.endCall(reason: "token_failed")
            }
        }
    }

    /// Closes the Live socket and reports it. The call state is the caller's.
    private func closeLive(reason: String) {
        openingLive = false
        liveReady = false
        reply.end()
        if let session = live {
            live = nil
            session.onEvent = nil
            session.close(reason: reason)
            socket.send(["type": "live.closed", "reason": reason])
        }
    }

    private func handleLive(_ event: LiveEvent) {
        switch event {
        case .setupComplete:
            liveReady = true
            if let live {
                for item in liveQueue { send(item, to: live) }
                for text in pendingEvents { live.sendEventTurn(text) }
            }
            liveQueue.removeAll()
            pendingEvents.removeAll()
            touchIdle()

        case .audio(let pcm, let rate):
            receivedAudioBytes += pcm.count
            if reply.audio() { audio.play(pcm16: pcm, sampleRate: rate) }
            touchIdle()

        case .interrupted:
            audio.flushPlayback()
            reply.end()

        case .generationComplete:
            reply.end()

        case .turnComplete:
            reply.end()
            if !agentText.isEmpty {
                relayTranscript(role: "agent", text: agentText, final: true)
                agentText = ""
            }
            if !userText.isEmpty {
                relayTranscript(role: "user", text: userText, final: true)
                userText = ""
            }
            touchIdle()

        case .inputTranscription(let text, let finished):
            userText += text
            gate?.setTranscript(userText)
            relayTranscript(role: "user", text: userText, final: finished)
            if finished { userText = "" }

        case .outputTranscription(let text, let finished):
            agentText += text
            relayTranscript(role: "agent", text: agentText, final: finished)
            if finished { agentText = "" }

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
            // The call goes on; a turn that is open restarts on the new one.
            closeLive(reason: "go_away")
            if gate?.isOpen == true { liveQueue.append(.activityStart) }
            openLive()

        case .closed(let reason):
            // The Live session ended by itself (error, server drop): so does
            // the call.
            endCall(reason: reason)
        }
        updateOrb()
    }

    private func relayTranscript(role: String, text: String, final: Bool) {
        socket.send(["type": "transcript", "role": role, "text": text, "final": final])
    }

    private func playbackDrained() {
        updateOrb()
        if live != nil { touchIdle() }
    }

    // MARK: - Idle close (config [live] idle_close_seconds)

    private func touchIdle() {
        cancelIdle()
        guard inCall else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.idleWork = nil
                if self.gate?.isOpen == true || self.audio.isSpeaking {
                    self.touchIdle()
                    return
                }
                self.endCall(reason: "idle")
            }
        }
        idleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + idleCloseSeconds, execute: work)
    }

    private func cancelIdle() {
        idleWork?.cancel()
        idleWork = nil
    }

    // MARK: - Orb

    private func updateOrb() {
        let state: OrbVoiceState
        if !connected {
            state = .connecting
        } else if gate?.isOpen == true {
            state = .listening
        } else if audio.isSpeaking {
            state = .speaking
        } else if !jobsRunning.isEmpty {
            state = .working
        } else {
            state = .idle
        }
        if orbState != state { orbState = state }
        let other = voiceHolder != nil && voiceHolder != deviceId
        if otherHoldsVoice != other { otherHoldsVoice = other }
    }
}
