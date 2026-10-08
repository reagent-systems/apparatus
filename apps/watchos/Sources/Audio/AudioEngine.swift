import AVFoundation
import Foundation

/// Microphone in, model voice out, for the length of one call.
///
/// Input: AVAudioEngine tap on the input node -> AVAudioConverter to
/// 16 kHz Int16 mono -> 20 ms chunks (640 bytes) to `onChunk`, the whole
/// time the engine runs: the microphone is open for the call and the voice
/// gate decides what leaves the watch. Output: AVAudioPlayerNode at 24 kHz;
/// `flushPlayback` drops every scheduled buffer at once (barge-in).
///
/// The session is playAndRecord + voiceChat with voice processing on the
/// input node: the speaker plays while the microphone is open, and Apple's
/// echo cancellation uses the output as its reference, so the model does
/// not hear itself from the watch speaker.
///
/// Public methods run on the main actor. `onChunk` runs on the audio
/// thread; `onPlaybackDrained` on the main queue. `isSpeaking` may be read
/// from any thread.
final class AudioEngine {
    var onChunk: (@Sendable (Data) -> Void)?
    var onPlaybackDrained: (@Sendable () -> Void)?

    private(set) var isRunning = false

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let captureFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                              sampleRate: Config.liveInputRate,
                                              channels: 1, interleaved: true)!
    private var playbackFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                               sampleRate: Config.liveOutputRate,
                                               channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private let chunkBytes = Int(Config.liveInputRate) * Config.chunkMilliseconds / 1000 * MemoryLayout<Int16>.size

    // Shared with the audio thread.
    private let lock = NSLock()
    private var pending = Data()
    private var scheduled = 0
    private var generation = 0

    private var interruptionObserver: NSObjectProtocol?

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
    }

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Lifecycle

    func start() throws {
        guard !isRunning else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [])
        try session.setActive(true)

        // Echo cancellation and gain control for AVAudioEngine come only
        // with voice processing on (AVAudioSession.Mode.voiceChat docs).
        // The simulator may refuse; capture still works without it.
        try? engine.inputNode.setVoiceProcessingEnabled(true)

        let hardwareFormat = engine.inputNode.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: hardwareFormat, to: captureFormat)
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: hardwareFormat) { [weak self] buffer, _ in
            self?.convertAndEmit(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            engine.inputNode.removeTap(onBus: 0)
            converter = nil
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
        player.play()
        isRunning = true
        observeInterruptions()
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        flushPlayback()
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil
        lock.lock()
        pending.removeAll()
        lock.unlock()
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
            self.interruptionObserver = nil
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Capture

    private func convertAndEmit(_ buffer: AVAudioPCMBuffer) {
        guard let converter, buffer.frameLength > 0 else { return }

        let ratio = captureFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: captureFormat, frameCapacity: capacity) else { return }

        var fed = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, outStatus in
            if fed {
                outStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, out.frameLength > 0, let channel = out.int16ChannelData else { return }

        var chunks: [Data] = []
        lock.lock()
        pending.append(UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength)))
        while pending.count >= chunkBytes {
            chunks.append(Data(pending.prefix(chunkBytes)))
            pending.removeFirst(chunkBytes)
        }
        lock.unlock()
        for chunk in chunks { onChunk?(chunk) }
    }

    // MARK: - Playback

    /// True while model audio is scheduled or still on its way to the
    /// speaker: the gate's "model speaking". A buffer counts until it has
    /// played back at the output (`.dataPlayedBack`, which includes the
    /// output latency), not until the player has consumed it, so echo of the
    /// agent's last words still meets the barge-in bar.
    var isSpeaking: Bool {
        lock.lock()
        defer { lock.unlock() }
        return scheduled > 0
    }

    /// Schedules pcm16le mono. Gemini emits 24 kHz; another rate reconnects
    /// the player once.
    func play(pcm16 data: Data, sampleRate: Double) {
        guard isRunning else { return }
        let frames = data.count / MemoryLayout<Int16>.size
        guard frames > 0 else { return }
        ensurePlaybackRate(sampleRate)

        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)),
              let channel = buffer.floatChannelData else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        let dst = channel[0]
        data.withUnsafeBytes { raw in
            for i in 0..<frames {
                let sample = raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self)
                dst[i] = Float(Int16(littleEndian: sample)) / 32768
            }
        }

        lock.lock()
        scheduled += 1
        let gen = generation
        lock.unlock()
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            self?.bufferDone(gen)
        }
        if !player.isPlaying { player.play() }
    }

    /// Drops every scheduled buffer now, well inside `gate.bargein_stop_ms`.
    func flushPlayback() {
        lock.lock()
        generation += 1
        scheduled = 0
        lock.unlock()
        player.stop()
        if isRunning { player.play() }
    }

    private func bufferDone(_ gen: Int) {
        lock.lock()
        guard gen == generation else {
            lock.unlock()
            return
        }
        scheduled = max(0, scheduled - 1)
        let drained = scheduled == 0
        lock.unlock()
        if drained {
            DispatchQueue.main.async { [weak self] in self?.onPlaybackDrained?() }
        }
    }

    private func ensurePlaybackRate(_ sampleRate: Double) {
        guard sampleRate > 0, sampleRate != playbackFormat.sampleRate,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate,
                                         channels: 1, interleaved: false) else { return }
        flushPlayback()
        player.stop()
        engine.disconnectNodeOutput(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        playbackFormat = format
        player.play()
    }

    // MARK: - Interruptions (calls, Siri)

    private func observeInterruptions() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let self, self.isRunning,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                self.flushPlayback()
            case .ended:
                try? AVAudioSession.sharedInstance().setActive(true)
                if !self.engine.isRunning { try? self.engine.start() }
                self.player.play()
            @unknown default:
                break
            }
        }
    }
}
