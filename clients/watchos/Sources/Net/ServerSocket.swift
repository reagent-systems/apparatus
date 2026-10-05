import Foundation

/// The one authenticated WebSocket to the session server (`/ws/client`).
/// C2S and S2C messages per agent-kit/docs/PROTOCOL.md. Call every method
/// on the main actor; URLSession callbacks hop to it before touching state.
///
/// - Sends `hello` on open, then flushes messages queued while closed
///   (`Outbox`: bounded, and never at the cost of a control message).
/// - Reconnects with exponential backoff (1 s to 30 s, jittered).
/// - Sends a protocol `ping` every 20 s.
@MainActor
final class ServerSocket: NSObject, URLSessionWebSocketDelegate {
    var onMessage: (@MainActor ([String: Any]) -> Void)?
    var onOpen: (@MainActor () -> Void)?
    var onClose: (@MainActor () -> Void)?

    private(set) var isOpen = false

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var wantsConnection = false
    private var attempt = 0
    private var outbox = Outbox(limit: 32)
    private var pingTimer: DispatchSourceTimer?
    private var reconnectWork: DispatchWorkItem?

    private let pingInterval: TimeInterval = 20

    override init() {
        super.init()
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    func connect() {
        wantsConnection = true
        guard task == nil else { return }
        open()
    }

    func disconnect() {
        wantsConnection = false
        reconnectWork?.cancel()
        reconnectWork = nil
        stopPing()
        let current = task
        task = nil
        isOpen = false
        current?.cancel(with: .normalClosure, reason: nil)
    }

    /// Sends one C2S message. While the socket is closed the message waits
    /// in the outbox and goes out after the next `hello`.
    func send(_ message: [String: Any]) {
        guard isOpen, let task, let text = JSON.encodeString(message) else {
            outbox.append(message)
            return
        }
        task.send(.string(text)) { [weak self] error in
            guard error != nil else { return }
            onMain { self?.failed(task) }
        }
    }

    // MARK: - Connection

    private func open() {
        var parts = URLComponents(url: Config.socketOrigin.appendingPathComponent("ws/client"),
                                  resolvingAgainstBaseURL: false)!
        parts.queryItems = [
            URLQueryItem(name: "auth", value: Config.auth),
            URLQueryItem(name: "device", value: Config.device),
        ]
        let newTask = session.webSocketTask(with: parts.url!)
        task = newTask
        newTask.resume()
        receive(on: newTask)
    }

    private func receive(on socketTask: URLSessionWebSocketTask) {
        socketTask.receive { [weak self] result in
            onMain {
                guard let self, self.task === socketTask else { return }
                switch result {
                case .failure:
                    self.failed(socketTask)
                case .success(let frame):
                    var text: String?
                    switch frame {
                    case .string(let s): text = s
                    case .data(let d): text = String(data: d, encoding: .utf8)
                    @unknown default: text = nil
                    }
                    if let text, let object = JSON.decode(text), object["type"] is String {
                        self.onMessage?(object)
                    }
                    self.receive(on: socketTask)
                }
            }
        }
    }

    private func opened(_ socketTask: URLSessionWebSocketTask) {
        guard socketTask === task else { return }
        isOpen = true
        attempt = 0
        // The watch takes the voice session only for a call (`voice.claim`
        // on tap), so connecting never takes it from another device.
        send(["type": "hello", "device": Config.device, "wants_voice": false])
        outbox.drain().forEach { send($0) }
        startPing()
        onOpen?()
    }

    private func failed(_ socketTask: URLSessionWebSocketTask) {
        guard socketTask === task else { return }
        let wasOpen = isOpen
        isOpen = false
        task = nil
        stopPing()
        socketTask.cancel(with: .goingAway, reason: nil)
        if wasOpen { onClose?() }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard wantsConnection, reconnectWork == nil else { return }
        let exponent = Double(min(attempt, 5))
        attempt += 1
        let delay = min(30.0, pow(2.0, exponent)) * Double.random(in: 0.8...1.25)
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.reconnectWork = nil
                guard self.wantsConnection, self.task == nil else { return }
                self.open()
            }
        }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: - Keepalive

    private func startPing() {
        stopPing()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + pingInterval, repeating: pingInterval)
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.send(["type": "ping"]) }
        }
        timer.resume()
        pingTimer = timer
    }

    private func stopPing() {
        pingTimer?.cancel()
        pingTimer = nil
    }

    // MARK: - URLSessionWebSocketDelegate (URLSession queue)

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        onMain { self.opened(webSocketTask) }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onMain { self.failed(webSocketTask) }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let socketTask = task as? URLSessionWebSocketTask else { return }
        onMain { self.failed(socketTask) }
    }
}
