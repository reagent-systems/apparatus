// PCM16 playback queue. Model audio arrives as 24 kHz chunks; each becomes
// an AudioBuffer scheduled back to back. `stop()` cancels every scheduled
// source at once, well inside `bargein_stop_ms`.
//
// The output goes through `outputNode` to the context destination. Echo
// cancellation relies on the OS/browser AEC taking the device output as its
// reference; nothing here feeds the capture side directly.

export class Playback {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private endTime = 0;

  private ensure(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  /** The node every scheduled source connects to. */
  get outputNode(): AudioNode {
    this.ensure();
    return this.gain as GainNode;
  }

  /** Call from a user gesture so the context may start. */
  async unlock(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
  }

  enqueue(pcm16: Uint8Array, sampleRate: number): void {
    if (pcm16.byteLength < 2) return;
    const ctx = this.ensure();
    const samples = pcm16.byteLength >> 1;
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, samples * 2);
    const buffer = ctx.createBuffer(1, samples, sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputNode);
    const startAt = Math.max(this.nextTime, ctx.currentTime + 0.02);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.endTime = this.nextTime;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    if (ctx.state === "suspended") void ctx.resume();
  }

  /** Flush everything scheduled. Returns at once. */
  stop(): void {
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop(0);
        s.disconnect();
      } catch {
        // already ended
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.endTime = 0;
  }

  /** True while audio is scheduled or still sounding. */
  isSpeaking(): boolean {
    if (!this.context || this.sources.size === 0) return false;
    return this.context.currentTime < this.endTime;
  }
}
