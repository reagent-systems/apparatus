// AudioWorkletProcessor: downmix to mono, resample to 16 kHz when the
// context runs at another rate, chunk to 320 samples (20 ms), post Int16.
// Built as its own entry: dist/worklet.js.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

const TARGET_RATE = 16000;
const FRAME = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private pending = new Float32Array(FRAME);
  private fill = 0;
  private readonly ratio = sampleRate / TARGET_RATE;
  private phase = 0;
  private last = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += input[c][i];
      s /= channels;
      if (this.ratio === 1) {
        this.push(s);
      } else {
        // linear interpolation between the previous and current sample
        while (this.phase < 1) {
          this.push(this.last + (s - this.last) * this.phase);
          this.phase += this.ratio;
        }
        this.phase -= 1;
        this.last = s;
      }
    }
    return true;
  }

  private push(sample: number): void {
    this.pending[this.fill++] = sample;
    if (this.fill === FRAME) {
      const out = new Int16Array(FRAME);
      for (let i = 0; i < FRAME; i++) {
        const v = Math.max(-1, Math.min(1, this.pending[i]));
        out[i] = v < 0 ? v * 32768 : v * 32767;
      }
      this.port.postMessage(out, [out.buffer]);
      this.fill = 0;
    }
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

export {};
