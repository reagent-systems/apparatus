import Foundation

/// One 20 ms frame of 16 kHz mono PCM. A class, so the gate hands back the
/// very frame it buffered: the shared vectors identify audio events by frame
/// identity, as the web gate's `Int16Array` events are.
final class PCMFrame {
    let samples: [Int16]

    init(_ samples: [Int16]) {
        self.samples = samples
    }

    /// pcm16le bytes, as Gemini Live takes them.
    convenience init(pcm16le data: Data) {
        let count = data.count / MemoryLayout<Int16>.size
        var samples = [Int16](repeating: 0, count: count)
        data.withUnsafeBytes { raw in
            for i in 0..<count {
                samples[i] = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
            }
        }
        self.init(samples)
    }

    var pcm16le: Data {
        var data = Data(capacity: samples.count * 2)
        for s in samples {
            let le = s.littleEndian
            withUnsafeBytes(of: le) { data.append(contentsOf: $0) }
        }
        return data
    }
}

/// RMS of a frame on the [-1, 1] scale. Port of `frameRms` in
/// apps/web/src/gate/vad.ts, operation for operation, so the doubles match.
func frameRms(_ samples: [Int16]) -> Double {
    if samples.isEmpty { return 0 }
    let scale = 1.0 / 32768
    var sum = 0.0
    for s in samples {
        let v = Double(s) * scale
        sum += v * v
    }
    return (sum / Double(samples.count)).squareRoot()
}

/// `raw` is the per-frame decision. `active` adds the hangover: it stays true
/// for `hangoverMs` after the last raw frame, so a short dip inside a word
/// does not split a segment. Port of `EnergyVad` in apps/web/src/gate/vad.ts.
struct VadResult {
    let raw: Bool
    let active: Bool
    let energy: Double
}

final class EnergyVad {
    let threshold: Double
    let hangoverMs: Double
    let sampleRate: Double
    private var hangoverLeftMs = 0.0

    init(threshold: Double, hangoverMs: Double, sampleRate: Double = 16000) {
        self.threshold = threshold
        self.hangoverMs = hangoverMs
        self.sampleRate = sampleRate
    }

    func process(_ samples: [Int16]) -> VadResult {
        let frameMs = (Double(samples.count) / sampleRate) * 1000
        let energy = frameRms(samples)
        let raw = energy >= threshold
        let active = raw || hangoverLeftMs > 1e-6
        if raw {
            hangoverLeftMs = hangoverMs
        } else {
            hangoverLeftMs = max(0, hangoverLeftMs - frameMs)
        }
        return VadResult(raw: raw, active: active, energy: energy)
    }

    func reset() {
        hangoverLeftMs = 0
    }
}
