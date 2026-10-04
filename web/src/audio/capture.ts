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

  get running(): boolean {
    return this.node !== null;
  }

  async start(onFrame: FrameHandler): Promise<void> {
    if (this.node) {
      this.handler = onFrame;
      return;
    }
    this.handler = onFrame;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    // Some browsers refuse 16 kHz; the worklet resamples from the real rate.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    this.context = ctx;
    await ctx.audioWorklet.addModule("./worklet.js");
    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data instanceof Int16Array) this.handler?.(data);
    };
    source.connect(node);
    this.node = node;
    if (ctx.state === "suspended") await ctx.resume();
  }

  stop(): void {
    this.node?.disconnect();
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.handler = null;
  }
}
