// Microphone capture: 16 kHz mono, 20 ms Int16 frames.
//
// Echo cancellation, noise suppression and gain control come from the
// browser/OS voice processing (gate steps 1 and 2). The AEC reference is
// whatever the OS mixes to the default output, which includes our playback
// context; there is no way to hand it our output node directly.

export type FrameHandler = (frame: Int16Array) => void;

export class Capture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private handler: FrameHandler | null = null;
  /** The start in progress, so a second start joins it. */
  private starting: Promise<void> | null = null;
  /** Bumped by `stop`: a start that awaited across a stop gives back what it took. */
  private epoch = 0;

  get running(): boolean {
    return this.node !== null || this.starting !== null;
  }

  start(onFrame: FrameHandler): Promise<void> {
    this.handler = onFrame;
    if (this.node) return Promise.resolve();
    if (!this.starting) {
      const epoch = this.epoch;
      this.starting = this.open(epoch).finally(() => {
        if (this.epoch === epoch) this.starting = null;
      });
    }
    return this.starting;
  }

  private async open(epoch: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    if (epoch !== this.epoch) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    // Some browsers refuse 16 kHz; the worklet resamples from the real rate.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    this.context = ctx;
    await ctx.audioWorklet.addModule("./worklet.js");
    if (epoch !== this.epoch) return;
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data instanceof Int16Array) this.handler?.(data);
    };
    source.connect(node);
    this.node = node;
    if (ctx.state === "suspended") await ctx.resume();
  }

  /** Stop and release the microphone, also during a start: that start then gives the tracks back. */
  stop(): void {
    this.epoch += 1;
    this.starting = null;
    this.node?.disconnect();
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.handler = null;
  }
}
